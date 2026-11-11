-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 2 of 10: activity truth without the dialer.
--
-- WHAT
--   0. v_agent_first_deal_definer: the one definition of "first deal, any source", readable inside the definer staff
--      views; v_agent_first_deal_any_source (WP5) becomes a thin invoker view over it, same columns and grants.
--   1. my_lead_dial_tap(p_item_id): records a tap on a lead's call link in My Leads as
--      lead_bundle_events(action = 'dial_tap', actor = caller). Only the holder of a live grant on that lead's
--      bundle can record it; a second tap on the same lead inside 30 seconds is one tap. Writes nothing else.
--   2. v_agent_dialer_state gains in-app activity columns (appended; every existing column is unchanged):
--      app_dial_taps_14d, app_outcomes_14d, app_conversations_14d, app_calls_7d, app_calls_14d,
--      app_last_activity_at, dials_any_source_14d, dialing_any_source, dialer_status.
--   3. v_agent_activation_state: derived_stage 'dialing' is reachable from in-app activity, and the same
--      activity columns are appended.
--
-- WHY
--   ReadyMode was canceled for non-payment on 2026-11-10 and its call feed is dark since 10-28, so every agent read
--   "not dialing" and the 'dialing' stage could not be reached by anyone (readymode_block 5b). Agents already dial
--   from My Leads (tel: / Google Voice links) and log outcomes there: 150 outcomes from 4 agents on 11-10. The tap
--   on the call link wrote nothing, so a logged outcome could not be told from a real attempt (readymode_block 6b).
--
-- HOW "CALLS" ARE COUNTED (a floor, never a double count)
--   app_calls = greatest(dial taps, logged outcomes) over the window. Outcomes logged before taps were recorded
--   still count; a tap followed by its outcome counts once.

-- ---------------------------------------------------------------------------
-- 0. First deal, readable inside the WP5 staff views
-- ---------------------------------------------------------------------------
-- v_agent_first_deal_any_source is security_invoker and reads mat_production_unified, which authenticated cannot
-- SELECT. Measured 2026-11-11 as Sam (admin, role authenticated): count(*) on v_licensed_hire_clock,
-- v_agent_activation_state and v_activation_seat_queue succeeds (the planner never evaluates the column), but reading
-- next_action / first_deal_state / derived_stage / has_deal raises "permission denied for materialized view
-- mat_production_unified". The staff views below are definer views with their own role gates, so they read this
-- definer view instead, and the invoker original becomes a thin view over it (one definition, cannot drift). Not
-- granted to authenticated (only reachable through those gated views).
create or replace view public.v_agent_first_deal_definer with (security_barrier = true) as
with ids as (
  select a.id as member_id,
         case when a.canonical_agent_id is not null and a.canonical_agent_id <> a.id then a.canonical_agent_id else a.id end as agent_id
    from public.agents a
), src as (
  select i.agent_id, min(coalesce(m.posted_date, m.effective_date))::timestamp with time zone as at, 'production_unified'::text as source
    from public.mat_production_unified m
    join ids i on i.member_id = m.agent_id
   group by i.agent_id
  union all
  select i.agent_id, min(d.created_at) as min, 'deals'::text as text
    from public.deals d
    join ids i on i.member_id = d.agent_id
   group by i.agent_id
  union all
  select i.agent_id, min(a.first_deal_at) as min, 'agents.first_deal_at'::text as text
    from public.agents a
    join ids i on i.member_id = a.id
   where a.first_deal_at is not null
   group by i.agent_id
)
select agent_id, min(at) as first_deal_at, array_agg(distinct source order by source) as sources
  from src
 group by agent_id;

revoke all on public.v_agent_first_deal_definer from public, anon, authenticated;
grant select on public.v_agent_first_deal_definer to service_role;

comment on view public.v_agent_first_deal_definer is
  'PKG2: the ONE definition of "first deal, any source" per canonical agent. Definer view so the definer staff views (hire clock, activation state, seat queue, launch board) can read it for signed-in staff; v_agent_first_deal_any_source is a thin invoker view over it. Not granted to authenticated.';

-- One definition, two names: v_agent_first_deal_any_source (WP5, security_invoker, service_role only) now reads the
-- definer view above, so the two can never drift. Only this direction works: an invoker view's base tables are
-- checked as the CALLER even when a definer view wraps it, so a definer wrapper over the invoker view would still
-- deny every signed-in reader. Columns, the invoker setting and the grants are unchanged.
create or replace view public.v_agent_first_deal_any_source with (security_invoker = true) as
select f.agent_id, f.first_deal_at, f.sources
  from public.v_agent_first_deal_definer f;

revoke all on public.v_agent_first_deal_any_source from public, anon, authenticated;
grant select on public.v_agent_first_deal_any_source to service_role;

comment on view public.v_agent_first_deal_any_source is
  'WP5 + PKG2 (2026-11-12): first deal per canonical agent from any source (mat_production_unified, deals, agents.first_deal_at). Thin invoker view over v_agent_first_deal_definer, which holds the one definition. Service role only.';

-- ---------------------------------------------------------------------------
-- 1. Dial tap RPC
-- ---------------------------------------------------------------------------
create or replace function public.my_lead_dial_tap(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_bundle uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_item_id is null then
    raise exception 'lead required' using errcode = '22023';
  end if;
  select i.bundle_id into v_bundle
    from public.lead_bundle_items i
    join public.lead_bundles b on b.id = i.bundle_id and b.archived_at is null
   where i.id = p_item_id and i.removed_at is null;
  if v_bundle is null then
    raise exception 'That lead is no longer in a live bundle.' using errcode = '22023';
  end if;
  -- Role check: only the person the bundle is granted to records a dial on it.
  if not exists (select 1 from public.lead_bundle_grants g
                  where g.bundle_id = v_bundle and g.user_id = v_uid and g.revoked_at is null) then
    raise exception 'This lead is not assigned to you.' using errcode = '42501';
  end if;
  if exists (select 1 from public.agent_access_suspensions s where s.user_id = v_uid and s.lifted_at is null) then
    raise exception 'This login is suspended.' using errcode = '42501';
  end if;
  -- A double tap (or a tap that opens Google Voice twice) is one attempt.
  if exists (select 1 from public.lead_bundle_events e
              where e.item_id = p_item_id and e.actor = v_uid and e.action = 'dial_tap'
                and e.at > now() - interval '30 seconds') then
    return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'duplicate_tap');
  end if;
  insert into public.lead_bundle_events (bundle_id, item_id, user_id, actor, action, detail)
  values (v_bundle, p_item_id, v_uid, v_uid, 'dial_tap', jsonb_build_object('source', 'my_leads'));
  return jsonb_build_object('ok', true, 'recorded', true);
end;
$$;

comment on function public.my_lead_dial_tap(uuid) is
  'PKG2: records one tap on a My Leads call link as lead_bundle_events(dial_tap) for the caller. Caller must hold a live grant on the lead''s bundle; suspended logins are refused; taps within 30s dedupe.';

revoke all on function public.my_lead_dial_tap(uuid) from public, anon;
grant execute on function public.my_lead_dial_tap(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. v_agent_dialer_state: + in-app activity (columns appended)
-- ---------------------------------------------------------------------------
create or replace view public.v_agent_dialer_state with (security_barrier = true) as
with ids as (
  select a_1.id as member_id,
         coalesce(case when a_1.canonical_agent_id <> a_1.id then a_1.canonical_agent_id else null::uuid end, a_1.id) as agent_id
    from public.agents a_1
), dials as (
  select i.agent_id,
         min(c.call_started_at) as first_dial_at,
         max(c.call_started_at) as last_dial_at,
         count(*) as dials_total,
         count(*) filter (where c.call_started_at >= (now() - '7 days'::interval)) as dials_7d,
         count(*) filter (where c.call_started_at >= (now() - '14 days'::interval)) as dials_14d
    from public.readymode_dialer_calls c
    join ids i on i.member_id = c.agent_id
   group by i.agent_id
), seats as (
  select s_1.agent_id,
         max(s_1.seat_label) as seat_label,
         max(s_1.assigned_at) as seat_assigned_at
    from public.agent_dialer_seats s_1
   where s_1.released_at is null
   group by s_1.agent_id
), logins as (
  -- one row per (login, person); a login shared by two rows of the same person counts once
  select distinct m.user_id, i.agent_id
    from public.agents m
    join ids i on i.member_id = m.id
   where m.user_id is not null
), app as (
  select l.agent_id,
         count(*) filter (where e.action = 'dial_tap' and e.at >= now() - interval '7 days') as taps_7d,
         count(*) filter (where e.action = 'dial_tap' and e.at >= now() - interval '14 days') as taps_14d,
         count(*) filter (where e.action = 'status' and e.at >= now() - interval '7 days') as outcomes_7d,
         count(*) filter (where e.action = 'status' and e.at >= now() - interval '14 days') as outcomes_14d,
         count(*) filter (where e.action = 'status' and e.at >= now() - interval '14 days'
                            and coalesce(e.detail ->> 'status', '') in ('callback', 'appointment', 'sold', 'not_interested', 'do_not_call')) as conversations_14d,
         max(e.at) as last_at
    from public.lead_bundle_events e
    join logins l on l.user_id = e.actor
   where e.action in ('dial_tap', 'status')
   group by l.agent_id
), cfg as (
  select coalesce((select lower(btrim(s.value)) from public.system_settings s where s.key = 'dialer_status'), 'unset') as dialer_status
)
select a.id as agent_id,
       s.agent_id is not null as has_open_seat,
       s.seat_label,
       s.seat_assigned_at,
       d.first_dial_at,
       d.last_dial_at,
       coalesce(d.dials_total, 0::bigint)::integer as dials_total,
       coalesce(d.dials_7d, 0::bigint)::integer as dials_7d,
       coalesce(d.dials_14d, 0::bigint)::integer as dials_14d,
       s.agent_id is not null or coalesce(d.dials_14d, 0::bigint) > 0 as dialer_active_derived,
       coalesce(a.has_dialer_login, false) as has_dialer_login_column,
       -- appended 2026-11-12 (PKG2): in-app activity from My Leads
       coalesce(ap.taps_14d, 0::bigint)::integer as app_dial_taps_14d,
       coalesce(ap.outcomes_14d, 0::bigint)::integer as app_outcomes_14d,
       coalesce(ap.conversations_14d, 0::bigint)::integer as app_conversations_14d,
       greatest(coalesce(ap.taps_7d, 0::bigint), coalesce(ap.outcomes_7d, 0::bigint))::integer as app_calls_7d,
       greatest(coalesce(ap.taps_14d, 0::bigint), coalesce(ap.outcomes_14d, 0::bigint))::integer as app_calls_14d,
       ap.last_at as app_last_activity_at,
       (coalesce(d.dials_14d, 0::bigint) + greatest(coalesce(ap.taps_14d, 0::bigint), coalesce(ap.outcomes_14d, 0::bigint)))::integer as dials_any_source_14d,
       s.agent_id is not null
         or coalesce(d.dials_14d, 0::bigint) > 0
         or greatest(coalesce(ap.taps_14d, 0::bigint), coalesce(ap.outcomes_14d, 0::bigint)) > 0 as dialing_any_source,
       cfg.dialer_status
  from public.agents a
  cross join cfg
  left join dials d on d.agent_id = a.id
  left join seats s on s.agent_id = a.id
  left join app ap on ap.agent_id = a.id
 where (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
   and (public.apex_is_admin()
        or public.has_role(auth.uid(), 'manager'::public.app_role) and public.apex_can_read_agent(a.id)
        or current_user = any (array['postgres'::name, 'service_role'::name, 'supabase_admin'::name]));

revoke all on public.v_agent_dialer_state from public, anon;
grant select on public.v_agent_dialer_state to authenticated, service_role;

comment on view public.v_agent_dialer_state is
  'WP5 + PKG2 (2026-11-12): per canonical agent, ReadyMode dials (dark since 10-28; account canceled 11-10) plus in-app My Leads activity (dial taps + logged outcomes). dialing_any_source is the activation signal; dialer_active_derived stays dialer-only.';

-- ---------------------------------------------------------------------------
-- 3. v_agent_activation_state: 'dialing' reachable without ReadyMode (columns appended)
-- ---------------------------------------------------------------------------
create or replace view public.v_agent_activation_state with (security_barrier = true) as
with pop as (
  select a.id as agent_id,
         a.user_id,
         a.created_at as hired_at,
         a.license_status::text as license_status,
         a.onboarding_stage::text as onboarding_stage,
         a.status::text as status
    from public.agents a
   where (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
     and a.status::text = 'active'::text
     and coalesce(a.is_deactivated, false) = false
     and coalesce(a.is_inactive, false) = false
), facts as (
  select p.agent_id,
         p.user_id,
         p.hired_at,
         p.license_status,
         p.onboarding_stage,
         p.status,
         (select u.last_sign_in_at is not null from auth.users u where u.id = p.user_id) as has_signed_in,
         coalesce((select t.required_complete from public.v_training_required_completion t where t.agent_id = p.agent_id), false) as required_training_complete,
         (select max(ie.scheduled_at)
            from public.interview_events ie
           where ie.call_track = 'onboarding'::text and ie.canceled_at is null and ie.scheduled_at < now()
             and (ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id))) as onboarding_call_at,
         ds.first_dial_at as dialer_first_call_at,
         ds.dials_14d,
         ds.has_open_seat,
         (select f.first_deal_at from public.v_agent_first_deal_definer f where f.agent_id = p.agent_id) as first_deal_at,
         ds.app_calls_14d,
         ds.app_last_activity_at,
         ds.dials_any_source_14d
    from pop p
    left join public.v_agent_dialer_state ds on ds.agent_id = p.agent_id
   where public.apex_is_admin()
      or public.apex_can_read_agent(p.agent_id)
      or current_user = any (array['postgres'::name, 'service_role'::name, 'supabase_admin'::name])
)
select agent_id,
       hired_at,
       license_status,
       onboarding_stage,
       coalesce(has_signed_in, false) as has_signed_in,
       required_training_complete,
       onboarding_call_at,
       dialer_first_call_at,
       coalesce(dials_14d, 0) as dials_14d,
       coalesce(has_open_seat, false) as has_open_seat,
       first_deal_at,
       case
         when first_deal_at is not null then 'producing'::text
         when coalesce(dials_14d, 0) > 0 or coalesce(has_open_seat, false) or coalesce(app_calls_14d, 0) > 0 then 'dialing'::text
         when license_status <> 'licensed'::text then 'licensing'::text
         when required_training_complete or onboarding_call_at is not null then 'ready_to_dial'::text
         when coalesce(has_signed_in, false) then 'onboarding'::text
         else 'not_signed_in'::text
       end as derived_stage,
       -- appended 2026-11-12 (PKG2)
       coalesce(app_calls_14d, 0) as app_calls_14d,
       app_last_activity_at,
       coalesce(dials_any_source_14d, 0) as dials_any_source_14d
  from facts;

revoke all on public.v_agent_activation_state from public, anon;
grant select on public.v_agent_activation_state to authenticated, service_role;

comment on view public.v_agent_activation_state is
  'WP5 + PKG2 (2026-11-12): activation stage per active canonical agent. dialing = ReadyMode dials in 14d, an open seat, or in-app My Leads calls in 14d (the dialer is canceled; My Leads is the live dialing path).';
