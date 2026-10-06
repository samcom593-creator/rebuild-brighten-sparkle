-- APEX OS redesign §5 — the recruiting pipeline becomes a contact workspace.
--
-- WHAT EXISTED (measured 2026-10-06, docs/audits/apex-os-redesign-2026-10-05/04-pipeline-contact-workspace.md):
--   * application_contact_log is the only table shaped like a contact record
--     (application_id, channel, outcome, logged_by, logged_at) but its outcome is free
--     text with no CHECK, 11 of its 36 rows are `initiated` (a dial-link CLICK), and
--     nothing in it says what happens next.
--   * applications carries three next-action families; every value is overdue, and the
--     only writer of next_action/next_action_due_at is the nudge cron
--     (fn_run_applicant_nudges -> MANAGER_CALL_72H_ESCALATION).
--   * Ownership is fiction: assigned_agent_id/recruiter_id/referral_manager_id are filled
--     on 832/832 live rows by intake routing (88.5% Sam). They are ATTRIBUTION (who
--     recruited the person, who gets paid) and fn_protect_application_attribution freezes
--     them. Nobody has ever been made accountable for CONTACTING a person.
--
-- WHAT THIS ADDS (additive; nothing is dropped, rewritten or backfilled):
--   1. application_contact_log stays the single contact record. New columns hold a CHECKed
--      contact_outcome vocabulary, the plan set alongside it, and provider_event_ref.
--      is_manual is GENERATED from provider_event_ref, and the user-facing RPC never
--      accepts a provider ref, so every outcome a person records is labelled manual — a
--      dial-link click can never be dressed as a call. Legacy rows keep contact_outcome
--      NULL: they are not rewritten into a vocabulary they were never recorded in.
--   2. channel CHECK is WIDENED (adds in_person, manual). Every existing value stays legal.
--   3. applications gains the accountable owner (recruiting_owner_user_id — a staff user,
--      distinct from attribution), the waiting/review half of the plan, a denormalised
--      last outcome for the queue, a do-not-contact stamp, and a time zone that is only
--      ever written from a verified source (never inferred from a phone number).
--   4. record_recruiting_outcome(): one SECURITY DEFINER write that logs the outcome,
--      stamps last_contacted_at, sets owner + plan, honours suppression and returns the
--      updated worklist row so the queue and the profile refresh from one response.
--      set_recruiting_plan(): owner / plan / verified time zone without inventing contact.
--      recruiting_staff_directory(): names for owner pickers, no emails.
--   5. A BEFORE UPDATE guard so the nudge cron can no longer overwrite a plan a human set.
--   6. A SELECT policy for the `recruiter` role, which every recruiting route admits but no
--      RLS policy did (0 recruiter users today, so this changes nobody's visibility yet).

-- ---------------------------------------------------------------- 1. contact log columns
alter table public.application_contact_log
  add column if not exists contact_outcome text,
  add column if not exists provider_event_ref text,
  add column if not exists next_action text,
  add column if not exists next_action_due_at timestamptz,
  add column if not exists waiting_reason text,
  add column if not exists next_review_at timestamptz,
  add column if not exists owner_user_id uuid,
  add column if not exists source_surface text;

alter table public.application_contact_log
  add column if not exists is_manual boolean generated always as (provider_event_ref is null) stored;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.application_contact_log'::regclass
       and conname = 'application_contact_log_contact_outcome_check'
  ) then
    alter table public.application_contact_log
      add constraint application_contact_log_contact_outcome_check
      check (contact_outcome is null or contact_outcome in (
        'no_answer', 'callback', 'interested', 'appointment_booked',
        'not_interested', 'wrong_number', 'do_not_contact'
      ));
  end if;
end
$$;

-- Widen, never narrow: every value the old CHECK admitted is still admitted.
alter table public.application_contact_log
  drop constraint if exists application_contact_log_channel_check;
alter table public.application_contact_log
  add constraint application_contact_log_channel_check
  check (channel in ('call', 'sms', 'email', 'note', 'in_person', 'manual'));

create index if not exists idx_application_contact_log_app_logged
  on public.application_contact_log (application_id, logged_at desc);

comment on column public.application_contact_log.contact_outcome is
  'Canonical recruiting contact outcome (CHECKed). NULL on legacy rows and on plan-only notes; legacy free text stays in outcome.';
comment on column public.application_contact_log.is_manual is
  'Generated: true unless a provider event reference exists. A person recording an outcome is always manual.';

-- ---------------------------------------------------------------- 2. applications columns
alter table public.applications
  add column if not exists recruiting_owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists recruiting_owner_set_at timestamptz,
  add column if not exists recruiting_owner_set_by uuid,
  add column if not exists next_action_set_at timestamptz,
  add column if not exists next_action_set_by uuid,
  add column if not exists waiting_reason text,
  add column if not exists next_review_at timestamptz,
  add column if not exists last_contact_outcome text,
  add column if not exists last_contact_outcome_at timestamptz,
  add column if not exists last_contact_outcome_by uuid,
  add column if not exists last_contact_channel text,
  add column if not exists do_not_contact_at timestamptz,
  add column if not exists do_not_contact_by uuid,
  add column if not exists do_not_contact_reason text,
  add column if not exists time_zone text,
  add column if not exists time_zone_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.applications'::regclass
                  and conname = 'applications_last_contact_outcome_check') then
    alter table public.applications
      add constraint applications_last_contact_outcome_check
      check (last_contact_outcome is null or last_contact_outcome in (
        'no_answer', 'callback', 'interested', 'appointment_booked',
        'not_interested', 'wrong_number', 'do_not_contact'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.applications'::regclass
                  and conname = 'applications_last_contact_channel_check') then
    alter table public.applications
      add constraint applications_last_contact_channel_check
      check (last_contact_channel is null or last_contact_channel in ('call', 'sms', 'email', 'in_person', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.applications'::regclass
                  and conname = 'applications_time_zone_source_check') then
    alter table public.applications
      add constraint applications_time_zone_source_check
      check (
        (time_zone is null and time_zone_source is null)
        or (time_zone is not null and time_zone_source in ('applicant_form', 'confirmed_by_staff'))
      );
  end if;
end
$$;

create index if not exists idx_applications_recruiting_owner
  on public.applications (recruiting_owner_user_id) where recruiting_owner_user_id is not null;

comment on column public.applications.recruiting_owner_user_id is
  'Staff user accountable for contacting this person. NOT attribution: assigned_agent_id/recruiter_id/referral_manager_id stay the recruiting credit. NULL = unassigned.';
comment on column public.applications.time_zone is
  'IANA zone from a verified source only (time_zone_source). Never inferred from a phone number.';
comment on column public.applications.next_action_set_at is
  'Set when a person (not automation) writes next_action/next_action_due_at; trg_protect_human_next_action keeps automation from overwriting it.';

-- ---------------------------------------------------------------- 3. recruiter read access
do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'public.applications'::regclass
                  and polname = 'applications_recruiter_read') then
    create policy applications_recruiter_read on public.applications
      for select to authenticated
      using (public.has_role((select auth.uid()), 'recruiter'::public.app_role));
  end if;
end
$$;

-- ---------------------------------------------------------------- 4. authorization helpers
create or replace function public.is_recruiting_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Org-wide recruiting staff. Managers are deliberately NOT here: they work their team
  -- through can_work_recruiting_application(), mirroring their applications RLS policy.
  select public.apex_is_admin()
      or public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'va'::public.app_role)
      or public.has_role(auth.uid(), 'va_manager'::public.app_role)
      or public.has_role(auth.uid(), 'recruiter'::public.app_role);
$function$;

create or replace function public.can_work_recruiting_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    public.is_recruiting_staff()
    or public.can_work_application(p_application_id)
    or (
      public.has_role(auth.uid(), 'manager'::public.app_role)
      and exists (
        select 1
          from public.applications ap
         where ap.id = p_application_id
           and (
             ap.hiring_manager_user_id = auth.uid()
             or ap.assigned_agent_id = public.get_agent_id(auth.uid())
             or ap.referral_manager_id = public.get_agent_id(auth.uid())
             or ap.recruiter_id = public.get_agent_id(auth.uid())
             or ap.assigned_agent_id in (select a.id from public.agents a
                                          where a.invited_by_manager_id = public.get_agent_id(auth.uid()))
             or ap.referral_manager_id in (select a.id from public.agents a
                                            where a.invited_by_manager_id = public.get_agent_id(auth.uid()))
           )
      )
    )
  );
$function$;

-- A person may only be made the accountable owner if they can actually work the queue.
create or replace function public.is_recruiting_owner_eligible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.user_roles ur
      join auth.users au on au.id = ur.user_id
     where ur.user_id = p_user_id
       and ur.role::text in ('admin', 'manager', 'va', 'va_manager', 'recruiter')
  );
$function$;

-- ---------------------------------------------------------------- 5. the worklist row
-- One definition of the row the workspace renders. Both write RPCs return it, so the
-- queue and the profile refresh from the same response.
create or replace function public.recruiting_worklist_row(p_application_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', a.id,
    'first_name', a.first_name,
    'last_name', a.last_name,
    'email', a.email,
    'phone', a.phone,
    'state', a.state,
    'time_zone', a.time_zone,
    'time_zone_source', a.time_zone_source,
    'license_status', a.license_status,
    'license_progress', a.license_progress,
    'status', a.status,
    'next_step_stage_key', a.next_step_stage_key,
    'created_at', a.created_at,
    'assigned_agent_id', a.assigned_agent_id,
    'recruiting_owner_user_id', a.recruiting_owner_user_id,
    'last_contacted_at', a.last_contacted_at,
    'last_contact_outcome', a.last_contact_outcome,
    'last_contact_outcome_at', a.last_contact_outcome_at,
    'last_contact_channel', a.last_contact_channel,
    'next_action', a.next_action,
    'next_action_due_at', a.next_action_due_at,
    'next_action_set_at', a.next_action_set_at,
    'waiting_reason', a.waiting_reason,
    'next_review_at', a.next_review_at,
    'next_step_due_at', a.next_step_due_at,
    'phone_bad_at', a.phone_bad_at,
    'email_bad_at', a.email_bad_at,
    'sms_consent_given', a.sms_consent_given,
    'email_consent_given', a.email_consent_given,
    'do_not_contact_at', a.do_not_contact_at,
    'terminated_at', a.terminated_at,
    'is_duplicate', a.is_duplicate,
    'record_type', a.record_type
  )
  from public.applications a
  where a.id = p_application_id
    and public.can_work_recruiting_application(p_application_id);
$function$;

-- ---------------------------------------------------------------- 6. record an outcome
create or replace function public.record_recruiting_outcome(
  p_application_id uuid,
  p_outcome text,
  p_channel text,
  p_notes text default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_waiting_reason text default null,
  p_next_review_at timestamptz default null,
  p_owner_user_id uuid default null,
  p_expected_last_outcome_at timestamptz default null,
  p_check_conflict boolean default true,
  p_source_surface text default 'recruiting_worklist'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_app public.applications%rowtype;
  v_owner uuid;
  v_next_action text := nullif(btrim(coalesce(p_next_action, '')), '');
  v_waiting text := nullif(btrim(coalesce(p_waiting_reason, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_has_action boolean;
  v_has_wait boolean;
  v_closing boolean := p_outcome in ('not_interested', 'do_not_contact');
  v_log_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated: sign in before recording an outcome' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in (
    'no_answer', 'callback', 'interested', 'appointment_booked',
    'not_interested', 'wrong_number', 'do_not_contact'
  ) then
    raise exception 'invalid_outcome: % is not a recruiting contact outcome', coalesce(p_outcome, 'null')
      using errcode = '22023';
  end if;
  if p_channel is null or p_channel not in ('call', 'sms', 'email', 'in_person', 'manual') then
    raise exception 'invalid_channel: % is not a contact channel', coalesce(p_channel, 'null')
      using errcode = '22023';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found: no application %', p_application_id using errcode = 'P0002';
  end if;
  if not public.can_work_recruiting_application(p_application_id) then
    raise exception 'not_authorized: you cannot work this recruit' using errcode = '42501';
  end if;

  -- Conflicting staff updates: the caller states the last outcome it saw. If somebody
  -- else recorded one since, refuse instead of silently stacking a second contact.
  if coalesce(p_check_conflict, true)
     and v_app.last_contact_outcome_at is distinct from p_expected_last_outcome_at then
    raise exception 'conflict: another outcome (%) was recorded at % — reload before saving',
      coalesce(v_app.last_contact_outcome, 'unknown'), v_app.last_contact_outcome_at
      using errcode = '40001';
  end if;

  -- Suppression. Recording that the person asked not to be contacted is always allowed.
  if p_outcome <> 'do_not_contact' then
    if v_app.do_not_contact_at is not null then
      raise exception 'suppressed: this person asked not to be contacted' using errcode = 'P0001';
    end if;
    if p_channel in ('call', 'sms') and v_app.phone_bad_at is not null then
      raise exception 'suppressed: phone number is marked bad' using errcode = 'P0001';
    end if;
    if p_channel = 'sms' and v_app.sms_consent_given is false then
      raise exception 'suppressed: no SMS consent on file' using errcode = 'P0001';
    end if;
    if p_channel = 'email' and (
      v_app.email_consent_given is false
      or v_app.email_bad_at is not null
      or exists (select 1 from public.email_unsubscribes u
                  where lower(btrim(u.email)) = lower(btrim(coalesce(v_app.email, ''))))
    ) then
      raise exception 'suppressed: email is opted out, unsubscribed or bad' using errcode = 'P0001';
    end if;
  end if;

  -- Every open item needs a next action with a due time, or a waiting reason with a
  -- review date. Closing outcomes end the plan.
  v_has_action := v_next_action is not null and p_next_action_due_at is not null;
  v_has_wait := v_waiting is not null and p_next_review_at is not null;
  if not v_closing then
    if p_outcome in ('callback', 'appointment_booked') and not v_has_action then
      raise exception 'invalid_plan: % needs the next action and its date/time', p_outcome
        using errcode = '22023';
    end if;
    if not (v_has_action or v_has_wait) then
      raise exception 'invalid_plan: set a next action with a due time, or a waiting reason with a review date'
        using errcode = '22023';
    end if;
  end if;

  -- Owner: explicit choice, else keep the current owner, else the person doing the work.
  v_owner := coalesce(p_owner_user_id, v_app.recruiting_owner_user_id, v_uid);
  if v_owner is distinct from v_app.recruiting_owner_user_id and v_owner <> v_uid then
    if not (public.is_recruiting_staff() or public.has_role(v_uid, 'manager'::public.app_role)) then
      raise exception 'not_authorized: only recruiting staff can assign someone else' using errcode = '42501';
    end if;
  end if;
  if v_owner is distinct from v_app.recruiting_owner_user_id and v_owner <> v_uid
     and not public.is_recruiting_owner_eligible(v_owner) then
    raise exception 'invalid_owner: that user cannot work the recruiting queue' using errcode = '22023';
  end if;

  insert into public.application_contact_log (
    application_id, channel, outcome, contact_outcome, notes, logged_by, logged_at,
    next_action, next_action_due_at, waiting_reason, next_review_at, owner_user_id, source_surface
  ) values (
    p_application_id, p_channel, p_outcome, p_outcome, v_notes, v_uid, now(),
    case when p_outcome = 'do_not_contact' then null else v_next_action end,
    case when p_outcome = 'do_not_contact' then null else p_next_action_due_at end,
    case when p_outcome = 'do_not_contact' then null else v_waiting end,
    case when p_outcome = 'do_not_contact' then null else p_next_review_at end,
    v_owner, coalesce(nullif(btrim(coalesce(p_source_surface, '')), ''), 'recruiting_worklist')
  )
  returning id into v_log_id;

  update public.applications a
     set last_contacted_at = now(),
         last_contact_outcome = p_outcome,
         last_contact_outcome_at = now(),
         last_contact_outcome_by = v_uid,
         last_contact_channel = p_channel,
         recruiting_owner_user_id = v_owner,
         recruiting_owner_set_at = case when v_owner is distinct from v_app.recruiting_owner_user_id
                                        then now() else a.recruiting_owner_set_at end,
         recruiting_owner_set_by = case when v_owner is distinct from v_app.recruiting_owner_user_id
                                        then v_uid else a.recruiting_owner_set_by end,
         next_action = case when p_outcome = 'do_not_contact' then null else v_next_action end,
         next_action_due_at = case when p_outcome = 'do_not_contact' then null else p_next_action_due_at end,
         next_action_set_at = now(),
         next_action_set_by = v_uid,
         waiting_reason = case when p_outcome = 'do_not_contact' then null else v_waiting end,
         next_review_at = case when p_outcome = 'do_not_contact' then null else p_next_review_at end,
         phone_bad_at = case when p_outcome = 'wrong_number' then coalesce(a.phone_bad_at, now()) else a.phone_bad_at end,
         phone_bad_reason = case when p_outcome = 'wrong_number'
                                 then coalesce(a.phone_bad_reason, 'wrong number (recorded by staff)')
                                 else a.phone_bad_reason end,
         do_not_contact_at = case when p_outcome = 'do_not_contact' then coalesce(a.do_not_contact_at, now())
                                  else a.do_not_contact_at end,
         do_not_contact_by = case when p_outcome = 'do_not_contact' then coalesce(a.do_not_contact_by, v_uid)
                                  else a.do_not_contact_by end,
         do_not_contact_reason = case when p_outcome = 'do_not_contact' then coalesce(v_notes, a.do_not_contact_reason)
                                      else a.do_not_contact_reason end,
         sms_consent_given = case when p_outcome = 'do_not_contact' then false else a.sms_consent_given end,
         email_consent_given = case when p_outcome = 'do_not_contact' then false else a.email_consent_given end
   where a.id = p_application_id;

  -- Do-not-contact must also stop automated email, which reads email_unsubscribes.
  if p_outcome = 'do_not_contact' and nullif(btrim(coalesce(v_app.email, '')), '') is not null then
    insert into public.email_unsubscribes (email, reason, source, user_id)
    values (lower(btrim(v_app.email)), 'do_not_contact recorded by recruiting staff', 'recruiting_worklist', v_uid)
    on conflict (email) do nothing;
  end if;

  return public.recruiting_worklist_row(p_application_id)
         || jsonb_build_object('log_id', v_log_id);
end
$function$;

-- ---------------------------------------------------------------- 7. plan / owner / time zone
create or replace function public.set_recruiting_plan(
  p_application_id uuid,
  p_update_owner boolean default false,
  p_owner_user_id uuid default null,
  p_update_plan boolean default false,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_waiting_reason text default null,
  p_next_review_at timestamptz default null,
  p_time_zone text default null,
  p_notes text default null,
  p_expected_plan_set_at timestamptz default null,
  p_check_conflict boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_app public.applications%rowtype;
  v_next_action text := nullif(btrim(coalesce(p_next_action, '')), '');
  v_waiting text := nullif(btrim(coalesce(p_waiting_reason, '')), '');
  v_tz text := nullif(btrim(coalesce(p_time_zone, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_log_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated: sign in first' using errcode = '42501';
  end if;
  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'not_found: no application %', p_application_id using errcode = 'P0002';
  end if;
  if not public.can_work_recruiting_application(p_application_id) then
    raise exception 'not_authorized: you cannot work this recruit' using errcode = '42501';
  end if;
  if coalesce(p_check_conflict, true) and coalesce(p_update_plan, false)
     and v_app.next_action_set_at is distinct from p_expected_plan_set_at then
    raise exception 'conflict: the plan was changed at % — reload before saving', v_app.next_action_set_at
      using errcode = '40001';
  end if;

  if coalesce(p_update_owner, false) then
    if p_owner_user_id is distinct from v_uid
       and not (public.is_recruiting_staff() or public.has_role(v_uid, 'manager'::public.app_role)) then
      raise exception 'not_authorized: only recruiting staff can assign someone else' using errcode = '42501';
    end if;
    if p_owner_user_id is not null and p_owner_user_id <> v_uid
       and not public.is_recruiting_owner_eligible(p_owner_user_id) then
      raise exception 'invalid_owner: that user cannot work the recruiting queue' using errcode = '22023';
    end if;
  end if;

  if coalesce(p_update_plan, false) then
    if (v_next_action is null) <> (p_next_action_due_at is null) then
      raise exception 'invalid_plan: a next action needs a due time (and a due time needs an action)' using errcode = '22023';
    end if;
    if (v_waiting is null) <> (p_next_review_at is null) then
      raise exception 'invalid_plan: a waiting reason needs a review date (and a review date needs a reason)' using errcode = '22023';
    end if;
    if v_next_action is null and v_waiting is null
       and v_app.do_not_contact_at is null
       and coalesce(v_app.last_contact_outcome, '') <> 'not_interested' then
      raise exception 'invalid_plan: an open recruit needs a next action or a waiting reason' using errcode = '22023';
    end if;
  end if;

  if v_tz is not null and not exists (select 1 from pg_timezone_names z where z.name = v_tz) then
    raise exception 'invalid_time_zone: % is not an IANA time zone', v_tz using errcode = '22023';
  end if;

  update public.applications a
     set recruiting_owner_user_id = case when coalesce(p_update_owner, false) then p_owner_user_id
                                         else a.recruiting_owner_user_id end,
         recruiting_owner_set_at = case when coalesce(p_update_owner, false)
                                         and p_owner_user_id is distinct from a.recruiting_owner_user_id
                                        then now() else a.recruiting_owner_set_at end,
         recruiting_owner_set_by = case when coalesce(p_update_owner, false)
                                         and p_owner_user_id is distinct from a.recruiting_owner_user_id
                                        then v_uid else a.recruiting_owner_set_by end,
         next_action = case when coalesce(p_update_plan, false) then v_next_action else a.next_action end,
         next_action_due_at = case when coalesce(p_update_plan, false) then p_next_action_due_at else a.next_action_due_at end,
         waiting_reason = case when coalesce(p_update_plan, false) then v_waiting else a.waiting_reason end,
         next_review_at = case when coalesce(p_update_plan, false) then p_next_review_at else a.next_review_at end,
         next_action_set_at = case when coalesce(p_update_plan, false) then now() else a.next_action_set_at end,
         next_action_set_by = case when coalesce(p_update_plan, false) then v_uid else a.next_action_set_by end,
         time_zone = coalesce(v_tz, a.time_zone),
         time_zone_source = case when v_tz is not null then 'confirmed_by_staff' else a.time_zone_source end
   where a.id = p_application_id;

  -- Audit row. channel='note' with contact_outcome NULL: a plan change is never a contact.
  insert into public.application_contact_log (
    application_id, channel, outcome, contact_outcome, notes, logged_by, logged_at,
    next_action, next_action_due_at, waiting_reason, next_review_at, owner_user_id, source_surface
  ) values (
    p_application_id, 'note', 'plan_updated', null,
    concat_ws(' · ',
      case when coalesce(p_update_owner, false) then 'owner changed' end,
      case when coalesce(p_update_plan, false) then 'plan changed' end,
      case when v_tz is not null then 'time zone confirmed: ' || v_tz end,
      v_notes),
    v_uid, now(),
    case when coalesce(p_update_plan, false) then v_next_action end,
    case when coalesce(p_update_plan, false) then p_next_action_due_at end,
    case when coalesce(p_update_plan, false) then v_waiting end,
    case when coalesce(p_update_plan, false) then p_next_review_at end,
    case when coalesce(p_update_owner, false) then p_owner_user_id else v_app.recruiting_owner_user_id end,
    'recruiting_worklist'
  )
  returning id into v_log_id;

  return public.recruiting_worklist_row(p_application_id)
         || jsonb_build_object('log_id', v_log_id);
end
$function$;

-- ---------------------------------------------------------------- 8. staff directory
create or replace function public.recruiting_staff_directory()
returns table (user_id uuid, display_name text, roles text[])
language sql
stable
security definer
set search_path to 'public'
as $function$
  select ur.user_id,
         coalesce(nullif(btrim(p.full_name), ''), 'Staff member') as display_name,
         array_agg(distinct ur.role::text order by ur.role::text) as roles
    from public.user_roles ur
    join auth.users au on au.id = ur.user_id   -- user_roles holds orphan ids with no login
    left join public.profiles p on p.user_id = ur.user_id
   where ur.role::text in ('admin', 'manager', 'va', 'va_manager', 'recruiter')
     and (public.is_recruiting_staff() or public.has_role(auth.uid(), 'manager'::public.app_role))
   group by ur.user_id, p.full_name
   order by 2;
$function$;

-- ---------------------------------------------------------------- 9. protect human plans
create or replace function public.fn_protect_human_next_action()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Automation (no JWT, e.g. fn_run_applicant_nudges from pg_cron) may not overwrite a
  -- plan a person set. A person's write always moves next_action_set_at, so it passes.
  if auth.uid() is null
     and old.next_action_set_at is not null
     and new.next_action_set_at is not distinct from old.next_action_set_at then
    new.next_action := old.next_action;
    new.next_action_due_at := old.next_action_due_at;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_protect_human_next_action on public.applications;
create trigger trg_protect_human_next_action
  before update of next_action, next_action_due_at on public.applications
  for each row execute function public.fn_protect_human_next_action();

-- ---------------------------------------------------------------- 10. grants
revoke all on function public.record_recruiting_outcome(uuid, text, text, text, text, timestamptz, text, timestamptz, uuid, timestamptz, boolean, text) from public, anon;
grant execute on function public.record_recruiting_outcome(uuid, text, text, text, text, timestamptz, text, timestamptz, uuid, timestamptz, boolean, text) to authenticated;
revoke all on function public.set_recruiting_plan(uuid, boolean, uuid, boolean, text, timestamptz, text, timestamptz, text, text, timestamptz, boolean) from public, anon;
grant execute on function public.set_recruiting_plan(uuid, boolean, uuid, boolean, text, timestamptz, text, timestamptz, text, text, timestamptz, boolean) to authenticated;
revoke all on function public.recruiting_staff_directory() from public, anon;
grant execute on function public.recruiting_staff_directory() to authenticated;
revoke all on function public.recruiting_worklist_row(uuid) from public, anon;
grant execute on function public.recruiting_worklist_row(uuid) to authenticated;
revoke all on function public.is_recruiting_staff() from public, anon;
grant execute on function public.is_recruiting_staff() to authenticated;
revoke all on function public.can_work_recruiting_application(uuid) from public, anon;
grant execute on function public.can_work_recruiting_application(uuid) to authenticated;
revoke all on function public.is_recruiting_owner_eligible(uuid) from public, anon;
grant execute on function public.is_recruiting_owner_eligible(uuid) to authenticated;
