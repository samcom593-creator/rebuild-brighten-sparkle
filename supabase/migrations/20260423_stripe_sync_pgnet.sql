-- ════════════════════════════════════════════════════════════════════════
-- stripe_sync_db — pure-Postgres Stripe charges sync via pg_net.
-- Bypasses the edge-function deploy pipeline so it works the moment the
-- migration runs. Cron swaps to this if stripe-sync edge fn is absent.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.stripe_sync_db()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_key       text;
  v_req       bigint;
  v_status    int;
  v_body      text;
  v_json      jsonb;
  v_charge    jsonb;
  v_inserted  int := 0;
  v_total     int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_key FROM public.system_settings WHERE key='stripe_secret_key';
  IF v_key IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('error','stripe_secret_key not configured');
  END IF;

  -- Fire the GET /v1/charges?limit=100 via pg_net
  v_req := net.http_get(
    url := 'https://api.stripe.com/v1/charges?limit=100',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Accept', 'application/json'),
    timeout_milliseconds := 25000);

  -- Poll for the response (pg_net is async — wait up to 60s)
  FOR i IN 1..60 LOOP
    SELECT status_code, content::text INTO v_status, v_body
    FROM net._http_response WHERE id = v_req;
    EXIT WHEN v_status IS NOT NULL;
    PERFORM pg_sleep(1.0);
  END LOOP;

  IF v_status IS NULL OR v_status >= 300 THEN
    RETURN jsonb_build_object(
      'error','stripe http failed',
      'status',v_status,
      'body',LEFT(COALESCE(v_body,''), 500));
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
        COALESCE(v_charge->>'currency', 'usd'),
        v_charge->>'customer',
        v_charge->'billing_details'->>'email',
        v_charge->'billing_details'->>'name',
        v_charge->>'description',
        v_charge->'metadata'->>'agent_id',
        to_timestamp((v_charge->>'created')::bigint),
        COALESCE(v_charge->'metadata', '{}'::jsonb)
      )
      ON CONFLICT (stripe_charge_id) DO UPDATE SET
        amount_cents   = EXCLUDED.amount_cents,
        customer_email = EXCLUDED.customer_email,
        customer_name  = EXCLUDED.customer_name,
        metadata       = EXCLUDED.metadata,
        synced_at      = now();
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'synced', v_inserted,
    'total_from_stripe', v_total,
    'has_more', COALESCE((v_json->>'has_more')::boolean, false));
END $fn$;
GRANT EXECUTE ON FUNCTION public.stripe_sync_db() TO service_role, authenticated;

-- Repoint the cron to the DB-native sync (was hitting the edge function that isn't deployed yet)
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='stripe-sync-hourly') THEN
    PERFORM cron.unschedule('stripe-sync-hourly'); END IF;
  PERFORM cron.schedule('stripe-sync-hourly', '23 * * * *',
    $j$ SELECT public.stripe_sync_db(); $j$);
END $outer$;

SELECT 'stripe_sync_db installed' AS r;
