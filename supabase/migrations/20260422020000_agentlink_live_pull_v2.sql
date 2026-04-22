-- ════════════════════════════════════════════════════════════════════════
-- Agent Link live pull v2 — switched to /api/deals (session-cookie path)
-- The /api/v1/book-of-business endpoint returns 500s on API tokens and
-- requires x-api-key even with cookies. /api/deals accepts cookie auth
-- cleanly and returns 791+ deals as a flat array.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
RETURNS public.agentlink_sync_log
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text; v_request_id bigint;
  v_status_code int; v_content text;
  v_deadline timestamptz;
  v_payload jsonb; v_inserted int := 0; v_updated int := 0;
BEGIN
  INSERT INTO public.agentlink_sync_log (status) VALUES ('running') RETURNING * INTO v_log;

  SELECT value INTO v_cookie FROM public.system_settings WHERE key = 'agent_link_session_cookie';
  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='no_cookie',
           error_message='No cookie configured' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  SELECT net.http_get(
    url     := 'https://agentlink.insuracloud.ai/api/deals',
    headers := jsonb_build_object('Cookie', v_cookie, 'Accept', 'application/json',
                                  'User-Agent', 'APEX-live-pull/1.0')
  ) INTO v_request_id;
  UPDATE public.agentlink_sync_log SET http_request_id=v_request_id WHERE id=v_log.id;

  v_deadline := clock_timestamp() + interval '60 seconds';
  LOOP
    SELECT status_code, content INTO v_status_code, v_content FROM net._http_response WHERE id = v_request_id;
    EXIT WHEN v_status_code IS NOT NULL OR clock_timestamp() > v_deadline;
    PERFORM pg_sleep(0.5);
  END LOOP;

  IF v_status_code IS NULL THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='Timeout waiting for Agent Link' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;
  UPDATE public.agentlink_sync_log SET upstream_status=v_status_code WHERE id=v_log.id;

  IF v_status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message=format('HTTP %s: %s', v_status_code, left(v_content, 300))
     WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN v_payload := v_content::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='error',
           error_message='Non-JSON response' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_payload) <> 'array' OR jsonb_array_length(v_payload) = 0 THEN
    UPDATE public.agentlink_sync_log SET finished_at=now(), status='empty', policies_seen=0,
           error_message='Agent Link returned empty' WHERE id=v_log.id RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  WITH raw AS (SELECT jsonb_array_elements(v_payload) AS d),
  resolved AS (
    SELECT d,
      (d->>'id')::text AS external_id,
      (SELECT a.id FROM public.agents a WHERE a.insuracloud_user_id = (d->>'userId')::int LIMIT 1) AS agent_id,
      (SELECT c.id FROM public.carriers c WHERE c.insuracloud_carrier_id = (d->>'carrierId')::int LIMIT 1) AS carrier_id,
      d->'policyStatus'->>'standardStatus' AS al_status
    FROM raw
  ),
  ins AS (
    INSERT INTO public.deals (
      agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date, status, source, pipeline_stage, external_deal_id, notes
    )
    SELECT agent_id, carrier_id,
      COALESCE(d->>'clientFirstName','Unknown'),
      COALESCE(d->>'clientLastName','Unknown'),
      COALESCE(d->>'clientPhoneNumber','UNKNOWN'),
      COALESCE(NULLIF(d->>'clientDateOfBirth','')::date,'1970-01-01'::date),
      d->>'productSold',
      COALESCE(d->>'policyNumber', external_id),
      COALESCE((d->>'monthlyPremium')::numeric,0),
      COALESCE((d->>'annualPremium')::numeric,(d->>'monthlyPremium')::numeric*12,0),
      COALESCE((d->>'faceAmount')::numeric,0),
      COALESCE(NULLIF(d->>'effectiveDate','')::date,CURRENT_DATE),
      NULLIF(d->>'policyExpirationDate','')::date,
      CASE al_status
        WHEN 'Active' THEN 'active' WHEN 'Issued' THEN 'active' WHEN 'Lapse Pending' THEN 'active'
        WHEN 'Lapsed' THEN 'lapsed'
        WHEN 'Declined' THEN 'cancelled' WHEN 'Withdrawn' THEN 'cancelled'
        WHEN 'Cancelled' THEN 'cancelled' WHEN 'Not Taken' THEN 'cancelled'
        ELSE 'submitted' END,
      'agent_link',
      CASE al_status
        WHEN 'Active' THEN 'approved' WHEN 'Issued' THEN 'approved' WHEN 'Approved' THEN 'approved'
        WHEN 'Lapsed' THEN 'lapsed' ELSE 'submitted' END,
      external_id,
      d->>'notes'
    FROM resolved WHERE agent_id IS NOT NULL
    ON CONFLICT (external_deal_id) DO UPDATE SET
      monthly_premium = EXCLUDED.monthly_premium,
      annual_premium  = EXCLUDED.annual_premium,
      face_amount     = EXCLUDED.face_amount,
      status          = EXCLUDED.status,
      pipeline_stage  = EXCLUDED.pipeline_stage,
      notes           = EXCLUDED.notes,
      updated_at      = now()
    RETURNING xmax = 0 AS was_insert
  )
  SELECT
    COUNT(*) FILTER (WHERE was_insert)::int,
    COUNT(*) FILTER (WHERE NOT was_insert)::int
  INTO v_inserted, v_updated
  FROM ins;

  UPDATE public.agentlink_sync_log SET finished_at=now(), status='ok',
         policies_seen = jsonb_array_length(v_payload),
         deals_inserted = v_inserted, deals_updated = v_updated
   WHERE id=v_log.id RETURNING * INTO v_log;
  RETURN v_log;
END $fn$;

-- Raise statement timeout inside the function — big JSON + 700-row upsert takes > default
ALTER FUNCTION public.agentlink_live_pull() SET statement_timeout = '120s';

-- Make the unique index non-partial so ON CONFLICT without WHERE works
DROP INDEX IF EXISTS public.idx_deals_external_deal_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_external_deal_id_unique
  ON public.deals(external_deal_id);
