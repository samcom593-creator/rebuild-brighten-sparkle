-- MP-LEAD-POOL-REFRESH-COST (1): the hourly pool rebuild runs 404-606s (10 runs today) on the
-- 1 GB Micro host and every owner RPC's p95 lands on top of it (fn_owner_goal_board 17s,
-- production_attribution_exceptions 16.5s, dashboard_deal_status 12s). Before changing what it
-- does, record how long each step takes, on the next run, without adding any load: the five
-- steps write their own elapsed ms into lead_pool_snapshot_meta.steps.
--
-- Applied live 2026-11-27 01:42Z through the Supabase MCP apply_migration (version = file name).
alter table public.lead_pool_snapshot_meta add column if not exists steps jsonb;

create or replace function public.refresh_lead_pool_snapshot()
returns jsonb
language plpgsql security definer
set search_path to 'public'
set work_mem to '64MB'
set maintenance_work_mem to '128MB'
as $$
declare t0 timestamptz := clock_timestamp(); t1 timestamptz; n integer; ms integer; st jsonb := '{}'::jsonb;
begin
  update public.lead_pool_snapshot_meta set started_at = t0 where id;
  t1 := clock_timestamp();
  refresh materialized view concurrently public.mat_lead_phone_fix;
  st := st || jsonb_build_object('phone_fix_ms', (extract(epoch from (clock_timestamp() - t1)) * 1000)::int);
  t1 := clock_timestamp();
  refresh materialized view concurrently public.mat_lead_pool;
  st := st || jsonb_build_object('pool_ms', (extract(epoch from (clock_timestamp() - t1)) * 1000)::int);
  -- MP-LEAD-COUNTS-SLIM: the count path's phone-flagged copy follows the pool it was cut from.
  t1 := clock_timestamp();
  refresh materialized view concurrently public.mat_lead_pool_slim;
  st := st || jsonb_build_object('slim_ms', (extract(epoch from (clock_timestamp() - t1)) * 1000)::int);
  -- MP-LEAD-PHONE-READYMODE-b: packs already handed out pick up new ReadyMode-number evidence.
  t1 := clock_timestamp();
  perform public.fn_repair_pack_phones();
  st := st || jsonb_build_object('repair_ms', (extract(epoch from (clock_timestamp() - t1)) * 1000)::int);
  -- The pool tiles and the filter lists are worked out once here, not on every page visit: over ~450k rows they
  -- took about 10 seconds each, past the 8-second limit a signed-in page call gets.
  t1 := clock_timestamp();
  begin
    perform public.fn_lead_pool_stats_refresh();
  exception when others then
    update public.lead_pool_stats set last_error = sqlerrm, error_at = now() where id;
  end;
  st := st || jsonb_build_object('stats_ms', (extract(epoch from (clock_timestamp() - t1)) * 1000)::int);
  select count(*)::int into n from public.mat_lead_pool;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  update public.lead_pool_snapshot_meta
     set refreshed_at = clock_timestamp(), rows = n, duration_ms = ms, last_error = null, steps = st
   where id;
  return jsonb_build_object('rows', n, 'duration_ms', ms, 'steps', st);
exception when others then
  update public.lead_pool_snapshot_meta set last_error = sqlerrm, error_at = now(), steps = st where id;
  return jsonb_build_object('error', sqlerrm, 'steps', st);
end $$;
