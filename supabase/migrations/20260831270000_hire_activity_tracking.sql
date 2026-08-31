-- MP-344: track a hire through onboarding by what they DO, not what stage
-- someone last typed.
--
-- Sam: "make sure we're able to track hires in the onboarding process — if
-- that's when I'm calling in call center, licensed prospects, etcetera."
--
-- WHY STAGE ALONE IS USELESS HERE, measured: of 54 active agents only 29 have
-- ever had a stage change at all, exactly TWO moved in the last 30 days, and
-- the most recent move was 2026-08-25. 19 people sit in 'onboarding' and 7
-- carry no stage whatsoever. onboarding_stage is a field somebody sets once and
-- nobody maintains, so a board built on it shows a frozen picture and calls it
-- progress.
--
-- THE ACTIVITY IS REAL AND IT WAS INVISIBLE. readymode_dialer_calls holds 7,944
-- calls, 7,644 of them in the last 30 days, with calls landing today — and
-- matched_application_id is NULL on ALL 7,944 rows. The call centre and the
-- recruiting pipeline were two separate worlds.
--
-- The specimen that proves the cost: Jaden Selvaraj (1,184 calls in 30 days)
-- and David Ladd (933) are two of the four KJ Vaughn hires the Monday roll call
-- reports as "no contact on file — only their manager can reach them". They are
-- among the hardest-working people on the dialer and Apex's records treat them
-- as ghosts with no account. Stage said nothing; activity says everything.
--
-- HOW THE JOIN WORKS, AND ITS LIMIT STATED HONESTLY. readymode_dialer_calls has
-- no agent FK — agent_id is unpopulated and agent_raw is a free-text name typed
-- in ReadyMode. Matching on the normalised name covers 6 of 17 distinct dialer
-- names and 2,834 of 7,644 calls (37%). That is a PROXY, not a key, so:
--   * matched calls are reported per agent,
--   * the 11 unmatched names are exposed in their own view rather than dropped,
--     because "Tre made 691 calls and we cannot say who that is" is a staffing
--     fact Sam needs, not noise to hide.
-- No attempt is made to fuzzy-match; a wrong attribution here would credit one
-- person's work to another, which is worse than admitting the gap.

begin;

create or replace view public.v_hire_activity
with (security_invoker = true) as
with dialer as (
  select lower(btrim(agent_raw)) as name_key,
         count(*) filter (where call_started_at >= now() - interval '7 days')  as calls_7d,
         count(*) filter (where call_started_at >= now() - interval '30 days') as calls_30d,
         max(call_started_at) as last_call_at,
         count(*) filter (
           where call_started_at >= now() - interval '30 days'
             and coalesce(duration_seconds, 0) >= 60
         ) as conversations_30d
  from public.readymode_dialer_calls
  where nullif(btrim(agent_raw), '') is not null
  group by 1
)
select
  a.id as agent_id,
  a.display_name,
  a.created_at::date as hired_on,
  (current_date - a.created_at::date)::integer as days_since_hire,
  coalesce(a.onboarding_stage::text, 'not_started') as onboarding_stage,
  a.license_status::text as license_status,
  coalesce(m.display_name, 'Unassigned') as manager_name,
  coalesce(d.calls_7d, 0)::integer as calls_7d,
  coalesce(d.calls_30d, 0)::integer as calls_30d,
  coalesce(d.conversations_30d, 0)::integer as conversations_30d,
  d.last_call_at,
  -- Production, so "working" is not confused with "producing".
  (select count(*) from public.agentlink_book b
    where b.agent_id = a.id and b.posted_date >= current_date - 30)::integer as deals_30d,
  (select max(b.posted_date) from public.agentlink_book b where b.agent_id = a.id) as last_deal_on,
  -- The single question Sam is actually asking of each row.
  case
    when coalesce(d.calls_30d, 0) = 0
     and (select count(*) from public.agentlink_book b
           where b.agent_id = a.id and b.posted_date >= current_date - 30) = 0
      then 'no activity in 30 days'
    when coalesce(d.calls_7d, 0) = 0 and coalesce(d.calls_30d, 0) > 0
      then 'was dialing, stopped this week'
    when coalesce(d.calls_7d, 0) > 0 then 'dialing now'
    else 'producing, not on the dialer'
  end as activity_state
from public.agents a
left join public.agents m on m.id = a.manager_id
left join dialer d on d.name_key = lower(btrim(a.display_name))
where a.status = 'active'
  and coalesce(a.is_deactivated, false) = false
  and coalesce(a.is_inactive, false) = false
  and not public.fn_agent_is_roster_excluded(a.id);

comment on view public.v_hire_activity is
  'MP-344: per active agent, real onboarding progress measured by dialer '
  'activity and production rather than onboarding_stage (which moved twice in '
  '30 days across 54 agents). Dialer join is a NAME match — a proxy, not a key '
  '— covering 37% of calls; see v_dialer_unattributed for the remainder.';

grant select on public.v_hire_activity to authenticated;

-- The calls we CANNOT attribute. Reported, never dropped: an unrecognised name
-- making hundreds of calls a month is a staffing question, not noise.
create or replace view public.v_dialer_unattributed
with (security_invoker = true) as
select btrim(r.agent_raw) as dialer_name,
       count(*)::integer as calls_30d,
       max(r.call_started_at) as last_call_at
  from public.readymode_dialer_calls r
 where r.call_started_at >= now() - interval '30 days'
   and nullif(btrim(r.agent_raw), '') is not null
   and not exists (
     select 1 from public.agents g
      where lower(btrim(g.display_name)) = lower(btrim(r.agent_raw))
   )
 group by 1
 order by count(*) desc;

comment on view public.v_dialer_unattributed is
  'MP-344: dialer operators whose ReadyMode name matches no agent row. 11 of 17 '
  'names and 63% of calls. Deliberately not fuzzy-matched: crediting one '
  'person''s calls to another is worse than naming the gap.';

grant select on public.v_dialer_unattributed to authenticated;

-- Caller-scoped worklist: admins see everyone, a manager sees their downline,
-- using the same walk the override is paid on.
create or replace function public.my_hire_activity(p_days integer default 60)
returns table(
  agent_id uuid,
  display_name text,
  hired_on date,
  days_since_hire integer,
  onboarding_stage text,
  license_status text,
  manager_name text,
  calls_7d integer,
  calls_30d integer,
  conversations_30d integer,
  last_call_at timestamptz,
  deals_30d integer,
  last_deal_on date,
  activity_state text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with caller as (
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) as id
    from public.agents a
    where a.user_id = auth.uid() and coalesce(a.is_deactivated, false) = false
    limit 1
  ), scope as (
    select a.id from public.agents a where public.apex_is_admin()
    union
    select h.member from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h
  )
  select v.agent_id, v.display_name, v.hired_on, v.days_since_hire,
         v.onboarding_stage, v.license_status, v.manager_name,
         v.calls_7d, v.calls_30d, v.conversations_30d, v.last_call_at,
         v.deals_30d, v.last_deal_on, v.activity_state
  from public.v_hire_activity v
  join scope s on s.id = v.agent_id
  where v.days_since_hire <= greatest(coalesce(p_days, 60), 1)
  order by v.calls_30d desc, v.hired_on desc;
$function$;

comment on function public.my_hire_activity(integer) is
  'MP-344: recent hires with their REAL activity (dialer + production), scoped '
  'to the caller. Answers "is this hire actually working?", which '
  'onboarding_stage cannot.';

revoke all on function public.my_hire_activity(integer) from public;
grant execute on function public.my_hire_activity(integer) to authenticated;

commit;
