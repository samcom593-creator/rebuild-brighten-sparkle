-- Default lead previews need exact live eligibility, but detailed coaching/work
-- context is needed only for the 25 displayed rows. Keep one shared protection
-- relation for previews and assignment; no cache or timeout increase.
begin;

-- Pure argument predicate: no table reads, no search-path dependencies, and
-- intentionally inlineable so the source/state/tier indexes can be used.
create or replace function public.lead_pool_static_filter_matches(
  p_state text, p_age integer, p_tier text, p_lead_age integer, p_filters jsonb
) returns boolean language sql immutable as $$
select
  (not (p_filters ? 'tiers') or pg_catalog.jsonb_array_length(p_filters->'tiers') = 0 or (p_filters->'tiers') ? p_tier)
  and (not (p_filters ? 'states') or pg_catalog.jsonb_array_length(p_filters->'states') = 0 or (p_filters->'states') ? p_state)
  and (not (p_filters ? 'min_age') or p_age >= (p_filters->>'min_age')::integer)
  and (not (p_filters ? 'max_age') or p_age <= (p_filters->>'max_age')::integer)
  and (not (p_filters ? 'max_lead_age_days') or p_lead_age <= (p_filters->>'max_lead_age_days')::integer);
$$;
revoke all on function public.lead_pool_static_filter_matches(text, integer, text, integer, jsonb) from public, anon, authenticated;

-- The full predicate delegates static fields to the same function.
create or replace function public.lead_pool_filter_matches(
  p_state text, p_age integer, p_tier text, p_lead_age integer, p_flags jsonb, p_filters jsonb
) returns boolean language sql stable set search_path to 'public' as $$
select public.lead_pool_static_filter_matches(p_state,p_age,p_tier,p_lead_age,p_filters)
  and (not (p_filters ? 'campaigns') or jsonb_array_length(p_filters->'campaigns') = 0
       or coalesce(p_flags->'campaigns', jsonb_build_array(p_flags->>'campaign')) ?| array(select jsonb_array_elements_text(p_filters->'campaigns')))
  and (not (p_filters ? 'require_flags') or not exists (
       select 1 from jsonb_array_elements_text(p_filters->'require_flags') f(k) where coalesce(p_flags->>f.k, 'false') <> 'true'))
  and (coalesce(p_filters->>'vantage_only', 'false') <> 'true' or p_flags->>'vantage' = 'true')
  and (nullif(p_filters->>'caller', '') is null or position(lower(p_filters->>'caller') in lower(coalesce(p_flags->>'last_caller', ''))) > 0)
  and (not (p_filters ? 'outcomes') or jsonb_array_length(p_filters->'outcomes') = 0
       or (p_filters->'outcomes') ? public.lead_outcome_key(p_flags->>'last_outcome'))
  and (not (p_filters ? 'min_attempts') or coalesce((p_flags->>'times_called')::integer, 0) >= (p_filters->>'min_attempts')::integer)
  and (not (p_filters ? 'max_attempts') or coalesce((p_flags->>'times_called')::integer, 0) <= (p_filters->>'max_attempts')::integer)
  and (not (p_filters ? 'touched_after') or public.lead_context_time(p_flags->>'last_touched_at') >= ((p_filters->>'touched_after')::date::timestamp at time zone 'America/Phoenix'))
  and (not (p_filters ? 'touched_before') or public.lead_context_time(p_flags->>'last_touched_at') < (((p_filters->>'touched_before')::date + 1)::timestamp at time zone 'America/Phoenix'))
  and (not (p_filters ? 'callback_before') or public.lead_context_time(p_flags->>'callback_at') < (((p_filters->>'callback_before')::date + 1)::timestamp at time zone 'America/Phoenix'))
  and (nullif(p_filters->>'source_file', '') is null or position(lower(p_filters->>'source_file') in lower(coalesce(p_flags->>'source_file', ''))) > 0)
  and (nullif(p_filters->>'source_type', '') is null or p_flags->>'source_type' = p_filters->>'source_type')
  and (nullif(p_filters->>'policy_standing', '') is null or coalesce(p_flags->>'policy_standing', 'unverified') = p_filters->>'policy_standing')
  and case coalesce(p_filters->>'hold', '')
    when '' then true
    when 'ready' then not coalesce((p_flags->>'blocked')::boolean, false)
    when 'true_dnc' then coalesce((p_flags->>'true_dnc')::boolean, false)
    when 'current_client' then coalesce((p_flags->>'current_client')::boolean, false)
    when 'assigned' then coalesce((p_flags->>'in_bundle')::boolean, false)
    when 'resold' then coalesce((p_flags->>'already_sold')::boolean, false)
    when 'review' then coalesce((p_flags->>'import_review_required')::boolean, false)
    else false end;
$$;

create or replace view public.v_lead_pool_candidate_base
with (security_invoker = true) as
with holds as materialized (
  select h.phone10,
    bool_or(coalesce((h.flags->>'true_dnc')::boolean, h.dnc and not coalesce((h.flags->>'current_client')::boolean,false))) as true_dnc,
    bool_or(coalesce((h.flags->>'current_client')::boolean,false)) as current_client,
    bool_or(coalesce((h.flags->>'import_review_required')::boolean,false)) as needs_review
  from public.mat_lead_pool h
  where h.dnc or h.flags @> '{"true_dnc":true}' or h.flags @> '{"current_client":true}' or h.flags @> '{"import_review_required":true}'
  group by h.phone10
)
select s.source, s.lead_id, s.phone10, s.first_name, s.last_name, s.email,
  s.state, s.age, s.tier, s.tags, s.flags, s.lead_age_days, s.under_9mo,
  d.phone10 is not null or d_old.phone10 is not null or coalesce(h.true_dnc,false) as true_dnc,
  coalesce(h.current_client,false) as current_client,
  coalesce(h.needs_review,false) as needs_review,
  exists(select 1 from public.lead_resale_ledger r where r.phone10=s.phone10) as already_sold,
  exists(select 1 from public.lead_bundle_items i where i.phone10=s.phone10 and i.removed_at is null) as in_bundle
from public.mat_lead_pool s
left join public.lead_contact_dnc d on d.phone10=s.phone10
left join public.lead_contact_dnc d_old on d_old.phone10=s.flags->>'replaced_phone10'
left join holds h on h.phone10=s.phone10;
revoke all on public.v_lead_pool_candidate_base from public, anon, authenticated;

-- Internal row selection only. The existing RPC/assignment gates stay in place;
-- untrusted callers cannot read raw phones through this helper or the view.
create or replace function public.lead_pool_candidates_for_phones(p_source text, p_filters jsonb, p_phone10 text[])
returns table(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text,
  age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean,
  already_sold boolean, in_bundle boolean)
language sql stable security definer set search_path to 'public' as $$
with taps as materialized (
  select i.phone10,count(*)::int as n,max(e.at) as touched_at,(array_agg(e.actor order by e.at desc))[1] as actor
  from public.lead_bundle_events e join public.lead_bundle_items i on i.id=e.item_id
  where e.action='dial_tap' and (p_phone10 is null or i.phone10=any(p_phone10))
  group by i.phone10
), work as materialized (
  select distinct on (i.phone10) i.phone10, i.status, i.status_at, i.callback_at, i.next_action,
    coalesce((select a.display_name from public.agents a where a.user_id = i.status_by
       order by (a.canonical_agent_id is null) desc, a.created_at limit 1), i.last_agent) as caller
  from public.lead_bundle_items i
  where i.status_at is not null and (p_phone10 is null or i.phone10=any(p_phone10))
  order by i.phone10, i.status_at desc, i.id
), base as materialized (
  select s.lead_id, s.phone10, s.first_name, s.last_name, s.email, s.state, s.age,
    s.tier, s.tags, s.lead_age_days, s.under_9mo, s.true_dnc, s.current_client, s.needs_review,
    s.already_sold as sold, s.in_bundle as assigned,
    coalesce(s.flags, '{}') || case when w.status_at > coalesce(public.lead_context_time(s.flags->>'last_touched_at'), '-infinity'::timestamptz)
      then jsonb_build_object('last_caller', w.caller, 'last_outcome', w.status,
        'last_touched_at', w.status_at, 'callback_at', w.callback_at, 'next_action', w.next_action)
      else '{}'::jsonb end || jsonb_strip_nulls(jsonb_build_object(
      'times_called',coalesce((s.flags->>'times_called')::integer,0)+coalesce(t.n,0),
      'source_attempts',coalesce((s.flags->>'times_called')::integer,0),
      'last_touched_at',greatest(public.lead_context_time(s.flags->>'last_touched_at'),w.status_at,t.touched_at))) ||
      case when t.touched_at > greatest(coalesce(public.lead_context_time(s.flags->>'last_touched_at'),'-infinity'::timestamptz),coalesce(w.status_at,'-infinity'::timestamptz))
        then jsonb_build_object('last_caller',(select a.display_name from public.agents a where a.user_id=t.actor order by a.created_at limit 1))
        else '{}'::jsonb end as context_flags
  from public.v_lead_pool_candidate_base s
  left join work w on w.phone10=s.phone10
  left join taps t on t.phone10=s.phone10
  where s.source=p_source and (p_phone10 is null or s.phone10=any(p_phone10))
    and public.lead_pool_static_filter_matches(s.state,s.age,s.tier,s.lead_age_days,coalesce(p_filters,'{}'))
), context as materialized (
  select t.lead_id, t.phone10, t.first_name, t.last_name, t.email, t.state, t.age,
    t.tier, t.tags, t.lead_age_days, t.under_9mo, t.sold, t.assigned, t.context_flags || jsonb_build_object('true_dnc', t.true_dnc, 'dnc', t.true_dnc,
    'last_outcome', case when coalesce((t.context_flags->>'times_called')::integer,0)>0 and public.lead_outcome_key(t.context_flags->>'last_outcome')='never_called' then 'unknown' else public.lead_outcome_key(t.context_flags->>'last_outcome') end,
    'current_client', t.current_client, 'import_review_required', t.needs_review,
    'policy_standing', case when t.current_client then 'current_client' else coalesce(t.context_flags->>'policy_standing','unverified') end, 'already_sold', t.sold, 'in_bundle', t.assigned,
    'blocked', t.true_dnc or t.current_client or t.sold or t.assigned or t.needs_review) as merged
  from base t
)
select c.lead_id, c.phone10, c.first_name, c.last_name, c.email, c.state, c.age, c.tier,
 c.tags, c.merged, c.lead_age_days, c.under_9mo, c.sold, c.assigned
from context c
where public.lead_pool_filter_matches(c.state, c.age, c.tier, c.lead_age_days, c.merged, coalesce(p_filters, '{}'));
$$;
revoke all on function public.lead_pool_candidates_for_phones(text, jsonb, text[]) from public, anon, authenticated;

create or replace function public.lead_pool_candidates(p_source text, p_filters jsonb default '{}')
returns table(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text,
  age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean,
  already_sold boolean, in_bundle boolean)
language sql stable security definer set search_path to 'public' as $$
select * from public.lead_pool_candidates_for_phones(p_source, p_filters, null);
$$;
revoke all on function public.lead_pool_candidates(text, jsonb) from public, anon, authenticated;

create or replace function public.lead_pool_counts(p_source text, p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare result jsonb; refreshed timestamptz;
begin
  if not public.can_view_sold_calls() then raise exception 'Only lead administrators can browse lead pools.' using errcode = '42501'; end if;
  if p_source not in ('marketing', 'dialer', 'rewrite', 'winback') then raise exception 'Unknown lead pool.' using errcode = '22023'; end if;
  select refreshed_at into refreshed from public.lead_pool_snapshot_meta where id;
  -- Legacy switches do not affect the shared predicate. Static snapshot
  -- filters need no work/tap context; every other filter keeps the full path.
  if (case when jsonb_typeof(coalesce(p_filters,'{}'))='object'
    then coalesce(p_filters,'{}') - array['exclude_dnc','exclude_resold','sort','tiers','states','min_age','max_age','max_lead_age_days'] = '{}'::jsonb
    else false end) then
    with candidates as materialized (
      select phone10, tier, lead_age_days, under_9mo, true_dnc, current_client,
        needs_review, already_sold, in_bundle
      from public.v_lead_pool_candidate_base
      where source=p_source
        and public.lead_pool_static_filter_matches(state,age,tier,lead_age_days,coalesce(p_filters,'{}'))
    ), unique_ready as materialized (
      select distinct on (phone10) phone10, tier, lead_age_days, under_9mo
      from candidates
      where not (true_dnc or current_client or needs_review or already_sold or in_bundle)
      order by phone10, array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days
    ), sample_phones as (
      select phone10 from unique_ready
      order by array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days limit 25
    ), sample_rows as (
      select distinct on (phone10) *
      from public.lead_pool_candidates_for_phones(p_source, p_filters, array(select phone10 from sample_phones))
      where not (flags->>'blocked')::boolean
      order by phone10, array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days
    )
    select jsonb_build_object(
      'total', (select count(*) from unique_ready),
      'matching', (select count(*) from (select distinct phone10 from candidates) z),
      'under_9mo', (select count(*) from unique_ready where under_9mo),
      'by_tier', coalesce((select jsonb_object_agg(tier,n) from (select tier,count(*) n from unique_ready group by tier) z),'{}'),
      'dnc_excluded', (select count(*) from (select distinct phone10 from candidates where true_dnc) z),
      'client_excluded', (select count(*) from (select distinct phone10 from candidates where current_client) z),
      'review_excluded', (select count(*) from (select distinct phone10 from candidates where needs_review) z),
      'resold_excluded', (select count(*) from (select distinct phone10 from candidates where already_sold) z),
      'in_bundle_excluded', (select count(*) from (select distinct phone10 from candidates where in_bundle) z),
      'sample', coalesce((select jsonb_agg(to_jsonb(z)) from (
        select first_name,last_name,'***-***-'||right(phone10,4) as phone_masked,
          state,age,tier,tags,flags-'replaced_phone10' as flags,lead_age_days,under_9mo
        from sample_rows
        order by array_position(array['S','pos','A','B','F','C','D'],tier),lead_age_days limit 25
      ) z),'[]'),
      'as_of',refreshed,'snapshot',true
    ) into result;
    return result;
  end if;

  with candidates as materialized (select * from public.lead_pool_candidates(p_source, p_filters)),
  ready as (select * from candidates where not (flags->>'blocked')::boolean),
  unique_ready as (select distinct on (phone10) * from ready
     order by phone10, array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days)
  select jsonb_build_object(
    'total', (select count(*) from unique_ready),
    'matching', (select count(*) from (select distinct phone10 from candidates) z),
    'under_9mo', (select count(*) from unique_ready where under_9mo),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (select tier, count(*) n from unique_ready group by tier) z), '{}'),
    'dnc_excluded', (select count(*) from (select distinct phone10 from candidates where (flags->>'true_dnc')::boolean) z),
    'client_excluded', (select count(*) from (select distinct phone10 from candidates where (flags->>'current_client')::boolean) z),
    'review_excluded', (select count(*) from (select distinct phone10 from candidates where coalesce((flags->>'import_review_required')::boolean,false)) z),
    'resold_excluded', (select count(*) from (select distinct phone10 from candidates where already_sold) z),
    'in_bundle_excluded', (select count(*) from (select distinct phone10 from candidates where in_bundle) z),
    'sample', coalesce((select jsonb_agg(to_jsonb(z)) from (
      select first_name, last_name, '***-***-' || right(phone10, 4) as phone_masked,
        state, age, tier, tags, flags - 'replaced_phone10' as flags, lead_age_days, under_9mo
      from (select distinct on (phone10) * from candidates
        where not (flags->>'blocked')::boolean or nullif(p_filters->>'hold','') is not null
        order by phone10, array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days) c
      order by array_position(array['S','pos','A','B','F','C','D'],tier), lead_age_days limit 25) z), '[]'),
    'as_of', refreshed, 'snapshot', true) into result;
  return result;
end $$;

-- CREATE OR REPLACE retains the existing administrator RPC ACL. Internal
-- objects are explicitly locked down even when default privileges grant access.
revoke all on public.v_lead_pool_candidate_base from public, anon, authenticated;
revoke all on function public.lead_pool_candidates_for_phones(text, jsonb, text[]) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
