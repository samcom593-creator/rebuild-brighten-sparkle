-- MP-260 (2026-07-22) — 40-day reissue campaign
-- Requeues the last 40d of applicants with the correct cohort template.
-- Guards:
--   - hard dedup on any reissue-40d-* send within 14d (email OR application_id)
--   - excludes: terminated_at IS NOT NULL, missing email, do_not_contact flag
--   - excludes: bounced (email_delivery_log.bounced_at IS NOT NULL)
--   - excludes: unsubscribed (email_unsubscribes)
--   - licensed cohort skipped if applications.contracted_at IS NOT NULL
--   - staggered scheduled_for: priority-first + 6min interval = 10 emails/hour cap
--   - transactional: fn either commits fully or rolls back
--   - idempotency_key UNIQUE = 'reissue-40d-{cohort}-{application_id}'
-- Design source: user request 2026-07-22
BEGIN;

-- 1) Extend outreach_queue with fields the sender needs for RFC 8058 compliance.
ALTER TABLE public.outreach_queue
  ADD COLUMN IF NOT EXISTS reply_to text,
  ADD COLUMN IF NOT EXISTS list_unsubscribe text,
  ADD COLUMN IF NOT EXISTS text_body text;

-- 2) Kill switch (auto-flipped by sender if bounce_rate crosses threshold).
INSERT INTO public.system_settings (key, value)
VALUES ('reissue_40d_paused', 'false')
ON CONFLICT (key) DO NOTHING;

-- 3) Cohort→template map + priority (lower = ships first)
CREATE OR REPLACE FUNCTION public.fn_reissue_40d_template_for(p_license_progress text)
RETURNS TABLE(template_key text, cohort text, priority int, subject text)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE COALESCE(p_license_progress, 'unlicensed')
    WHEN 'test_scheduled'      THEN 'reissue-40d-exam-day-reminder'
    WHEN 'finished_course'     THEN 'reissue-40d-exam-scheduling-push'
    WHEN 'passed_test'         THEN 'reissue-40d-license-issuance-check'
    WHEN 'exam_passed'         THEN 'reissue-40d-license-issuance-check'
    WHEN 'waiting_on_license'  THEN 'reissue-40d-license-issuance-check'
    WHEN 'fingerprints_done'   THEN 'reissue-40d-license-issuance-check'
    WHEN 'waiting_fingerprints'THEN 'reissue-40d-license-issuance-check'
    WHEN 'failed_test'         THEN 'reissue-40d-exam-scheduling-push'
    WHEN 'course_purchased'    THEN 'reissue-40d-course-started-nudge'
    WHEN 'in_field_training'   THEN 'reissue-40d-onboarding-welcome'
    WHEN 'licensed'            THEN 'reissue-40d-onboarding-welcome'
    ELSE                             'reissue-40d-prospect-combined-v1'
  END AS template_key,
  CASE COALESCE(p_license_progress, 'unlicensed')
    WHEN 'test_scheduled'      THEN 'test_scheduled'
    WHEN 'finished_course'     THEN 'finished_course'
    WHEN 'passed_test'         THEN 'passed_test'
    WHEN 'exam_passed'         THEN 'passed_test'
    WHEN 'waiting_on_license'  THEN 'waiting_on_license'
    WHEN 'fingerprints_done'   THEN 'waiting_on_license'
    WHEN 'waiting_fingerprints'THEN 'waiting_on_license'
    WHEN 'failed_test'         THEN 'finished_course'
    WHEN 'course_purchased'    THEN 'course_purchased'
    WHEN 'in_field_training'   THEN 'licensed_not_contracted'
    WHEN 'licensed'            THEN 'licensed_not_contracted'
    ELSE                             'unlicensed_or_null'
  END AS cohort,
  CASE COALESCE(p_license_progress, 'unlicensed')
    WHEN 'test_scheduled'      THEN 1
    WHEN 'finished_course'     THEN 2
    WHEN 'passed_test'         THEN 3
    WHEN 'exam_passed'         THEN 3
    WHEN 'waiting_on_license'  THEN 3
    WHEN 'fingerprints_done'   THEN 3
    WHEN 'waiting_fingerprints'THEN 3
    WHEN 'failed_test'         THEN 2
    WHEN 'course_purchased'    THEN 4
    WHEN 'in_field_training'   THEN 5
    WHEN 'licensed'            THEN 5
    ELSE                             6
  END AS priority,
  CASE COALESCE(p_license_progress, 'unlicensed')
    WHEN 'test_scheduled'      THEN 'Your exam is coming up'
    WHEN 'finished_course'     THEN 'Time to book your license exam'
    WHEN 'passed_test'         THEN 'Quick check on your license'
    WHEN 'exam_passed'         THEN 'Quick check on your license'
    WHEN 'waiting_on_license'  THEN 'Quick check on your license'
    WHEN 'fingerprints_done'   THEN 'Quick check on your license'
    WHEN 'waiting_fingerprints'THEN 'Quick check on your license'
    WHEN 'failed_test'         THEN 'Reset and re-book your exam'
    WHEN 'course_purchased'    THEN 'Start your course today'
    WHEN 'in_field_training'   THEN 'Welcome to APEX — next step'
    WHEN 'licensed'            THEN 'Welcome to APEX — let''s get you contracted'
    ELSE                             'Your APEX application — next step'
  END AS subject;
$$;

-- 4) HTML body per cohort. Short, direct, low link budget, unsub tokens rendered at send time.
CREATE OR REPLACE FUNCTION public.fn_reissue_40d_html(
  p_first_name text,
  p_cohort text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>APEX Financial</title></head>' ||
    '<body style="font-family:Arial,sans-serif;color:#0a0a0a;max-width:560px;margin:0 auto;padding:16px;line-height:1.5;">' ||
    '<p>Hey ' || COALESCE(NULLIF(TRIM(p_first_name), ''), 'there') || ',</p>' ||
    CASE p_cohort
      WHEN 'test_scheduled' THEN
        '<p>Your license exam is booked. Two quick reminders:</p>' ||
        '<ol><li>Bring two valid IDs.</li><li>Arrive 20 minutes early.</li></ol>' ||
        '<p>You have already done the hardest part — the study. Trust it, walk in confident, and text me the moment you pass.</p>' ||
        '<p><a href="https://calendly.com/apexfinancialempire/licensed-prospect-call-clone">Book a post-license onboarding call</a></p>'
      WHEN 'finished_course' THEN
        '<p>You finished the course. The only thing standing between you and a real income is the state exam.</p>' ||
        '<p>Book it this week while the material is still sharp — every day you wait, retention drops.</p>' ||
        '<p><a href="https://www.xcelsolutions.com/">Schedule your exam</a></p>'
      WHEN 'passed_test' THEN
        '<p>You passed. Congrats.</p>' ||
        '<p>I want to make sure nothing is stuck between you and your license number. Fingerprints done? NIPR clear? Carrier appointment started?</p>' ||
        '<p>Reply "status" and I will pull it and tell you exactly what is left.</p>'
      WHEN 'waiting_on_license' THEN
        '<p>Your license should be issuing any day now.</p>' ||
        '<p>If it has been more than 10 business days since you passed, reply "check" and I will escalate at the DOI / NIPR level today.</p>'
      WHEN 'course_purchased' THEN
        '<p>You bought the course. Now the money starts working for you the second you start it.</p>' ||
        '<p>Log in and knock out the first module today — most people who finish do it in 2-3 weeks.</p>' ||
        '<p><a href="https://www.xcelsolutions.com/login">Log in and start</a></p>'
      WHEN 'licensed_not_contracted' THEN
        '<p>You are licensed. Welcome to APEX Financial.</p>' ||
        '<p>Next step is contracting so you can start writing business under our carriers. It takes 15 minutes.</p>' ||
        '<p><a href="https://calendly.com/apexfinancialempire/licensed-prospect-call-clone">Book your contracting call</a></p>'
      ELSE
        '<p>You applied to APEX Financial in the last few weeks and I do not want you to fall through the cracks.</p>' ||
        '<p>Two options — pick whichever is easier:</p>' ||
        '<ol><li><a href="https://calendly.com/apexfinancialempire/licensed-prospect-call-clone">Book a 15-min call</a></li>' ||
        '<li><a href="https://wa.me/16015404885?text=Hi%20Sam%2C%20I%20applied%20to%20APEX%20and%20want%20to%20get%20started.">WhatsApp me directly</a></li></ol>' ||
        '<p>Either one gets you moving.</p>'
    END ||
    '<p>— Samuel James<br>Managing Partner, APEX Financial</p>' ||
    '<hr style="border:none;border-top:1px solid #e5e5e5;margin:20px 0;">' ||
    '<p style="font-size:12px;color:#666;">APEX Financial | 205 Reagan Farm Rd, Ridgeland, MS 39157<br>' ||
    'You are receiving this because you submitted an application. ' ||
    '<a href="mailto:info@kingofsales.net?subject=Unsubscribe">Unsubscribe</a>.</p>' ||
    '</body></html>';
$$;

-- 5) Text/plain body for multipart requirement.
CREATE OR REPLACE FUNCTION public.fn_reissue_40d_text(
  p_first_name text,
  p_cohort text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    'Hey ' || COALESCE(NULLIF(TRIM(p_first_name), ''), 'there') || ',' || E'\n\n' ||
    CASE p_cohort
      WHEN 'test_scheduled' THEN
        'Your license exam is booked. Two quick reminders:' || E'\n' ||
        '1) Bring two valid IDs.' || E'\n' ||
        '2) Arrive 20 minutes early.' || E'\n\n' ||
        'You have already done the hardest part. Text me the moment you pass.' || E'\n\n' ||
        'Post-license onboarding: https://calendly.com/apexfinancialempire/licensed-prospect-call-clone'
      WHEN 'finished_course' THEN
        'You finished the course. The only thing between you and real income is the state exam.' || E'\n\n' ||
        'Book it this week while the material is sharp.' || E'\n\n' ||
        'Schedule: https://www.xcelsolutions.com/'
      WHEN 'passed_test' THEN
        'You passed. Congrats.' || E'\n\n' ||
        'Make sure nothing is stuck between you and your license number. Fingerprints done? NIPR clear? Carrier appointment started?' || E'\n\n' ||
        'Reply "status" and I will pull it and tell you what is left.'
      WHEN 'waiting_on_license' THEN
        'Your license should be issuing any day now.' || E'\n\n' ||
        'If it has been more than 10 business days since you passed, reply "check" and I will escalate today.'
      WHEN 'course_purchased' THEN
        'You bought the course. Now the money starts working for you the second you start it.' || E'\n\n' ||
        'Log in and knock out the first module today.' || E'\n\n' ||
        'Login: https://www.xcelsolutions.com/login'
      WHEN 'licensed_not_contracted' THEN
        'You are licensed. Welcome to APEX Financial.' || E'\n\n' ||
        'Next step is contracting so you can start writing business under our carriers. 15 minutes.' || E'\n\n' ||
        'Book: https://calendly.com/apexfinancialempire/licensed-prospect-call-clone'
      ELSE
        'You applied to APEX Financial in the last few weeks and I do not want you to fall through the cracks.' || E'\n\n' ||
        'Two options:' || E'\n' ||
        '1) Book a 15-min call: https://calendly.com/apexfinancialempire/licensed-prospect-call-clone' || E'\n' ||
        '2) WhatsApp me directly: https://wa.me/16015404885' || E'\n\n' ||
        'Either one gets you moving.'
    END ||
    E'\n\n— Samuel James\nManaging Partner, APEX Financial\n\n' ||
    '---' || E'\n' ||
    'APEX Financial | 205 Reagan Farm Rd, Ridgeland, MS 39157' || E'\n' ||
    'You are receiving this because you submitted an application.' || E'\n' ||
    'Unsubscribe: reply with subject "Unsubscribe" to info@kingofsales.net';
$$;

-- 6) Main enqueue function — transactional, single INSERT ... SELECT.
CREATE OR REPLACE FUNCTION public.fn_enqueue_40d_reissue()
RETURNS TABLE(
  enqueued int,
  skipped_dedup int,
  first_send timestamptz,
  last_send timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_base_ts timestamptz := date_trunc('hour', now()) + INTERVAL '1 hour';
  v_enqueued int;
  v_total_eligible int;
  v_skipped int;
  v_first timestamptz;
  v_last timestamptz;
BEGIN
  -- Count total eligible before dedup for reporting.
  SELECT COUNT(*)::int INTO v_total_eligible
  FROM public.applications a
  LEFT JOIN LATERAL public.fn_reissue_40d_template_for(a.license_progress::text) t ON true
  WHERE a.created_at >= now() - INTERVAL '40 days'
    AND a.terminated_at IS NULL
    AND a.email IS NOT NULL
    AND a.email LIKE '%@%'
    AND (t.cohort <> 'licensed_not_contracted' OR a.contracted_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.email_unsubscribes u
      WHERE LOWER(u.email) = LOWER(a.email)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.email_delivery_log ed
      WHERE LOWER(ed.recipient_email) = LOWER(a.email)
        AND ed.bounced_at IS NOT NULL
    );

  WITH eligible AS (
    SELECT
      a.id AS application_id,
      a.email,
      a.first_name,
      t.template_key,
      t.cohort,
      t.priority,
      t.subject,
      ROW_NUMBER() OVER (
        ORDER BY t.priority ASC, a.created_at DESC
      ) AS rn
    FROM public.applications a
    CROSS JOIN LATERAL public.fn_reissue_40d_template_for(a.license_progress::text) t
    WHERE a.created_at >= now() - INTERVAL '40 days'
      AND a.terminated_at IS NULL
      AND a.email IS NOT NULL
      AND a.email LIKE '%@%'
      AND (t.cohort <> 'licensed_not_contracted' OR a.contracted_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.email_unsubscribes u
        WHERE LOWER(u.email) = LOWER(a.email)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.email_delivery_log ed
        WHERE LOWER(ed.recipient_email) = LOWER(a.email)
          AND ed.bounced_at IS NOT NULL
      )
      -- 14d dedup: skip if any reissue-40d-* was queued or sent to this
      -- email OR application_id in the last 14 days.
      AND NOT EXISTS (
        SELECT 1 FROM public.outreach_queue oq
        WHERE oq.template_key LIKE 'reissue-40d-%'
          AND oq.created_at > now() - INTERVAL '14 days'
          AND (
            oq.application_id = a.id
            OR (oq.to_email IS NOT NULL AND LOWER(oq.to_email) = LOWER(a.email))
          )
      )
      -- Skip if the applicant is already flagged as globally suppressed via any prior queue row.
      AND NOT EXISTS (
        SELECT 1 FROM public.outreach_queue oq2
        WHERE oq2.do_not_contact = true
          AND (
            oq2.application_id = a.id
            OR (oq2.to_email IS NOT NULL AND LOWER(oq2.to_email) = LOWER(a.email))
          )
      )
  ),
  inserted AS (
    INSERT INTO public.outreach_queue (
      application_id,
      channel,
      template_key,
      scheduled_for,
      status,
      source_run,
      idempotency_key,
      do_not_contact,
      subject,
      html_body,
      text_body,
      to_email,
      from_email,
      reply_to,
      list_unsubscribe
    )
    SELECT
      e.application_id,
      'email' AS channel,
      e.template_key,
      -- Staggered send: base + (rank * 6 min) → ~10/hour effective throughput.
      v_base_ts + ((e.rn - 1) * INTERVAL '6 minutes') AS scheduled_for,
      'pending' AS status,  -- outreach_queue_status_check allows: pending/sent/error/skipped/snoozed
      'reissue-40d-2026-07-22' AS source_run,
      'reissue-40d-' || e.cohort || '-' || e.application_id::text AS idempotency_key,
      false AS do_not_contact,
      e.subject,
      public.fn_reissue_40d_html(e.first_name, e.cohort) AS html_body,
      public.fn_reissue_40d_text(e.first_name, e.cohort) AS text_body,
      LOWER(e.email) AS to_email,
      'Samuel James <info@kingofsales.net>' AS from_email,
      'info@kingofsales.net' AS reply_to,
      '<mailto:info@kingofsales.net?subject=Unsubscribe>' AS list_unsubscribe
    FROM eligible e
    -- Belt-and-suspenders idempotency: idempotency_key is UNIQUE. If a row already exists,
    -- do_nothing so the fn is safe to re-run.
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, scheduled_for
  )
  SELECT
    COUNT(*)::int,
    MIN(scheduled_for),
    MAX(scheduled_for)
  INTO v_enqueued, v_first, v_last
  FROM inserted;

  v_skipped := GREATEST(0, v_total_eligible - v_enqueued);

  RETURN QUERY SELECT v_enqueued, v_skipped, v_first, v_last;
END;
$$;

COMMIT;
