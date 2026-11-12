-- PERF-LOAD-TIMES (2026-11-12). Sam: "getting slow, load times."
--
-- Measured before this file (edge logs, browser traffic, 24h; pg_stat_statements since 11-09):
--   * The static site is not the problem: the HTML shell answers in 0.1-0.2s and the first
--     paint pulls ~180 KB of JS/CSS. Every slow surface is a database call.
--   * Book of Business (My Deals) was not slow, it was BROKEN: v_book_of_business 81/96
--     loads 403, book_of_business_counts 45/51 403, book_state_summary 17/19 403, each
--     after ~1.2s. 20261110090000 flipped v_book_of_business to security_invoker; the view
--     LEFT JOINs us_area_codes, which 20261030120000 had revoked from authenticated. So every
--     logged-in read hit "permission denied for table us_area_codes" (42501).
--   * production_book_freshness() (the Dashboard scoreboard, every user's home page):
--     p50 6.0s / p95 8.1s, 3 timeouts. As an ordinary agent it takes 2.8s on an idle DB,
--     as Sam 0.42s. The view underneath costs 0.17s; the rest is the scope predicate
--     crm_can_read_agent_scope(agent_id) evaluated ~1,400 times (once per ROW), each call a
--     SECURITY DEFINER chain that re-walks the caller's downline (2.07 ms/call measured).
--   * system_health_logs (Dashboard "latest health"): p50 0.76s / p95 3.1s on a 13,659-row
--     table that HAS an index on checked_at. Its RLS policy calls has_role(auth.uid(), ...)
--     once per row, so a non-admin's ORDER BY checked_at DESC LIMIT 1 tests every row,
--     finds none, and returns nothing after thousands of function calls.
--   * apex_can_read_agent's downline walk (used per row by 41 functions + 4 views) scans
--     agents on every recursion level: agents.user_id has no index and the manager_id /
--     invited_by_manager_id indexes are PARTIAL (live agents only), which the walk's
--     unfiltered join cannot use.
--
-- Every change below returns exactly what it returned before. None widens access except
-- us_area_codes, which is 349 rows of public area-code -> state reference data.

-- 1. Book of Business 403s. Grant + an explicit read policy: RLS is ON for this table, so a
--    grant alone would return ZERO rows to authenticated and the view's area-code state
--    fallback would silently go blank instead of erroring. That is worse than the 403.
grant select on table public.us_area_codes to authenticated;
drop policy if exists us_area_codes_read_authenticated on public.us_area_codes;
create policy us_area_codes_read_authenticated
  on public.us_area_codes
  for select
  to authenticated
  using (true);

-- 2. system_health_logs: the admin test does not depend on the row, so evaluate it once per
--    statement (InitPlan) instead of once per row. Same predicate, same result. The ALL
--    policy has no WITH CHECK, so its write check keeps defaulting to this USING expression.
alter policy "Admins read health" on public.system_health_logs
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));
alter policy "Admins can manage health logs" on public.system_health_logs
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

-- 3. Indexes the downline walk can actually use (agents is ~241 rows; build is instant).
create index if not exists idx_agents_user_id on public.agents (user_id);
create index if not exists idx_agents_manager_id_all on public.agents (manager_id);
create index if not exists idx_agents_invited_by_manager_id_all on public.agents (invited_by_manager_id);

-- 4. production_book_freshness(): the scope predicate depends ONLY on agent_id, so evaluate it
--    once per DISTINCT agent (~100) instead of once per row (~1,400). Same function, same
--    arguments, same truth values, so the same rows survive:
--      admin            -> every agent_id passes                      -> every row (as before)
--      va / va_manager  -> crm_can_read_agent_scope(NULL) is TRUE, so NULL is in `readable`
--                          and NULL-agent rows match via IS NOT DISTINCT FROM (as before)
--      ordinary agent   -> a FALSE/NULL verdict never enters `readable` (as before)
create or replace function public.production_book_freshness()
returns table(
  last_posted_date date,
  last_posted_count integer,
  last_posted_ap numeric,
  last_synced_at timestamp with time zone,
  live_policies integer
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with base as (
    select t.posted_date, t.annual_premium, t.synced_at, t.agent_id
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
  ), viewer as (
    select public.apex_is_admin() as is_admin
  ), agent_ids as materialized (
    -- MATERIALIZED is load-bearing. Without it the planner pushes the scope filter BELOW the
    -- DISTINCT (Filter on "CTE Scan on base", then HashAggregate) and it runs 1,422 times
    -- again: measured 2,295 ms of a 2,468 ms run as an ordinary agent on the first cut.
    select distinct b.agent_id from base b
  ), readable as materialized (
    -- MATERIALIZED here too. Inlined, this CTE lands inside the per-row EXISTS below and the
    -- planner re-evaluates the scope check for every (row x agent) pair: the second cut of
    -- this function ran 65s+ as an ordinary agent before it was cancelled.
    select a.agent_id
    from agent_ids a
    where (select v.is_admin from viewer v) or public.crm_can_read_agent_scope(a.agent_id)
  ), scoped as (
    select b.posted_date, b.annual_premium, b.synced_at
    from base b
    where exists (select 1 from readable r where r.agent_id is not distinct from b.agent_id)
  ), newest as (
    select max(posted_date) as d from scoped
  )
  select
    (select d from newest),
    (select count(*)::integer from scoped s, newest n where s.posted_date = n.d),
    (select coalesce(sum(annual_premium), 0) from scoped s, newest n where s.posted_date = n.d),
    greatest(
      (select nullif(value, '')::timestamptz from public.system_settings where key = 'agentlink_book_last_refreshed_at'),
      (select max(imported_at) from public.agentlink_book),
      (select max(synced_at) from scoped)
    ),
    (select count(*)::integer from scoped);
$function$;
