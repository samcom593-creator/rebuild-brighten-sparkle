-- MP-LEAD-COUNTS-SLIM (3/3): the 25-lead sample was the other half of the 8s.
-- lead_pool_candidates_for_phones filtered the pool with (p_phone10 is null or phone10 = any(p_phone10));
-- an OR against a parameter-null test cannot use the (source, phone10) index, so a 25-phone lookup
-- walked all 250k dialer rows through the candidate view: 4.9s for 25 rows (measured 2026-11-26).
-- Split into two UNION ALL branches: the array branch is an index probe, the all-rows branch sits
-- behind a one-time filter on p_phone10 is null, so neither case scans what it does not need.
-- Output columns, enrichment and the final lead_pool_filter_matches gate are unchanged.
--
-- Applied live 2026-11-26 17:48Z through the Supabase MCP apply_migration (version = file name).
-- After: lead_pool_counts('dialer', default filters) as Sam 1.52s (was 8.17s); marketing 1.15s;
-- lead_pool_candidates('rewrite') still 211 = 211 view rows; 25 named dialer phones -> 25 rows.
create or replace function public.lead_pool_candidates_for_phones(p_source text, p_filters jsonb, p_phone10 text[])
returns table(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text, age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean, already_sold boolean, in_bundle boolean)
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
), pool_rows as materialized (
  -- Named phones: an index probe on (source, phone10). A null array matches nothing here.
  select s.* from public.v_lead_pool_candidate_base s
  where s.source=p_source and s.phone10 = any(p_phone10)
    and public.lead_pool_static_filter_matches(s.state,s.age,s.tier,s.lead_age_days,coalesce(p_filters,'{}'))
  union all
  -- Every row of the pool: only when no phones were named (one-time filter, no scan otherwise).
  select s.* from public.v_lead_pool_candidate_base s
  where p_phone10 is null and s.source=p_source
    and public.lead_pool_static_filter_matches(s.state,s.age,s.tier,s.lead_age_days,coalesce(p_filters,'{}'))
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
  from pool_rows s
  left join work w on w.phone10=s.phone10
  left join taps t on t.phone10=s.phone10
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
