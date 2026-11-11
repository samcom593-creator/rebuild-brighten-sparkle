-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 3 of 11: next action while the dialer is off,
-- and suspended people off every hire list.
--
-- WHAT
--   1. fn_licensed_activation_population() drops anyone with an open agent_access_suspensions row (any login of the
--      person). It feeds v_licensed_hire_clock, v_activation_seat_queue, v_activation_dialing_no_close,
--      fn_licensed_contracting_gaps (=> the contracting-stalled staff alert and v_contracting_truth_health).
--   2. v_licensed_hire_clock: while system_settings.dialer_status <> 'active', "Decide on a dialer seat" is never the
--      next action, so "Decide on starter leads" and "Get the first deal" are reachable again. The coach step reads
--      dials from any source (ReadyMode + My Leads). Columns appended: dialer_status, app_calls_14d,
--      dials_any_source_14d, app_last_activity_at.
--   3. v_hire_launch_board: same ordering for assign_dialer / grant_leads / first_deal, coach step on any-source
--      dials, suspended people excluded. Columns unchanged.
--   4. v_activation_seat_queue: suspended excluded (via the population), decision note states the starter-pack rule.
--
-- WHY
--   funnel_now 6.5: the hire clock listed 4 suspended agents (021f1686, 30e3ed5a, 20344eff, c7ffeea3), one flagged
--   stalled and so inside the contracting alert. readymode_block 5b: with 0 seats and no dialer rows "Decide on a
--   dialer seat" always won, so starter leads and the first deal were unreachable and every hire who cleared
--   contracting was pointed at a canceled dialer. DECISIONS N8: while the dialer is off, starter leads outrank the
--   dialer seat.

-- ---------------------------------------------------------------------------
-- 1. Population: no suspended people
-- ---------------------------------------------------------------------------
create or replace function public.fn_licensed_activation_population()
returns table(agent_id uuid, hired_at timestamp with time zone, first_name text, manager_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, a.created_at,
         coalesce(nullif(split_part(btrim(coalesce(a.display_name, '')), ' ', 1), ''), 'Unnamed'),
         coalesce(a.manager_id, a.invited_by_manager_id)
  from public.agents a
  join public.fn_contract_review_population() p on p.agent_id = a.id
  where a.license_status::text = 'licensed'
    and coalesce(a.account_mode, 'agent') not in ('manager', 'admin')
    and public.fn_wp5_staff_reader()
    -- PKG2: a person with an open suspension on any of their logins is on no activation list.
    and not exists (
      select 1
        from public.agents g
        join public.agent_access_suspensions s on s.user_id = g.user_id and s.lifted_at is null
       where coalesce(nullif(g.canonical_agent_id, g.id), g.id) = a.id)
$$;

-- ---------------------------------------------------------------------------
-- 2. Licensed hire clock
-- ---------------------------------------------------------------------------
create or replace view public.v_licensed_hire_clock with (security_barrier = true) as
with cfg as (
  select c.version,
         public.fn_contracting_required_carriers() as required,
         nullif(btrim(coalesce((select s.value from public.system_settings s where s.key = 'contracting_owner_agent_id'::text), ''::text)), ''::text) as owner_setting,
         coalesce((select array_agg(f.origin order by f.origin) as array_agg
                     from public.v_production_origin_freshness f
                    where f.verdict = any (array['DARK'::text, 'DYING'::text])), '{}'::text[]) as dark_origins,
         coalesce((select lower(btrim(s.value)) from public.system_settings s where s.key = 'dialer_status'), 'unset') as dialer_status
    from public.contract_review_config c
   where c.singleton
), pop as (
  select g.agent_id, g.hired_at, g.first_name, g.manager_id, g.marked_count, g.required_missing, g.has_deal, g.gap
    from public.fn_licensed_contracting_gaps() g(agent_id, hired_at, first_name, manager_id, marked_count, required_missing, has_deal, gap)
   where public.apex_is_admin()
      or public.has_role(auth.uid(), 'manager'::public.app_role) and public.apex_can_read_agent(g.agent_id)
      or current_user = any (array['postgres'::name, 'service_role'::name, 'supabase_admin'::name])
), base as (
  select p.agent_id, p.first_name, p.hired_at, p.manager_id, p.marked_count, p.required_missing, p.gap, p.has_deal,
         floor(extract(epoch from now() - p.hired_at) / 86400::numeric)::integer as days_since_hire,
         a.user_id,
         a.nipr_number,
         (select jsonb_object_agg(m.carrier_key, m.confirmed_at) as jsonb_object_agg
            from public.contract_review_marks m, cfg cfg_1
           where m.agent_id = p.agent_id and m.version = cfg_1.version) as marks,
         (exists (select 1 from public.agent_contract_profile cp where cp.agent_id = p.agent_id)) as contract_profile_present,
         (select min(ie.scheduled_at) as min
            from public.interview_events ie
           where ie.call_track = 'onboarding'::text and ie.canceled_at is null
             and (ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id))) as onboarding_call_booked_at,
         (exists (select 1
                    from public.interview_events ie
                   where ie.call_track = 'onboarding'::text and ie.canceled_at is null and ie.scheduled_at < now()
                     and (ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)))) as onboarding_call_held,
         (select min(g.granted_at) as min
            from public.lead_bundle_grants g
           where g.user_id = a.user_id and a.user_id is not null and g.revoked_at is null) as lead_grant_at,
         -- definer twin: the invoker v_agent_first_deal_any_source denies every signed-in reader (see part 2)
         (select f.first_deal_at from public.v_agent_first_deal_definer f where f.agent_id = p.agent_id) as first_deal_at
    from pop p
    join public.agents a on a.id = p.agent_id
)
select b.agent_id,
       b.first_name,
       b.hired_at,
       b.days_since_hire,
       b.manager_id,
       (select coalesce(nullif(split_part(btrim(coalesce(m.display_name, ''::text)), ' '::text, 1), ''::text), 'Unnamed'::text) as "coalesce"
          from public.agents m where m.id = b.manager_id) as manager_first_name,
       case when cfg.owner_setting ~ '^[0-9a-f-]{36}$'::text then cfg.owner_setting::uuid else b.manager_id end as owner_agent_id,
       case when cfg.owner_setting ~ '^[0-9a-f-]{36}$'::text then 'contracting_owner'::text else 'manager'::text end as owner_source,
       (nullif(regexp_replace(coalesce(b.nipr_number, ''::text), '\D'::text, ''::text, 'g'::text), ''::text) ~ '^[0-9]{5,10}$'::text) is true as has_npn,
       b.contract_profile_present,
       coalesce(b.marks, '{}'::jsonb) as marks,
       b.marked_count,
       cfg.required as required_carriers,
       b.required_missing,
       case
         when cardinality(cfg.required) = 0 and b.marked_count = 0 then 'no_record'::text
         when cardinality(cfg.required) = 0 then 'marked_required_unset'::text
         when cardinality(b.required_missing) = 0 then 'required_complete'::text
         when b.marked_count = 0 then 'no_record'::text
         else 'partial'::text
       end as contracting_state,
       b.onboarding_call_booked_at,
       b.onboarding_call_held,
       ds.first_dial_at as dialer_first_dial_at,
       coalesce(ds.dials_14d, 0) as dials_14d,
       coalesce(ds.dials_total, 0) as dials_total,
       coalesce(ds.has_open_seat, false) as has_open_seat,
       b.lead_grant_at,
       b.first_deal_at,
       cardinality(cfg.dark_origins) > 0 as production_truth_degraded,
       cfg.dark_origins,
       case
         when b.first_deal_at is not null then 'has_deal'::text
         when cardinality(cfg.dark_origins) > 0 then 'unprovable'::text
         else 'none'::text
       end as first_deal_state,
       (select max(x.x) as max from unnest(array[3, 7, 14, 21]) x(x) where (b.hired_at + make_interval(days => x.x)) <= now()) as last_checkpoint,
       (select min(x.x) as min from unnest(array[3, 7, 14, 21]) x(x) where (b.hired_at + make_interval(days => x.x)) > now()) as next_checkpoint,
       (select b.hired_at + make_interval(days => min(x.x)) from unnest(array[3, 7, 14, 21]) x(x) where (b.hired_at + make_interval(days => x.x)) > now()) as next_checkpoint_at,
       b.gap and b.first_deal_at is null and b.days_since_hire >= 7 as stalled,
       case
         when b.first_deal_at is not null then 'Producing'::text
         when b.gap then 'Get a carrier contract on file'::text
         when b.onboarding_call_booked_at is null then 'Book the onboarding call'::text
         when coalesce(ds.dials_any_source_14d, 0) >= 300 then 'Coach the close (dialing, no deal)'::text
         -- PKG2: a dialer seat is a next action only while the dialer exists (dialer_status = 'active').
         when cfg.dialer_status = 'active' and not coalesce(ds.has_open_seat, false) and coalesce(ds.dials_14d, 0) = 0
           then 'Decide on a dialer seat'::text
         when b.lead_grant_at is null then 'Decide on starter leads'::text
         else 'Get the first deal'::text
       end as next_action,
       -- appended 2026-11-12 (PKG2)
       cfg.dialer_status,
       coalesce(ds.app_calls_14d, 0) as app_calls_14d,
       coalesce(ds.dials_any_source_14d, 0) as dials_any_source_14d,
       ds.app_last_activity_at
  from base b
  cross join cfg
  left join public.v_agent_dialer_state ds on ds.agent_id = b.agent_id;

revoke all on public.v_licensed_hire_clock from public, anon;
grant select on public.v_licensed_hire_clock to authenticated, service_role;

comment on view public.v_licensed_hire_clock is
  'WP5 + PKG2 (2026-11-12): licensed hires (suspended excluded) with the next action. While dialer_status <> active the dialer-seat step is skipped: contract -> onboarding call -> coach (300 any-source dials) -> starter leads -> first deal.';

-- ---------------------------------------------------------------------------
-- 3. Hire launch board
-- ---------------------------------------------------------------------------
create or replace view public.v_hire_launch_board as
with base as (
  select a.id as agent_id,
         a.user_id,
         a.profile_id,
         a.display_name,
         a.license_status::text as license_status,
         a.onboarding_stage::text as onboarding_stage,
         public.fn_hire_stage_rank(a.onboarding_stage::text) as stage_rank,
         a.created_at as hired_at,
         a.stage_changed_at,
         a.contracted_at,
         a.first_deal_at,
         a.source_application_id,
         a.invited_by_manager_id
    from public.agents a
   where a.status = 'active'::public.agent_status
     and a.canonical_agent_id is null
     and coalesce(a.is_deactivated, false) = false
     and coalesce(a.is_inactive, false) = false
     -- PKG2: a person with an open suspension on any of their logins is not on the board.
     and not exists (
       select 1
         from public.agents g
         join public.agent_access_suspensions s on s.user_id = g.user_id and s.lifted_at is null
        where coalesce(nullif(g.canonical_agent_id, g.id), g.id) = a.id)
), book as (
  select coalesce(cm.canonical_agent_id, p.agent_id) as agent_id,
         count(*) as deals,
         coalesce(sum(p.annual_premium), 0::numeric) as ap
    from public.v_production_canonical p
    left join public.v_agent_canonical_map cm on cm.agent_id = p.agent_id
   where p.agent_id is not null
   group by (coalesce(cm.canonical_agent_id, p.agent_id))
), cfg as (
  select coalesce((select lower(btrim(s.value)) from public.system_settings s where s.key = 'dialer_status'), 'unset') as dialer_status
), enriched as (
  select b.agent_id,
         b.user_id,
         b.profile_id,
         b.display_name,
         b.license_status,
         b.onboarding_stage,
         b.stage_rank,
         b.hired_at,
         b.stage_changed_at,
         b.contracted_at,
         b.first_deal_at,
         b.source_application_id,
         b.invited_by_manager_id,
         p.full_name,
         p.email,
         p.phone,
         mgr.display_name as manager_name,
         greatest(0, current_date - coalesce(b.stage_changed_at, b.hired_at)::date) as days_in_stage,
         greatest(0, current_date - b.hired_at::date) as days_since_hired,
         act.calls_7d,
         act.calls_30d,
         act.conversations_30d,
         act.last_call_at,
         coalesce(bk.deals, 0::bigint) as book_deals,
         coalesce(bk.ap, 0::numeric) as book_ap,
         cal.next_call_at,
         cal.last_outcome as last_call_outcome,
         tr.modules_done,
         (exists (select 1 from public.agent_dialer_seats s where s.agent_id = b.agent_id and s.released_at is null)) as has_open_seat,
         (exists (select 1 from public.lead_bundle_grants g where g.user_id = b.user_id and b.user_id is not null and g.revoked_at is null)) as has_lead_grant,
         dl.dials_7d as alias_dials_7d,
         dl.dials_14d as alias_dials_14d,
         coalesce(app.calls_14d, 0::bigint) as app_calls_14d,
         cfg.dialer_status
    from base b
    cross join cfg
    left join public.profiles p on p.id = b.profile_id
    left join public.agents mgr on mgr.id = b.invited_by_manager_id
    left join book bk on bk.agent_id = b.agent_id
    left join lateral (select min(oc.scheduled_at) filter (where oc.scheduled_at > now() and oc.canceled_at is null) as next_call_at,
                              (array_agg(oc.outcome order by oc.scheduled_at desc) filter (where oc.outcome is not null))[1] as last_outcome
                         from public.v_onboarding_calls oc
                        where oc.agent_id = b.agent_id) cal on true
    left join lateral (select count(*) as modules_done
                         from public.onboarding_progress op
                        where op.agent_id = b.agent_id and op.completed_at is not null) tr on true
    left join public.v_hire_activity act on act.agent_id = b.agent_id
    left join lateral (select count(*) filter (where c.call_started_at >= (now() - '7 days'::interval)) as dials_7d,
                              count(*) filter (where c.call_started_at >= (now() - '14 days'::interval)) as dials_14d
                         from public.readymode_dialer_calls c
                        where (c.agent_id in (select a2.id from public.agents a2 where a2.id = b.agent_id or a2.canonical_agent_id = b.agent_id))) dl on true
    -- PKG2: in-app My Leads activity (dial taps / logged outcomes), the live dialing path while the dialer is off
    left join lateral (select greatest(count(*) filter (where e.action = 'dial_tap'), count(*) filter (where e.action = 'status')) as calls_14d
                         from public.lead_bundle_events e
                        where e.action in ('dial_tap', 'status')
                          and e.at >= now() - '14 days'::interval
                          and e.actor in (select a3.user_id from public.agents a3
                                           where (a3.id = b.agent_id or a3.canonical_agent_id = b.agent_id) and a3.user_id is not null)) app on true
)
select agent_id,
       user_id,
       coalesce(nullif(btrim(display_name), ''::text), full_name, 'Name not on file'::text) as display_name,
       email,
       phone,
       license_status,
       onboarding_stage,
       stage_rank,
       hired_at,
       stage_changed_at,
       days_in_stage,
       days_since_hired,
       contracted_at,
       first_deal_at,
       source_application_id,
       invited_by_manager_id,
       manager_name,
       book_deals,
       book_ap,
       next_call_at,
       last_call_outcome,
       modules_done,
       calls_7d,
       calls_30d,
       conversations_30d,
       last_call_at,
       hired_at >= (date_trunc('month'::text, (now() at time zone 'America/Phoenix'::text))::date::timestamp with time zone + '07:00:00'::interval) as hired_this_month,
       case
         when license_status <> 'licensed'::text then 'license'::text
         when stage_rank is null then 'off_ladder'::text
         when stage_rank < 3 and book_deals > 0 then 'mark_producing'::text
         when stage_rank = 0 then 'start_onboarding'::text
         when stage_rank = 1 and next_call_at is null then 'book_call'::text
         when stage_rank = 1 then 'move_to_course'::text
         when stage_rank = 2 then 'move_to_field'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0
              and coalesce(alias_dials_14d, 0::bigint) + app_calls_14d >= 300 then 'coach_closing'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0 and dialer_status = 'active'
              and not has_open_seat and coalesce(alias_dials_7d, 0::bigint) = 0 then 'assign_dialer'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0 and not has_lead_grant then 'grant_leads'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0 then 'first_deal'::text
         when stage_rank = 3 then 'mark_producing'::text
         else 'coach'::text
       end as next_action_key,
       case
         when license_status <> 'licensed'::text then 'Get them licensed'::text
         when stage_rank is null then ('Off the ladder at '::text || coalesce(onboarding_stage, 'no stage'::text)) || ' — put them back on it'::text
         when stage_rank < 3 and book_deals > 0 then 'Already writing business — mark them producing'::text
         when stage_rank = 0 then 'Start onboarding'::text
         when stage_rank = 1 and next_call_at is null then 'Book the onboarding call'::text
         when stage_rank = 1 then 'Move them into the course'::text
         when stage_rank = 2 then 'Course done — send them to field training'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0
              and coalesce(alias_dials_14d, 0::bigint) + app_calls_14d >= 300 then 'Dialing hard, no deal yet — coach the close'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0 and dialer_status = 'active'
              and not has_open_seat and coalesce(alias_dials_7d, 0::bigint) = 0 then 'No dialer seat on record — decide on a seat'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0 and not has_lead_grant then 'No leads granted — decide on a starter bundle'::text
         when stage_rank = 3 and first_deal_at is null and book_deals = 0 then 'Field training — get the first deal'::text
         when stage_rank = 3 then 'First deal is in — mark them producing'::text
         else 'Producing — coach the next win'::text
       end as next_action_label,
       coalesce(stage_rank, 0) < 4 and greatest(0, current_date - coalesce(stage_changed_at, hired_at)::date) > 14 as is_stalled,
       email is null or btrim(email) = ''::text as email_missing,
       phone is null or btrim(phone) = ''::text as phone_missing,
       has_open_seat,
       has_lead_grant,
       coalesce(alias_dials_14d, 0::bigint)::integer as dials_14d
  from enriched e
 where public.apex_is_admin() or public.crm_can_read_agent_scope(agent_id);

revoke all on public.v_hire_launch_board from public, anon;
grant select on public.v_hire_launch_board to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Seat queue (now the "no dialing path yet" queue)
-- ---------------------------------------------------------------------------
create or replace view public.v_activation_seat_queue with (security_barrier = true) as
select p.agent_id,
       p.first_name,
       p.hired_at,
       floor(extract(epoch from now() - p.hired_at) / 86400::numeric)::integer as days_since_hire,
       coalesce(t.required_complete, false) as training_complete,
       (exists (select 1
                  from public.interview_events ie
                 where ie.call_track = 'onboarding'::text and ie.canceled_at is null and ie.scheduled_at < now()
                   and (ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)))) as onboarding_call_held,
       ds.last_dial_at,
       ds.dials_total,
       f.agent_id is not null as has_deal,
       p.manager_id,
       case
         when coalesce((select lower(btrim(s.value)) from public.system_settings s where s.key = 'dialer_status'), 'unset') = 'active'
           then 'ready: a dialer seat or a starter pack in My Leads'::text
         else 'ready: starter pack in My Leads (the dialer is not active; automatic only when onboarding_starter_pack_enabled = true)'::text
       end as decision_note
  from public.fn_licensed_activation_population() p(agent_id, hired_at, first_name, manager_id)
  join public.agents a on a.id = p.agent_id
  left join public.v_training_required_completion t on t.agent_id = p.agent_id
  left join public.v_agent_dialer_state ds on ds.agent_id = p.agent_id
  left join public.v_agent_first_deal_definer f on f.agent_id = p.agent_id
 where (coalesce(t.required_complete, false)
        or (exists (select 1
                      from public.interview_events ie
                     where ie.call_track = 'onboarding'::text and ie.canceled_at is null and ie.scheduled_at < now()
                       and (ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)))))
   and not coalesce(ds.has_open_seat, false)
   and coalesce(ds.dials_7d, 0) = 0
   and coalesce(ds.app_calls_7d, 0) = 0
   and not (exists (select 1 from public.lead_bundle_grants g where g.user_id = a.user_id and g.revoked_at is null));

revoke all on public.v_activation_seat_queue from public, anon;
grant select on public.v_activation_seat_queue to authenticated, service_role;
