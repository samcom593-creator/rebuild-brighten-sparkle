-- MP-431 (2026-09-04): "website not working / loading slow".
--
-- MEASURED, not assumed. The static site answered in ~100ms the whole time. The
-- database node (Supabase Micro: 2 shared vCPU, 0.95 GB) sat at load average
-- 17 with 140 MB free and 517 MB swapped. In the 21:30-21:50Z window the edge
-- logs show ONE client IP (Sam, two browsers) issuing ~1,350 heavy admin RPC
-- calls (apex_admin_home_dashboard 348, scoped_production_scoreboard 344,
-- imo_by_agency_period 240, apex_admin_operations_snapshot 202, ...), each
-- 5-9s at origin, 108 of them timing out at the 8s statement cap, while the
-- AgentLink sync rewrote 1,264 deal rows one PATCH at a time. Every rewrite
-- stamps status_updated_at=now(), so every row "changes", so every row is WAL,
-- a realtime packet, a 14-trigger AFTER fan-out, and a dirty production truth.
-- The dashboards refetch on the realtime packets (MP-388's coalescer bounds
-- ONE subscriber; the home page has several and each flush fans out to ~9
-- heavy calls per tab), the calls queue behind each other, time out, get
-- retried, and the box collapses. auth/v1 admin calls 504'd at 36s.
--
-- Four fixes, all at the source:
--   1. fn_rpc_single_flight: a 15s result cache keyed per (rpc, args, caller)
--      with an advisory-lock single flight. N concurrent callers -> 1 compute;
--      callers holding a stale copy get it back immediately while one of them
--      recomputes. The six heavy RPCs keep their names and signatures; the
--      originals become *_uncached and are revoked from anon/authenticated.
--   2. zz_suppress_noop_update on deals + agentlink_book: a BEFORE UPDATE row
--      trigger that ignores the touch columns (updated_at, status_updated_at /
--      imported_at) and returns NULL when nothing else changed. No WAL, no
--      realtime packet, no AFTER triggers, no dirty flag. Bonus correctness:
--      v_ceo_command_center.lapses_30d and v_lapses_30d_detail read
--      status_updated_at as "when the status changed"; the every-run stamping
--      made every lapsed deal look freshly lapsed.
--   3. truth_refresh_state.dirtied_at + a quiet-period debounce in
--      refresh_production_truth: refresh 15s after the LAST dirtying (a burst
--      refreshes once when it ends), with a 120s ceiling so a long sync still
--      moves. The dirty trigger writes at most once per 5s per burst.
--   4. job 98 (mat_production_unified, every minute, unconditional) now
--      refreshes only when the production truth moved, with a 10-minute floor.
--
-- Applied live via bot-sql in chunks (lock_timeout + retry on the hot tables).

-- @@chunk 1: cache table + single-flight helper + the six wrappers
create table if not exists public.rpc_result_cache (
  cache_key   text primary key,
  payload     jsonb not null,
  computed_at timestamptz not null default now(),
  compute_ms  integer,
  computes    bigint not null default 0
);
alter table public.rpc_result_cache enable row level security;
revoke all on table public.rpc_result_cache from public, anon, authenticated;

create or replace function public.fn_rpc_single_flight(p_key text, p_ttl_seconds integer, p_sql text)
returns jsonb
language plpgsql volatile security definer
set search_path to 'public'
as $fn$
declare
  v_payload jsonb;
  v_at      timestamptz;
  v_t0      timestamptz;
  v_lock    bigint := hashtextextended('rpc_single_flight:' || p_key, 0);
begin
  select c.payload, c.computed_at into v_payload, v_at
    from public.rpc_result_cache c where c.cache_key = p_key;
  if v_at is not null and v_at > now() - make_interval(secs => p_ttl_seconds) then
    return v_payload;
  end if;
  if not pg_try_advisory_xact_lock(v_lock) then
    -- another request is computing this exact key right now
    if v_at is not null then
      return v_payload;                      -- stale-while-revalidate
    end if;
    perform pg_advisory_xact_lock(v_lock);   -- nothing to serve: wait for the computer to commit
    select c.payload, c.computed_at into v_payload, v_at
      from public.rpc_result_cache c where c.cache_key = p_key;
    if v_at is not null and v_at > now() - make_interval(secs => p_ttl_seconds) then
      return v_payload;
    end if;
    -- the computer failed (timeout/error): we hold the lock now, compute ourselves
  end if;
  v_t0 := clock_timestamp();
  execute p_sql into v_payload;
  insert into public.rpc_result_cache as c (cache_key, payload, computed_at, compute_ms, computes)
  values (p_key, coalesce(v_payload, 'null'::jsonb), now(),
          (extract(epoch from clock_timestamp() - v_t0) * 1000)::integer, 1)
  on conflict (cache_key) do update
     set payload = excluded.payload, computed_at = excluded.computed_at,
         compute_ms = excluded.compute_ms, computes = c.computes + 1;
  return v_payload;
end
$fn$;
revoke all on function public.fn_rpc_single_flight(text, integer, text) from public, anon, authenticated;

-- apex_admin_home_dashboard(p_start, p_end) -> jsonb
alter function public.apex_admin_home_dashboard(date, date) rename to apex_admin_home_dashboard_uncached;
revoke all on function public.apex_admin_home_dashboard_uncached(date, date) from public, anon, authenticated;
create function public.apex_admin_home_dashboard(p_start date, p_end date)
returns jsonb language sql volatile security definer set search_path to 'public' as $w$
  select public.fn_rpc_single_flight(
    'apex_admin_home_dashboard:' || coalesce(p_start::text, '') || ':' || coalesce(p_end::text, '') || ':' || coalesce(auth.uid()::text, 'anon'),
    15,
    format('select public.apex_admin_home_dashboard_uncached(%L::date, %L::date)', p_start, p_end));
$w$;
revoke all on function public.apex_admin_home_dashboard(date, date) from public, anon;
grant execute on function public.apex_admin_home_dashboard(date, date) to authenticated, service_role;

-- scoped_production_scoreboard(p_start, p_end) -> jsonb
alter function public.scoped_production_scoreboard(date, date) rename to scoped_production_scoreboard_uncached;
revoke all on function public.scoped_production_scoreboard_uncached(date, date) from public, anon, authenticated;
create function public.scoped_production_scoreboard(p_start date, p_end date)
returns jsonb language sql volatile security definer set search_path to 'public' as $w$
  select public.fn_rpc_single_flight(
    'scoped_production_scoreboard:' || coalesce(p_start::text, '') || ':' || coalesce(p_end::text, '') || ':' || coalesce(auth.uid()::text, 'anon'),
    15,
    format('select public.scoped_production_scoreboard_uncached(%L::date, %L::date)', p_start, p_end));
$w$;
revoke all on function public.scoped_production_scoreboard(date, date) from public, anon;
grant execute on function public.scoped_production_scoreboard(date, date) to authenticated, service_role;

-- scoped_production_projection() -> jsonb
alter function public.scoped_production_projection() rename to scoped_production_projection_uncached;
revoke all on function public.scoped_production_projection_uncached() from public, anon, authenticated;
create function public.scoped_production_projection()
returns jsonb language sql volatile security definer set search_path to 'public' as $w$
  select public.fn_rpc_single_flight(
    'scoped_production_projection:' || coalesce(auth.uid()::text, 'anon'),
    15,
    'select public.scoped_production_projection_uncached()');
$w$;
revoke all on function public.scoped_production_projection() from public, anon;
grant execute on function public.scoped_production_projection() to authenticated, service_role;

-- apex_admin_operations_snapshot() -> jsonb
alter function public.apex_admin_operations_snapshot() rename to apex_admin_operations_snapshot_uncached;
revoke all on function public.apex_admin_operations_snapshot_uncached() from public, anon, authenticated;
create function public.apex_admin_operations_snapshot()
returns jsonb language sql volatile security definer set search_path to 'public' as $w$
  select public.fn_rpc_single_flight(
    'apex_admin_operations_snapshot:' || coalesce(auth.uid()::text, 'anon'),
    15,
    'select public.apex_admin_operations_snapshot_uncached()');
$w$;
revoke all on function public.apex_admin_operations_snapshot() from public, anon;
grant execute on function public.apex_admin_operations_snapshot() to authenticated, service_role;

-- imo_by_agency_period(p_start, p_end) -> table
alter function public.imo_by_agency_period(date, date) rename to imo_by_agency_period_uncached;
revoke all on function public.imo_by_agency_period_uncached(date, date) from public, anon, authenticated;
create function public.imo_by_agency_period(p_start date, p_end date)
returns table(agency text, is_primary boolean, policies integer, alp numeric, owner_override_pct numeric, est_owner_override_alp numeric)
language sql volatile security definer set search_path to 'public' as $w$
  select x.agency, x.is_primary, x.policies, x.alp, x.owner_override_pct, x.est_owner_override_alp
  from jsonb_to_recordset(public.fn_rpc_single_flight(
    'imo_by_agency_period:' || coalesce(p_start::text, '') || ':' || coalesce(p_end::text, '') || ':' || coalesce(auth.uid()::text, 'anon'),
    15,
    format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.imo_by_agency_period_uncached(%L::date, %L::date) t', p_start, p_end)))
  as x(agency text, is_primary boolean, policies integer, alp numeric, owner_override_pct numeric, est_owner_override_alp numeric);
$w$;
revoke all on function public.imo_by_agency_period(date, date) from public, anon;
grant execute on function public.imo_by_agency_period(date, date) to authenticated, service_role;

-- discord_deal_feed_health() -> table (anon-callable like the original; the body gates on role)
alter function public.discord_deal_feed_health() rename to discord_deal_feed_health_uncached;
revoke all on function public.discord_deal_feed_health_uncached() from public, anon, authenticated;
create function public.discord_deal_feed_health()
returns table(source text, agency_name text, status text, detail text, last_heartbeat_at timestamptz, last_message_at timestamptz, last_ingested_at timestamptz, unresolved_24h bigint, measured_at timestamptz)
language sql volatile security definer set search_path to 'public' as $w$
  select x.source, x.agency_name, x.status, x.detail, x.last_heartbeat_at, x.last_message_at, x.last_ingested_at, x.unresolved_24h, x.measured_at
  from jsonb_to_recordset(public.fn_rpc_single_flight(
    'discord_deal_feed_health:' || coalesce(auth.uid()::text, 'anon'),
    15,
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.discord_deal_feed_health_uncached() t'))
  as x(source text, agency_name text, status text, detail text, last_heartbeat_at timestamptz, last_message_at timestamptz, last_ingested_at timestamptz, unresolved_24h bigint, measured_at timestamptz);
$w$;
revoke all on function public.discord_deal_feed_health() from public;
grant execute on function public.discord_deal_feed_health() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- @@chunk 2: no-op update suppression on the two sync-rewritten tables
create or replace function public.trg_fn_suppress_noop_update()
returns trigger language plpgsql
as $fn$
declare
  v_ignore text[] := string_to_array(coalesce(tg_argv[0], ''), ',');
begin
  -- A rewrite that changes nothing but its own touch columns is not a change:
  -- no WAL, no realtime packet, no AFTER-trigger fan-out, no dirty truth.
  if (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
    return null;
  end if;
  return new;
end
$fn$;
drop trigger if exists zz_suppress_noop_update on public.deals;
create trigger zz_suppress_noop_update
  before update on public.deals
  for each row execute function public.trg_fn_suppress_noop_update('updated_at,status_updated_at');
drop trigger if exists zz_suppress_noop_update on public.agentlink_book;
create trigger zz_suppress_noop_update
  before update on public.agentlink_book
  for each row execute function public.trg_fn_suppress_noop_update('imported_at');

-- @@chunk 3: refresh debounce + job 98 gating
alter table public.truth_refresh_state add column if not exists dirtied_at timestamptz;

create or replace function public.trg_mark_truth_dirty()
returns trigger language plpgsql security definer set search_path to 'public'
as $fn$
begin
  -- at most one write per 5s per burst: the refresh reads dirtied_at as "when
  -- did this stop being touched", and a 1,264-statement sync must not leave
  -- 1,264 dead tuples on a 3-row table.
  update public.truth_refresh_state
     set dirty = true, dirtied_at = now(), updated_at = now()
   where name = any(string_to_array(tg_argv[0], ','))
     and (not dirty or dirtied_at is null or dirtied_at < now() - interval '5 seconds');
  return null;
end
$fn$;

create or replace function public.refresh_production_truth(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare
  r record; t0 timestamptz; v_out jsonb := '{}'::jsonb; v_due boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_production_truth')) then
    return jsonb_build_object('skipped', 'another refresh holds the lock');
  end if;
  -- agent facts feed the hierarchy and the production truth: refresh in that order,
  -- and anything upstream being dirty makes everything downstream dirty.
  for r in select name, dirty, dirtied_at, refreshed_at from public.truth_refresh_state
           order by case name when 'agent_flags' then 1 when 'hierarchy' then 2 else 3 end loop
    -- MP-431 debounce: a burst (the AgentLink sync writes for minutes) refreshes
    -- once 15s after its LAST write, not every 30s while it runs; the 120s
    -- ceiling keeps a very long burst from starving the truth entirely.
    v_due := p_force or (r.dirty and (
               coalesce(r.dirtied_at, now()) < now() - interval '15 seconds'
            or coalesce(r.refreshed_at, '-infinity'::timestamptz) < now() - interval '120 seconds'));
    v_due := v_due
      or (r.name in ('hierarchy','production') and (v_out ? 'agent_flags'))
      or (r.name = 'production' and (v_out ? 'hierarchy'));
    if not v_due then continue; end if;
    t0 := clock_timestamp();
    begin
      if r.name = 'agent_flags' then refresh materialized view concurrently public.mv_agent_truth;
      elsif r.name = 'hierarchy' then refresh materialized view concurrently public.mv_hierarchy_hops;
      else refresh materialized view concurrently public.mv_production_comp_truth; end if;
      update public.truth_refresh_state
         set dirty = false, refreshed_at = now(), last_error = null, updated_at = now(),
             refresh_ms = (extract(epoch from clock_timestamp() - t0) * 1000)::integer
       where name = r.name;
      v_out := v_out || jsonb_build_object(r.name, (extract(epoch from clock_timestamp() - t0) * 1000)::integer);
    exception when others then
      update public.truth_refresh_state set last_error = sqlerrm, updated_at = now() where name = r.name;
      v_out := v_out || jsonb_build_object(r.name, 'error: ' || sqlerrm);
    end;
  end loop;
  return v_out;
end
$fn$;

create or replace function public.refresh_mat_production_unified_if_needed()
returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_truth timestamptz; v_last timestamptz; t0 timestamptz;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_mat_production_unified')) then
    return jsonb_build_object('skipped', 'locked');
  end if;
  select refreshed_at into v_truth from public.truth_refresh_state where name = 'production';
  select refreshed_at into v_last from public.mat_refresh_heartbeat where view_name = 'mat_production_unified';
  -- MP-431: this ran unconditionally every minute (0.5s idle, 5-20s under load).
  -- The production truth only refreshes when its base tables actually moved,
  -- so follow it; the 10-minute floor keeps this honest if that signal breaks.
  if v_last is not null and v_last > now() - interval '10 minutes'
     and (v_truth is null or v_truth <= v_last) then
    return jsonb_build_object('skipped', 'no production movement since last refresh', 'last_refreshed_at', v_last);
  end if;
  t0 := clock_timestamp();
  refresh materialized view concurrently public.mat_production_unified;
  insert into public.mat_refresh_heartbeat (view_name) values ('mat_production_unified')
  on conflict (view_name) do update set refreshed_at = now();
  return jsonb_build_object('refreshed_ms', (extract(epoch from clock_timestamp() - t0) * 1000)::integer);
end
$fn$;

do $cron$
begin
  perform cron.alter_job(job_id := (select jobid from cron.job where jobname = 'apex-mat-production-refresh'),
                         command := 'select public.refresh_mat_production_unified_if_needed()');
end
$cron$;

-- @@chunk 4: keep the cache table bounded (keys are per caller x args; custom date windows accumulate)
do $cron2$
begin
  if not exists (select 1 from cron.job where jobname = 'prune-rpc-result-cache') then
    perform cron.schedule('prune-rpc-result-cache', '17 3 * * *',
      $$delete from public.rpc_result_cache where computed_at < now() - interval '1 day'$$);
  end if;
end
$cron2$;
