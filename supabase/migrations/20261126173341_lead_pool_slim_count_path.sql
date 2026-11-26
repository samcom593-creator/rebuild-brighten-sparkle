-- MP-LEAD-COUNTS-SLIM (2/2): the common no-history preview reads the slim snapshot, and the
-- hourly pool refresh rebuilds the slim copy right after the pool so the two cannot drift
-- for longer than one refresh step. Everything else in the function is byte-for-byte the
-- 20261126040000 body (history filters, legacy flag contract, sample enrichment).
--
-- Applied live 2026-11-26 17:33Z through the Supabase MCP apply_migration (version = file name).
-- Proven equal to the old path on the marketing pool before the swap: 195,361 phones,
-- 192,348 ready, 1,502 DNC, 337 current clients, 1,239 in packs on both sides.
create or replace function public.lead_pool_preview_candidates(p_source text, p_filters jsonb)
returns table(phone10 text, tier text, lead_age_days integer, under_9mo boolean,
  true_dnc boolean, current_client boolean, needs_review boolean,
  already_sold boolean, in_bundle boolean)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  f jsonb := coalesce(p_filters, '{}');
  need_caller boolean := nullif(f->>'caller','') is not null;
  need_outcome boolean := f ? 'outcomes' and jsonb_array_length(f->'outcomes') > 0;
  need_attempts boolean := f ? 'min_attempts' or f ? 'max_attempts';
  need_touched boolean := f ? 'touched_after' or f ? 'touched_before';
  need_callback boolean := f ? 'callback_before';
begin
  -- Preserve the generic legacy flag contract for work fields that can contain
  -- the literal text "true". Ordinary boolean flags use the compact path below.
  if exists (select 1 from jsonb_array_elements_text(f->'require_flags') k
    where k = any(array['last_caller','last_outcome','last_touched_at','callback_at','next_action','times_called','source_attempts'])) then
    return query select c.phone10,c.tier,c.lead_age_days,c.under_9mo,
      (c.flags->>'true_dnc')::boolean,(c.flags->>'current_client')::boolean,
      coalesce((c.flags->>'import_review_required')::boolean,false),c.already_sold,c.in_bundle
    from public.lead_pool_candidates(p_source,f) c;
    return;
  end if;

  -- The common source/state/age preview reads the slim snapshot (MP-LEAD-COUNTS-SLIM): the
  -- held-phone flags were computed when the pool was rebuilt; DNC marks, sold phones and
  -- live packs are still read live because they change between refreshes.
  if (case when jsonb_typeof(f)='object'
    then f - array['exclude_dnc','exclude_resold','sort','tiers','states','min_age','max_age','max_lead_age_days'] = '{}'::jsonb
    else false end) then
    return query select s.phone10,s.tier,s.lead_age_days,s.under_9mo,
      (s.flag_true_dnc
        or exists (select 1 from public.lead_contact_dnc d where d.phone10 = s.phone10)
        or (s.replaced_phone10 is not null and exists (select 1 from public.lead_contact_dnc d2 where d2.phone10 = s.replaced_phone10))) as true_dnc,
      s.current_client,s.needs_review,
      exists (select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10) as already_sold,
      exists (select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null) as in_bundle
    from public.mat_lead_pool_slim s
    where s.source=p_source
      and public.lead_pool_static_filter_matches(s.state,s.age,s.tier,s.lead_age_days,f);
    return;
  end if;

  return query
  with taps as materialized (
    select i.phone10,count(*)::integer as n,max(e.at) as touched_at,
      (array_agg(e.actor order by e.at desc))[1] as actor
    from public.lead_bundle_events e join public.lead_bundle_items i on i.id=e.item_id
    where e.action='dial_tap' and (need_caller or need_outcome or need_attempts or need_touched)
    group by i.phone10
  ), work as materialized (
    select distinct on (i.phone10) i.phone10,i.status,i.status_at,i.callback_at,
      case when need_caller then coalesce((select a.display_name from public.agents a where a.user_id=i.status_by
        order by (a.canonical_agent_id is null) desc,a.created_at limit 1),i.last_agent) end as caller
    from public.lead_bundle_items i
    where i.status_at is not null and (need_caller or need_outcome or need_touched or need_callback)
    order by i.phone10,i.status_at desc,i.id
  ), typed as materialized (
    select s.phone10,s.tier,s.lead_age_days,s.under_9mo,s.true_dnc,s.current_client,s.needs_review,s.already_sold,s.in_bundle,
      case when need_caller or need_outcome or need_touched or need_callback
        then public.lead_context_time(s.flags->>'last_touched_at') end as source_at,
      case when need_caller then s.flags->>'last_caller' end as source_caller,
      case when need_outcome then s.flags->>'last_outcome' end as source_outcome,
      case when need_attempts or need_outcome then coalesce((s.flags->>'times_called')::integer,0)+coalesce(t.n,0) else 0 end as attempts,
      case when need_callback then public.lead_context_time(s.flags->>'callback_at') end as source_callback,
      w.status_at,w.status,w.callback_at,w.caller,
      t.touched_at as tap_at,
      case when need_caller then (select a.display_name from public.agents a where a.user_id=t.actor order by a.created_at limit 1) end as tap_caller
    from public.v_lead_pool_candidate_base s
    left join work w on w.phone10=s.phone10
    left join taps t on t.phone10=s.phone10
    where s.source=p_source
      and public.lead_pool_static_filter_matches(s.state,s.age,s.tier,s.lead_age_days,f)
      and (not (f ? 'campaigns') or jsonb_array_length(f->'campaigns')=0
        or coalesce(s.flags->'campaigns',jsonb_build_array(s.flags->>'campaign')) ?| array(select jsonb_array_elements_text(f->'campaigns')))
      and (not (f ? 'require_flags') or not exists (
        select 1 from jsonb_array_elements_text(f->'require_flags') k
        where coalesce(case k
          when 'true_dnc' then s.true_dnc::text when 'dnc' then s.true_dnc::text
          when 'current_client' then s.current_client::text when 'import_review_required' then s.needs_review::text
          when 'already_sold' then s.already_sold::text when 'in_bundle' then s.in_bundle::text
          when 'blocked' then (s.true_dnc or s.current_client or s.needs_review or s.already_sold or s.in_bundle)::text
          when 'policy_standing' then case when s.current_client then 'current_client' else coalesce(s.flags->>'policy_standing','unverified') end
          else s.flags->>k end,'false') <> 'true'))
      and (coalesce(f->>'vantage_only','false') <> 'true' or s.flags->>'vantage'='true')
      and (nullif(f->>'source_file','') is null or position(lower(f->>'source_file') in lower(coalesce(s.flags->>'source_file',''))) > 0)
      and (nullif(f->>'source_type','') is null or s.flags->>'source_type'=f->>'source_type')
      and (nullif(f->>'policy_standing','') is null or case when s.current_client then 'current_client' else coalesce(s.flags->>'policy_standing','unverified') end=f->>'policy_standing')
      and case coalesce(f->>'hold','')
        when '' then true when 'ready' then not (s.true_dnc or s.current_client or s.needs_review or s.already_sold or s.in_bundle)
        when 'true_dnc' then s.true_dnc when 'current_client' then s.current_client
        when 'assigned' then s.in_bundle when 'resold' then s.already_sold when 'review' then s.needs_review
        else false end
  ), resolved as not materialized (
    select t.*,
      case when t.tap_at > greatest(coalesce(t.source_at,'-infinity'::timestamptz),coalesce(t.status_at,'-infinity'::timestamptz)) then t.tap_caller
        when t.status_at > coalesce(t.source_at,'-infinity'::timestamptz) then t.caller else t.source_caller end as last_caller,
      public.lead_outcome_key(case when t.status_at > coalesce(t.source_at,'-infinity'::timestamptz) then t.status else t.source_outcome end) as last_outcome,
      greatest(t.source_at,t.status_at,t.tap_at) as touched_at,
      case when t.status_at > coalesce(t.source_at,'-infinity'::timestamptz) then t.callback_at else t.source_callback end as resolved_callback
    from typed t
  )
  select r.phone10,r.tier,r.lead_age_days,r.under_9mo,r.true_dnc,r.current_client,r.needs_review,r.already_sold,r.in_bundle
  from resolved r
  where (not need_caller or position(lower(f->>'caller') in lower(coalesce(r.last_caller,''))) > 0)
    and (not need_outcome or (f->'outcomes') ? case when r.attempts>0 and r.last_outcome='never_called' then 'unknown' else r.last_outcome end)
    and (not (f ? 'min_attempts') or r.attempts >= (f->>'min_attempts')::integer)
    and (not (f ? 'max_attempts') or r.attempts <= (f->>'max_attempts')::integer)
    and (not (f ? 'touched_after') or r.touched_at >= ((f->>'touched_after')::date::timestamp at time zone 'America/Phoenix'))
    and (not (f ? 'touched_before') or r.touched_at < (((f->>'touched_before')::date+1)::timestamp at time zone 'America/Phoenix'))
    and (not (f ? 'callback_before') or r.resolved_callback < (((f->>'callback_before')::date+1)::timestamp at time zone 'America/Phoenix'));
end $$;

-- The hourly refresh rebuilds the slim copy right after the pool. CONCURRENTLY so a count
-- running at :17 reads the previous copy instead of waiting on a lock.
create or replace function public.refresh_lead_pool_snapshot()
returns jsonb
language plpgsql security definer
set search_path to 'public'
set work_mem to '64MB'
set maintenance_work_mem to '128MB'
as $$
declare t0 timestamptz := clock_timestamp(); n integer; ms integer;
begin
  update public.lead_pool_snapshot_meta set started_at = t0 where id;
  refresh materialized view concurrently public.mat_lead_phone_fix;
  refresh materialized view concurrently public.mat_lead_pool;
  -- MP-LEAD-COUNTS-SLIM: the count path's phone-flagged copy follows the pool it was cut from.
  refresh materialized view concurrently public.mat_lead_pool_slim;
  -- MP-LEAD-PHONE-READYMODE-b: packs already handed out pick up new ReadyMode-number evidence.
  perform public.fn_repair_pack_phones();
  -- The pool tiles and the filter lists are worked out once here, not on every page visit: over ~450k rows they
  -- took about 10 seconds each, past the 8-second limit a signed-in page call gets.
  begin
    perform public.fn_lead_pool_stats_refresh();
  exception when others then
    update public.lead_pool_stats set last_error = sqlerrm, error_at = now() where id;
  end;
  select count(*)::int into n from public.mat_lead_pool;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  update public.lead_pool_snapshot_meta
     set refreshed_at = clock_timestamp(), rows = n, duration_ms = ms, last_error = null
   where id;
  return jsonb_build_object('rows', n, 'duration_ms', ms);
exception when others then
  update public.lead_pool_snapshot_meta set last_error = sqlerrm, error_at = now() where id;
  return jsonb_build_object('error', sqlerrm);
end $$;
