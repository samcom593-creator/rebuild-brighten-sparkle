-- onboarding-integrate (2026-11-10): two guards found by the new doctor checks after the WP1-WP8 merge.
--
-- 1) doctor #45 went CRITICAL on applicant_nudge: WP3 removed the send branches from
--    fn_run_applicant_nudges and moved day-1 into send-followup-emails, forward-only after
--    system_settings.wp3_recruit_sla_cutoff. v_recruit_sequence_health still counted every
--    applicant in the window as eligible, so a deliberately held-back backlog read as a dead
--    sequence. Eligibility for applicant_nudge / applicant_followup now starts at the cutoff
--    (no cutoff row = now(), i.e. nobody eligible yet, never a false CRITICAL). The day-1
--    subject ("<first>, your next step with Galaxy") joins the applicant_nudge family.
-- 2) doctor #48 flagged notify_sam_on_licensing_milestone: net.http_post with no EXCEPTION
--    handler, so a failed alert leg could roll back the applications write that fired it.
--    Body unchanged; an EXCEPTION block now logs a WARNING and returns NEW.

update public.email_template_families
   set subject_pattern = 'your next step with galaxy|day 1 check-in|last automated check-in',
       notes = 'Day-1 nudge, now sent by send-followup-emails (WP3, forward-only after wp3_recruit_sla_cutoff). Old fn_run_applicant_nudges subjects kept for history.'
 where family = 'applicant_nudge';

update public.recruit_sequences
   set endpoint = 'send-followup-emails (day-1)',
       cron_jobname = 'apex-followup-emails-daily',
       notes = 'Day-1 nudge moved from fn_run_applicant_nudges (401 since 2026-09-06, stamped sent anyway) to send-followup-emails by WP3; stamped only with a Resend id; forward-only after wp3_recruit_sla_cutoff.',
       updated_at = now()
 where key = 'applicant_nudge';

create or replace view public.v_recruit_sequence_health with (security_invoker = true) as
 WITH d AS (
         SELECT v_recruit_message_delivery.sequence,
            count(*) FILTER (WHERE v_recruit_message_delivery.receipted) AS receipted,
            count(*) FILTER (WHERE v_recruit_message_delivery.delivered) AS delivered,
            count(*) FILTER (WHERE v_recruit_message_delivery.bounced) AS bounced,
            max(v_recruit_message_delivery.sent_at) FILTER (WHERE v_recruit_message_delivery.receipted) AS last_receipt_at
           FROM v_recruit_message_delivery
          WHERE (v_recruit_message_delivery.sent_at >= (now() - '7 days'::interval))
          GROUP BY v_recruit_message_delivery.sequence
        ), m AS (
         SELECT s.key,
            s.audience,
            s.channel,
            s.trigger_kind,
            s.cron_jobname,
            s.endpoint,
            s.grade_mode,
            s.subject_families,
            s.expected_min_sends_7d,
            s.owner,
            s.status,
            s.notes,
            s.updated_at,
                CASE s.key
                    WHEN 'applicant_welcome'::text THEN ( SELECT count(*) AS count
                       FROM applications a
                      WHERE ((a.created_at >= (now() - '7 days'::interval)) AND (a.record_type = 'application'::text) AND (COALESCE(a.is_duplicate, false) = false) AND (a.email IS NOT NULL)))
                    WHEN 'applicant_magic_login'::text THEN ( SELECT count(*) AS count
                       FROM applicant_login_queue q
                      WHERE (q.created_at >= (now() - '7 days'::interval)))
                    WHEN 'applicant_nudge'::text THEN ( SELECT count(*) AS count
                       FROM applications a
                      WHERE ((a.created_at >= COALESCE((SELECT (ss.value)::timestamptz FROM system_settings ss WHERE ss.key = 'wp3_recruit_sla_cutoff'), now())) AND ((a.created_at >= (now() - '10 days'::interval)) AND (a.created_at <= (now() - '1 day'::interval))) AND (a.record_type = 'application'::text) AND (COALESCE(a.is_duplicate, false) = false) AND (a.email IS NOT NULL) AND (a.terminated_at IS NULL) AND (a.closed_at IS NULL)))
                    WHEN 'applicant_followup'::text THEN ( SELECT count(*) AS count
                       FROM applications a
                      WHERE ((a.created_at >= COALESCE((SELECT (ss.value)::timestamptz FROM system_settings ss WHERE ss.key = 'wp3_recruit_sla_cutoff'), now())) AND ((a.created_at >= (now() - '15 days'::interval)) AND (a.created_at <= (now() - '3 days'::interval))) AND (a.record_type = 'application'::text) AND (COALESCE(a.is_duplicate, false) = false) AND (a.email IS NOT NULL) AND (a.terminated_at IS NULL) AND (a.closed_at IS NULL)))
                    WHEN 'next_step_ladder'::text THEN ( SELECT count(*) AS count
                       FROM next_step_messages m_1
                      WHERE ((m_1.fallback_of_id IS NULL) AND (m_1.created_at >= (now() - '7 days'::interval))))
                    WHEN 'newhire_onboarding'::text THEN ( SELECT count(*) AS count
                       FROM agent_onboarding_queue q
                      WHERE ((q.target_send_at >= (now() - '7 days'::interval)) AND (q.target_send_at <= now())))
                    WHEN 'onboarding_call_invites'::text THEN ( SELECT count(*) AS count
                       FROM onboarding_call_invites i
                      WHERE (i.created_at >= (now() - '7 days'::interval)))
                    ELSE NULL::bigint
                END AS eligible_7d,
                CASE s.key
                    WHEN 'onboarding_call_invites'::text THEN (( SELECT count(*) AS count
                       FROM onboarding_call_invites i
                      WHERE ((i.sent_at >= (now() - '7 days'::interval)) AND (i.resend_message_id IS NOT NULL))))::numeric
                    ELSE ( SELECT COALESCE(sum(d.receipted), (0)::numeric) AS "coalesce"
                       FROM d
                      WHERE ((d.sequence = s.key) OR (d.sequence = ANY (COALESCE(s.subject_families, '{}'::text[])))))
                END AS receipted_sends_7d,
            ( SELECT COALESCE(sum(d.delivered), (0)::numeric) AS "coalesce"
                   FROM d
                  WHERE ((d.sequence = s.key) OR (d.sequence = ANY (COALESCE(s.subject_families, '{}'::text[]))))) AS delivered_7d,
            ( SELECT COALESCE(sum(d.bounced), (0)::numeric) AS "coalesce"
                   FROM d
                  WHERE ((d.sequence = s.key) OR (d.sequence = ANY (COALESCE(s.subject_families, '{}'::text[]))))) AS bounced_7d,
            ( SELECT max(d.last_receipt_at) AS max
                   FROM d
                  WHERE ((d.sequence = s.key) OR (d.sequence = ANY (COALESCE(s.subject_families, '{}'::text[]))))) AS last_receipt_at
           FROM recruit_sequences s
        )
 SELECT key,
    audience,
    channel,
    status,
    owner,
    grade_mode,
    cron_jobname,
    endpoint,
    expected_min_sends_7d,
    eligible_7d,
    receipted_sends_7d,
    delivered_7d,
    bounced_7d,
    last_receipt_at,
        CASE
            WHEN (status <> 'active'::text) THEN status
            WHEN ((grade_mode = 'ungraded'::text) OR (eligible_7d IS NULL)) THEN 'ungraded'::text
            WHEN (eligible_7d = 0) THEN 'idle'::text
            WHEN (receipted_sends_7d = (0)::numeric) THEN 'critical_no_receipts'::text
            WHEN (receipted_sends_7d < (expected_min_sends_7d)::numeric) THEN 'below_expected'::text
            ELSE 'ok'::text
        END AS verdict
   FROM m;

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
EXCEPTION WHEN others THEN
  -- A failed alert leg must never roll back the applications write that fired it.
  RAISE WARNING 'notify_sam_on_licensing_milestone failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;
