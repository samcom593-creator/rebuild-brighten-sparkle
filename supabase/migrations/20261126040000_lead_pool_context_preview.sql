-- Match broad work filters with compact typed context. Enrich only the sampled
-- or selected phones, while retaining the existing protection and RPC gates.
begin;

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

  -- Keep the released no-history path for the common source/state/age preview.
  if (case when jsonb_typeof(f)='object'
    then f - array['exclude_dnc','exclude_resold','sort','tiers','states','min_age','max_age','max_lead_age_days'] = '{}'::jsonb
    else false end) then
    return query select s.phone10,s.tier,s.lead_age_days,s.under_9mo,
      s.true_dnc,s.current_client,s.needs_review,s.already_sold,s.in_bundle
    from public.v_lead_pool_candidate_base s
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
revoke all on function public.lead_pool_preview_candidates(text,jsonb) from public, anon, authenticated;

create or replace function public.lead_pool_counts(p_source text, p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare result jsonb; refreshed timestamptz;
begin
  if not public.can_view_sold_calls() then raise exception 'Only lead administrators can browse lead pools.' using errcode='42501'; end if;
  if p_source not in ('marketing','dialer','rewrite','winback') then raise exception 'Unknown lead pool.' using errcode='22023'; end if;
  select refreshed_at into refreshed from public.lead_pool_snapshot_meta where id;
  with candidates as materialized (
    select * from public.lead_pool_preview_candidates(p_source,p_filters)
  ), unique_ready as materialized (
    select distinct on (phone10) phone10,tier,lead_age_days,under_9mo
    from candidates where not (true_dnc or current_client or needs_review or already_sold or in_bundle)
    order by phone10,array_position(array['S','pos','A','B','F','C','D'],tier),lead_age_days
  ), sample_candidates as (
    select * from unique_ready where nullif(p_filters->>'hold','') is null
    union all
    (select distinct on (phone10) phone10,tier,lead_age_days,under_9mo
     from candidates where nullif(p_filters->>'hold','') is not null
     order by phone10,array_position(array['S','pos','A','B','F','C','D'],tier),lead_age_days)
  ), sample_phones as (
    select phone10 from sample_candidates
    order by array_position(array['S','pos','A','B','F','C','D'],tier),lead_age_days limit 25
  ), sample_rows as (
    select distinct on (phone10) *
    from public.lead_pool_candidates_for_phones(p_source,p_filters,array(select phone10 from sample_phones))
    where not (flags->>'blocked')::boolean or nullif(p_filters->>'hold','') is not null
    order by phone10,array_position(array['S','pos','A','B','F','C','D'],tier),lead_age_days
  )
  select jsonb_build_object(
    'total',(select count(*) from unique_ready),
    'matching',(select count(*) from (select distinct phone10 from candidates) z),
    'under_9mo',(select count(*) from unique_ready where under_9mo),
    'by_tier',coalesce((select jsonb_object_agg(tier,n) from (select tier,count(*) n from unique_ready group by tier) z),'{}'),
    'dnc_excluded',(select count(*) from (select distinct phone10 from candidates where true_dnc) z),
    'client_excluded',(select count(*) from (select distinct phone10 from candidates where current_client) z),
    'review_excluded',(select count(*) from (select distinct phone10 from candidates where needs_review) z),
    'resold_excluded',(select count(*) from (select distinct phone10 from candidates where already_sold) z),
    'in_bundle_excluded',(select count(*) from (select distinct phone10 from candidates where in_bundle) z),
    'sample',coalesce((select jsonb_agg(to_jsonb(z)) from (
      select first_name,last_name,'***-***-'||right(phone10,4) as phone_masked,
        state,age,tier,tags,flags-'replaced_phone10' as flags,lead_age_days,under_9mo
      from sample_rows order by array_position(array['S','pos','A','B','F','C','D'],tier),lead_age_days limit 25
    ) z),'[]'),
    'as_of',refreshed,'snapshot',true
  ) into result;
  return result;
end $$;

-- Change only candidate selection in the established allocator. Its role and
-- recipient checks, sort, hold trigger, conflict handling, and receipts remain.
do $$
declare
  old_selection text := $old$select * from public.sellable_pool(p_source, p_filters) m$old$;
  new_selection text := $new$with selected_phones as materialized (
        select r.phone10 from (
          select c.phone10,c.tier,c.lead_age_days,c.under_9mo,
            row_number() over (partition by c.phone10 order by
              case when v_sort = 'chargeback' then (case when c.under_9mo then 0 else 1 end) end asc nulls last,
              case when v_sort = 'oldest' then c.lead_age_days end desc,
              array_position(array['S','pos','A','B','F','C','D'],c.tier),c.lead_age_days asc) as rn
          from public.lead_pool_preview_candidates(p_source,p_filters) c
          where not (c.true_dnc or c.current_client or c.needs_review or c.already_sold or c.in_bundle)
        ) r where r.rn=1 order by
          case when v_sort = 'chargeback' then (case when r.under_9mo then 0 else 1 end) end asc nulls last,
          case when v_sort = 'oldest' then r.lead_age_days end desc,
          array_position(array['S','pos','A','B','F','C','D'],r.tier),r.lead_age_days asc
        limit p_limit
      )
      select m.* from public.lead_pool_candidates_for_phones(
        p_source,p_filters,array(select phone10 from selected_phones)) m
      where not (m.flags->>'blocked')::boolean$new$;
  body text := pg_get_functiondef('public.lead_pool_assign(text,jsonb,integer,uuid,text,text)'::regprocedure);
  old_count integer; new_count integer;
begin
  old_count := (length(body)-length(replace(body,old_selection,'')))/length(old_selection);
  new_count := (length(body)-length(replace(body,new_selection,'')))/length(new_selection);
  if old_count=1 and new_count=0 then
    execute replace(body,old_selection,new_selection);
  elsif old_count<>0 or new_count<>1 then
    raise exception 'Unexpected lead_pool_assign definition; candidate selection was not changed.';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
