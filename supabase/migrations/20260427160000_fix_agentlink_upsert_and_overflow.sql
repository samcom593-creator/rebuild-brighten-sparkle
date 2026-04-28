-- 2026-04-27: Three-part fix that unblocked agentlink_upsert_from_payload.
--
-- Symptoms (from Mac launchd job firing every 60s):
--   "column \"agent_id\" does not exist"   → function had no FROM clause
--   "numeric field overflow"               → closing_rate numeric(5,2) couldn't
--                                            hold deals_closed/presentations*100
--                                            when presentations stays low
--
-- Why it matters: every Agent Link sync was a no-op until this lands.

-- 1) Rebuild the upsert function WITH the missing FROM resolved.
CREATE OR REPLACE FUNCTION public.agentlink_upsert_from_payload(p_payload jsonb)
RETURNS TABLE(inserted integer, updated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_inserted int := 0;
  v_updated  int := 0;
BEGIN
  WITH raw AS (
    SELECT jsonb_array_elements(p_payload) AS d
  ),
  resolved AS (
    SELECT
      d,
      (d->>'id')::text AS external_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id = (d->>'userId')::int LIMIT 1) AS agent_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id = (d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->'policyStatus'->>'standardStatus' AS al_status_raw,
      NULLIF(d->>'createdAt','')::timestamptz AS posted_at_raw,
      NULLIF(d->>'updatedAt','')::timestamptz AS al_updated_raw,
      COALESCE(NULLIF(d->>'effectiveDate','')::date, CURRENT_DATE) AS eff_date
    FROM raw
  ),
  ins AS (
    INSERT INTO public.deals (
      agent_id, carrier_id,
      client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number,
      monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date,
      status, policy_status_standard, status_updated_at,
      source, pipeline_stage, external_deal_id,
      notes, posted_at, created_at
    )
    SELECT
      r.agent_id, r.carrier_id,
      COALESCE(r.d->>'clientFirstName','Unknown'),
      COALESCE(r.d->>'clientLastName','Unknown'),
      COALESCE(r.d->>'clientPhoneNumber','UNKNOWN'),
      COALESCE(NULLIF(r.d->>'clientDateOfBirth','')::date,'1970-01-01'::date),
      r.d->>'productSold',
      COALESCE(r.d->>'policyNumber', r.external_id),
      COALESCE((r.d->>'monthlyPremium')::numeric, 0),
      COALESCE((r.d->>'annualPremium')::numeric, (r.d->>'monthlyPremium')::numeric * 12, 0),
      COALESCE((r.d->>'faceAmount')::numeric, 0),
      r.eff_date,
      NULLIF(r.d->>'policyExpirationDate','')::date,
      public.map_al_status(r.al_status_raw),
      r.al_status_raw,
      COALESCE(r.al_updated_raw, r.eff_date::timestamptz, NOW()),
      'agent_link',
      CASE public.map_al_status(r.al_status_raw)
        WHEN 'active' THEN 'approved'
        WHEN 'lapsed' THEN 'lapsed'
        ELSE 'submitted'
      END,
      r.external_id,
      r.d->>'notes',
      r.posted_at_raw,
      r.eff_date::timestamptz
    FROM resolved r
    WHERE r.agent_id IS NOT NULL
    ON CONFLICT (external_deal_id) DO UPDATE SET
      monthly_premium       = EXCLUDED.monthly_premium,
      annual_premium        = EXCLUDED.annual_premium,
      face_amount           = EXCLUDED.face_amount,
      status                = EXCLUDED.status,
      policy_status_standard= EXCLUDED.policy_status_standard,
      status_updated_at     = CASE
                                WHEN public.deals.status IS DISTINCT FROM EXCLUDED.status
                                  THEN COALESCE(EXCLUDED.status_updated_at, NOW())
                                ELSE public.deals.status_updated_at
                              END,
      pipeline_stage        = EXCLUDED.pipeline_stage,
      notes                 = EXCLUDED.notes,
      posted_at             = COALESCE(public.deals.posted_at, EXCLUDED.posted_at),
      created_at            = CASE
                                WHEN public.deals.created_at::date > EXCLUDED.created_at::date
                                  THEN EXCLUDED.created_at
                                ELSE public.deals.created_at
                              END,
      updated_at            = NOW()
    RETURNING xmax = 0 AS was_insert
  )
  SELECT
    COUNT(*) FILTER (WHERE was_insert)::int,
    COUNT(*) FILTER (WHERE NOT was_insert)::int
  INTO v_inserted, v_updated
  FROM ins;

  RETURN QUERY SELECT v_inserted, v_updated;
END;
$function$;

-- 2) Widen deals premium/face columns so high-AP cases stop overflowing.
ALTER TABLE public.deals ALTER COLUMN monthly_premium TYPE numeric(14,2);
ALTER TABLE public.deals ALTER COLUMN annual_premium  TYPE numeric(14,2);
ALTER TABLE public.deals ALTER COLUMN face_amount     TYPE numeric(16,2);

-- 3) Cap closing_rate so the BEFORE trigger can't blow numeric(5,2).
CREATE OR REPLACE FUNCTION public.calculate_closing_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.presentations > 0 THEN
    NEW.closing_rate := LEAST(
      ROUND((NEW.deals_closed::decimal / NEW.presentations::decimal) * 100, 2),
      999.99::numeric
    );
  ELSE
    NEW.closing_rate := 0;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
