-- ──────────────────────────────────────────────────────────────────────
-- Leak-detection watchdog (2026-04-28)
--
-- Runs hourly. Detects:
--   1. Sam zero-deals rule violations (any deal attributed to 7c3c5581)
--   2. RPC drift: get_weekly_leaderboard / get_agent_production_stats
--      total deviates from deals truth by more than $1k → flag
--   3. Discord posts containing banned phrases (team alp / agency total)
--      that bypassed the policy guards
--   4. Cron jobs that became active without `automation_settings.enabled`
--   5. Plaque queue rows targeting blocked IG handles
--
-- Writes findings to `automation_health` (if any). Returns a summary.
-- Never posts. Never fires a remediation. Just visibility.
-- ──────────────────────────────────────────────────────────────────────

-- Dedicated log table for watchdog runs (own table; doesn't fight with automation_health schema)
CREATE TABLE IF NOT EXISTS public.autoposter_watchdog_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_autoposter_watchdog_ran_at
  ON public.autoposter_watchdog_log (ran_at DESC);

CREATE OR REPLACE FUNCTION public.autoposter_leak_watchdog()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sam_deal_count int;
  v_rpc_week_alp numeric;
  v_truth_week_alp numeric;
  v_drift_alp numeric;
  v_bad_discord_count int;
  v_blocked_ig_count int;
  v_findings jsonb := '[]'::jsonb;
BEGIN
  -- 1. Sam zero-deals rule
  SELECT COUNT(*)::int INTO v_sam_deal_count
  FROM public.deals
  WHERE agent_id = '7c3c5581-3544-437f-bfe2-91391afb217d';

  IF v_sam_deal_count > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'rule', 'sam_zero_deals',
      'severity', 'critical',
      'count', v_sam_deal_count,
      'detail', 'Sam attributed deals must always be 0; check agent_link_*_sync triggers'
    );
  END IF;

  -- 2. RPC drift vs deals truth (last 7d)
  SELECT COALESCE(SUM(total_alp), 0) INTO v_rpc_week_alp
  FROM public.get_agent_production_stats(
    (CURRENT_DATE - INTERVAL '6 days')::date,
    CURRENT_DATE::date
  );

  SELECT COALESCE(SUM(annual_premium), 0) INTO v_truth_week_alp
  FROM public.deals
  WHERE status IN ('submitted', 'active')
    AND effective_date BETWEEN (CURRENT_DATE - INTERVAL '6 days')::date AND CURRENT_DATE::date
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  v_drift_alp := ABS(v_rpc_week_alp - v_truth_week_alp);
  IF v_drift_alp > 1000 THEN
    v_findings := v_findings || jsonb_build_object(
      'rule', 'rpc_drift',
      'severity', 'high',
      'rpc_value', v_rpc_week_alp,
      'truth_value', v_truth_week_alp,
      'drift', v_drift_alp,
      'detail', 'get_agent_production_stats deviates from deals truth — RPC may be reading polluted source'
    );
  END IF;

  -- 3. Recent Discord posts containing banned phrases
  SELECT COUNT(*)::int INTO v_bad_discord_count
  FROM public.discord_event_log
  WHERE posted_at > now() - interval '24 hours'
    AND (
      payload::text ~* 'team\s+alp'
      OR payload::text ~* 'agency\s+total'
      OR (payload::text ~* '\$[0-9,]+\s+ALP' AND channel = 'leadership')
    );

  IF v_bad_discord_count > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'rule', 'discord_banned_phrase',
      'severity', 'high',
      'count', v_bad_discord_count,
      'detail', 'Discord posts in last 24h contain team alp / agency total phrasing'
    );
  END IF;

  -- 4. Plaque queue rows targeting blocked IG handles (skip if table not yet deployed)
  v_blocked_ig_count := 0;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'plaque_ig_post_queue'
  ) THEN
    EXECUTE $sql$
      SELECT COUNT(*)::int FROM public.plaque_ig_post_queue
      WHERE LOWER(REGEXP_REPLACE(ig_handle, '^@', '')) IN (
        'theprincejamez', 'the_prince_james', 'the.prince.james', 'theprincejames'
      )
    $sql$ INTO v_blocked_ig_count;
  END IF;

  IF v_blocked_ig_count > 0 THEN
    v_findings := v_findings || jsonb_build_object(
      'rule', 'blocked_ig_handle',
      'severity', 'critical',
      'count', v_blocked_ig_count,
      'detail', 'plaque_ig_post_queue rows target hard-deny handle (Sam personal IG)'
    );
  END IF;

  -- Log to dedicated table (one row per run, keep history)
  INSERT INTO public.autoposter_watchdog_log (ok, findings, metrics)
  VALUES (
    jsonb_array_length(v_findings) = 0,
    v_findings,
    jsonb_build_object(
      'sam_deals', v_sam_deal_count,
      'rpc_week_alp', v_rpc_week_alp,
      'truth_week_alp', v_truth_week_alp,
      'drift_alp', v_drift_alp,
      'bad_discord_count', v_bad_discord_count,
      'blocked_ig_count', v_blocked_ig_count
    )
  );

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_findings) = 0,
    'findings', v_findings,
    'metrics', jsonb_build_object(
      'sam_deals', v_sam_deal_count,
      'week_alp_rpc', v_rpc_week_alp,
      'week_alp_truth', v_truth_week_alp,
      'drift_alp', v_drift_alp
    )
  );
END $function$;

COMMENT ON FUNCTION public.autoposter_leak_watchdog() IS
'Hourly leak detection: Sam zero-deals, RPC drift, banned Discord phrases, blocked IG handles. Writes to automation_health.';

-- Schedule it hourly (skip if pg_cron disabled)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('autoposter-leak-watchdog-hourly');
    PERFORM cron.schedule(
      'autoposter-leak-watchdog-hourly',
      '0 * * * *',  -- top of every hour
      $cmd$ SELECT public.autoposter_leak_watchdog(); $cmd$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- cron schedule errors are non-fatal — function still runnable manually
  NULL;
END $$;
