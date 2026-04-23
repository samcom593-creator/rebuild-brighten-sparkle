-- ════════════════════════════════════════════════════════════════════════
-- Section 8 — cron cleanup + job_runs observability
-- Kills redundant/broken cron jobs, adds integrity jobs per the master
-- prompt, and wires job_runs tracking so every cron reports to a
-- single table and the admin dashboard can show green/red tiles.
-- ════════════════════════════════════════════════════════════════════════

-- 1. job_runs — universal cron observability table
CREATE TABLE IF NOT EXISTS public.job_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name        text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','error','skipped')),
  rows_affected   int,
  error_message   text,
  metadata        jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_job_runs_started ON public.job_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_name_started ON public.job_runs(job_name, started_at DESC);
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jr_admin ON public.job_runs;
DROP POLICY IF EXISTS jr_svc ON public.job_runs;
CREATE POLICY jr_admin ON public.job_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY jr_svc   ON public.job_runs FOR ALL TO service_role USING (true);

-- 2. Helper: wrap a query in job_runs tracking (start/ok/error)
CREATE OR REPLACE FUNCTION public.job_run_start(p_job_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.job_runs (job_name, status) VALUES (p_job_name, 'running') RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.job_run_finish(p_id uuid, p_status text, p_rows int DEFAULT NULL, p_error text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $fn$
  UPDATE public.job_runs
  SET finished_at = now(), status = p_status,
      rows_affected = p_rows, error_message = p_error, metadata = p_metadata
  WHERE id = p_id;
$fn$;

GRANT EXECUTE ON FUNCTION public.job_run_start(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.job_run_finish(uuid, text, int, text, jsonb) TO service_role;

-- 3. Kill redundant/broken crons (master prompt Section 1)
DO $outer$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobname FROM cron.job WHERE jobname IN (
    'agentlink-commissions-pull',   -- no /api/commissions endpoint exists
    'agentlink-book-refresh',       -- redundant: book = deals
    'agentlink-appointments-refresh'-- no /api/appointments endpoint exists
  ) LOOP
    PERFORM cron.unschedule(v_job.jobname);
  END LOOP;
END $outer$;

-- 4. stale_submitted_alert — surfaces the null-upstream-status problem
CREATE OR REPLACE FUNCTION public.stale_submitted_alert()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_count int; v_alp numeric; v_body jsonb; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('stale_submitted_alert');
  SELECT COUNT(*)::int, ROUND(COALESCE(SUM(annual_premium),0)::numeric, 2)
    INTO v_count, v_alp
  FROM public.deals
  WHERE status = 'submitted' AND effective_date < CURRENT_DATE - interval '7 days';

  IF v_count = 0 THEN
    PERFORM public.job_run_finish(v_job, 'ok', 0, NULL, jsonb_build_object('clean', true));
    RETURN jsonb_build_object('clean', true);
  END IF;

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NOT NULL THEN
    v_body := jsonb_build_object('username','APEX Stale Book',
      'content', format(E'📋 **%s deals stuck in submitted >7d · $%s ALP unresolved**\n\nMost likely carrier-side delay — cross-check top carriers for status updates.',
        v_count, to_char(v_alp,'FM999,999,990.00')));
    PERFORM net.http_post(url := v_webhook,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := v_body, timeout_milliseconds := 10000);
  END IF;

  PERFORM public.job_run_finish(v_job, 'ok', v_count, NULL, jsonb_build_object('alp', v_alp));
  RETURN jsonb_build_object('flagged', v_count, 'alp', v_alp);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;

-- 5. orphan_deal_audit — deals with no agent or no carrier
CREATE OR REPLACE FUNCTION public.orphan_deal_audit()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_no_agent int; v_no_carrier int; v_deactivated int; v_webhook text; v_body jsonb; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('orphan_deal_audit');
  SELECT COUNT(*) FILTER (WHERE agent_id IS NULL)::int,
         COUNT(*) FILTER (WHERE carrier_id IS NULL)::int,
         COUNT(*) FILTER (WHERE agent_id IN (SELECT id FROM public.agents WHERE is_deactivated))::int
    INTO v_no_agent, v_no_carrier, v_deactivated FROM public.deals;

  IF v_no_agent + v_no_carrier + v_deactivated > 0 THEN
    SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
    IF v_webhook IS NOT NULL THEN
      v_body := jsonb_build_object('username','APEX Orphan Audit',
        'content', format(E'🧭 **Orphan deals found**\n• No agent: %s\n• No carrier: %s\n• Deactivated agent: %s',
          v_no_agent, v_no_carrier, v_deactivated));
      PERFORM net.http_post(url := v_webhook,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := v_body, timeout_milliseconds := 10000);
    END IF;
  END IF;

  PERFORM public.job_run_finish(v_job, 'ok', v_no_agent+v_no_carrier+v_deactivated, NULL,
    jsonb_build_object('no_agent',v_no_agent,'no_carrier',v_no_carrier,'deactivated',v_deactivated));
  RETURN jsonb_build_object('no_agent',v_no_agent,'no_carrier',v_no_carrier,'deactivated',v_deactivated);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;

-- 6. commission_ledger_reconcile — flag variances, age pending rows
CREATE OR REPLACE FUNCTION public.commission_ledger_reconcile()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_overdue int; v_deals_wo_ledger int; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('commission_ledger_reconcile');

  SELECT COUNT(*)::int INTO v_overdue FROM public.commission_ledger
  WHERE status = 'pending' AND expected_paid_date < CURRENT_DATE - interval '14 days';

  SELECT COUNT(*)::int INTO v_deals_wo_ledger FROM public.deals d
  WHERE d.status = 'active' AND d.agent_id IS NOT NULL AND d.carrier_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.commission_ledger cl WHERE cl.deal_id = d.id);

  IF v_deals_wo_ledger > 0 THEN
    INSERT INTO public.commission_ledger (deal_id, agent_id, carrier_id, annual_premium,
      rate_pct, rate_source, amount, as_earned_pct, expected_paid_date, status)
    SELECT d.id, d.agent_id, d.carrier_id, d.annual_premium,
      fcr.rate_pct, fcr.rate_source,
      d.annual_premium * fcr.rate_pct / 100.0, 100,
      COALESCE(d.effective_date, CURRENT_DATE) + interval '14 days', 'pending'
    FROM public.deals d
    CROSS JOIN LATERAL public.fn_commission_rate(d.agent_id, d.carrier_id) fcr
    WHERE d.status = 'active' AND fcr.rate_pct IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.commission_ledger cl WHERE cl.deal_id = d.id)
    ON CONFLICT (deal_id) DO NOTHING;
  END IF;

  PERFORM public.job_run_finish(v_job, 'ok', v_overdue + v_deals_wo_ledger, NULL,
    jsonb_build_object('overdue_pending',v_overdue,'missing_ledger',v_deals_wo_ledger));
  RETURN jsonb_build_object('overdue_pending',v_overdue,'missing_ledger',v_deals_wo_ledger);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;

-- 7. churn_calc — rolling 90-day churn rate per agent into agents.metadata
CREATE OR REPLACE FUNCTION public.churn_calc()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_rows int; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('churn_calc');
  WITH per_agent AS (
    SELECT agent_id,
      COUNT(*) FILTER (WHERE effective_date >= CURRENT_DATE - interval '90 days') AS deals_90d,
      COUNT(*) FILTER (WHERE effective_date >= CURRENT_DATE - interval '90 days'
                       AND status IN ('lapsed','cancelled','charged_back')) AS churned_90d
    FROM public.deals WHERE agent_id IS NOT NULL GROUP BY agent_id)
  UPDATE public.agents a
  SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
    'churn_90d_pct',
      CASE WHEN pa.deals_90d = 0 THEN 0
           ELSE ROUND((pa.churned_90d::numeric / pa.deals_90d::numeric) * 100, 1) END,
    'deals_90d', pa.deals_90d,
    'churned_90d', pa.churned_90d,
    'churn_updated_at', now())
  FROM per_agent pa WHERE a.id = pa.agent_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM public.job_run_finish(v_job, 'ok', v_rows);
  RETURN jsonb_build_object('agents_updated', v_rows);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;

-- 8. webhook_health_check — ping Discord; future: Resend + WhatsApp
CREATE OR REPLACE FUNCTION public.webhook_health_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_webhook text; v_req bigint; v_resp net.http_response_result; v_code int; v_job uuid;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_job := public.job_run_start('webhook_health_check');
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN
    PERFORM public.job_run_finish(v_job, 'error', NULL, 'discord_webhook_url not set');
    RETURN jsonb_build_object('discord', 'not_configured');
  END IF;

  -- GET the webhook URL (Discord returns 200 JSON with channel info on valid webhooks)
  v_req := net.http_get(url := v_webhook,
    headers := jsonb_build_object('Accept','application/json'),
    timeout_milliseconds := 8000);
  v_resp := net.http_collect_response(v_req, async := false);
  v_code := (v_resp.response).status_code;

  PERFORM public.job_run_finish(v_job, CASE WHEN v_code BETWEEN 200 AND 299 THEN 'ok' ELSE 'error' END,
    NULL,
    CASE WHEN v_code BETWEEN 200 AND 299 THEN NULL ELSE format('discord %s', v_code) END,
    jsonb_build_object('discord_status', v_code));
  RETURN jsonb_build_object('discord_status', v_code);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;

GRANT EXECUTE ON FUNCTION public.stale_submitted_alert()          TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.orphan_deal_audit()              TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.commission_ledger_reconcile()    TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.churn_calc()                     TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_health_check()           TO service_role, authenticated;

-- 9. Schedule them per master prompt Section 8
DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='stale-submitted-alert') THEN
    PERFORM cron.unschedule('stale-submitted-alert'); END IF;
  PERFORM cron.schedule('stale-submitted-alert', '0 14 * * *',  -- 9 AM CST
    $j$ SELECT public.stale_submitted_alert(); $j$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='orphan-deal-audit') THEN
    PERFORM cron.unschedule('orphan-deal-audit'); END IF;
  PERFORM cron.schedule('orphan-deal-audit', '0 13 * * *',  -- 8 AM CST
    $j$ SELECT public.orphan_deal_audit(); $j$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='commission-ledger-reconcile') THEN
    PERFORM cron.unschedule('commission-ledger-reconcile'); END IF;
  PERFORM cron.schedule('commission-ledger-reconcile', '0 12 * * *',  -- 7 AM CST
    $j$ SELECT public.commission_ledger_reconcile(); $j$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='churn-calc') THEN
    PERFORM cron.unschedule('churn-calc'); END IF;
  PERFORM cron.schedule('churn-calc', '58 4 * * *',  -- 23:58 CT → nightly
    $j$ SELECT public.churn_calc(); $j$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='webhook-health-check') THEN
    PERFORM cron.unschedule('webhook-health-check'); END IF;
  PERFORM cron.schedule('webhook-health-check', '7 * * * *',  -- hourly at :07
    $j$ SELECT public.webhook_health_check(); $j$);
END $outer$;
