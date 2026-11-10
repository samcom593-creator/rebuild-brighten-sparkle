-- WP2 (onboarding audit 2026-11-10): unlicensed front door + applicant comms.
--
-- What this migration does, in order:
--   0. Snapshot every object it retires into ops_preimage_snapshots (and below, as comments).
--   1. Retire the roadmap queue: drop trg_calendly_for_unlicensed_ins/_upd and
--      fn_enqueue_calendly_for_unlicensed (the enqueue stops in the SAME migration that
--      settles the queue, or the settled set refills: 2-5 new rows a week, newest 11-10).
--   2. Settle the pending 'applicant-onboarding-v2' rows to a TERMINAL status. They are NOT
--      sent and NOT deleted. The roadmap content now lives in the day-0 email
--      (submit-application), which delivered the same steps with a Resend receipt to 67 of
--      the 72 the audit counted. Re-contact of anyone behind these rows is AUDIT.md S9, a
--      staged list for Sam, never this queue.
--      Status note: outreach_queue_status_check allows only
--      pending|sent|error|skipped|snoozed, so 'superseded' (the spec's word) would violate
--      the live CHECK constraint. 'skipped' is the existing terminal value; the reason is in
--      last_error = 'superseded_by_day0_email_2026-11'. Widening a shared table's CHECK was
--      rejected: other packages write terminal states to queue tables today and a
--      drop/recreate of the constraint would race them.
--   3. Point system_settings.licensing_support_call_url at the licensing call (was the
--      LICENSED prospect call, which auto-flips license_status on booking).
--   4. applications.course_proof_submitted_at + trg_licensing_proof_submitted: a proof upload
--      stamps the column forward-only and raises ONE private bot_alerts row per application.
--      It never stamps course_purchased_at / license_progress (an unverified image would fire
--      the milestone SMS/email triggers); WP1's review owns that.
--      Severity note: the spec said 'warn'. Measured 2026-11-10: warn rows are never
--      delivered. apex-alert-dispatch flush() selects celebrate+critical only; 3 of 3 warn
--      rows in 14d expired undelivered, and apex-morning-brief stamps warn rows sent_at
--      without rendering them (it reads bot_audits). A proof alert at 'warn' would reach
--      nobody, so it is raised at 'celebrate' (a buying signal; email + ntfy to Sam; the
--      dispatcher routes non-team events to the PRIVATE discord key only).
--   5. licensing_self_reports + fn_apply_licensing_self_report: exam booked / exam passed / NPN
--      from /status/:id, forward-only, labelled self_reported. Never sets license_status.
--   6. licensing_state_requirements (empty until Sam answers N1) + v_licensing_cost_public.
--   7. v_abandoned_partials_staged (staged for Sam, first name only) +
--      get_partial_application_resume(uuid) for the applicant-initiated /apply?resume=<id>.
--   8. v_course_proof_funnel guard view (apex-doctor drop-in 43).
--
-- ── PREIMAGE (live, read 2026-11-10 before this migration) ──────────────────────────────
-- CREATE TRIGGER trg_calendly_for_unlicensed_ins AFTER INSERT ON public.applications
--   FOR EACH ROW EXECUTE FUNCTION fn_enqueue_calendly_for_unlicensed()
-- CREATE TRIGGER trg_calendly_for_unlicensed_upd AFTER UPDATE OF license_status, email ON public.applications
--   FOR EACH ROW WHEN (((new.license_status IS DISTINCT FROM old.license_status) OR (new.email IS DISTINCT FROM old.email)))
--   EXECUTE FUNCTION fn_enqueue_calendly_for_unlicensed()
-- system_settings.licensing_support_call_url = 'https://calendly.com/apexfinancialempire/licensed-prospect-call-clone'
-- outreach_queue template_key='applicant-onboarding-v2': 73 rows, all status='pending',
--   attempt_count 0, no provider_message_id, oldest 2026-08-29. Ids + application ids are
--   in ops_preimage_snapshots (reason 'wp2_front_door_20261111100100').
-- CREATE OR REPLACE FUNCTION public.fn_enqueue_calendly_for_unlicensed()
--  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- declare
--   v_calendly_url text; v_slack_url text; v_discord_url text; v_first_name text; v_html text;
-- begin
--   if new.email is null or new.email = '' or position('@' in new.email) = 0 then return new; end if;
--   if new.license_status is not null and lower(new.license_status::text) <> 'unlicensed' then return new; end if;
--   select value into v_calendly_url from public.system_settings where key = 'licensing_support_call_url' limit 1;
--   v_calendly_url := coalesce(nullif(trim(both '"' from v_calendly_url), ''),
--     'https://calendly.com/apexfinancialempire/licensed-prospect-call-clone');
--   select value into v_slack_url from public.system_settings where key = 'slack_community_invite_url' limit 1;
--   v_slack_url := coalesce(nullif(trim(both '"' from v_slack_url), ''), '<slack shared invite>');
--   select value into v_discord_url from public.system_settings where key = 'discord_invite_url' limit 1;
--   v_discord_url := coalesce(nullif(trim(both '"' from v_discord_url), ''), 'https://discord.gg/JpUWA73UZX');
--   v_first_name := split_part(coalesce(new.first_name, 'there'), ' ', 1);
--   v_html := '<!doctype html>... "Hey <first>, here is your licensing roadmap" ... 6 steps:
--     Join the APEX Slack / Join the APEX Discord / Create your XCEL account (legal name on ID) /
--     Complete pre-licensing training / Update your APEX roadmap at milestones /
--     Add your NPN and book onboarding after your license posts;
--     buttons: Join Team Slack, Join APEX Discord, Create XCEL Account (partners.xcelsolutions.com/afe),
--     Open My APEX Roadmap (/get-licensed), Book a Licensing Support Call (v_calendly_url) ...';
--     (full HTML text is in ops_preimage_snapshots.payload->'fn_enqueue_calendly_for_unlicensed')
--   insert into public.outreach_queue (channel, source_run, application_id, to_email, subject,
--     template_key, html_body, status, scheduled_for, idempotency_key)
--   values ('email', 'applicant-onboarding', new.id, new.email,
--     'Your APEX licensing roadmap and account setup', 'applicant-onboarding-v2', v_html, 'pending', now(),
--     'applicant-onboarding-v2-' || new.id::text)
--   on conflict (idempotency_key) do nothing;
--   return new;
-- end;
-- $function$
-- ────────────────────────────────────────────────────────────────────────────────────────

-- 0. Preimage snapshot (once).
insert into public.ops_preimage_snapshots (reason, payload)
select 'wp2_front_door_20261111100100',
       jsonb_build_object(
         'fn_enqueue_calendly_for_unlicensed',
           (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'fn_enqueue_calendly_for_unlicensed' limit 1),
         'triggers',
           (select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t
             where t.tgname in ('trg_calendly_for_unlicensed_ins', 'trg_calendly_for_unlicensed_upd')),
         'licensing_support_call_url',
           (select value from public.system_settings where key = 'licensing_support_call_url'),
         'roadmap_rows',
           (select jsonb_agg(jsonb_build_object('id', q.id, 'application_id', q.application_id, 'status', q.status,
                    'created_at', q.created_at, 'attempt_count', q.attempt_count, 'last_error', q.last_error,
                    'provider_message_id', q.provider_message_id) order by q.created_at)
              from public.outreach_queue q
             where q.template_key = 'applicant-onboarding-v2' and q.status = 'pending')
       )
where not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp2_front_door_20261111100100');

-- 1. Stop the enqueue.
drop trigger if exists trg_calendly_for_unlicensed_ins on public.applications;
drop trigger if exists trg_calendly_for_unlicensed_upd on public.applications;
drop function if exists public.fn_enqueue_calendly_for_unlicensed();

-- 2. Settle the queue to a terminal status. Not sent, not deleted.
update public.outreach_queue
   set status = 'skipped',
       last_error = 'superseded_by_day0_email_2026-11',
       error_message = coalesce(error_message, 'superseded_by_day0_email_2026-11')
 where template_key = 'applicant-onboarding-v2'
   and status = 'pending'
   and sent_at is null
   and provider_message_id is null;

-- 3. The roadmap/support-call setting points at the licensing call, not the licensed call.
update public.system_settings
   set value = 'https://calendly.com/apexfinancialempire/licensing-call', updated_at = now()
 where key = 'licensing_support_call_url';
insert into public.system_settings (key, value)
select 'licensing_support_call_url', 'https://calendly.com/apexfinancialempire/licensing-call'
where not exists (select 1 from public.system_settings where key = 'licensing_support_call_url');

-- Forward-only anchor: every WP2 guard operand counts only rows after this instant.
insert into public.system_settings (key, value)
select 'wp2_front_door_cutoff', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
where not exists (select 1 from public.system_settings where key = 'wp2_front_door_cutoff');

-- 4. Proof submission side effects.
alter table public.applications add column if not exists course_proof_submitted_at timestamptz;
comment on column public.applications.course_proof_submitted_at is
  'WP2: first course-receipt upload (licensing_course_proofs). Unverified. Never implies course_purchased_at; WP1 review/Xcel match owns that.';

create or replace function public.fn_on_licensing_proof_submitted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_first text;
begin
  begin
    -- Forward-only: only the FIRST proof for an application stamps and alerts. A re-upload
    -- is visible in the review panel and does not page again.
    update public.applications
       set course_proof_submitted_at = coalesce(new.submitted_at, now())
     where id = new.application_id
       and course_proof_submitted_at is null
    returning split_part(coalesce(nullif(trim(first_name), ''), 'An applicant'), ' ', 1) into v_first;

    if v_first is not null then
      insert into public.bot_alerts (source, event_type, severity, subject, body, action_link, channels)
      values (
        'trigger',
        'course_proof_submitted',
        'celebrate',
        format('Course receipt uploaded: %s', v_first),
        format('<p><strong>%s</strong> uploaded a course receipt on their status page. It is unverified until someone reviews it.</p><p><a href="https://apex-financial.org/dashboard/prelicensing?application=%s">Review it in Pre-Licensing</a></p>',
               v_first, new.application_id),
        format('https://apex-financial.org/dashboard/prelicensing?application=%s', new.application_id),
        array['email', 'ntfy']::text[]
      );
    end if;
  exception when others then
    -- Never roll back the upload because the stamp or the alert failed.
    raise warning 'fn_on_licensing_proof_submitted: % (%)', sqlerrm, sqlstate;
  end;
  return new;
end;
$$;
revoke all on function public.fn_on_licensing_proof_submitted() from public, anon, authenticated;

drop trigger if exists trg_licensing_proof_submitted on public.licensing_course_proofs;
create trigger trg_licensing_proof_submitted
  after insert on public.licensing_course_proofs
  for each row execute function public.fn_on_licensing_proof_submitted();

-- 5. Exam self-report.
create table if not exists public.licensing_self_reports (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  kind text not null check (kind in ('exam_scheduled', 'exam_passed', 'npn')),
  exam_date date,
  npn text check (npn is null or npn ~ '^[0-9]{5,10}$'),
  source text not null default 'self_reported',
  applied jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists lsr_application_idx on public.licensing_self_reports (application_id, created_at desc);
comment on table public.licensing_self_reports is
  'WP2: applicant self-reports from /status/:id (exam booked, exam passed, NPN). Unverified by definition. applied = what the trigger actually stamped on applications.';

alter table public.licensing_self_reports enable row level security;
drop policy if exists lsr_staff_read on public.licensing_self_reports;
create policy lsr_staff_read on public.licensing_self_reports for select to authenticated
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role) or public.has_role(auth.uid(), 'va_manager'::app_role));
revoke all on public.licensing_self_reports from anon;
grant select on public.licensing_self_reports to authenticated;

create or replace function public.fn_apply_licensing_self_report()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_app public.applications%rowtype;
  v_applied jsonb := '{}'::jsonb;
  v_target public.license_progress;
begin
  select * into v_app from public.applications where id = new.application_id;
  if not found then
    raise exception 'licensing_self_report: no application %', new.application_id using errcode = 'foreign_key_violation';
  end if;
  new.source := 'self_reported';

  begin
    if new.kind = 'exam_scheduled' then
      v_target := 'test_scheduled';
      update public.applications a
         set exam_scheduled_at = coalesce(a.exam_scheduled_at, now()),
             test_scheduled_date = coalesce(a.test_scheduled_date, new.exam_date),
             license_progress = case
               when public.fn_license_stage_rank(coalesce(a.license_progress, 'unlicensed')) < public.fn_license_stage_rank(v_target)
               then v_target else a.license_progress end
       where a.id = new.application_id;
      v_applied := jsonb_build_object(
        'exam_scheduled_at', v_app.exam_scheduled_at is null,
        'test_scheduled_date', v_app.test_scheduled_date is null and new.exam_date is not null,
        'license_progress', case when public.fn_license_stage_rank(coalesce(v_app.license_progress, 'unlicensed')) < public.fn_license_stage_rank(v_target)
                                 then v_target::text else null end);

    elsif new.kind = 'exam_passed' then
      v_target := 'passed_test';
      update public.applications a
         set exam_passed_at = coalesce(a.exam_passed_at, now()),
             license_progress = case
               when public.fn_license_stage_rank(coalesce(a.license_progress, 'unlicensed')) < public.fn_license_stage_rank(v_target)
               then v_target else a.license_progress end
       where a.id = new.application_id;
      v_applied := jsonb_build_object(
        'exam_passed_at', v_app.exam_passed_at is null,
        'license_progress', case when public.fn_license_stage_rank(coalesce(v_app.license_progress, 'unlicensed')) < public.fn_license_stage_rank(v_target)
                                 then v_target::text else null end);

    elsif new.kind = 'npn' then
      -- Store the NPN only if none is on file. Never touches license_status.
      update public.applications a
         set nipr_number = new.npn
       where a.id = new.application_id
         and nullif(trim(coalesce(a.nipr_number, '')), '') is null
         and new.npn is not null;
      v_applied := jsonb_build_object('nipr_number', nullif(trim(coalesce(v_app.nipr_number, '')), '') is null and new.npn is not null);
    end if;
  exception when others then
    -- Record the report even if a downstream trigger refused the stamp; applied says so.
    v_applied := jsonb_build_object('error', sqlstate || ': ' || left(sqlerrm, 200));
  end;

  new.applied := v_applied;
  return new;
end;
$$;
revoke all on function public.fn_apply_licensing_self_report() from public, anon, authenticated;

drop trigger if exists trg_apply_licensing_self_report on public.licensing_self_reports;
create trigger trg_apply_licensing_self_report
  before insert on public.licensing_self_reports
  for each row execute function public.fn_apply_licensing_self_report();

-- 6. One cost source, empty until Sam answers N1.
create table if not exists public.licensing_state_requirements (
  state text primary key check (state ~ '^[A-Z]{2}$'),
  course_price_usd numeric(8, 2),
  exam_fee_usd numeric(8, 2),
  fingerprint_fee_usd numeric(8, 2),
  license_fee_usd numeric(8, 2),
  exam_vendor text,
  exam_vendor_url text,
  fingerprint_vendor text,
  notes text,
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.licensing_state_requirements is
  'WP2: per-state licensing costs + vendors. Seeded by Sam (N1). Rows render publicly only when is_active.';
alter table public.licensing_state_requirements enable row level security;
drop policy if exists lsreq_public_read on public.licensing_state_requirements;
create policy lsreq_public_read on public.licensing_state_requirements for select to anon, authenticated
  using (is_active);
drop policy if exists lsreq_admin_all on public.licensing_state_requirements;
create policy lsreq_admin_all on public.licensing_state_requirements for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());
grant select on public.licensing_state_requirements to anon, authenticated;

create or replace view public.v_licensing_cost_public with (security_invoker = true) as
select r.state,
       r.course_price_usd,
       r.exam_fee_usd,
       r.fingerprint_fee_usd,
       r.license_fee_usd,
       coalesce(r.course_price_usd, 0) + coalesce(r.exam_fee_usd, 0)
         + coalesce(r.fingerprint_fee_usd, 0) + coalesce(r.license_fee_usd, 0) as total_usd,
       r.exam_vendor,
       r.exam_vendor_url,
       r.fingerprint_vendor,
       r.updated_at
  from public.licensing_state_requirements r
 where r.is_active;
grant select on public.v_licensing_cost_public to anon, authenticated;

-- 7. Abandoned partials: staged for Sam (first name, step, age; no contact fields).
create or replace view public.v_abandoned_partials_staged with (security_invoker = true) as
with latest as (
  select distinct on (lower(trim(p.email)))
         p.id as partial_id,
         lower(trim(p.email)) as email_key,
         p.first_name,
         p.step_completed,
         p.form_data ->> 'licenseStatus' as license_status_claimed,
         coalesce(p.updated_at, p.created_at) as last_seen_at,
         (p.recovery_email_sent_at is not null or p.recovery_sms_sent_at is not null) as previously_nudged
    from public.partial_applications p
   where p.email is not null
     and position('@' in p.email) > 1
     and p.converted_at is null
     and coalesce(p.step, '') <> 'inbound_dm'
     and coalesce(p.updated_at, p.created_at) between now() - interval '30 days' and now() - interval '2 hours'
   order by lower(trim(p.email)), coalesce(p.updated_at, p.created_at) desc
)
select l.partial_id,
       split_part(coalesce(nullif(trim(l.first_name), ''), '(no name)'), ' ', 1) as first_name,
       l.step_completed as step_reached,
       l.license_status_claimed,
       round(extract(epoch from (now() - l.last_seen_at)) / 3600.0)::int as age_hours,
       l.previously_nudged,
       '/apply?resume=' || l.partial_id::text as resume_path
  from latest l
 where not exists (
   select 1 from public.applications a where lower(trim(a.email)) = l.email_key
 );
revoke all on public.v_abandoned_partials_staged from anon;
grant select on public.v_abandoned_partials_staged to authenticated;
comment on view public.v_abandoned_partials_staged is
  'WP2 staged list (AUDIT S10): one row per distinct email that started /apply 2h-30d ago and never applied. Sam approves any contact; nothing sends from here.';

-- Applicant-initiated resume: returns only that row's own form fields, only while it is an
-- open (unconverted, < 30 days) partial. Never ip/user_agent.
create or replace function public.get_partial_application_resume(p_partial_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
           'firstName', p.first_name,
           'lastName', p.last_name,
           'email', p.email,
           'phone', p.phone,
           'city', p.city,
           'state', p.state,
           'stepCompleted', p.step_completed,
           'hasInsuranceExperience', p.form_data -> 'hasInsuranceExperience',
           'yearsExperience', p.form_data -> 'yearsExperience',
           'previousCompany', p.form_data ->> 'previousCompany',
           'licenseStatus', p.form_data ->> 'licenseStatus',
           'instagramHandle', p.form_data ->> 'instagramHandle',
           'availability', p.form_data ->> 'availability')
    from public.partial_applications p
   where p.id = p_partial_id
     and p.converted_at is null
     and coalesce(p.step, '') <> 'inbound_dm'
     and coalesce(p.updated_at, p.created_at) > now() - interval '30 days'
$$;
revoke all on function public.get_partial_application_resume(uuid) from public;
grant execute on function public.get_partial_application_resume(uuid) to anon, authenticated, service_role;

-- 8. Guard view for apex-doctor drop-in 43. Exactly one row in every state (scalar subqueries).
create or replace view public.v_course_proof_funnel with (security_invoker = true) as
with cutoff as (
  select coalesce(
           (select nullif(value, '')::timestamptz from public.system_settings where key = 'wp2_front_door_cutoff'),
           now()) as at
)
select
  (select count(*) from public.applications a
    where a.created_at > now() - interval '14 days'
      and coalesce(a.record_type, 'application') = 'application'
      and not coalesce(a.is_duplicate, false)
      and a.license_status::text = 'unlicensed')::int as unlicensed_apps_14d,
  (select count(distinct p.application_id) from public.licensing_course_proofs p
    where p.submitted_at > now() - interval '14 days')::int as proofs_14d,
  (select count(*) from public.interview_events e
    where e.created_at > now() - interval '14 days'
      and e.canceled_at is null
      and (e.event_type_name ilike '%licensing call%' or e.call_track = 'licensing'))::int as licensing_call_bookings_14d,
  (select count(*) from public.licensing_self_reports s
    where s.created_at > now() - interval '14 days')::int as self_reports_14d,
  -- A first proof (after the cutoff, > 5 min old) whose application never got the stamp or the alert.
  (select count(*) from (
     select distinct on (p.application_id) p.application_id, p.submitted_at
       from public.licensing_course_proofs p
      order by p.application_id, p.submitted_at asc) fp, cutoff c
    where fp.submitted_at > c.at
      and fp.submitted_at < now() - interval '5 minutes'
      and (not exists (select 1 from public.applications a where a.id = fp.application_id and a.course_proof_submitted_at is not null)
           or not exists (select 1 from public.bot_alerts b
                           where b.event_type = 'course_proof_submitted'
                             and b.action_link like '%application=' || fp.application_id::text)))::int as proofs_without_alert,
  -- An alert that exists but never reached Sam within an hour (expired counts as undelivered).
  (select count(*) from public.bot_alerts b, cutoff c
    where b.event_type = 'course_proof_submitted'
      and b.created_at > c.at
      and b.created_at < now() - interval '1 hour'
      and b.sent_at is null)::int as proof_alerts_undelivered_1h,
  (select count(*) from public.outreach_queue q
    where q.template_key = 'applicant-onboarding-v2' and q.status = 'pending')::int as roadmap_rows_pending,
  (select count(*) from pg_trigger t
    where t.tgname like 'trg_calendly_for_unlicensed%')::int as roadmap_triggers_live,
  (select c.at from cutoff c) as cutoff_at,
  -- The WARN operand: only applicants who applied AFTER the gate + day-0 email shipped can
  -- be expected to have uploaded a receipt or booked the licensing call. Grading the raw 14d
  -- count would warn about people who never saw the path.
  (select count(*) from public.applications a, cutoff c
    where a.created_at > greatest(now() - interval '14 days', c.at)
      and coalesce(a.record_type, 'application') = 'application'
      and not coalesce(a.is_duplicate, false)
      and a.license_status::text = 'unlicensed')::int as unlicensed_apps_post_cutoff_14d;
revoke all on public.v_course_proof_funnel from anon;
grant select on public.v_course_proof_funnel to authenticated;
comment on view public.v_course_proof_funnel is
  'WP2 guard (apex-doctor 43). CRITICAL: proofs_without_alert>0, proof_alerts_undelivered_1h>0, roadmap_rows_pending>0 or roadmap_triggers_live>0. WARN: unlicensed_apps_post_cutoff_14d>=5 with 0 proofs and 0 licensing-call bookings in 14d.';
