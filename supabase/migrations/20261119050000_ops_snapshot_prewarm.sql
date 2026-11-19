-- MP-PERF-OPS — the admin Operations snapshot on Sam's Home timed out / 500'd under
-- the tile burst because its single-flight cache had a 15s TTL, so nearly every
-- visit recomputed the ~1s aggregate synchronously. Fix: pre-warm both admins'
-- cache entries on a 2-min pg_cron, raise the TTL to 300s, and split the body into
-- a gate-free compute twin so the cron can populate the cache without the per-caller
-- admin gate. Behaviour is identical for an admin (same payload); a non-admin is
-- still rejected by the gate on the uncached path and never reaches the cache.

-- Gate-free twin of the ops snapshot body (single source — the uncached function
-- and the pre-warm cron both call this). Revoked from anon/authenticated: only
-- SECURITY DEFINER callers (the gated uncached fn, the cron) reach it.
create or replace function public.apex_admin_operations_snapshot_compute()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $compute$
declare
  v_recruiting jsonb;
  v_onboarding jsonb;
  v_contracting jsonb;
  v_sales jsonb;
  v_readymode jsonb;
  v_support jsonb;
begin

  select jsonb_build_object(
    'active', count(*),
    'new', count(*) filter (where status::text = 'new'),
    'uncontacted', count(*) filter (where contacted_at is null and closed_at is null),
    'uncontacted_48h', count(*) filter (where contacted_at is null and closed_at is null and created_at < now() - interval '48 hours'),
    'interview', count(*) filter (where status::text = 'interview'),
    'contracting', count(*) filter (where status::text = 'contracting'),
    'hired', count(*) filter (where closed_at is not null)
  ) into v_recruiting
  from public.applications
  where record_type = 'application' and terminated_at is null
    and not coalesce(tags @> array['xcel_roster']::text[], false);

  select jsonb_build_object(
    'stalled', count(*) filter (where next_missing_step not like 'COMPLETE%'),
    'intake_missing', count(*) filter (where next_missing_step like '1.%'),
    'npn_comp_missing', count(*) filter (where next_missing_step like '2.%'),
    'carrier_contracting', count(*) filter (where next_missing_step like '3.%'),
    'appointment_missing', count(*) filter (where next_missing_step like '4.%'),
    'discord_missing', count(*) filter (where next_missing_step like '5.%'),
    'training_missing', count(*) filter (where next_missing_step like '6.%'),
    'launch_missing', count(*) filter (where next_missing_step like '7.%'),
    'first_sale_missing', count(*) filter (where next_missing_step like '8.%'),
    'complete', count(*) filter (where next_missing_step like 'COMPLETE%')
  ) into v_onboarding from public.v_onboarding_sequence;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where lower(coalesce(status,'')) = 'active'),
    'pending', count(*) filter (where lower(coalesce(status,'')) in ('requested','submitted','pending','agent_action_required')),
    'issues', count(*) filter (where lower(coalesce(status,'')) in ('issue','declined','error'))
  ) into v_contracting from public.apex_carrier_contracts;

  select jsonb_build_object(
    'expected_to_sell', count(*),
    'sold_today', count(*) filter (where pulse = 'sold_today'),
    'not_selling', count(*) filter (where pulse <> 'sold_today'),
    'people', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select vp.agent_id, vp.agent_name, vp.leg, vp.pulse, vp.business_days_quiet,
          vp.last_sale, vp.deals_mtd, vp.ap_mtd,
          coalesce(p.phone, '') as phone, coalesce(p.email, '') as email
        from public.v_producer_pulse vp
        left join public.agents a on a.id = vp.agent_id
        left join public.profiles p on p.id = a.profile_id
        where vp.pulse <> 'sold_today'
        order by case vp.pulse when 'cold' then 0 when 'slipping' then 1 when 'quiet' then 2 else 3 end,
          vp.business_days_quiet desc nulls last, vp.agent_name
        limit 12
      ) x
    ), '[]'::jsonb)
  ) into v_sales from public.v_producer_pulse;

  select coalesce(to_jsonb(h), '{}'::jsonb) || jsonb_build_object(
    'sync_enabled', coalesce((select value::text::boolean from public.system_settings where key='readymode_sync_enabled'), false)
  ) into v_readymode
  from public.v_readymode_ingest_health h
  limit 1;

  select jsonb_build_object(
    'open', count(*) filter (where status in ('open','in_progress','waiting_on_requester')),
    'urgent', count(*) filter (where status in ('open','in_progress','waiting_on_requester') and priority = 'urgent')
  ) into v_support from public.support_requests;

  return jsonb_build_object(
    'as_of', now(), 'recruiting', coalesce(v_recruiting, '{}'::jsonb),
    'onboarding', coalesce(v_onboarding, '{}'::jsonb),
    'contracting', coalesce(v_contracting, '{}'::jsonb),
    'sales', coalesce(v_sales, '{}'::jsonb),
    'readymode', coalesce(v_readymode, '{}'::jsonb),
    'support', coalesce(v_support, '{}'::jsonb)
  );
end;
$compute$;
revoke all on function public.apex_admin_operations_snapshot_compute() from public, anon, authenticated;

-- Keeps the admin gate; delegates the work to the compute twin (no logic copy).
create or replace function public.apex_admin_operations_snapshot_uncached()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $uncached$
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return public.apex_admin_operations_snapshot_compute();
end
$uncached$;
revoke all on function public.apex_admin_operations_snapshot_uncached() from public, anon, authenticated;

-- TTL 15s -> 300s: the operations overview does not need 15-second freshness, and
-- a 15s window made nearly every admin Home visit recompute the ~1s aggregate
-- synchronously and 500 under the tile burst. The pre-warm cron keeps it fresher
-- than this anyway; 300s is the safety floor.
create or replace function public.apex_admin_operations_snapshot()
returns jsonb language sql security definer set search_path to 'public'
as $wrap$
  select public.fn_rpc_single_flight(
    'apex_admin_operations_snapshot:' || coalesce(auth.uid()::text, 'anon'),
    300,
    'select public.apex_admin_operations_snapshot_compute()');
$wrap$;

-- Keep the two admins' ops-snapshot cache entries warm so the Home never pays the
-- cold ~1s compute inside the tile burst. Upserts the gate-free payload under each
-- admin's per-uid cache key (the key the wrapper reads). Read-only compute.
create or replace function public.apex_ops_snapshot_prewarm()
returns integer language plpgsql security definer set search_path to 'public'
as $pw$
declare v_payload jsonb; v_uid uuid; v_n int := 0;
begin
  v_payload := public.apex_admin_operations_snapshot_compute();
  for v_uid in
    select ur.user_id from public.user_roles ur where ur.role = 'admin'::public.app_role
  loop
    insert into public.rpc_result_cache(cache_key, payload, computed_at)
    values ('apex_admin_operations_snapshot:' || v_uid::text, v_payload, now())
    on conflict (cache_key) do update set payload = excluded.payload, computed_at = excluded.computed_at;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$pw$;
revoke all on function public.apex_ops_snapshot_prewarm() from public, anon, authenticated;

select cron.schedule('apex-ops-snapshot-prewarm', '*/2 * * * *', $$select public.apex_ops_snapshot_prewarm();$$)
where not exists (select 1 from cron.job where jobname = 'apex-ops-snapshot-prewarm');
