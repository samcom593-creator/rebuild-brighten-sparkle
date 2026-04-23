-- ════════════════════════════════════════════════════════════════════════
-- stripe_sync v2 — 2-phase pg_net approach (fire → drain).
-- pg_net response rows only become visible to new transactions, so we
-- split "queue the request" and "ingest the response" into separate cron
-- jobs 2 minutes apart. Each phase is short + robust to restarts.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stripe_sync_cursor (
  id             smallint PRIMARY KEY DEFAULT 1,
  pending_req_id bigint,
  last_fired_at  timestamptz,
  last_drained_at timestamptz,
  last_error     text,
  last_synced    int DEFAULT 0,
  CHECK (id = 1)
);
INSERT INTO public.stripe_sync_cursor (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─── Phase 1: fire ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stripe_sync_fire()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_key text; v_req bigint;
BEGIN
  SELECT value INTO v_key FROM public.system_settings WHERE key='stripe_secret_key';
  IF v_key IS NULL OR v_key = '' THEN
    UPDATE public.stripe_sync_cursor SET last_error='no stripe_secret_key', last_fired_at=now() WHERE id=1;
    RETURN jsonb_build_object('error','no key');
  END IF;
  v_req := net.http_get(
    url := 'https://api.stripe.com/v1/charges?limit=100',
    headers := jsonb_build_object(
      'Authorization','Bearer '||v_key,
      'Accept','application/json'),
    timeout_milliseconds := 25000);
  UPDATE public.stripe_sync_cursor
     SET pending_req_id=v_req, last_fired_at=now(), last_error=NULL
   WHERE id=1;
  RETURN jsonb_build_object('fired', true, 'req', v_req);
END $fn$;
GRANT EXECUTE ON FUNCTION public.stripe_sync_fire() TO service_role, authenticated;

-- ─── Phase 2: drain ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stripe_sync_drain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_req       bigint;
  v_status    int;
  v_body      text;
  v_json      jsonb;
  v_charge    jsonb;
  v_inserted  int := 0;
  v_total     int := 0;
BEGIN
  SELECT pending_req_id INTO v_req FROM public.stripe_sync_cursor WHERE id=1;
  IF v_req IS NULL THEN RETURN jsonb_build_object('idle', true); END IF;

  SELECT status_code, content::text INTO v_status, v_body
    FROM net._http_response WHERE id = v_req;
  IF v_status IS NULL THEN
    -- Not ready — leave pending_req_id intact, try again next tick
    RETURN jsonb_build_object('not_ready', true, 'req', v_req);
  END IF;

  IF v_status >= 300 THEN
    UPDATE public.stripe_sync_cursor
       SET last_error=format('stripe %s: %s', v_status, LEFT(COALESCE(v_body,''),300)),
           pending_req_id=NULL, last_drained_at=now()
     WHERE id=1;
    RETURN jsonb_build_object('error', v_status);
  END IF;

  v_json := v_body::jsonb;
  FOR v_charge IN SELECT * FROM jsonb_array_elements(v_json->'data') LOOP
    v_total := v_total + 1;
    IF v_charge->>'status' = 'succeeded' THEN
      INSERT INTO public.lead_purchases (
        stripe_charge_id, amount_cents, currency, customer_id,
        customer_email, customer_name, description, agent_id_ref,
        charged_at, metadata
      ) VALUES (
        v_charge->>'id',
        (v_charge->>'amount')::int,
        COALESCE(v_charge->>'currency','usd'),
        v_charge->>'customer',
        v_charge->'billing_details'->>'email',
        v_charge->'billing_details'->>'name',
        v_charge->>'description',
        v_charge->'metadata'->>'agent_id',
        to_timestamp((v_charge->>'created')::bigint),
        COALESCE(v_charge->'metadata','{}'::jsonb))
      ON CONFLICT (stripe_charge_id) DO UPDATE SET
        amount_cents=EXCLUDED.amount_cents,
        customer_email=EXCLUDED.customer_email,
        customer_name=EXCLUDED.customer_name,
        metadata=EXCLUDED.metadata,
        synced_at=now();
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  UPDATE public.stripe_sync_cursor
     SET pending_req_id=NULL, last_drained_at=now(), last_synced=v_inserted, last_error=NULL
   WHERE id=1;

  RETURN jsonb_build_object('synced', v_inserted, 'total', v_total);
END $fn$;
GRANT EXECUTE ON FUNCTION public.stripe_sync_drain() TO service_role, authenticated;

-- ─── Reschedule: fire at :23, drain at :25, :26, :27 (3 tries) ──────────
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='stripe-sync-hourly') THEN
    PERFORM cron.unschedule('stripe-sync-hourly'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='stripe-sync-drain') THEN
    PERFORM cron.unschedule('stripe-sync-drain'); END IF;

  PERFORM cron.schedule('stripe-sync-fire', '23 * * * *',
    $j$ SELECT public.stripe_sync_fire(); $j$);
  PERFORM cron.schedule('stripe-sync-drain', '25,27,30 * * * *',
    $j$ SELECT public.stripe_sync_drain(); $j$);
END $outer$;

SELECT 'stripe_sync v2 (fire+drain) installed' AS r;
