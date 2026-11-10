-- WP5 (2026-11-10) part 3 of 3: provenance on every hire, the NPN gate on booking-based licensing, the licensed hire
-- clock, the derived activation stage, and the staged "Needs a decision" list for licensed leads never resolved.
--
-- MEASURED LIVE BEFORE WRITING (2026-11-10):
--   * agents.source_application_id is set on 10 of 241 agents; 29 of 32 unlinked licensed hires have NO application at
--     all (they came through Add Agent, the hire link or a toolkit). agents.metadata carries no creation source.
--   * fn_auto_license_from_licensed_booking flips applications.license_status to 'licensed' whenever a booking lands on
--     a licensed-track calendar, NPN or not (6 flips, all on the 2026-08-01 backfill day; none since). Latent, hardened.
--   * 33 non-duplicate 'interview_booking' application rows (backfilled 08-01 from Calendly) have a past call and no
--     outcome; 57 non-duplicate licensed applications in 180 days; many never became agents.
--   * Production truth has DARK origins (v_production_origin_freshness: agentcloud_producer DARK 43d, external_daily_gap
--     DARK 47d, discord_external DYING), so "no deal" is unprovable for recent hires and must read that way.
--
-- WHAT THIS DOES:
--   1. agents.origin (application | direct_add | hire_link | import | headhunter | unattributed) and
--      agents.recruiter_agent_id. A BEFORE INSERT default fills a blank origin from metadata.origin, else 'application'
--      when an application is linked, else 'import' for an AgentLink id, else 'unattributed' (honest, and counted by the
--      apex-doctor ratchet). It never blocks an insert. Existing rows are NOT backfilled.
--      apex_provision_licensed_applicant now links the application it provisions (source_application_id + origin).
--   2. agent_contract_profile.source accepts 'magic_hire_link' (the stub consume-invite-token creates for licensed hires).
--   3. fn_auto_license_from_licensed_booking: without a 5-10 digit NPN on the application it no longer changes
--      license_status; it writes next_step_events 'licensed_claim_unverified' and a waiting_reason instead.
--   4. v_agent_activation_state: one row per canonical active agent, a DERIVED stage from facts (sign-in, required
--      training, onboarding call, dialer, first deal in any source). Read-only; never writes agents.onboarding_stage, so
--      it cannot fire the 'live' enqueue chain. Readable by admin and by whoever can already read that agent's row.
--   5. v_licensed_hire_clock: per canonical active licensed recruit, day 0..N with contracting marks, onboarding call,
--      dialer, leads, first deal (or 'unprovable' while a production origin is DARK/DYING), owner, next checkpoint.
--      Admin, Aisha (manager role, her downline) and service only; agents see nothing new.
--   6. v_licensed_unresolved: STAGED. Never-hired licensed applications (180d) + booking-only licensed records with a
--      past call and no outcome, minus anyone already an agent or already logged. First name, state, last call date.
--      Nothing is sent from it.

-- ── 0. preimage (once) ──────────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.ops_preimage_snapshots') is not null
     and not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp5 preimage: functions (part 3)') then
    insert into public.ops_preimage_snapshots (reason, payload)
    select 'wp5 preimage: functions (part 3)', jsonb_build_object(
      'functions', (select jsonb_object_agg(p.proname, pg_get_functiondef(p.oid))
                      from pg_proc p where p.pronamespace = 'public'::regnamespace
                       and p.proname in ('fn_auto_license_from_licensed_booking', 'apex_provision_licensed_applicant')),
      'agent_contract_profile_source_check', (select pg_get_constraintdef(oid) from pg_constraint
                                                where conrelid = 'public.agent_contract_profile'::regclass and conname = 'agent_contract_profile_source_check'));
  end if;
end $$;

-- ── 1. provenance ───────────────────────────────────────────────────────────────────────────────────────────────
alter table public.agents add column if not exists origin text;
alter table public.agents add column if not exists recruiter_agent_id uuid references public.agents(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.agents'::regclass and conname = 'agents_origin_check') then
    alter table public.agents add constraint agents_origin_check
      check (origin is null or origin in ('application', 'direct_add', 'hire_link', 'import', 'headhunter', 'unattributed'));
  end if;
end $$;
comment on column public.agents.origin is
  'WP5 2026-11-10: how this agent row was created (application | direct_add | hire_link | import | headhunter | unattributed). Set by the writer or by trg_yz_agent_origin_default; never backfilled for rows created before 2026-11-10.';
comment on column public.agents.recruiter_agent_id is
  'WP5 2026-11-10: who recruited this hire, as stated by the creating path (falls back to invited_by_manager_id).';

create or replace function public.fn_yz_agent_origin_default()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_meta text;
begin
  if new.origin is null then
    v_meta := lower(btrim(coalesce(new.metadata ->> 'origin', '')));
    new.origin := case
      when v_meta in ('application', 'direct_add', 'hire_link', 'import', 'headhunter') then v_meta
      when new.source_application_id is not null then 'application'
      when new.al_user_id is not null then 'import'
      else 'unattributed'
    end;
  end if;
  if new.recruiter_agent_id is null and new.invited_by_manager_id is not null and new.invited_by_manager_id <> new.id then
    new.recruiter_agent_id := new.invited_by_manager_id;
  end if;
  return new;
exception when others then
  -- Provenance must never block a hire.
  raise warning 'fn_yz_agent_origin_default soft-failed: %', sqlerrm;
  return new;
end;
$$;
-- Named to run after trg_y_agent_attribution_from_application (which may fill source_application_id and the recruiter)
-- and before z_default_agent_manager_to_sam.
drop trigger if exists trg_yz_agent_origin_default on public.agents;
create trigger trg_yz_agent_origin_default before insert on public.agents
  for each row execute function public.fn_yz_agent_origin_default();

do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.apex_provision_licensed_applicant'::regproc);
  if position('source_application_id' in v_def) = 0 then
    v_new := replace(v_def,
      E'profile_id, display_name, license_status, status, onboarding_stage, start_date, manager_id\n    ) VALUES (\n      v_profile_id,',
      E'profile_id, display_name, license_status, status, onboarding_stage, start_date, manager_id, source_application_id, origin\n    ) VALUES (\n      v_profile_id,');
    v_new := replace(v_new,
      E'''licensed'', ''active'', ''provisioned'', CURRENT_DATE,\n      v_app.hiring_manager_user_id\n    )',
      E'''licensed'', ''active'', ''provisioned'', CURRENT_DATE,\n      v_app.hiring_manager_user_id, p_application_id, ''application''\n    )');
    if (length(v_new) - length(v_def)) <> (length(', source_application_id, origin') + length(', p_application_id, ''application''')) then
      raise exception 'wp5: apex_provision_licensed_applicant live text drifted; refusing a partial patch';
    end if;
    execute v_new;
  end if;
end $$;

-- ── 2. contracting-profile stub source ──────────────────────────────────────────────────────────────────────────
alter table public.agent_contract_profile drop constraint if exists agent_contract_profile_source_check;
alter table public.agent_contract_profile add constraint agent_contract_profile_source_check
  check (source = any (array['staff'::text, 'self'::text, 'magic_hire_link'::text]));

-- ── 3. NPN gate on booking-based licensing ──────────────────────────────────────────────────────────────────────
-- next_step_events.event_type is a closed list: add 'licensed_claim_unverified' to whatever the LIVE list is (another
-- package may have widened it today), never replace the list with a copy from this file.
do $$
declare v_def text; v_vals text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.next_step_events'::regclass and conname = 'next_step_events_event_type_check';
  if v_def is null or position('licensed_claim_unverified' in v_def) > 0 then return; end if;
  select array_agg(t.m[1] order by t.ord) into v_vals
    from regexp_matches(v_def, '''([^'']+)''::text', 'g') with ordinality as t(m, ord);
  if coalesce(cardinality(v_vals), 0) < 5 then
    raise exception 'wp5: could not parse next_step_events_event_type_check (%); refusing to rebuild it', v_def;
  end if;
  v_vals := v_vals || 'licensed_claim_unverified'::text;
  execute format('alter table public.next_step_events drop constraint next_step_events_event_type_check, '
              || 'add constraint next_step_events_event_type_check check (event_type = any (%L::text[]))', v_vals);
end $$;

create or replace function public.fn_auto_license_from_licensed_booking()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_prev text;
  v_signal text;
  v_npn text;
begin
  if new.application_id is not null
     and new.canceled_at is null
     and (
       (new.call_track = 'licensed'
        and coalesce(new.event_type_name, '') not ilike '%unlicensed%')
       or public.fn_status_answer_indicates_licensed(new.invitee_status)
     )
  then
    v_signal := case
      when new.call_track = 'licensed'
           and coalesce(new.event_type_name, '') not ilike '%unlicensed%'
        then 'licensed_calendar_link'
      else 'status_answer'
    end;
    begin
      select license_status::text, regexp_replace(coalesce(nipr_number, ''), '\D', '', 'g')
        into v_prev, v_npn
        from public.applications where id = new.application_id;

      if found and v_prev is distinct from 'licensed' then
        if v_npn ~ '^[0-9]{5,10}$' then
          update public.applications
             set license_status = 'licensed',
                 licensed_at    = coalesce(licensed_at, now())
           where id = new.application_id
             and license_status is distinct from 'licensed';

          insert into public.next_step_events
            (application_id, event_type, source, payload)
          values
            (new.application_id,
             'auto_licensed_from_booking',
             'calendly',
             jsonb_build_object(
               'interview_event_id',      new.id,
               'event_type_name',         new.event_type_name,
               'booking_scheduled_at',    new.scheduled_at,
               'previous_license_status', v_prev,
               'signal',                  v_signal,
               'invitee_status',          new.invitee_status,
               'note', 'Booked as licensed (' || v_signal || ') with an NPN on file; auto-marked licensed'));
        else
          -- WP5: which calendar someone picked is not license proof. Without an NPN, record the claim for a human.
          if not exists (select 1 from public.next_step_events e
                          where e.application_id = new.application_id and e.event_type = 'licensed_claim_unverified'
                            and e.payload ->> 'interview_event_id' = new.id::text) then
            insert into public.next_step_events
              (application_id, event_type, source, payload)
            values
              (new.application_id,
               'licensed_claim_unverified',
               'calendly',
               jsonb_build_object(
                 'interview_event_id',      new.id,
                 'event_type_name',         new.event_type_name,
                 'booking_scheduled_at',    new.scheduled_at,
                 'previous_license_status', v_prev,
                 'signal',                  v_signal,
                 'note', 'Booked as licensed (' || v_signal || ') with no 5-10 digit NPN on the application; license_status left unchanged'));
            update public.applications
               set waiting_reason = 'Says licensed (booked a licensed call) but no NPN on file: verify the NPN on the call'
             where id = new.application_id and waiting_reason is null;
          end if;
        end if;
      end if;
    exception when others then
      raise warning 'fn_auto_license_from_licensed_booking failed for interview_event %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$function$;

-- ── 4. derived activation stage (read-only) ─────────────────────────────────────────────────────────────────────
create or replace view public.v_agent_activation_state with (security_barrier = true) as
with pop as (
  select a.id as agent_id, a.user_id, a.created_at as hired_at, a.license_status::text as license_status,
         a.onboarding_stage::text as onboarding_stage, a.status::text as status
  from public.agents a
  where (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
    and a.status::text = 'active' and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
), facts as (
  select p.*,
         (select u.last_sign_in_at is not null from auth.users u where u.id = p.user_id) as has_signed_in,
         coalesce((select t.required_complete from public.v_training_required_completion t where t.agent_id = p.agent_id), false) as required_training_complete,
         (select max(ie.scheduled_at) from public.interview_events ie
           where ie.call_track = 'onboarding' and ie.canceled_at is null and ie.scheduled_at < now()
             and ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)) as onboarding_call_at,
         (select ds.first_dial_at from public.v_agent_dialer_state ds where ds.agent_id = p.agent_id) as dialer_first_call_at,
         (select ds.dials_14d from public.v_agent_dialer_state ds where ds.agent_id = p.agent_id) as dials_14d,
         (select ds.has_open_seat from public.v_agent_dialer_state ds where ds.agent_id = p.agent_id) as has_open_seat,
         (select f.first_deal_at from public.v_agent_first_deal_any_source f where f.agent_id = p.agent_id) as first_deal_at
  from pop p
  where public.apex_is_admin() or public.apex_can_read_agent(p.agent_id)
     or current_user in ('postgres', 'service_role', 'supabase_admin')
)
select agent_id, hired_at, license_status, onboarding_stage,
       coalesce(has_signed_in, false) as has_signed_in, required_training_complete, onboarding_call_at,
       dialer_first_call_at, coalesce(dials_14d, 0) as dials_14d, coalesce(has_open_seat, false) as has_open_seat, first_deal_at,
       case
         when first_deal_at is not null then 'producing'
         when coalesce(dials_14d, 0) > 0 or coalesce(has_open_seat, false) then 'dialing'
         when license_status <> 'licensed' then 'licensing'
         when required_training_complete or onboarding_call_at is not null then 'ready_to_dial'
         when coalesce(has_signed_in, false) then 'onboarding'
         else 'not_signed_in'
       end as derived_stage
from facts;
revoke all on public.v_agent_activation_state from public, anon;
grant select on public.v_agent_activation_state to authenticated, service_role;

-- ── 5. the licensed hire clock ──────────────────────────────────────────────────────────────────────────────────
create or replace view public.v_licensed_hire_clock with (security_barrier = true) as
with cfg as (
  select c.version,
         public.fn_contracting_required_carriers() as required,
         nullif(btrim(coalesce((select s.value from public.system_settings s where s.key = 'contracting_owner_agent_id'), '')), '') as owner_setting,
         coalesce((select array_agg(f.origin order by f.origin) from public.v_production_origin_freshness f where f.verdict in ('DARK', 'DYING')), '{}'::text[]) as dark_origins
  from public.contract_review_config c where c.singleton
), pop as (
  select g.* from public.fn_licensed_contracting_gaps() g
  where public.apex_is_admin()
     or (public.has_role(auth.uid(), 'manager'::app_role) and public.apex_can_read_agent(g.agent_id))
     or current_user in ('postgres', 'service_role', 'supabase_admin')
), base as (
  select p.agent_id, p.first_name, p.hired_at, p.manager_id, p.marked_count, p.required_missing, p.gap, p.has_deal,
         floor(extract(epoch from (now() - p.hired_at)) / 86400)::int as days_since_hire,
         a.user_id, a.nipr_number,
         (select jsonb_object_agg(m.carrier_key, m.confirmed_at) from public.contract_review_marks m, cfg
           where m.agent_id = p.agent_id and m.version = cfg.version) as marks,
         exists (select 1 from public.agent_contract_profile cp where cp.agent_id = p.agent_id) as contract_profile_present,
         (select min(ie.scheduled_at) from public.interview_events ie
           where ie.call_track = 'onboarding' and ie.canceled_at is null
             and ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)) as onboarding_call_booked_at,
         exists (select 1 from public.interview_events ie
           where ie.call_track = 'onboarding' and ie.canceled_at is null and ie.scheduled_at < now()
             and ie.agent_id in (select a2.id from public.agents a2 where a2.id = p.agent_id or a2.canonical_agent_id = p.agent_id)) as onboarding_call_held,
         (select min(g.granted_at) from public.lead_bundle_grants g where g.user_id = a.user_id and a.user_id is not null and g.revoked_at is null) as lead_grant_at,
         (select f.first_deal_at from public.v_agent_first_deal_any_source f where f.agent_id = p.agent_id) as first_deal_at
  from pop p join public.agents a on a.id = p.agent_id
)
select b.agent_id, b.first_name, b.hired_at, b.days_since_hire, b.manager_id,
       (select coalesce(nullif(split_part(btrim(coalesce(m.display_name, '')), ' ', 1), ''), 'Unnamed') from public.agents m where m.id = b.manager_id) as manager_first_name,
       case when cfg.owner_setting ~ '^[0-9a-f-]{36}$' then cfg.owner_setting::uuid else b.manager_id end as owner_agent_id,
       case when cfg.owner_setting ~ '^[0-9a-f-]{36}$' then 'contracting_owner' else 'manager' end as owner_source,
       (nullif(regexp_replace(coalesce(b.nipr_number, ''), '\D', '', 'g'), '') ~ '^[0-9]{5,10}$') is true as has_npn,
       b.contract_profile_present,
       coalesce(b.marks, '{}'::jsonb) as marks,
       b.marked_count,
       cfg.required as required_carriers,
       b.required_missing,
       case
         when cardinality(cfg.required) = 0 and b.marked_count = 0 then 'no_record'
         when cardinality(cfg.required) = 0 then 'marked_required_unset'
         when cardinality(b.required_missing) = 0 then 'required_complete'
         when b.marked_count = 0 then 'no_record'
         else 'partial'
       end as contracting_state,
       b.onboarding_call_booked_at, b.onboarding_call_held,
       ds.first_dial_at as dialer_first_dial_at, coalesce(ds.dials_14d, 0) as dials_14d, coalesce(ds.dials_total, 0) as dials_total,
       coalesce(ds.has_open_seat, false) as has_open_seat,
       b.lead_grant_at,
       b.first_deal_at,
       (cardinality(cfg.dark_origins) > 0) as production_truth_degraded,
       cfg.dark_origins,
       case when b.first_deal_at is not null then 'has_deal'
            when cardinality(cfg.dark_origins) > 0 then 'unprovable'
            else 'none' end as first_deal_state,
       (select max(x) from unnest(array[3, 7, 14, 21]) x where b.hired_at + make_interval(days => x) <= now()) as last_checkpoint,
       (select min(x) from unnest(array[3, 7, 14, 21]) x where b.hired_at + make_interval(days => x) > now()) as next_checkpoint,
       (select b.hired_at + make_interval(days => min(x)) from unnest(array[3, 7, 14, 21]) x where b.hired_at + make_interval(days => x) > now()) as next_checkpoint_at,
       (b.gap and b.first_deal_at is null and b.days_since_hire >= 7) as stalled,
       case
         when b.first_deal_at is not null then 'Producing'
         when b.gap then 'Get a carrier contract on file'
         when b.onboarding_call_booked_at is null then 'Book the onboarding call'
         when coalesce(ds.dials_14d, 0) >= 300 then 'Coach the close (dialing, no deal)'
         when not coalesce(ds.has_open_seat, false) and coalesce(ds.dials_14d, 0) = 0 then 'Decide on a dialer seat'
         when b.lead_grant_at is null then 'Decide on starter leads'
         else 'Get the first deal'
       end as next_action
from base b
cross join cfg
left join public.v_agent_dialer_state ds on ds.agent_id = b.agent_id;
revoke all on public.v_licensed_hire_clock from public, anon;
grant select on public.v_licensed_hire_clock to authenticated, service_role;

-- ── 6. licensed leads never resolved (STAGED) ───────────────────────────────────────────────────────────────────
create or replace view public.v_licensed_unresolved with (security_barrier = true) as
with apps as (
  select ap.id as application_id, ap.record_type, ap.created_at, ap.first_name, ap.state, ap.email, ap.phone, ap.status::text as status,
         (regexp_replace(coalesce(ap.nipr_number, ''), '\D', '', 'g') ~ '^[0-9]{5,10}$') as has_npn,
         (select max(ie.scheduled_at) from public.interview_events ie
           where ie.application_id = ap.id and ie.canceled_at is null and ie.scheduled_at < now()) as last_call_at,
         (select count(*) from public.interview_events ie
           where ie.application_id = ap.id and ie.canceled_at is null and ie.scheduled_at < now() and ie.outcome is null) as calls_without_outcome
  from public.applications ap
  where coalesce(ap.is_duplicate, false) = false
    and (
      (ap.record_type = 'application' and ap.license_status::text = 'licensed' and ap.created_at >= now() - interval '180 days')
      or (ap.record_type = 'interview_booking'
          and exists (select 1 from public.interview_events ie where ie.application_id = ap.id and ie.call_track = 'licensed'))
    )
    and ap.status::text not in ('rejected', 'disqualified', 'contracting', 'onboarding')
)
select x.application_id,
       coalesce(nullif(split_part(btrim(coalesce(x.first_name, '')), ' ', 1), ''), 'Unnamed') as first_name,
       nullif(upper(btrim(coalesce(x.state, ''))), '') as state,
       case when x.record_type = 'application' then 'never_hired_application' else 'booking_only_no_outcome' end as kind,
       x.created_at as applied_at,
       x.last_call_at,
       x.has_npn,
       case when x.has_npn then 'Call first: licensed with an NPN on file'
            when x.last_call_at is not null then 'Record the call outcome, then decide'
            else 'One call or one email from Sam, on approval' end as suggested_next_step,
       'staged: nothing is sent from this list; Sam approves each batch'::text as decision_note
from apps x
where (x.record_type = 'application' or (x.last_call_at is not null and x.calls_without_outcome > 0))
  -- already an agent (linked, or the same email on an agent's profile / login)
  and not exists (select 1 from public.agents a where a.source_application_id = x.application_id)
  and not exists (select 1 from public.agents a
                   left join public.profiles p on p.id = a.profile_id
                   left join auth.users u on u.id = a.user_id
                  where (x.email is not null and btrim(x.email) <> ''
                         and lower(btrim(x.email)) in (lower(btrim(coalesce(p.email, ''))), lower(btrim(coalesce(u.email, '')))))
                     or (length(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g')) >= 10
                         and right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10)))
  -- already logged by a human
  and not exists (select 1 from public.application_contact_log l where l.application_id = x.application_id)
  and (public.apex_is_admin()
       or public.has_role(auth.uid(), 'manager'::app_role)
       or current_user in ('postgres', 'service_role', 'supabase_admin'));
revoke all on public.v_licensed_unresolved from public, anon;
grant select on public.v_licensed_unresolved to authenticated, service_role;
