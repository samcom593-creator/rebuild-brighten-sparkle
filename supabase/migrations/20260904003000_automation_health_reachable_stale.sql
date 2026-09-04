-- MP-412: public.automation_health's 'stale' verdict was unreachable BY CONSTRUCTION.
--
-- The CTE filtered `triggered_at > now() - interval '24 hours'`, so last_run was
-- always inside 24h; the verdict then asked `last_run < now() - interval '2 days'`,
-- which is false for every row the CTE can produce. Proven on live prod
-- 2026-09-04: 8 rows, 0 stale, oldest last_run well inside the bar.
--
-- The consequence is not a cosmetic dead branch. A job that STOPS running leaves
-- the CTE entirely, so it does not go stale -- it disappears, and an empty result
-- reads as "nothing wrong" on every surface. Same shape as v_stripe_event_health
-- returning zero rows once Stripe went dark.
--
-- Fix: the row window must be strictly WIDER than the staleness bar, or the bar
-- can never be crossed. Window 3 days, bar 2 days. Both are written as plain
-- literals ON PURPOSE so that scripts/check-view-window-vs-threshold.mjs can
-- read and order them; hiding them behind a shared CTE column would have made
-- this view invisible to the guard written to protect it.
--
-- Honest about what this does NOT fix: a job silent for longer than the window
-- still leaves the view. That is why this view is no longer the spine of
-- /dashboard/automation-health -- cron.job is, via get_cron_jobs_with_status().
-- This view answers "of the jobs that recently logged, which are erroring or
-- have just gone quiet", and nothing more. Do not rebuild a
-- "does this automation exist" verdict on top of it.
--
-- The *_24h column names remain literally true: only the row window widened, the
-- counters are still filtered to 24 hours.
CREATE OR REPLACE VIEW public.automation_health AS
WITH recent AS (
  SELECT l.job_name,
         max(l.triggered_at) AS last_run,
         count(*) FILTER (WHERE l.status = 'success' AND l.triggered_at > now() - interval '24 hours') AS success_count_24h,
         count(*) FILTER (WHERE l.status = 'error'   AND l.triggered_at > now() - interval '24 hours') AS error_count_24h,
         count(*) FILTER (WHERE l.triggered_at > now() - interval '24 hours') AS total_24h,
         avg(l.duration_ms) FILTER (WHERE l.status = 'success' AND l.triggered_at > now() - interval '24 hours') AS avg_duration_ms,
         max(l.error) FILTER (WHERE l.status = 'error' AND l.triggered_at > now() - interval '24 hours') AS last_error
  FROM public.automation_run_log l
  -- ROW WINDOW. Must stay strictly WIDER than the stale bar below, or the stale
  -- branch becomes dead code again. That ordering is not left to this comment:
  -- scripts/check-view-window-vs-threshold.mjs re-derives both from this file on
  -- every commit and fails the build if they cross.
  WHERE l.triggered_at > now() - interval '3 days'
  GROUP BY l.job_name
)
SELECT r.job_name,
       r.last_run,
       r.success_count_24h,
       r.error_count_24h,
       r.total_24h,
       round(r.avg_duration_ms)::integer AS avg_duration_ms,
       r.last_error,
       CASE
         WHEN r.last_run < now() - interval '2 days'  THEN 'stale'   -- STALE BAR
         WHEN r.error_count_24h > 0
          AND r.success_count_24h = 0                 THEN 'broken'
         WHEN r.error_count_24h > 0                   THEN 'flaky'
         ELSE 'healthy'
       END AS health_status
FROM recent r;

GRANT SELECT ON public.automation_health TO authenticated;

COMMENT ON VIEW public.automation_health IS
  'Health of automations that logged a run in the last 3 days. The row window (3d) is deliberately wider than the stale bar (2d) so the stale verdict is reachable; before MP-412 the window was 24h and stale was dead code. A job silent longer than the window LEAVES this view -- absence here is not health. cron.job (get_cron_jobs_with_status) is the authority on what is scheduled.';
