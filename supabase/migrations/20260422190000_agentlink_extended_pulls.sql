-- Agent Link extended pulls: commissions, book-of-business, carrier appointments.
-- Mirrors the pattern established in 20260422030000_agentlink_head_to_toe.sql
-- (cookie-auth via system_settings, pg_net blocking collect, sync_log writes).
--
-- Why: at 1000-agent scale Sam needs per-agent commission visibility,
-- lapse tracking (book-of-business), and carrier appointment status.
-- The existing deals/pipeline pulls don't cover any of those.
--
-- Three new cron jobs added at the bottom, all staggered to avoid :00
-- collisions with the existing agentlink-* crons.

-- ─────────────────────────────────────────────────────────────────────
-- Table: agentlink_commissions
-- ─────────────────────────────────────────────────────────────────────
-- One row per commission entry (accrual or payout). Pulled per-agent
-- because the upstream /api/commissions endpoint scopes by logged-in
-- cookie; we iterate active agents that have insuracloud_user_id.

CREATE TABLE IF NOT EXISTS public.agentlink_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id         TEXT UNIQUE,              -- Agent Link's commission record id
  agent_id            UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  insuracloud_user_id INT,                      -- mirror for fast filter
  carrier_id          UUID REFERENCES public.carriers(id) ON DELETE SET NULL,
  carrier_name        TEXT,                     -- denormalized for UI speed
  policy_number       TEXT,
  commission_type     TEXT,                     -- 'advance' | 'earned' | 'charge_back' | 'override'
  amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount         NUMERIC(12,2) DEFAULT 0,  -- actually paid vs accrued
  accrued_at          DATE,
  paid_at             DATE,
  statement_date      DATE,
  raw                 JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agentlink_commissions_agent_recent
  ON public.agentlink_commissions(agent_id, accrued_at DESC);
CREATE INDEX IF NOT EXISTS idx_agentlink_commissions_carrier
  ON public.agentlink_commissions(carrier_id);

ALTER TABLE public.agentlink_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see own commissions" ON public.agentlink_commissions;
CREATE POLICY "Agents see own commissions"
  ON public.agentlink_commissions FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins see all commissions" ON public.agentlink_commissions;
CREATE POLICY "Admins see all commissions"
  ON public.agentlink_commissions FOR SELECT TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role writes commissions" ON public.agentlink_commissions;
CREATE POLICY "Service role writes commissions"
  ON public.agentlink_commissions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- Table: agentlink_book_of_business
-- ─────────────────────────────────────────────────────────────────────
-- Per-policy snapshot refreshed nightly. Shows lapsed/active/pending/cancelled
-- so we can raise lapse alerts and track retention by agent.

CREATE TABLE IF NOT EXISTS public.agentlink_book_of_business (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_policy_id    TEXT UNIQUE,
  agent_id              UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  insuracloud_user_id   INT,
  carrier_id            UUID REFERENCES public.carriers(id) ON DELETE SET NULL,
  carrier_name          TEXT,
  client_name           TEXT,
  policy_number         TEXT,
  product_name          TEXT,
  face_amount           NUMERIC(12,2),
  monthly_premium       NUMERIC(12,2),
  annual_premium        NUMERIC(12,2),
  effective_date        DATE,
  issue_date            DATE,
  status                TEXT,                   -- 'active' | 'pending' | 'lapsed' | 'cancelled' | 'surrendered'
  lapse_date            DATE,
  paid_to_date          DATE,
  months_in_force       INT,
  raw                   JSONB,
  refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bob_agent_status
  ON public.agentlink_book_of_business(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_bob_lapse_watch
  ON public.agentlink_book_of_business(status, paid_to_date)
  WHERE status IN ('active', 'pending');

ALTER TABLE public.agentlink_book_of_business ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see own book" ON public.agentlink_book_of_business;
CREATE POLICY "Agents see own book"
  ON public.agentlink_book_of_business FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins see all books" ON public.agentlink_book_of_business;
CREATE POLICY "Admins see all books"
  ON public.agentlink_book_of_business FOR SELECT TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role writes book" ON public.agentlink_book_of_business;
CREATE POLICY "Service role writes book"
  ON public.agentlink_book_of_business FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- Table: agentlink_appointments
-- ─────────────────────────────────────────────────────────────────────
-- Carrier appointments per agent (which carriers they're contracted with,
-- appointment status, writing number, expiration). Critical for
-- compliance + showing agents which carriers they can sell.

CREATE TABLE IF NOT EXISTS public.agentlink_appointments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id           TEXT UNIQUE,
  agent_id              UUID REFERENCES public.agents(id) ON DELETE CASCADE,
  insuracloud_user_id   INT,
  carrier_id            UUID REFERENCES public.carriers(id) ON DELETE SET NULL,
  carrier_name          TEXT,
  writing_number        TEXT,
  status                TEXT,                   -- 'active' | 'pending' | 'terminated' | 'expired'
  appointed_at          DATE,
  terminated_at         DATE,
  expires_at            DATE,
  states                TEXT[],                 -- state codes appointed in
  raw                   JSONB,
  refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appts_agent_status
  ON public.agentlink_appointments(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_appts_expiring
  ON public.agentlink_appointments(expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

ALTER TABLE public.agentlink_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents see own appointments" ON public.agentlink_appointments;
CREATE POLICY "Agents see own appointments"
  ON public.agentlink_appointments FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins see all appointments" ON public.agentlink_appointments;
CREATE POLICY "Admins see all appointments"
  ON public.agentlink_appointments FOR SELECT TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role writes appointments" ON public.agentlink_appointments;
CREATE POLICY "Service role writes appointments"
  ON public.agentlink_appointments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- Function: agentlink_pull_commissions()
-- ─────────────────────────────────────────────────────────────────────
-- Single-call endpoint-wide pull (cookie-scoped). Agent Link returns
-- all commission entries visible to the cookie owner (admin account),
-- which includes the whole downline at the master cookie's level.
-- We UPSERT on external_id and resolve agent_id via insuracloud_user_id.

CREATE OR REPLACE FUNCTION public.agentlink_pull_commissions()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_log    public.agentlink_sync_log;
  v_cookie text;
  v_req    bigint;
  v_resp   net.http_response_result;
  v_status int;
  v_body   text;
  v_pl     jsonb;
  v_inserted int := 0;
  v_updated  int := 0;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);
  INSERT INTO public.agentlink_sync_log (status, error_message)
    VALUES ('running', 'commissions') RETURNING * INTO v_log;

  SELECT value INTO v_cookie FROM public.system_settings WHERE key = 'agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'no_cookie',
           error_message = 'commissions: no cookie' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req := net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/commissions',
    headers := jsonb_build_object(
      'Cookie', v_cookie,
      'Accept', 'application/json',
      'User-Agent', 'APEX/1.0'
    ),
    timeout_milliseconds := 90000
  );
  UPDATE public.agentlink_sync_log SET http_request_id = v_req WHERE id = v_log.id;

  v_resp := net.http_collect_response(v_req, async := false);
  v_status := (v_resp.response).status_code;
  v_body   := (v_resp.response).body;
  UPDATE public.agentlink_sync_log SET upstream_status = v_status WHERE id = v_log.id;

  IF v_resp.status::text <> 'SUCCESS' OR v_status NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'error',
           error_message = format('commissions HTTP %s: %s', v_status, left(coalesce(v_body,''), 200))
      WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_pl := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'error',
           error_message = 'commissions: non-JSON' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_pl) <> 'array' THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'empty',
           error_message = 'commissions: expected array' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_pl) AS d),
  resolved AS (
    SELECT d,
      (d->>'id')::text AS external_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id = (d->>'userId')::int LIMIT 1) AS agent_id,
      (d->>'userId')::int AS insuracloud_user_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id = (d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->>'carrierName'          AS carrier_name,
      d->>'policyNumber'         AS policy_number,
      d->>'commissionType'       AS commission_type,
      (d->>'amount')::numeric    AS amount,
      (d->>'paidAmount')::numeric AS paid_amount,
      NULLIF(d->>'accruedAt','')::date    AS accrued_at,
      NULLIF(d->>'paidAt','')::date       AS paid_at,
      NULLIF(d->>'statementDate','')::date AS statement_date
    FROM raw
  ),
  upserted AS (
    INSERT INTO public.agentlink_commissions AS c (
      external_id, agent_id, insuracloud_user_id, carrier_id, carrier_name,
      policy_number, commission_type, amount, paid_amount,
      accrued_at, paid_at, statement_date, raw
    )
    SELECT external_id, agent_id, insuracloud_user_id, carrier_id, carrier_name,
           policy_number, commission_type, COALESCE(amount, 0), COALESCE(paid_amount, 0),
           accrued_at, paid_at, statement_date, d
      FROM resolved
    WHERE external_id IS NOT NULL
    ON CONFLICT (external_id) DO UPDATE SET
      agent_id        = EXCLUDED.agent_id,
      amount          = EXCLUDED.amount,
      paid_amount     = EXCLUDED.paid_amount,
      paid_at         = EXCLUDED.paid_at,
      statement_date  = EXCLUDED.statement_date,
      raw             = EXCLUDED.raw
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted),
         COUNT(*) FILTER (WHERE NOT inserted)
    INTO v_inserted, v_updated
    FROM upserted;

  UPDATE public.agentlink_sync_log
  SET finished_at = now(), status = 'ok',
      policies_seen = jsonb_array_length(v_pl),
      deals_inserted = v_inserted, deals_updated = v_updated,
      error_message = NULL
  WHERE id = v_log.id RETURNING * INTO v_log;
  RETURN v_log;
EXCEPTION WHEN others THEN
  UPDATE public.agentlink_sync_log
  SET finished_at = now(), status = 'error', error_message = SQLERRM
  WHERE id = v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END;
$body$;

-- ─────────────────────────────────────────────────────────────────────
-- Function: agentlink_pull_book_of_business()
-- ─────────────────────────────────────────────────────────────────────
-- Same pattern as commissions but scoped to /api/book-of-business.

CREATE OR REPLACE FUNCTION public.agentlink_pull_book_of_business()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_log    public.agentlink_sync_log;
  v_cookie text;
  v_req    bigint;
  v_resp   net.http_response_result;
  v_status int;
  v_body   text;
  v_pl     jsonb;
  v_inserted int := 0;
  v_updated  int := 0;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);
  INSERT INTO public.agentlink_sync_log (status, error_message)
    VALUES ('running', 'book_of_business') RETURNING * INTO v_log;

  SELECT value INTO v_cookie FROM public.system_settings WHERE key = 'agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'no_cookie',
           error_message = 'book_of_business: no cookie' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req := net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/book-of-business',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept', 'application/json', 'User-Agent', 'APEX/1.0'),
    timeout_milliseconds := 120000
  );
  UPDATE public.agentlink_sync_log SET http_request_id = v_req WHERE id = v_log.id;

  v_resp := net.http_collect_response(v_req, async := false);
  v_status := (v_resp.response).status_code;
  v_body   := (v_resp.response).body;
  UPDATE public.agentlink_sync_log SET upstream_status = v_status WHERE id = v_log.id;

  IF v_resp.status::text <> 'SUCCESS' OR v_status NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'error',
           error_message = format('book HTTP %s: %s', v_status, left(coalesce(v_body,''), 200))
      WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_pl := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'error',
           error_message = 'book: non-JSON' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_pl) <> 'array' THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'empty',
           error_message = 'book: expected array' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_pl) AS d),
  resolved AS (
    SELECT d,
      (d->>'id')::text AS external_policy_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id = (d->>'userId')::int LIMIT 1) AS agent_id,
      (d->>'userId')::int AS insuracloud_user_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id = (d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->>'carrierName'   AS carrier_name,
      trim(concat_ws(' ', d->>'clientFirstName', d->>'clientLastName')) AS client_name,
      d->>'policyNumber'  AS policy_number,
      d->>'productName'   AS product_name,
      NULLIF(d->>'faceAmount','')::numeric      AS face_amount,
      NULLIF(d->>'monthlyPremium','')::numeric  AS monthly_premium,
      NULLIF(d->>'annualPremium','')::numeric   AS annual_premium,
      NULLIF(d->>'effectiveDate','')::date      AS effective_date,
      NULLIF(d->>'issueDate','')::date          AS issue_date,
      COALESCE(LOWER(d->'policyStatus'->>'standardStatus'), LOWER(d->>'status')) AS status,
      NULLIF(d->>'lapseDate','')::date          AS lapse_date,
      NULLIF(d->>'paidToDate','')::date         AS paid_to_date,
      NULLIF(d->>'monthsInForce','')::int       AS months_in_force
    FROM raw
  ),
  upserted AS (
    INSERT INTO public.agentlink_book_of_business AS b (
      external_policy_id, agent_id, insuracloud_user_id, carrier_id, carrier_name,
      client_name, policy_number, product_name, face_amount, monthly_premium, annual_premium,
      effective_date, issue_date, status, lapse_date, paid_to_date, months_in_force, raw, refreshed_at
    )
    SELECT external_policy_id, agent_id, insuracloud_user_id, carrier_id, carrier_name,
           client_name, policy_number, product_name, face_amount, monthly_premium, annual_premium,
           effective_date, issue_date, status, lapse_date, paid_to_date, months_in_force, d, now()
      FROM resolved
     WHERE external_policy_id IS NOT NULL
    ON CONFLICT (external_policy_id) DO UPDATE SET
      agent_id         = EXCLUDED.agent_id,
      status           = EXCLUDED.status,
      lapse_date       = EXCLUDED.lapse_date,
      paid_to_date     = EXCLUDED.paid_to_date,
      months_in_force  = EXCLUDED.months_in_force,
      raw              = EXCLUDED.raw,
      refreshed_at     = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted), COUNT(*) FILTER (WHERE NOT inserted)
    INTO v_inserted, v_updated FROM upserted;

  UPDATE public.agentlink_sync_log
  SET finished_at = now(), status = 'ok',
      policies_seen = jsonb_array_length(v_pl),
      deals_inserted = v_inserted, deals_updated = v_updated,
      error_message = NULL
  WHERE id = v_log.id RETURNING * INTO v_log;
  RETURN v_log;
EXCEPTION WHEN others THEN
  UPDATE public.agentlink_sync_log
  SET finished_at = now(), status = 'error', error_message = SQLERRM
  WHERE id = v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END;
$body$;

-- ─────────────────────────────────────────────────────────────────────
-- Function: agentlink_pull_appointments()
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.agentlink_pull_appointments()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_log    public.agentlink_sync_log;
  v_cookie text;
  v_req    bigint;
  v_resp   net.http_response_result;
  v_status int;
  v_body   text;
  v_pl     jsonb;
  v_inserted int := 0;
  v_updated  int := 0;
BEGIN
  PERFORM set_config('statement_timeout', '0', true);
  INSERT INTO public.agentlink_sync_log (status, error_message)
    VALUES ('running', 'appointments') RETURNING * INTO v_log;

  SELECT value INTO v_cookie FROM public.system_settings WHERE key = 'agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'no_cookie',
           error_message = 'appointments: no cookie' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req := net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/carrier/appointments',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept', 'application/json', 'User-Agent', 'APEX/1.0'),
    timeout_milliseconds := 60000
  );
  UPDATE public.agentlink_sync_log SET http_request_id = v_req WHERE id = v_log.id;

  v_resp := net.http_collect_response(v_req, async := false);
  v_status := (v_resp.response).status_code;
  v_body   := (v_resp.response).body;
  UPDATE public.agentlink_sync_log SET upstream_status = v_status WHERE id = v_log.id;

  -- Appointments endpoint is experimental — if it 404s, don't error the whole run.
  IF v_status = 404 THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'empty',
           error_message = 'appointments endpoint 404 (expected if Agent Link has not exposed it)'
     WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  IF v_resp.status::text <> 'SUCCESS' OR v_status NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'error',
           error_message = format('appointments HTTP %s: %s', v_status, left(coalesce(v_body,''), 200))
      WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_pl := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'error',
           error_message = 'appointments: non-JSON' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_pl) <> 'array' THEN
    UPDATE public.agentlink_sync_log SET finished_at = now(), status = 'empty',
           error_message = 'appointments: expected array' WHERE id = v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_pl) AS d),
  resolved AS (
    SELECT d,
      (d->>'id')::text AS external_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id = (d->>'userId')::int LIMIT 1) AS agent_id,
      (d->>'userId')::int AS insuracloud_user_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id = (d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->>'carrierName'    AS carrier_name,
      d->>'writingNumber'  AS writing_number,
      LOWER(d->>'status')  AS status,
      NULLIF(d->>'appointedAt','')::date  AS appointed_at,
      NULLIF(d->>'terminatedAt','')::date AS terminated_at,
      NULLIF(d->>'expiresAt','')::date    AS expires_at,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(d->'states', '[]'::jsonb))) AS states
    FROM raw
  ),
  upserted AS (
    INSERT INTO public.agentlink_appointments AS x (
      external_id, agent_id, insuracloud_user_id, carrier_id, carrier_name,
      writing_number, status, appointed_at, terminated_at, expires_at, states, raw, refreshed_at
    )
    SELECT external_id, agent_id, insuracloud_user_id, carrier_id, carrier_name,
           writing_number, status, appointed_at, terminated_at, expires_at, states, d, now()
      FROM resolved
     WHERE external_id IS NOT NULL
    ON CONFLICT (external_id) DO UPDATE SET
      status        = EXCLUDED.status,
      terminated_at = EXCLUDED.terminated_at,
      expires_at    = EXCLUDED.expires_at,
      states        = EXCLUDED.states,
      raw           = EXCLUDED.raw,
      refreshed_at  = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted), COUNT(*) FILTER (WHERE NOT inserted)
    INTO v_inserted, v_updated FROM upserted;

  UPDATE public.agentlink_sync_log
  SET finished_at = now(), status = 'ok',
      policies_seen = jsonb_array_length(v_pl),
      deals_inserted = v_inserted, deals_updated = v_updated,
      error_message = NULL
  WHERE id = v_log.id RETURNING * INTO v_log;
  RETURN v_log;
EXCEPTION WHEN others THEN
  UPDATE public.agentlink_sync_log
  SET finished_at = now(), status = 'error', error_message = SQLERRM
  WHERE id = v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END;
$body$;

-- ─────────────────────────────────────────────────────────────────────
-- Cron jobs — staggered to avoid :00 collisions
-- ─────────────────────────────────────────────────────────────────────

SELECT cron.unschedule('agentlink-commissions-pull') WHERE EXISTS(
  SELECT 1 FROM cron.job WHERE jobname = 'agentlink-commissions-pull');
SELECT cron.schedule(
  'agentlink-commissions-pull',
  '23 * * * *',   -- :23 every hour
  $$ SET LOCAL statement_timeout = 0; SELECT public.agentlink_pull_commissions(); $$
);

SELECT cron.unschedule('agentlink-book-refresh') WHERE EXISTS(
  SELECT 1 FROM cron.job WHERE jobname = 'agentlink-book-refresh');
SELECT cron.schedule(
  'agentlink-book-refresh',
  '41 4 * * *',   -- 4:41 UTC (11:41pm CT) nightly
  $$ SET LOCAL statement_timeout = 0; SELECT public.agentlink_pull_book_of_business(); $$
);

SELECT cron.unschedule('agentlink-appointments-refresh') WHERE EXISTS(
  SELECT 1 FROM cron.job WHERE jobname = 'agentlink-appointments-refresh');
SELECT cron.schedule(
  'agentlink-appointments-refresh',
  '53 5 * * *',   -- 5:53 UTC (12:53am CT) nightly
  $$ SET LOCAL statement_timeout = 0; SELECT public.agentlink_pull_appointments(); $$
);
