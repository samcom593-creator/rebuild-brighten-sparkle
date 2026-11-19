-- MP-PERF-DASH — apex_dashboard_summary (agency-GLOBAL jsonb: no args, no auth.uid,
-- identical for every caller) took ~2.9s on every agent portal load and 500'd under
-- the portal's tile burst. Wrap it in the established single-flight cache with a
-- global key + 180s TTL, and pre-warm it on the existing cron, so every portal load
-- is instant. Same payload (it is global, one entry serves all).

alter function public.apex_dashboard_summary() rename to apex_dashboard_summary_uncached;
revoke all on function public.apex_dashboard_summary_uncached() from public, anon, authenticated;

create or replace function public.apex_dashboard_summary()
returns jsonb language sql security definer set search_path to 'public'
as $wrap$
  select public.fn_rpc_single_flight('apex_dashboard_summary:global', 180,
    'select public.apex_dashboard_summary_uncached()');
$wrap$;
revoke all on function public.apex_dashboard_summary() from public, anon;
grant execute on function public.apex_dashboard_summary() to authenticated;

-- Extend the warmer to keep the global dashboard summary fresh too. Keeps the
-- 30s statement_timeout guard from 20261119060000 (CREATE OR REPLACE would drop it).
create or replace function public.apex_ops_snapshot_prewarm()
returns integer language plpgsql security definer
set search_path to 'public' set statement_timeout to '30s'
as $pw$
declare v_payload jsonb; v_uid uuid; v_n int := 0;
begin
  v_payload := public.apex_admin_operations_snapshot_compute();
  for v_uid in select ur.user_id from public.user_roles ur where ur.role = 'admin'::public.app_role loop
    insert into public.rpc_result_cache(cache_key, payload, computed_at)
    values ('apex_admin_operations_snapshot:' || v_uid::text, v_payload, now())
    on conflict (cache_key) do update set payload = excluded.payload, computed_at = excluded.computed_at;
    v_n := v_n + 1;
  end loop;
  insert into public.rpc_result_cache(cache_key, payload, computed_at)
  values ('apex_dashboard_summary:global', public.apex_dashboard_summary_uncached(), now())
  on conflict (cache_key) do update set payload = excluded.payload, computed_at = excluded.computed_at;
  return v_n + 1;
end
$pw$;
revoke all on function public.apex_ops_snapshot_prewarm() from public, anon, authenticated;
