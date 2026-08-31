-- MP-337: the CRM was slow because three functions re-derived the entire
-- production union on every page load.
--
-- MEASURED, as the viewer Sam is: crm_agent_sales_pulse 6.2s,
-- crm_roster_segments 5.2s, crm_today_production 4.0s wall — and
-- pg_stat_statements says the class has burned 132 + 109 + 104 MINUTES of
-- database time. The punchline is the row count: v_production_unified holds
-- 1,427 rows. The cost is not data volume, it is recomputing the multi-source
-- union + dedupe + per-row subagency resolution from scratch on every call,
-- twice per function.
--
-- THE FIX is a materialized snapshot refreshed every minute by pg_cron.
-- Sixty refreshes an hour at ~1-2s each costs less than ONE page load cost
-- before, and readers see a table scan over 1,427 rows.
--
-- WHAT THIS DOES NOT TOUCH: scoped_production_scoreboard and
-- finances_overview_base keep reading the live views — money surfaces stay
-- zero-staleness. Only the three measured CRM offenders move to the snapshot,
-- where up-to-a-minute staleness is invisible (the CRM page's realtime
-- invalidation refetches on new deals anyway, and the refetch lands after the
-- next refresh).
--
-- NO GRANT to authenticated on the matview, deliberately: it carries client
-- names. The three readers are SECURITY DEFINER functions with their own
-- crm_can_read_roster / crm_can_read_agent_scope checks; granting the matview
-- to authenticated would open a PostgREST read that bypasses those checks —
-- the 258-definer-view disease in a new costume.

begin;

drop materialized view if exists public.mat_production_unified;
create materialized view public.mat_production_unified as
  select * from public.v_production_unified;

-- Unique index required for REFRESH CONCURRENTLY (readers never block).
-- row_key proven unique on live data: 1,427 rows, 1,427 distinct keys.
create unique index mat_production_unified_row_key
  on public.mat_production_unified (row_key);
create index mat_production_unified_agent_date
  on public.mat_production_unified (agent_id, posted_date);
create index mat_production_unified_date
  on public.mat_production_unified (posted_date);

-- Freshness receipt. A snapshot whose refresh dies goes quietly stale; this
-- row is the operand a doctor check can grade without guessing from stats.
create table if not exists public.mat_refresh_heartbeat (
  view_name text primary key,
  refreshed_at timestamptz not null default now()
);

insert into public.mat_refresh_heartbeat (view_name)
values ('mat_production_unified')
on conflict (view_name) do update set refreshed_at = now();

-- Refresh every minute. CONCURRENTLY so a page load mid-refresh reads the old
-- snapshot instead of waiting on a lock.
select cron.unschedule(jobid) from cron.job where jobname = 'apex-mat-production-refresh';
select cron.schedule(
  'apex-mat-production-refresh',
  '* * * * *',
  $cron$
    refresh materialized view concurrently public.mat_production_unified;
    insert into public.mat_refresh_heartbeat (view_name)
    values ('mat_production_unified')
    on conflict (view_name) do update set refreshed_at = now();
  $cron$
);

commit;
