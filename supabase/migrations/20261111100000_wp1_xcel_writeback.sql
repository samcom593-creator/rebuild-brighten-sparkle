-- WP1 onboarding (2026-11-10): Xcel write-back, identity matching, course-proof review.
--
-- The IMAP launchd ingest (business-ops/scripts/apex-xcel-ingest.py) lands a fresh
-- Xcel report every morning into xcel_pre_licensing_reports/_students, and nothing
-- ever wrote it back: the only promoter (cron 64 -> fn_xcel_auto_upgrade_all) reads
-- the CSV-era xcel_events table (dead since 2026-07-07) through a view gated on
-- auth.uid(), so it no-ops 96 times a day. Matching was exact-email, once, at insert.
--
-- This migration:
--   1. matches every historic student identity (lower(btrim(email))) to an
--      application or an agent: email -> application, email -> profile -> agent,
--      phone -> exactly one application, name within +/-90 days -> exactly one
--      application. Every link is labelled (match_method) and never overwritten
--      by the matcher; staff links/unlinks win and stick.
--   2. stamps progress forward-only: course_purchased_at, course_started_at and
--      license_progress up to 'finished_course' at most. Never license_status,
--      never past finished_course, never on an already-licensed application.
--   3. FORWARD-ONLY MESSAGING. system_settings.xcel_writeback_messages_from holds
--      the deploy instant. An Xcel event dated on/before that day (or older than
--      14 days) is applied with apex.xcel_backfill=on, which the milestone
--      reactions (recruit SMS outbox, Sam SMS/email, team Slack/Discord queue,
--      staff inbox, Telegram pipeline post) now honour as their first statement.
--      Next-step nudges that a history-driven stage entry would otherwise trigger
--      (fn_next_step_nudge_sweep is WP3's) are pre-empted with failed_at
--      'suppressed:' rows on their dedupe keys. Only events dated after the cutoff
--      day reach a person.
--   4. auto-verifies course proofs whose application matches an Xcel student, and
--      adds admin/manager RPCs to link students and review proofs.
--   5. retires crons 64 and 38 (preimages below), keeps 94 (it drains the
--      outbox this write-back feeds), and ships guard views for apex-doctor #42.
--
-- PREIMAGES (for reversal: cron.schedule(jobname, schedule, command))
--   cron 64 xcel_auto_upgrade_stages  schedule '13-59/15 * * * *'  active=true  user postgres
--     command: SELECT fn_xcel_auto_upgrade_all()
--   cron 38 pl091_xcel_gmail_pull     schedule '27-59/30 * * * *'  active=true  user postgres
--     command:
--       SELECT net.http_post(
--         url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/xcel-gmail-pull',
--         headers := jsonb_build_object(
--           'Content-Type','application/json',
--           'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)
--         ),
--         body := '{}'::jsonb
--       ) AS request_id;
--   (setting app.settings.service_role_key is NULL, so every fire 503s; Gmail OAuth
--    path is retired on purpose: do not restore it.)
--   The five redefined trigger functions below are the live pg_get_functiondef text
--   of 2026-11-10 with ONE line added after the top-level BEGIN (the backfill guard).
--   To reverse, delete that line. Full live text is also in ops_preimage_snapshots
--   (reason 'wp1_xcel_writeback_preimage').
--   fn_match_xcel_students() is REPLACED (same signature, same integer return, same
--   admin/manager gate, still called by src/components/admin/XcelIngestDialog.tsx).
--   The old body also wrote license_progress with no backfill guard and could move
--   a 'passed_test' application BACK to 'finished_course'; progress now belongs to
--   fn_apply_xcel_progress alone. Old body: comment block above section 5.


-- ---------------------------------------------------------------------------
-- 0. Preimage snapshot (idempotent: one row per reason)
-- ---------------------------------------------------------------------------
insert into public.ops_preimage_snapshots (reason, payload)
select 'wp1_xcel_writeback_preimage',
       jsonb_build_object(
         'crons', (select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb)
                     from (select jobid, jobname, schedule, command, active, username, database
                             from cron.job
                            where jobname in ('xcel_auto_upgrade_stages', 'pl091_xcel_gmail_pull')) j),
         'functions', (select coalesce(jsonb_object_agg(p.proname, pg_get_functiondef(p.oid)), '{}'::jsonb)
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname in ('fn_license_milestone_emit', 'notify_sam_on_licensing_milestone',
                                            'fn_capture_application_licensing_milestone',
                                            'fn_application_milestone_broadcast', 'trg_fn_inbox_license_milestone',
                                            'fn_match_xcel_students')
                          and pg_get_functiondef(p.oid) not like '%apex.xcel_backfill%'
                          and pg_get_functiondef(p.oid) not like '%WP1 matcher%'))
where not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp1_xcel_writeback_preimage');

-- ---------------------------------------------------------------------------
-- 1. Forward-only cutoff. Kept on re-apply (on conflict do nothing).
-- ---------------------------------------------------------------------------
insert into public.system_settings (key, value)
values ('xcel_writeback_messages_from', now()::text)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Identity columns + audit log
-- ---------------------------------------------------------------------------
alter table public.xcel_pre_licensing_students
  add column if not exists match_method text,
  add column if not exists matched_agent_id uuid references public.agents(id) on delete set null;

comment on column public.xcel_pre_licensing_students.match_method is
  'WP1: how this identity was linked. email_ingest (legacy insert-time exact email), email_app, email_agent, phone_app, name_window (auto, unlinkable), staff_link / staff_unlinked (a human decided; the matcher never overrides).';

update public.xcel_pre_licensing_students
   set match_method = 'email_ingest'
 where application_id is not null and match_method is null;

create index if not exists xcel_stu_email_key_idx
  on public.xcel_pre_licensing_students (lower(btrim(email)));

-- licensing_milestone_events.source gains 'xcel' (additive).
-- PREIMAGE: CHECK ((source = ANY (ARRAY['application_progress'::text, 'agent_update'::text, 'admin'::text, 'import'::text])))
alter table public.licensing_milestone_events drop constraint if exists licensing_milestone_events_source_check;
alter table public.licensing_milestone_events add constraint licensing_milestone_events_source_check
  check (source = any (array['application_progress'::text, 'agent_update'::text, 'admin'::text, 'import'::text, 'xcel'::text]));

create table if not exists public.xcel_writeback_log (
  id             bigserial primary key,
  applied_at     timestamptz not null default now(),
  report_id      uuid,
  application_id uuid,
  agent_id       uuid,
  field          text not null,
  old_value      text,
  new_value      text,
  mode           text not null check (mode in ('backfill', 'fresh', 'staff')),
  event_on       date
);
comment on table public.xcel_writeback_log is
  'WP1: one row per field the Xcel write-back (or a staff proof verify) changed. old_value is the preimage. mode backfill = applied silently (event on/before the forward-only cutoff day or older than 14 days).';
create index if not exists xcel_writeback_log_app_idx on public.xcel_writeback_log (application_id);
create index if not exists xcel_writeback_log_applied_idx on public.xcel_writeback_log (applied_at desc);
alter table public.xcel_writeback_log enable row level security;
drop policy if exists xcel_writeback_log_staff_read on public.xcel_writeback_log;
create policy xcel_writeback_log_staff_read on public.xcel_writeback_log
  for select to authenticated
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role));
revoke all on public.xcel_writeback_log from anon, public;
grant select on public.xcel_writeback_log to authenticated;
grant all on public.xcel_writeback_log to service_role;

-- ---------------------------------------------------------------------------
-- 3. One row per student identity (internal; staff views and the health view
--    read through it). Not granted to anon or authenticated.
-- ---------------------------------------------------------------------------
create or replace view public.v_xcel_identity_rollup as
with r as (
  select lower(btrim(s.email)) as email_key, s.id, s.first_name, s.last_name,
         s.application_id, s.matched_agent_id, s.match_method,
         s.date_enrolled, s.last_log_in, s.date_completed, s.pct_complete, s.time_spent_minutes,
         s.hiring_manager_name, s.course_name, s.created_at, rep.report_date
    from public.xcel_pre_licensing_students s
    join public.xcel_pre_licensing_reports rep on rep.id = s.report_id
   where nullif(btrim(s.email), '') is not null
), g as (
  select email_key,
         (array_agg(id order by report_date desc, created_at desc))[1] as student_id,
         (array_agg(btrim(first_name) order by report_date desc, created_at desc)
            filter (where nullif(btrim(first_name), '') is not null))[1] as first_name,
         (array_agg(upper(left(btrim(last_name), 1)) order by report_date desc, created_at desc)
            filter (where nullif(btrim(last_name), '') is not null))[1] as last_initial,
         (array_agg(application_id order by report_date desc, created_at desc)
            filter (where application_id is not null))[1] as application_id,
         (array_agg(matched_agent_id order by report_date desc, created_at desc)
            filter (where matched_agent_id is not null))[1] as matched_agent_id,
         (array_agg(match_method order by report_date desc, created_at desc)
            filter (where match_method is not null))[1] as match_method,
         coalesce(bool_or(match_method = 'staff_unlinked'), false) as staff_unlinked,
         min(date_enrolled) as enrolled_on,
         min(coalesce(last_log_in, date_enrolled))
           filter (where coalesce(pct_complete, 0) > 0 or coalesce(time_spent_minutes, 0) > 0) as started_on,
         min(coalesce(date_completed, last_log_in, report_date))
           filter (where coalesce(pct_complete, 0) >= 100 or date_completed is not null) as completed_on,
         max(last_log_in) as last_log_in,
         max(greatest(date_enrolled, last_log_in, date_completed)) as last_activity_on,
         (array_agg(pct_complete order by report_date desc, pct_complete desc nulls last))[1] as latest_pct,
         (array_agg(btrim(hiring_manager_name) order by report_date desc, created_at desc)
            filter (where nullif(btrim(hiring_manager_name), '') is not null))[1] as hiring_manager_name,
         (array_agg(course_name order by report_date desc, created_at desc)
            filter (where course_name is not null))[1] as course_name,
         max(report_date) as last_seen_report,
         min(created_at) as first_seen_at
    from r
   group by email_key
)
select g.*,
       (g.application_id is not null or g.matched_agent_id is not null) as is_linked,
       (g.last_activity_on >= (now() at time zone 'America/Phoenix')::date - 60
        or g.last_seen_report >= (now() at time zone 'America/Phoenix')::date - 14) as is_active
  from g;

comment on view public.v_xcel_identity_rollup is
  'WP1 internal: one row per Xcel student identity (lower(btrim(email))). Holds contact-free progress facts. Not granted to anon/authenticated; staff read it through gated views.';
revoke all on public.v_xcel_identity_rollup from anon, authenticated, public;
grant select on public.v_xcel_identity_rollup to service_role;

-- ---------------------------------------------------------------------------
-- 4. Backfill guard on the five milestone reactions (live text + one line).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_license_milestone_emit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template public.license_milestone_templates%ROWTYPE;
  v_phone    text;
  v_body     text;
BEGIN
  -- WP1 (20261111100000): historic Xcel write-back runs with apex.xcel_backfill=on.
  -- A milestone that happened before the forward-only cutoff is history, not news:
  -- no recruit SMS, no Sam SMS/email, no team post, no inbox item.
  IF current_setting('apex.xcel_backfill', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.license_progress IS NULL OR NEW.license_progress = OLD.license_progress THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_template
    FROM public.license_milestone_templates
   WHERE template_key = NEW.license_progress::text AND is_active = true
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_phone := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone) < 10 THEN
    INSERT INTO public.license_milestone_outbox
      (application_id, prev_progress, new_progress, to_phone, template_key, rendered_body, status, last_error)
    VALUES
      (NEW.id, OLD.license_progress::text, NEW.license_progress::text, NEW.phone, NEW.license_progress::text, '', 'skipped', 'phone_too_short');
    RETURN NEW;
  END IF;
  v_body := replace(v_template.body, '{first_name}', COALESCE(NEW.first_name, 'there'));
  INSERT INTO public.license_milestone_outbox
    (application_id, prev_progress, new_progress, to_phone, template_key, rendered_body)
  VALUES
    (NEW.id, OLD.license_progress::text, NEW.license_progress::text, NEW.phone, NEW.license_progress::text, v_body);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_sam_on_licensing_milestone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_email_key text;
  v_label text;
  v_sms text;
  v_html text;
  v_name text;
BEGIN
  -- WP1 (20261111100000): historic Xcel write-back runs with apex.xcel_backfill=on.
  -- A milestone that happened before the forward-only cutoff is history, not news:
  -- no recruit SMS, no Sam SMS/email, no team post, no inbox item.
  IF current_setting('apex.xcel_backfill', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.license_progress IS NOT DISTINCT FROM OLD.license_progress THEN RETURN NEW; END IF;

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='service_role_key';
  -- PL-WIB-PG-ANON-BEARER: every leg presents the service key. The anon JWT in
  -- system_settings is refused by the gateway (401 UNAUTHORIZED_LEGACY_JWT,
  -- measured 2026-10-09), and the service key passes verify_jwt=true there.
  SELECT value INTO v_email_key FROM public.system_settings WHERE key='service_role_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  v_name := COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'');

  v_label := CASE NEW.license_progress::text
    WHEN 'course_purchased'    THEN '📚 Started course'
    WHEN 'finished_course'     THEN '🎓 Finished course — schedule exam'
    WHEN 'test_scheduled'      THEN '🗓️ Exam scheduled'
    WHEN 'passed_test'         THEN '🔥 PASSED exam — fingerprints next'
    WHEN 'fingerprints_done'   THEN '🖐️ Fingerprints done — waiting on state'
    WHEN 'waiting_on_license'  THEN '⏳ State processing license'
    WHEN 'licensed'            THEN '✅ LICENSED — field-ready'
    ELSE NULL
  END;

  IF v_label IS NULL THEN RETURN NEW; END IF;

  v_sms := format('APEX %s: %s (%s)', v_label, v_name, COALESCE(NEW.state,''));
  v_html := format(
    '<p><strong>%s</strong></p><p>%s</p><p>Email: %s<br/>Phone: %s<br/>State: %s</p><p>Open: <a href="https://apex-financial.org/dashboard/hiring-pipeline">Hiring Pipeline</a></p>',
    v_label, v_name, COALESCE(NEW.email,'—'), COALESCE(NEW.phone,'—'), COALESCE(NEW.state,'—'));

  IF v_svc_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-sms-auto-detect',
      body := jsonb_build_object('phone','4697676068','message', v_sms),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-admin-email',
      body := jsonb_build_object(
        'to','info@kingofsales.net',
        'subject', format('%s — %s', v_label, v_name),
        'html', v_html),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_email_key,'apikey', v_email_key));
  END IF;

  INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, channels, sent_at)
  VALUES ('trigger', 'licensing_milestone', 'info',
          format('%s — %s', v_label, v_name), v_sms,
          ARRAY['sms','email']::text[], now());

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_capture_application_licensing_milestone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_milestone text;
  v_agent_id uuid;
begin
  -- WP1 (20261111100000): historic Xcel write-back runs with apex.xcel_backfill=on.
  -- A milestone that happened before the forward-only cutoff is history, not news:
  -- no recruit SMS, no Sam SMS/email, no team post, no inbox item.
  IF current_setting('apex.xcel_backfill', true) = 'on' THEN RETURN NEW; END IF;
  if tg_op = 'UPDATE'
     and new.license_progress is not distinct from old.license_progress then
    return new;
  end if;

  v_milestone := case new.license_progress::text
    when 'course_purchased' then 'enrolled_course'
    when 'finished_course' then 'completed_course'
    when 'test_scheduled' then 'scheduled_exam'
    when 'passed_test' then 'passed_exam'
    when 'exam_passed' then 'passed_exam'
    when 'fingerprints_done' then 'fingerprints_submitted'
    when 'waiting_on_license' then 'fingerprints_submitted'
    when 'licensed' then 'license_issued'
    when 'in_field_training' then 'license_issued'
    else null
  end;
  if v_milestone is null then return new; end if;

  select a.id into v_agent_id
  from public.agents a
  left join public.profiles p on p.id = a.profile_id or p.user_id = a.user_id
  where a.source_application_id = new.id
     or lower(btrim(p.email)) = lower(btrim(new.email))
  order by (a.source_application_id = new.id) desc, a.created_at desc
  limit 1;

  -- one row per (application, milestone) — a re-save of the same stage is not news
  if exists (select 1 from public.licensing_milestone_events e
             where e.application_id = new.id and e.milestone_type = v_milestone) then
    return new;
  end if;

  insert into public.licensing_milestone_events(
    application_id, agent_id, candidate_name, milestone_type,
    exam_date, state, source
  ) values (
    new.id,
    v_agent_id,
    btrim(concat_ws(' ', new.first_name, new.last_name)),
    v_milestone,
    case when v_milestone = 'scheduled_exam' then new.test_scheduled_date else null end,
    case when upper(btrim(coalesce(new.state, ''))) ~ '^[A-Z]{2}$'
      then upper(btrim(new.state)) else null end,
    'application_progress'
  ) on conflict do nothing;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_application_milestone_broadcast()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
  v_owner_name text;
  v_owner_username text;
  v_msg text;
  v_emoji text;
  v_event text;
BEGIN
  -- WP1 (20261111100000): historic Xcel write-back runs with apex.xcel_backfill=on.
  -- A milestone that happened before the forward-only cutoff is history, not news:
  -- no recruit SMS, no Sam SMS/email, no team post, no inbox item.
  IF current_setting('apex.xcel_backfill', true) = 'on' THEN RETURN NEW; END IF;
  v_name := TRIM(COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,''));

  IF NEW.course_purchased_at IS NOT NULL
     AND (OLD.course_purchased_at IS NULL OR OLD.course_purchased_at IS DISTINCT FROM NEW.course_purchased_at) THEN
    v_emoji := '🎓'; v_event := 'just bought their XCEL prelicensing course';
  ELSIF NEW.exam_passed_at IS NOT NULL
     AND (OLD.exam_passed_at IS NULL OR OLD.exam_passed_at IS DISTINCT FROM NEW.exam_passed_at) THEN
    v_emoji := '✅'; v_event := 'PASSED their licensing exam';
  ELSIF NEW.license_approved_at IS NOT NULL
     AND (OLD.license_approved_at IS NULL OR OLD.license_approved_at IS DISTINCT FROM NEW.license_approved_at) THEN
    v_emoji := '🏆'; v_event := 'got their license approved';
  ELSE
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.full_name, 'Unassigned'), COALESCE(tu.username, '')
    INTO v_owner_name, v_owner_username
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.profile_id
  LEFT JOIN telegram_users tu ON tu.agent_id = a.id
  WHERE a.id = COALESCE(NEW.referral_manager_id, NEW.assigned_agent_id)
  LIMIT 1;

  v_msg := v_emoji || ' <b>' || v_name || '</b> ' || v_event || '. '
        || CASE WHEN v_owner_username <> ''
             THEN '(@' || v_owner_username || ')'
             WHEN v_owner_name <> 'Unassigned'
             THEN '(' || v_owner_name || ')'
             ELSE ''
           END;

  PERFORM public.fn_broadcast_to_telegram_chat('pipeline', v_msg);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_inbox_license_milestone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_name    text;
  v_label   text;
  v_type    text;
  v_prio    text;
BEGIN
  -- WP1 (20261111100000): historic Xcel write-back runs with apex.xcel_backfill=on.
  -- A milestone that happened before the forward-only cutoff is history, not news:
  -- no recruit SMS, no Sam SMS/email, no team post, no inbox item.
  IF current_setting('apex.xcel_backfill', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.license_progress IS NOT DISTINCT FROM OLD.license_progress THEN RETURN NEW; END IF;

  v_label := CASE NEW.license_progress::text
    WHEN 'course_purchased'   THEN 'Prelicensing course started (25%)'
    WHEN 'finished_course'    THEN 'Prelicensing course finished (75%) - schedule exam'
    WHEN 'test_scheduled'     THEN 'Exam scheduled'
    WHEN 'passed_test'        THEN 'Passed exam - fingerprints next'
    WHEN 'fingerprints_done'  THEN 'Fingerprints done - state processing'
    WHEN 'waiting_on_license' THEN 'Waiting on state license'
    WHEN 'licensed'           THEN 'Application completed - LICENSED (field-ready)'
    ELSE NULL
  END;
  IF v_label IS NULL THEN RETURN NEW; END IF;

  v_type := CASE NEW.license_progress::text
    WHEN 'course_purchased'  THEN 'course_milestone_25'
    WHEN 'finished_course'   THEN 'course_milestone_100'
    WHEN 'licensed'          THEN 'application_completed'
    ELSE 'license_milestone'
  END;
  v_prio := CASE WHEN NEW.license_progress::text = 'licensed' THEN 'high' ELSE 'normal' END;

  v_name := COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'');
  SELECT a.user_id INTO v_user_id FROM public.agents a
   WHERE a.id = COALESCE(NEW.assigned_agent_id, NEW.recruiter_id);
  IF v_user_id IS NOT NULL THEN
    PERFORM public.fn_emit_inbox_notification(
      v_user_id, v_type, v_label || ': ' || trim(v_name),
      COALESCE(NEW.state,'-') || ' . ' || COALESCE(NEW.phone,'-'),
      '/dashboard/applicants/' || NEW.id::text, v_prio,
      jsonb_build_object('application_id', NEW.id, 'license_progress', NEW.license_progress)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Matching: every identity, every ingest. Never overwrites a link.
--    PREIMAGE of the replaced fn_match_xcel_students() (live 2026-11-10):
--   CREATE OR REPLACE FUNCTION public.fn_match_xcel_students()
--    RETURNS integer
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   DECLARE
--     v_matched integer := 0;
--   BEGIN
--     PERFORM public.fn_require_caller_role(ARRAY['admin','manager']::public.app_role[]);
--     -- Match by email first (highest signal)
--     UPDATE xcel_pre_licensing_students s
--     SET application_id = a.id, matched_at = now()
--     FROM applications a
--     WHERE s.application_id IS NULL
--       AND s.email IS NOT NULL
--       AND lower(a.email) = lower(s.email)
--       AND a.terminated_at IS NULL;
--     GET DIAGNOSTICS v_matched = ROW_COUNT;
--   
--     -- Then by phone fallback (last 10 digits)
--     WITH digits AS (
--       SELECT s.id AS sid, regexp_replace(s.phone, '\D', '', 'g') AS sp
--       FROM xcel_pre_licensing_students s
--       WHERE s.application_id IS NULL AND s.phone IS NOT NULL
--     ),
--     matched AS (
--       SELECT d.sid, a.id AS aid
--       FROM digits d
--       JOIN applications a ON regexp_replace(a.phone, '\D', '', 'g') = d.sp
--                          AND a.terminated_at IS NULL
--                          AND length(d.sp) >= 10
--     )
--     UPDATE xcel_pre_licensing_students s
--     SET application_id = m.aid, matched_at = now()
--     FROM matched m
--     WHERE s.id = m.sid;
--   
--     -- Propagate progress back to applications.license_progress (real type).
--     UPDATE applications a
--     SET
--       license_progress = (
--         CASE
--           WHEN s.pct_complete >= 100 AND a.license_progress NOT IN ('test_scheduled','waiting_on_license','fingerprints_done','licensed')
--             THEN 'finished_course'::license_progress
--           WHEN s.pct_complete > 0 AND a.license_progress = 'unlicensed'
--             THEN 'course_purchased'::license_progress
--           ELSE a.license_progress
--         END
--       ),
--       course_started_at = COALESCE(a.course_started_at, s.date_enrolled::timestamptz),
--       course_purchased_at = COALESCE(a.course_purchased_at, s.date_enrolled::timestamptz)
--     FROM xcel_pre_licensing_students s
--     WHERE s.application_id = a.id
--       AND s.report_id = (SELECT id FROM xcel_pre_licensing_reports ORDER BY report_date DESC LIMIT 1)
--       AND a.terminated_at IS NULL;
--   
--     RETURN v_matched;
--   END
--   $function$
-- ---------------------------------------------------------------------------
create or replace function public.fn_match_xcel_students()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
-- WP1 matcher (20261111100000). Returns identities newly linked this call;
-- the per-method breakdown goes to automation_run_log job 'xcel-match'.
declare
  r record;
  v_app uuid;
  v_agent uuid;
  v_method text;
  v_n int;
  c_staff int := 0;
  c_prop int := 0;
  c_email_app int := 0;
  c_email_agent int := 0;
  c_phone int := 0;
  c_name int := 0;
  c_unmatched int := 0;
  c_agent_enrich int := 0;
  v_started timestamptz := clock_timestamp();
begin
  -- Same gate as before: admin/manager in the app, or a service context
  -- (bot-sql, the launchd ingest, the statement trigger, pg_cron).
  perform public.fn_require_caller_role(array['admin', 'manager']::public.app_role[]);

  -- A. A staff decision (link or unlink) is the identity's truth on every row,
  --    including rows ingested after the decision.
  with staff as (
    select distinct on (lower(btrim(email)))
           lower(btrim(email)) as em, application_id, matched_agent_id, match_method, matched_at
      from public.xcel_pre_licensing_students
     where match_method in ('staff_link', 'staff_unlinked')
     order by lower(btrim(email)), matched_at desc nulls last, created_at desc
  )
  update public.xcel_pre_licensing_students s
     set application_id = staff.application_id,
         matched_agent_id = staff.matched_agent_id,
         match_method = staff.match_method,
         matched_at = staff.matched_at
    from staff
   where lower(btrim(s.email)) = staff.em
     and (s.application_id is distinct from staff.application_id
          or s.matched_agent_id is distinct from staff.matched_agent_id
          or s.match_method is distinct from staff.match_method);
  get diagnostics c_staff = row_count;

  -- B. Propagate an automatic link to the same identity's unlinked rows
  --    (a student who enrolled before applying has early rows with no link).
  with src as (
    select distinct on (lower(btrim(email)))
           lower(btrim(email)) as em, application_id, matched_agent_id,
           coalesce(match_method, 'email_ingest') as mm
      from public.xcel_pre_licensing_students
     where application_id is not null or matched_agent_id is not null
     order by lower(btrim(email)), (application_id is not null) desc, created_at desc
  )
  update public.xcel_pre_licensing_students s
     set application_id = coalesce(s.application_id, src.application_id),
         matched_agent_id = coalesce(s.matched_agent_id, src.matched_agent_id),
         match_method = coalesce(s.match_method, src.mm),
         matched_at = coalesce(s.matched_at, now())
    from src
   where lower(btrim(s.email)) = src.em
     and ((s.application_id is null and src.application_id is not null)
          or (s.matched_agent_id is null and src.matched_agent_id is not null))
     and not exists (select 1 from public.xcel_pre_licensing_students x
                      where lower(btrim(x.email)) = src.em
                        and x.match_method in ('staff_link', 'staff_unlinked'));
  get diagnostics c_prop = row_count;

  -- C. Identities with no link at all: match in order, first hit wins.
  for r in
    select lower(btrim(s.email)) as em,
           (array_agg(btrim(s.first_name) order by s.created_at desc)
              filter (where nullif(btrim(s.first_name), '') is not null))[1] as fn,
           (array_agg(btrim(s.last_name) order by s.created_at desc)
              filter (where nullif(btrim(s.last_name), '') is not null))[1] as ln,
           (array_agg(right(regexp_replace(s.phone, '\D', '', 'g'), 10) order by s.created_at desc)
              filter (where length(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g')) >= 10))[1] as ph,
           min(s.date_enrolled) as enrolled_on
      from public.xcel_pre_licensing_students s
     where nullif(btrim(s.email), '') is not null
     group by 1
    having bool_and(s.application_id is null and s.matched_agent_id is null)
       and not coalesce(bool_or(s.match_method in ('staff_link', 'staff_unlinked')), false)
  loop
    v_app := null; v_agent := null; v_method := null;

    -- (a) exact email -> a real (non-duplicate) application
    select a.id into v_app
      from public.applications a
     where lower(btrim(a.email)) = r.em
       and coalesce(a.is_duplicate, false) = false
       and coalesce(a.record_type, 'application') = 'application'
     order by a.created_at desc
     limit 1;
    if v_app is not null then v_method := 'email_app'; end if;

    -- (b) exact email -> profile -> canonical agent (direct adds never apply)
    if v_method is null then
      select g.id into v_agent
        from public.profiles p
        join public.agents g on (g.user_id = p.user_id or g.profile_id = p.id)
       where lower(btrim(p.email)) = r.em
         and g.canonical_agent_id is null
       order by coalesce(g.is_deactivated, false), (g.status::text = 'active') desc, g.created_at desc
       limit 1;
      if v_agent is not null then v_method := 'email_agent'; end if;
    end if;

    -- (c) phone digits -> exactly one real application
    if v_method is null and r.ph is not null then
      select min(a.id::text)::uuid, count(*) into v_app, v_n
        from public.applications a
       where right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) = r.ph
         and coalesce(a.is_duplicate, false) = false
         and coalesce(a.record_type, 'application') = 'application';
      if v_n = 1 then v_method := 'phone_app'; else v_app := null; end if;
    end if;

    -- (d) first + last name, application created within +/-90 days of enrolment,
    --     exactly one candidate (common names stay unmatched for a human)
    if v_method is null and r.fn is not null and r.ln is not null and r.enrolled_on is not null then
      select min(a.id::text)::uuid, count(*) into v_app, v_n
        from public.applications a
       where lower(btrim(a.first_name)) = lower(r.fn)
         and lower(btrim(a.last_name)) = lower(r.ln)
         and coalesce(a.is_duplicate, false) = false
         and coalesce(a.record_type, 'application') = 'application'
         and a.created_at between r.enrolled_on - interval '90 days' and r.enrolled_on + interval '90 days';
      if v_n = 1 then v_method := 'name_window'; else v_app := null; end if;
    end if;

    if v_method is null then
      c_unmatched := c_unmatched + 1;
      continue;
    end if;

    update public.xcel_pre_licensing_students
       set application_id = v_app, matched_agent_id = v_agent,
           match_method = v_method, matched_at = now()
     where lower(btrim(email)) = r.em
       and application_id is null and matched_agent_id is null;

    if v_method = 'email_app' then c_email_app := c_email_app + 1;
    elsif v_method = 'email_agent' then c_email_agent := c_email_agent + 1;
    elsif v_method = 'phone_app' then c_phone := c_phone + 1;
    else c_name := c_name + 1; end if;
  end loop;

  -- D. Application-linked identities: also record the hired agent, so the
  --    agent's license_progress mirrors the course (fill-only).
  with ids as (
    select lower(btrim(email)) as em,
           (array_agg(application_id order by created_at desc) filter (where application_id is not null))[1] as app
      from public.xcel_pre_licensing_students
     where nullif(btrim(email), '') is not null
     group by 1
    having bool_and(matched_agent_id is null)
       and bool_or(application_id is not null)
       and not coalesce(bool_or(match_method = 'staff_unlinked'), false)
  ), cand as (
    select ids.em,
           coalesce(
             (select g.id from public.agents g
               where g.canonical_agent_id is null and g.source_application_id = ids.app
               order by coalesce(g.is_deactivated, false), g.created_at desc limit 1),
             (select g.id from public.profiles p
                join public.agents g on (g.user_id = p.user_id or g.profile_id = p.id)
               where lower(btrim(p.email)) = ids.em and g.canonical_agent_id is null
               order by coalesce(g.is_deactivated, false), g.created_at desc limit 1)
           ) as ag
      from ids
  )
  update public.xcel_pre_licensing_students s
     set matched_agent_id = cand.ag
    from cand
   where lower(btrim(s.email)) = cand.em
     and cand.ag is not null
     and s.matched_agent_id is null;
  get diagnostics c_agent_enrich = row_count;

  insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body, duration_ms)
  values ('xcel-match', v_started, clock_timestamp(), 'success',
          jsonb_build_object(
            'staff_rows_enforced', c_staff, 'rows_propagated', c_prop,
            'new_email_app', c_email_app, 'new_email_agent', c_email_agent,
            'new_phone_app', c_phone, 'new_name_window', c_name,
            'identities_unmatched', c_unmatched, 'agent_rows_enriched', c_agent_enrich),
          (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int);

  return c_email_app + c_email_agent + c_phone + c_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The plan: one row per linked identity, with freshness per event.
--    fresh(d) = d after the cutoff DAY (Phoenix) and within 14 days.
--    No cutoff configured -> nothing is fresh -> nothing is messaged.
-- ---------------------------------------------------------------------------
create or replace function public.fn_xcel_progress_plan()
returns table (
  email_key text, student_id uuid, first_name text,
  application_id uuid, agent_id uuid,
  enrolled_on date, started_on date, completed_on date, latest_pct numeric,
  target_progress text, target_on date,
  purchased_fresh boolean, started_fresh boolean, target_fresh boolean,
  cutoff_on date)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cfg as (
    select (select case when s.value ~ '^\d{4}-\d{2}-\d{2}'
                        then (s.value::timestamptz at time zone 'America/Phoenix')::date end
              from public.system_settings s
             where s.key = 'xcel_writeback_messages_from') as cutoff_on,
           (now() at time zone 'America/Phoenix')::date as today
  )
  select x.email_key, x.student_id, x.first_name,
         case when a.id is null then null
              when coalesce(a.is_duplicate, false) then d.id
              else a.id end,
         x.matched_agent_id,
         x.enrolled_on, x.started_on, x.completed_on, x.latest_pct,
         case when x.completed_on is not null then 'finished_course'
              when x.enrolled_on is not null then 'course_purchased' end,
         coalesce(x.completed_on, x.enrolled_on),
         (x.enrolled_on is not null and cfg.cutoff_on is not null
            and x.enrolled_on > cfg.cutoff_on and x.enrolled_on >= cfg.today - 14),
         (x.started_on is not null and cfg.cutoff_on is not null
            and x.started_on > cfg.cutoff_on and x.started_on >= cfg.today - 14),
         (coalesce(x.completed_on, x.enrolled_on) is not null and cfg.cutoff_on is not null
            and coalesce(x.completed_on, x.enrolled_on) > cfg.cutoff_on
            and coalesce(x.completed_on, x.enrolled_on) >= cfg.today - 14),
         cfg.cutoff_on
    from public.v_xcel_identity_rollup x
    cross join cfg
    left join public.applications a on a.id = x.application_id
    left join public.applications d on d.id = a.duplicate_of and coalesce(d.is_duplicate, false) = false
   where x.application_id is not null or x.matched_agent_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- 7. Apply. Phase A (history) runs with apex.xcel_backfill=on; phase B (fresh)
--    lets the normal reactions fire. Called with apex.xcel_backfill already 'on'
--    by the caller, the whole run stays silent.
-- ---------------------------------------------------------------------------
create or replace function public.fn_apply_xcel_progress(p_report_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p record;
  v_app record;
  v_agent record;
  v_started timestamptz := clock_timestamp();
  v_prev_guc text := coalesce(nullif(current_setting('apex.xcel_backfill', true), ''), 'off');
  v_silent boolean;
  v_cp timestamptz;
  v_cs timestamptz;
  v_lp text;
  v_target text;
  v_milestone text;
  v_stage_before text;
  v_entered_before timestamptz;
  v_stage_after text;
  v_entered_after timestamptz;
  v_cadence text;
  v_did_backfill boolean;
  v_phase text;
  v_n int;
  v_cutoff date;
  c_identities int := 0;
  c_app_backfill int := 0;
  c_app_fresh int := 0;
  c_app_licensed_skip int := 0;
  c_agent int := 0;
  c_events int := 0;
  c_proofs int := 0;
  c_suppressed int := 0;
  c_errors int := 0;
  v_first_error text;
  v_result jsonb;
begin
  v_silent := (v_prev_guc = 'on');

  for p in select * from public.fn_xcel_progress_plan() loop
    c_identities := c_identities + 1;
    v_cutoff := p.cutoff_on;

    -- One identity per subtransaction: a bad row is logged and skipped, it does
    -- not roll back everybody else's write-back (and its GUC change unwinds).
    begin

    if p.application_id is not null then
      select a.id, a.first_name, a.last_name, a.state,
             a.license_status::text as ls, a.licensed_at,
             coalesce(a.license_progress::text, 'unlicensed') as lp,
             a.course_purchased_at, a.course_started_at
        into v_app
        from public.applications a
       where a.id = p.application_id
         for update;

      if found then
        select np.current_stage_key, np.entered_at
          into v_stage_before, v_entered_before
          from public.next_step_progress np
         where np.application_id = p.application_id;
        v_did_backfill := false;

        -- An already-licensed application is left alone: course stamps would move
        -- it into the 'started_prelicense' next-step stage (v_next_step_current
        -- ranks course timestamps above licence fields), and a progress write
        -- would be dragged to 'licensed' by fn_reconcile_licensing_vocabularies.
        if v_app.ls = 'licensed' or v_app.licensed_at is not null then
          c_app_licensed_skip := c_app_licensed_skip + 1;
        else
        foreach v_phase in array array['backfill', 'fresh'] loop
          v_cp := case when v_app.course_purchased_at is null and p.enrolled_on is not null
                        and (p.purchased_fresh = (v_phase = 'fresh'))
                       then (p.enrolled_on::timestamp + interval '12 hours') at time zone 'America/Phoenix' end;
          v_cs := case when v_app.course_started_at is null and p.started_on is not null
                        and (p.started_fresh = (v_phase = 'fresh'))
                       then (p.started_on::timestamp + interval '12 hours') at time zone 'America/Phoenix' end;
          v_target := case
                        when p.completed_on is not null and (p.target_fresh = (v_phase = 'fresh')) then 'finished_course'
                        when p.enrolled_on is not null and (p.purchased_fresh = (v_phase = 'fresh')) then 'course_purchased'
                      end;
          -- Never on a licensed application (fn_reconcile_licensing_vocabularies
          -- would drag it to 'licensed' and fire the hire reactions); never back.
          v_lp := case when v_target is not null
                         and v_app.ls is distinct from 'licensed' and v_app.licensed_at is null
                         and public.fn_license_stage_rank(v_target::license_progress)
                             > public.fn_license_stage_rank(v_app.lp::license_progress)
                       then v_target end;

          continue when v_cp is null and v_cs is null and v_lp is null;

          perform set_config('apex.xcel_backfill',
                             case when v_phase = 'backfill' or v_silent then 'on' else 'off' end, true);

          if v_phase = 'fresh' and v_lp is not null and not v_silent then
            v_milestone := case v_lp when 'course_purchased' then 'enrolled_course'
                                     when 'finished_course' then 'completed_course' end;
            if not exists (select 1 from public.licensing_milestone_events e
                            where e.application_id = p.application_id and e.milestone_type = v_milestone) then
              insert into public.licensing_milestone_events
                (application_id, agent_id, candidate_name, milestone_type, state, source)
              values (p.application_id, p.agent_id,
                      coalesce(nullif(btrim(concat_ws(' ', v_app.first_name, v_app.last_name)), ''), 'Applicant'),
                      v_milestone,
                      case when upper(btrim(coalesce(v_app.state, ''))) ~ '^[A-Z]{2}$'
                           then upper(btrim(v_app.state)) end,
                      'xcel');
              c_events := c_events + 1;
            end if;
          end if;

          -- One column per statement, in this order: track_license_milestones
          -- stamps course_purchased_at := now() if progress moves first.
          if v_cp is not null then
            update public.applications set course_purchased_at = v_cp
             where id = p.application_id and course_purchased_at is null;
          end if;
          if v_cs is not null then
            update public.applications set course_started_at = v_cs
             where id = p.application_id and course_started_at is null;
          end if;
          if v_lp is not null then
            update public.applications set license_progress = v_lp::license_progress
             where id = p.application_id;
          end if;

          perform set_config('apex.xcel_backfill', v_prev_guc, true);

          insert into public.xcel_writeback_log
            (report_id, application_id, agent_id, field, old_value, new_value, mode, event_on)
          select p_report_id, p.application_id, null, f.field, f.old_v, f.new_v, v_phase, f.ev
            from (values ('course_purchased_at', v_app.course_purchased_at::text, v_cp::text, p.enrolled_on),
                         ('course_started_at', v_app.course_started_at::text, v_cs::text, p.started_on),
                         ('license_progress', v_app.lp, v_lp,
                          case when v_lp = 'finished_course' then p.completed_on else p.enrolled_on end)
                 ) as f(field, old_v, new_v, ev)
           where f.new_v is not null;

          if v_phase = 'backfill' then
            v_did_backfill := true;
            c_app_backfill := c_app_backfill + 1;
          else
            c_app_fresh := c_app_fresh + 1;
          end if;

          -- re-read for the next phase
          select a.id, a.first_name, a.last_name, a.state,
                 a.license_status::text as ls, a.licensed_at,
                 coalesce(a.license_progress::text, 'unlicensed') as lp,
                 a.course_purchased_at, a.course_started_at
            into v_app
            from public.applications a
           where a.id = p.application_id;
        end loop;

        -- A stage entered because of history must not start a nudge cadence.
        -- fn_next_step_nudge_sweep (WP3) skips any (person, stage, step) whose
        -- dedupe key exists; next-step-dispatch skips rows with failed_at set.
        if v_did_backfill then
          select np.current_stage_key, np.entered_at
            into v_stage_after, v_entered_after
            from public.next_step_progress np
           where np.application_id = p.application_id;
          if v_stage_after in ('started_prelicense', 'finished_prelicense')
             and (v_stage_after is distinct from v_stage_before
                  or v_entered_after is distinct from v_entered_before)
             and (v_cutoff is null or v_entered_after is null
                  or (v_entered_after at time zone 'America/Phoenix')::date <= v_cutoff) then
            select s.reminder_cadence into v_cadence
              from public.next_step_stages s where s.stage_key = v_stage_after;
            if coalesce(v_cadence, '') like '%:%' then
              insert into public.next_step_messages
                (application_id, stage_key, channel, template_key, dedupe_key, failed_at, error, metadata)
              select p.application_id, v_stage_after, 'telegram',
                     v_stage_after || ':' || k.unit || k.n,
                     p.application_id::text || ':' || v_stage_after || ':' || k.unit || k.n,
                     now(),
                     'suppressed: stage entered from historic Xcel data before the forward-only cutoff (WP1); not sent',
                     jsonb_build_object('suppressed_by', 'wp1_xcel_backfill', 'entered_at', v_entered_after,
                                        'cutoff_on', v_cutoff)
                from (select lower(btrim(split_part(v_cadence, ':', 1))) as unit, btrim(s) as n
                        from unnest(string_to_array(split_part(v_cadence, ':', 2), ',')) s
                       where btrim(s) ~ '^-?\d+$') k
               -- only steps whose send window is still ahead: a day step fires on
               -- that exact elapsed day, an hour step at most ~20h after its hour
               where v_entered_after is null
                  or (k.unit = 'day' and v_entered_after + make_interval(days => k.n::int + 1) > now())
                  or (k.unit = 'hour' and v_entered_after + make_interval(hours => k.n::int + 21) > now())
              on conflict (dedupe_key) where dedupe_key is not null do nothing;
              get diagnostics v_n = row_count;
              c_suppressed := c_suppressed + v_n;
            end if;
          end if;
        end if;
        end if;  -- not licensed

        -- A course-proof screenshot whose applicant is in the Xcel feed is proven.
        update public.licensing_course_proofs
           set status = 'verified_xcel', reviewed_at = now(),
               note = coalesce(note, 'Auto-verified: applicant matched an Xcel enrollment (WP1)')
         where application_id = p.application_id
           and coalesce(status, 'submitted') in ('submitted', 'pending');
        get diagnostics v_n = row_count;
        c_proofs := c_proofs + v_n;
      end if;
    end if;

    -- Agent mirror (forward-only, finished_course at most, never on licensed).
    if p.agent_id is not null then
      select g.id, g.display_name, g.license_status::text as ls, g.licensed_at,
             coalesce(g.license_progress::text, 'unlicensed') as lp
        into v_agent
        from public.agents g
       where g.id = p.agent_id
         for update;
      if found and v_agent.ls is distinct from 'licensed' and v_agent.licensed_at is null
         and p.target_progress is not null
         and public.fn_license_stage_rank(p.target_progress::license_progress)
             > public.fn_license_stage_rank(v_agent.lp::license_progress) then
        perform set_config('apex.xcel_backfill',
                           case when p.target_fresh and not v_silent then 'off' else 'on' end, true);
        update public.agents set license_progress = p.target_progress::license_progress
         where id = p.agent_id;
        perform set_config('apex.xcel_backfill', v_prev_guc, true);
        insert into public.xcel_writeback_log
          (report_id, application_id, agent_id, field, old_value, new_value, mode, event_on)
        values (p_report_id, null, p.agent_id, 'agents.license_progress', v_agent.lp, p.target_progress,
                case when p.target_fresh then 'fresh' else 'backfill' end, p.target_on);
        c_agent := c_agent + 1;

        -- An agent-only identity has no application trigger to record the milestone.
        if p.application_id is null and p.target_fresh and not v_silent then
          v_milestone := case p.target_progress when 'course_purchased' then 'enrolled_course'
                                                when 'finished_course' then 'completed_course' end;
          if not exists (select 1 from public.licensing_milestone_events e
                          where e.agent_id = p.agent_id and e.milestone_type = v_milestone) then
            insert into public.licensing_milestone_events
              (application_id, agent_id, candidate_name, milestone_type, source)
            values (null, p.agent_id, coalesce(nullif(btrim(v_agent.display_name), ''), 'Agent'), v_milestone, 'xcel');
            c_events := c_events + 1;
          end if;
        end if;
      end if;
    end if;

    exception when others then
      c_errors := c_errors + 1;
      v_first_error := coalesce(v_first_error, left(sqlerrm, 300));
      insert into public.automation_run_log (job_name, triggered_at, completed_at, status, error, response_body)
      values ('xcel-writeback', clock_timestamp(), clock_timestamp(), 'error', left(sqlerrm, 500),
              jsonb_build_object('application_id', p.application_id, 'agent_id', p.agent_id, 'report_id', p_report_id));
    end;
  end loop;

  perform set_config('apex.xcel_backfill', v_prev_guc, true);

  v_result := jsonb_build_object(
    'report_id', p_report_id, 'cutoff_on', v_cutoff, 'silent', v_silent,
    'identities', c_identities, 'apps_backfill', c_app_backfill, 'apps_fresh', c_app_fresh,
    'apps_licensed_progress_skipped', c_app_licensed_skip, 'agents_mirrored', c_agent,
    'milestone_events', c_events, 'proofs_verified', c_proofs, 'nudges_suppressed', c_suppressed,
    'identity_errors', c_errors, 'first_error', v_first_error);

  insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body, duration_ms)
  values ('xcel-writeback', v_started, clock_timestamp(), 'success', v_result,
          (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int);

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Read-only dry run (SELECT only). Same plan, same rules.
-- ---------------------------------------------------------------------------
create or replace function public.fn_preview_xcel_progress(p_report_id uuid default null)
returns table (
  first_name text, application_id uuid, agent_id uuid,
  app_license_progress text, app_is_licensed boolean,
  target_progress text, target_on date, mode text,
  would_stamp_purchased boolean, would_stamp_started boolean,
  would_advance_progress boolean, would_message boolean, agent_would_advance boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null
     and not (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select p.first_name, p.application_id, p.agent_id,
         coalesce(a.license_progress::text, 'unlicensed'),
         (a.license_status::text = 'licensed' or a.licensed_at is not null),
         p.target_progress, p.target_on,
         case when p.target_fresh then 'fresh' else 'backfill' end,
         (a.id is not null and a.license_status::text is distinct from 'licensed' and a.licensed_at is null
            and a.course_purchased_at is null and p.enrolled_on is not null),
         (a.id is not null and a.license_status::text is distinct from 'licensed' and a.licensed_at is null
            and a.course_started_at is null and p.started_on is not null),
         (a.id is not null and a.license_status::text is distinct from 'licensed' and a.licensed_at is null
            and p.target_progress is not null
            and public.fn_license_stage_rank(p.target_progress::license_progress)
                > public.fn_license_stage_rank(coalesce(a.license_progress, 'unlicensed'::license_progress))),
         (a.id is not null and p.target_fresh and a.license_status::text is distinct from 'licensed'
            and a.licensed_at is null and p.target_progress is not null
            and public.fn_license_stage_rank(p.target_progress::license_progress)
                > public.fn_license_stage_rank(coalesce(a.license_progress, 'unlicensed'::license_progress))),
         (g.id is not null and g.license_status::text is distinct from 'licensed' and g.licensed_at is null
            and p.target_progress is not null
            and public.fn_license_stage_rank(p.target_progress::license_progress)
                > public.fn_license_stage_rank(coalesce(g.license_progress, 'unlicensed'::license_progress)))
    from public.fn_xcel_progress_plan() p
    left join public.applications a on a.id = p.application_id
    left join public.agents g on g.id = p.agent_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Backstop: any insert of student rows (launchd ingest, the admin ingest
--    dialog, a manual paste) re-matches and re-applies. Never blocks the insert.
-- ---------------------------------------------------------------------------
create or replace function public.fn_xcel_students_apply_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rid uuid;
begin
  begin
    perform public.fn_match_xcel_students();
    select n.report_id into v_rid from new_rows n order by n.created_at desc limit 1;
    perform public.fn_apply_xcel_progress(v_rid);
  exception when others then
    insert into public.automation_run_log (job_name, triggered_at, completed_at, status, error)
    values ('xcel-writeback-trigger', now(), clock_timestamp(), 'error', left(sqlerrm, 500));
  end;
  return null;
end;
$$;

drop trigger if exists trg_xcel_students_apply_progress on public.xcel_pre_licensing_students;
create trigger trg_xcel_students_apply_progress
  after insert on public.xcel_pre_licensing_students
  referencing new table as new_rows
  for each statement execute function public.fn_xcel_students_apply_trigger();

-- ---------------------------------------------------------------------------
-- 10. Staff RPCs (admin, or the manager app_role)
-- ---------------------------------------------------------------------------
create or replace function public.admin_link_xcel_student(
  p_student_id uuid, p_application_id uuid default null, p_agent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_em text;
  v_n int;
  v_method text;
  v_apply jsonb;
begin
  if auth.uid() is null
     or not (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select lower(btrim(email)) into v_em from public.xcel_pre_licensing_students where id = p_student_id;
  if v_em is null then
    raise exception 'Xcel student not found' using errcode = 'P0002';
  end if;
  if p_application_id is not null
     and not exists (select 1 from public.applications where id = p_application_id) then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if p_agent_id is not null and not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'Agent not found' using errcode = 'P0002';
  end if;

  v_method := case when p_application_id is null and p_agent_id is null then 'staff_unlinked' else 'staff_link' end;
  update public.xcel_pre_licensing_students
     set application_id = p_application_id, matched_agent_id = p_agent_id,
         match_method = v_method, matched_at = now()
   where lower(btrim(email)) = v_em;
  get diagnostics v_n = row_count;

  -- An unlink stops future writes; it does not revert stamps already made
  -- (xcel_writeback_log holds their preimages).
  v_apply := public.fn_apply_xcel_progress(null);
  return jsonb_build_object('ok', true, 'status', v_method, 'rows', v_n, 'apply', v_apply);
end;
$$;

create or replace function public.admin_review_course_proof(p_proof_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_app uuid;
  v_submitted timestamptz;
  v_old timestamptz;
  v_stamped boolean := false;
begin
  if auth.uid() is null
     or not (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role)) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('verified', 'rejected') then
    raise exception 'Decision must be verified or rejected' using errcode = '22023';
  end if;

  update public.licensing_course_proofs
     set status = p_decision, reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_proof_id
  returning application_id, submitted_at into v_app, v_submitted;
  if not found then
    raise exception 'Proof not found' using errcode = 'P0002';
  end if;

  -- Verified proof = the course was bought. Forward-only; this RPC and the Xcel
  -- match are the only paths that stamp course_purchased_at from a proof.
  if p_decision = 'verified' and v_app is not null then
    select course_purchased_at into v_old from public.applications where id = v_app for update;
    if v_old is null then
      update public.applications set course_purchased_at = coalesce(v_submitted, now())
       where id = v_app and course_purchased_at is null;
      v_stamped := true;
      insert into public.xcel_writeback_log (application_id, field, old_value, new_value, mode, event_on)
      values (v_app, 'course_purchased_at', null, coalesce(v_submitted, now())::text, 'staff',
              (coalesce(v_submitted, now()) at time zone 'America/Phoenix')::date);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'status', p_decision, 'course_purchased_stamped', v_stamped);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Staff views (gated: admin / manager role / service context). First name
--     and last initial only; contact fields stay in the existing admin page.
-- ---------------------------------------------------------------------------
create or replace view public.v_xcel_unmatched_active as
select x.student_id,
       x.first_name,
       x.last_initial,
       x.latest_pct as pct_complete,
       x.last_log_in,
       x.completed_on,
       x.enrolled_on,
       ((now() at time zone 'America/Phoenix')::date - x.enrolled_on) as days_since_enrolled,
       x.hiring_manager_name,
       x.course_name,
       x.last_seen_report,
       ((now() at time zone 'America/Phoenix')::date - (x.first_seen_at at time zone 'America/Phoenix')::date) as days_unmatched,
       x.staff_unlinked as was_unlinked
  from public.v_xcel_identity_rollup x
 where not x.is_linked
   and x.is_active
   and (auth.uid() is null or public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role));

comment on view public.v_xcel_unmatched_active is
  'WP1: active Xcel students linked to no application and no agent. Staff link them with admin_link_xcel_student. Never auto-messaged; S1/S2 staged lists in the onboarding audit read from here.';

-- The SPA reads the worklist through an RPC (graded by check-rpc-args against
-- scripts/data/rpc-catalog.json) until types.ts is regenerated with the view.
-- SECURITY INVOKER: the view's own admin/manager gate decides what comes back.
create or replace function public.admin_xcel_unmatched_active()
returns setof public.v_xcel_unmatched_active
language sql
stable
security invoker
set search_path to 'public'
as $$
  select * from public.v_xcel_unmatched_active order by days_unmatched desc nulls last;
$$;

create or replace view public.v_xcel_writeback_health as
with today as (select (now() at time zone 'America/Phoenix')::date as d)
select
  (select max(r.received_at) from public.xcel_pre_licensing_reports r) as latest_report_at,
  (select max(r.report_date) from public.xcel_pre_licensing_reports r) as latest_report_date,
  (select r.enrolled_last_30d from public.xcel_pre_licensing_reports r
    order by r.report_date desc, r.received_at desc limit 1) as enrolled_last_30d,
  (select count(*) from public.v_xcel_identity_rollup x, today
    where x.last_activity_on >= today.d - 30)::int as students_active_30d,
  (select count(distinct l.application_id) from public.xcel_writeback_log l
    where l.application_id is not null and l.mode in ('backfill', 'fresh')
      and l.applied_at > now() - interval '30 days')::int as apps_stamped_from_xcel_30d,
  (select count(*) from public.v_xcel_identity_rollup x where not x.is_linked and x.is_active)::int as unmatched_active,
  (select max(today.d - (x.first_seen_at at time zone 'America/Phoenix')::date)
     from public.v_xcel_identity_rollup x, today
    where not x.is_linked and x.is_active) as unmatched_oldest_days,
  (select max(l.triggered_at) from public.automation_run_log l
    where l.job_name = 'xcel-writeback' and l.status = 'success') as last_apply_at,
  (select max(l.triggered_at) from public.automation_run_log l
    where l.job_name in ('xcel-writeback', 'xcel-writeback-trigger') and l.status = 'error') as last_apply_error_at,
  (select count(*) from cron.job j
    where j.jobname in ('xcel_auto_upgrade_stages', 'pl091_xcel_gmail_pull') and j.active)::int as zombie_crons_active,
  (select count(*) from public.licensing_course_proofs pr
    where coalesce(pr.status, 'submitted') in ('submitted', 'pending'))::int as proofs_awaiting_review
where auth.uid() is null or public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role);

comment on view public.v_xcel_writeback_health is
  'WP1 guard (apex-doctor #42): always one row of scalar operands for the Xcel write-back. Movement = last_apply_at vs latest_report_at; backlog = unmatched_active/unmatched_oldest_days.';

create or replace view public.v_hired_unlicensed_review as
with prod as (
  select coalesce(vc.canonical_agent_id, m.agent_id) as cid,
         count(*)::int as deals_total,
         count(*) filter (where m.posted_date >= current_date - 90)::int as deals_90d,
         max(m.posted_date) as last_deal_on
    from public.mat_production_unified m
    left join public.v_agent_canonical_map vc on vc.agent_id = m.agent_id
   group by 1
)
select g.id as agent_id,
       split_part(coalesce(nullif(btrim(g.display_name), ''), nullif(btrim(p.full_name), ''), ''), ' ', 1) as first_name,
       g.onboarding_stage::text as onboarding_stage,
       g.license_status::text as license_status,
       g.license_progress::text as license_progress,
       coalesce(g.start_date, (g.created_at at time zone 'America/Phoenix')::date) as hired_on,
       ((now() at time zone 'America/Phoenix')::date
         - coalesce(g.start_date, (g.created_at at time zone 'America/Phoenix')::date)) as days_since_hire,
       x.latest_pct as xcel_pct,
       x.last_log_in as xcel_last_login,
       x.completed_on as xcel_completed_on,
       (coalesce(pr.deals_total, 0) > 0) as has_production,
       coalesce(pr.deals_90d, 0) as deals_90d,
       pr.last_deal_on,
       u.last_sign_in_at
  from public.agents g
  left join public.profiles p on p.user_id = g.user_id
  left join prod pr on pr.cid = g.id
  left join auth.users u on u.id = g.user_id
  left join lateral (
    select xr.latest_pct, xr.last_log_in, xr.completed_on
      from public.v_xcel_identity_rollup xr
     where xr.matched_agent_id = g.id
        or (p.email is not null and xr.email_key = lower(btrim(p.email)))
        or (g.source_application_id is not null and xr.application_id = g.source_application_id)
     order by xr.last_seen_report desc
     limit 1
  ) x on true
 where g.canonical_agent_id is null
   and coalesce(g.is_deactivated, false) = false
   and g.status::text = 'active'
   and g.license_status::text is distinct from 'licensed'
   and (auth.uid() is null or public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role));

comment on view public.v_hired_unlicensed_review is
  'WP1: Sam''s weekly review of active hired agents who are not licensed (keep / move back to applicant / mark licensed with a source). A review list only: nothing reads it to demote or message anyone.';

create or replace view public.v_license_data_conflicts as
with prod as (
  select coalesce(vc.canonical_agent_id, m.agent_id) as cid,
         count(*)::int as deals_90d,
         max(m.posted_date) as last_deal_on,
         string_agg(distinct m.origin, ', ') as origins
    from public.mat_production_unified m
    left join public.v_agent_canonical_map vc on vc.agent_id = m.agent_id
   where m.posted_date >= current_date - 90
   group by 1
)
select g.id as agent_id,
       split_part(coalesce(nullif(btrim(g.display_name), ''), nullif(btrim(p.full_name), ''), ''), ' ', 1) as first_name,
       g.status::text as agent_status,
       g.license_status::text as license_status,
       pr.deals_90d, pr.last_deal_on, pr.origins
  from prod pr
  join public.agents g on g.id = pr.cid
  left join public.profiles p on p.user_id = g.user_id
 where g.license_status::text is distinct from 'licensed'
   and (auth.uid() is null or public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role));

comment on view public.v_license_data_conflicts is
  'WP1: agents with production in the last 90 days whose license_status is not licensed. For human verification only (stale field vs compliance question); nothing rewrites license_status from here.';

revoke all on public.v_xcel_unmatched_active, public.v_xcel_writeback_health,
              public.v_hired_unlicensed_review, public.v_license_data_conflicts from anon, public;
grant select on public.v_xcel_unmatched_active, public.v_xcel_writeback_health,
                public.v_hired_unlicensed_review, public.v_license_data_conflicts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Function privileges: engine functions are internal; staff RPCs check roles.
-- ---------------------------------------------------------------------------
revoke all on function public.fn_match_xcel_students() from public, anon;
grant execute on function public.fn_match_xcel_students() to authenticated;  -- XcelIngestDialog; gated inside
revoke all on function public.fn_xcel_progress_plan() from public, anon, authenticated;
revoke all on function public.fn_apply_xcel_progress(uuid) from public, anon, authenticated;
revoke all on function public.fn_xcel_students_apply_trigger() from public, anon, authenticated;
revoke all on function public.fn_preview_xcel_progress(uuid) from public, anon;
revoke all on function public.admin_link_xcel_student(uuid, uuid, uuid) from public, anon;
revoke all on function public.admin_review_course_proof(uuid, text) from public, anon;
revoke all on function public.admin_xcel_unmatched_active() from public, anon;
grant execute on function public.admin_xcel_unmatched_active() to authenticated, service_role;
grant execute on function public.fn_match_xcel_students() to service_role;
grant execute on function public.fn_xcel_progress_plan() to service_role;
grant execute on function public.fn_apply_xcel_progress(uuid) to service_role;
grant execute on function public.fn_preview_xcel_progress(uuid) to authenticated, service_role;
grant execute on function public.admin_link_xcel_student(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.admin_review_course_proof(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. Proof screenshots: staff may mint a signed URL (the panel uses 300s).
-- ---------------------------------------------------------------------------
drop policy if exists licensing_proofs_staff_read on storage.objects;
create policy licensing_proofs_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'licensing-proofs'
         and (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'::app_role)));

-- ---------------------------------------------------------------------------
-- 14. Retire the zombie promoters (preimages in the header + ops_preimage_snapshots).
--     Cron 94 license-milestone-sms-drain stays: it drains what this feeds.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'xcel_auto_upgrade_stages') then
    perform cron.unschedule('xcel_auto_upgrade_stages');
  end if;
  if exists (select 1 from cron.job where jobname = 'pl091_xcel_gmail_pull') then
    perform cron.unschedule('pl091_xcel_gmail_pull');
  end if;
end $$;

comment on function public.fn_xcel_auto_upgrade_all() is
  'DEPRECATED (WP1 2026-11-10): read the dead CSV-era xcel_events through a view gated on auth.uid(), so it no-oped under pg_cron. Its cron (xcel_auto_upgrade_stages) is unscheduled. Superseded by fn_match_xcel_students + fn_apply_xcel_progress.';
comment on view public.v_xcel_person_progress is
  'DEPRECATED (WP1 2026-11-10): reads xcel_events (no rows since 2026-07-07). Use v_xcel_identity_rollup / v_xcel_writeback_health.';
comment on view public.v_xcel_stage_gaps is
  'DEPRECATED (WP1 2026-11-10): fed fn_xcel_auto_upgrade_all from dead xcel_events. Use fn_preview_xcel_progress.';
