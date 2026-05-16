-- ════════════════════════════════════════════════════════════════════════
-- fix/deal-status-sync — Section 3 of APEX master operating prompt
--
-- Ships:
--   1. New columns on public.deals: policy_status_standard, status_updated_at
--   2. public.commission_ledger — paid/pending commissions per deal
--   3. public.commission_audit_log — rate resolution provenance
--   4. public.fn_commission_rate(agent_id, carrier_id) — override → contract → error
--   5. public.map_al_status(standardStatus) — Agent Link → APEX enum
--   6. public.agentlink_live_pull() — now refreshes status on CONFLICT
--   7. trigger trg_deal_status_transition — fires commission + retention side effects
--
-- Execute order (Section 14):
--   * migration creates schema
--   * agentlink_live_pull() backfill runs in a second step against /api/deals
-- ════════════════════════════════════════════════════════════════════════

-- 1. New columns on deals
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS policy_status_standard text,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_deals_status_updated_at ON public.deals(status_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_policy_status_standard ON public.deals(policy_status_standard);

-- Widen the status CHECK constraint to include charged_back (some older instances lack it)
DO $outer$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
    WHERE c.conname = 'deals_status_check';
  IF v_def NOT LIKE '%charged_back%' THEN
    ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_status_check;
    ALTER TABLE public.deals ADD CONSTRAINT deals_status_check
      CHECK (status IN ('draft','submitted','active','lapsed','cancelled','charged_back'));
  END IF;
END $outer$;

-- 2. commission_ledger
CREATE TABLE IF NOT EXISTS public.commission_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id               uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  agent_id              uuid NOT NULL REFERENCES public.agents(id) ON DELETE RESTRICT,
  carrier_id            uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  annual_premium        numeric NOT NULL,
  rate_pct              numeric NOT NULL,            -- the resolved rate (0-100)
  rate_source           text   NOT NULL,             -- 'override' | 'contract' | 'carrier_default'
  amount                numeric NOT NULL,            -- annual_premium * rate_pct / 100
  as_earned_pct         numeric DEFAULT 100,         -- 100 = full first-year book, else advance %
  expected_paid_date    date,
  actual_paid_date      date,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','paid','clawed_back','voided')),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE (deal_id)                                   -- one ledger row per deal
);
CREATE INDEX IF NOT EXISTS idx_cl_agent_status ON public.commission_ledger(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_cl_expected_pay ON public.commission_ledger(expected_paid_date);
ALTER TABLE public.commission_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cl_own  ON public.commission_ledger;
DROP POLICY IF EXISTS cl_admn ON public.commission_ledger;
DROP POLICY IF EXISTS cl_svc  ON public.commission_ledger;
CREATE POLICY cl_own  ON public.commission_ledger FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE profile_id = auth.uid()));
CREATE POLICY cl_admn ON public.commission_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY cl_svc  ON public.commission_ledger FOR ALL TO service_role USING (true);

-- 3. commission_audit_log — every rate resolution
CREATE TABLE IF NOT EXISTS public.commission_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid REFERENCES public.deals(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  carrier_id      uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  rate_pct        numeric,
  rate_source     text,
  note            text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cal_deal ON public.commission_audit_log(deal_id);
ALTER TABLE public.commission_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cal_admn ON public.commission_audit_log;
DROP POLICY IF EXISTS cal_svc  ON public.commission_audit_log;
CREATE POLICY cal_admn ON public.commission_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY cal_svc  ON public.commission_audit_log FOR ALL TO service_role USING (true);

-- 4. fn_commission_rate — override → contract → carrier default → NULL (alerts on null)
CREATE OR REPLACE FUNCTION public.fn_commission_rate(p_agent_id uuid, p_carrier_id uuid)
RETURNS TABLE(rate_pct numeric, rate_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT rate_pct, rate_source FROM (
    -- 1. agent-level override
    SELECT override_pct AS rate_pct, 'override'::text AS rate_source, 1 AS priority
    FROM public.agent_carrier_comp
    WHERE agent_id = p_agent_id AND carrier_id = p_carrier_id
      AND override_pct IS NOT NULL
    UNION ALL
    -- 2. agent-level contract
    SELECT effective_pct AS rate_pct, 'contract'::text AS rate_source, 2 AS priority
    FROM public.agent_carrier_comp
    WHERE agent_id = p_agent_id AND carrier_id = p_carrier_id
      AND effective_pct IS NOT NULL
    UNION ALL
    -- 3. agent-level contract_pct (fallback)
    SELECT contract_pct AS rate_pct, 'contract'::text AS rate_source, 3 AS priority
    FROM public.agent_carrier_comp
    WHERE agent_id = p_agent_id AND carrier_id = p_carrier_id
      AND contract_pct IS NOT NULL
  ) t ORDER BY priority LIMIT 1;
$fn$;
GRANT EXECUTE ON FUNCTION public.fn_commission_rate(uuid, uuid) TO service_role, authenticated;

-- 5. Agent Link → APEX status mapping
CREATE OR REPLACE FUNCTION public.map_al_status(p_al_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE lower(trim(COALESCE(p_al_status, '')))
    WHEN 'pending'        THEN 'submitted'
    WHEN 'submitted'      THEN 'submitted'
    WHEN 'uw requirement' THEN 'submitted'
    WHEN 'in review'      THEN 'submitted'
    WHEN 'approved'       THEN 'submitted'
    WHEN 'active'         THEN 'active'
    WHEN 'issued'         THEN 'active'
    WHEN 'in force'       THEN 'active'
    WHEN 'lapse pending'  THEN 'active'
    WHEN 'lapsed'         THEN 'lapsed'
    WHEN 'cancelled'      THEN 'cancelled'
    WHEN 'not taken'      THEN 'cancelled'
    WHEN 'nto'            THEN 'cancelled'
    WHEN 'declined'       THEN 'cancelled'
    WHEN 'withdrawn'      THEN 'cancelled'
    WHEN 'chargeback'     THEN 'charged_back'
    WHEN 'charged back'   THEN 'charged_back'
    ELSE 'submitted'
  END;
$fn$;

-- 6. agentlink_live_pull — v3 (adds status to DO UPDATE SET)
CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_req bigint; v_resp net.http_response_result;
  v_status_code int; v_body text; v_payload jsonb;
  v_inserted int := 0; v_updated int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  INSERT INTO public.agentlink_sync_log (status, error_message) VALUES ('running','deals') RETURNING * INTO v_log;
  SELECT value INTO v_cookie FROM public.system_settings WHERE key='agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='deals: no cookie' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req := net.http_get(url := 'https://agentlink.insuracloud.ai/api/deals',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept','application/json','User-Agent','APEX/1.0'),
    timeout_milliseconds := 60000);
  UPDATE public.agentlink_sync_log SET http_request_id=v_req WHERE id=v_log.id;
  v_resp := net.http_collect_response(v_req, async := false);
  v_status_code := (v_resp.response).status_code;
  v_body := (v_resp.response).body;
  UPDATE public.agentlink_sync_log SET upstream_status=v_status_code WHERE id=v_log.id;

  IF v_resp.status::text <> 'SUCCESS' OR v_status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message=format('deals HTTP %s: %s', v_status_code, left(coalesce(v_body,''),200))
     WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='deals: non-JSON' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_payload) <> 'array' OR jsonb_array_length(v_payload) = 0 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='empty', policies_seen=0,
           error_message='deals: empty' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_payload) AS d),
  resolved AS (
    SELECT d, (d->>'id')::text AS external_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id=(d->>'userId')::int LIMIT 1) AS agent_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id=(d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->'policyStatus'->>'standardStatus' AS al_status_raw
    FROM raw
  ),
  ins AS (
    INSERT INTO public.deals (agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date, status, policy_status_standard, status_updated_at,
      source, pipeline_stage, external_deal_id, notes)
    SELECT agent_id, carrier_id,
      COALESCE(d->>'clientFirstName','Unknown'), COALESCE(d->>'clientLastName','Unknown'),
      COALESCE(d->>'clientPhoneNumber','UNKNOWN'),
      COALESCE(NULLIF(d->>'clientDateOfBirth','')::date,'1970-01-01'::date),
      d->>'productSold', COALESCE(d->>'policyNumber', external_id),
      COALESCE((d->>'monthlyPremium')::numeric,0),
      COALESCE((d->>'annualPremium')::numeric,(d->>'monthlyPremium')::numeric*12,0),
      COALESCE((d->>'faceAmount')::numeric,0),
      COALESCE(NULLIF(d->>'effectiveDate','')::date,CURRENT_DATE),
      NULLIF(d->>'policyExpirationDate','')::date,
      public.map_al_status(al_status_raw),
      al_status_raw,
      now(),
      'agent_link',
      CASE public.map_al_status(al_status_raw)
        WHEN 'active'       THEN 'approved'
        WHEN 'lapsed'       THEN 'lapsed'
        WHEN 'cancelled'    THEN 'submitted'
        WHEN 'charged_back' THEN 'submitted'
        ELSE 'submitted' END,
      external_id, d->>'notes'
    FROM resolved WHERE agent_id IS NOT NULL
    ON CONFLICT (external_deal_id) DO UPDATE SET
      monthly_premium          = EXCLUDED.monthly_premium,
      annual_premium           = EXCLUDED.annual_premium,
      face_amount              = EXCLUDED.face_amount,
      status                   = EXCLUDED.status,            -- ← the fix
      policy_status_standard   = EXCLUDED.policy_status_standard,
      status_updated_at        = CASE
        WHEN public.deals.status IS DISTINCT FROM EXCLUDED.status THEN now()
        ELSE public.deals.status_updated_at END,
      pipeline_stage           = EXCLUDED.pipeline_stage,
      notes                    = EXCLUDED.notes,
      updated_at               = now()
    RETURNING xmax = 0 AS was_insert)
  SELECT COUNT(*) FILTER (WHERE was_insert)::int, COUNT(*) FILTER (WHERE NOT was_insert)::int
  INTO v_inserted, v_updated FROM ins;

  UPDATE public.agentlink_sync_log SET finished_at=now(), status='ok',
         policies_seen=jsonb_array_length(v_payload),
         deals_inserted=v_inserted, deals_updated=v_updated,
         error_message=format('deals: %s new, %s updated', v_inserted, v_updated)
   WHERE id=v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END $fn$;
ALTER FUNCTION public.agentlink_live_pull() SET statement_timeout='180s';

-- 7. trigger — status transition side effects (commission + retention alert)
CREATE OR REPLACE FUNCTION public.trg_fn_deal_status_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_rate numeric; v_rate_source text; v_amount numeric;
  v_webhook text; v_agent_name text; v_carrier_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- ── submitted → active : compute + book commission ────────────────────
  IF NEW.status = 'active' AND OLD.status = 'submitted' THEN
    IF NEW.agent_id IS NULL OR NEW.carrier_id IS NULL THEN
      INSERT INTO public.agentlink_alerts (severity, message)
      VALUES ('blocker',
        format('Deal %s went active but has no agent_id or carrier_id — commission cannot be computed', NEW.id));
      RETURN NEW;
    END IF;

    SELECT rate_pct, rate_source INTO v_rate, v_rate_source
    FROM public.fn_commission_rate(NEW.agent_id, NEW.carrier_id);

    IF v_rate IS NULL THEN
      INSERT INTO public.agentlink_alerts (severity, message)
      VALUES ('blocker',
        format('Deal %s went active but agent has no commission schedule for carrier — cannot pay', NEW.id));
      INSERT INTO public.commission_audit_log (deal_id, agent_id, carrier_id, rate_source, note)
      VALUES (NEW.id, NEW.agent_id, NEW.carrier_id, 'missing', 'No rate found — alert raised');
      RETURN NEW;
    END IF;

    v_amount := COALESCE(NEW.annual_premium, 0) * v_rate / 100.0;

    INSERT INTO public.commission_ledger (
      deal_id, agent_id, carrier_id, annual_premium,
      rate_pct, rate_source, amount, as_earned_pct,
      expected_paid_date)
    VALUES (
      NEW.id, NEW.agent_id, NEW.carrier_id, NEW.annual_premium,
      v_rate, v_rate_source, v_amount, 100,
      COALESCE(NEW.effective_date, CURRENT_DATE) + interval '14 days')
    ON CONFLICT (deal_id) DO UPDATE SET
      rate_pct = EXCLUDED.rate_pct,
      rate_source = EXCLUDED.rate_source,
      amount = EXCLUDED.amount,
      updated_at = now();

    INSERT INTO public.commission_audit_log (deal_id, agent_id, carrier_id, rate_pct, rate_source, note)
    VALUES (NEW.id, NEW.agent_id, NEW.carrier_id, v_rate, v_rate_source,
      format('status %s → active, $%s booked', OLD.status, to_char(v_amount,'FM999,990.00')));
  END IF;

  -- ── any → lapsed/cancelled/charged_back : retention alert + ledger clawback ─
  IF NEW.status IN ('lapsed','cancelled','charged_back') AND OLD.status <> NEW.status THEN
    -- Clawback any ledger row
    UPDATE public.commission_ledger
    SET status = CASE NEW.status WHEN 'charged_back' THEN 'clawed_back' ELSE 'voided' END,
        updated_at = now()
    WHERE deal_id = NEW.id AND status = 'pending';

    SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_retention_webhook';
    IF v_webhook IS NULL THEN
      SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
    END IF;

    IF v_webhook IS NOT NULL THEN
      SELECT p.full_name INTO v_agent_name FROM public.agents a
        JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
      SELECT name INTO v_carrier_name FROM public.carriers WHERE id = NEW.carrier_id;
      v_body := jsonb_build_object('username','APEX Retention',
        'content', format(
          E'⚠️ **Policy %s — %s %s · agent %s · %s $%s**\n\nReach out, rescue if possible.',
          NEW.status, NEW.client_first_name, NEW.client_last_name,
          COALESCE(v_agent_name,'unknown'),
          COALESCE(v_carrier_name,'carrier'),
          to_char(NEW.annual_premium,'FM999,990.00')));
      PERFORM net.http_post(url := v_webhook,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := v_body, timeout_milliseconds := 10000);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  INSERT INTO public.agentlink_alerts (severity, message)
  VALUES ('warning', 'trg_deal_status_transition swallowed exception: ' || SQLERRM);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_deal_status_transition ON public.deals;
CREATE TRIGGER trg_deal_status_transition AFTER UPDATE OF status ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_deal_status_transition();

-- Backfill note: run SELECT public.agentlink_live_pull(); immediately after this migration.
