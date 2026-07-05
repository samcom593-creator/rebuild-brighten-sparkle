-- MP238-course: Repoint system_settings.training_course_url to XCEL pre-licensing course.
--
-- Root cause: training_course_url was seeded to https://apex-financial.org/onboarding-course
-- (see 20260615030443_agent_onboarding_email_queue.sql). That in-app page has a hard license
-- gate (OnboardingCourse.tsx) that force-redirects any unlicensed user to /get-licensed. Every
-- new hire the 9:30 AM CT onboarding cron emails is unlicensed by definition (they were just
-- added), so the "Open the course" button dead-ended at a login → license-check → bounce loop.
-- To Sam this read as "the course link is broken."
--
-- Fix: repoint the setting to the XCEL pre-licensing course (already the canonical URL used by
--   - src/pages/GetLicensed.tsx line 34
--   - send-licensing-instructions, send-application-notification, submit-application,
--     welcome-new-agent, send-followup-emails, send-post-call-followup, send-bulk-unlicensed-outreach,
--     test-email-flows, unlicensed_ramp migration).
--
-- This aligns the day-zero onboarding email with the rest of the pre-license funnel and removes
-- the auth/license-gate wall for brand-new hires.
--
-- Applied live via bot-sql at 2026-07-05T19:28:32.627Z; this migration is the durable mirror.

UPDATE public.system_settings
SET
  value = 'https://partners.xcelsolutions.com/afe',
  updated_at = now()
WHERE key = 'training_course_url';

-- Backfill safety: if a fresh env is ever seeded without the row, insert it correctly first-time.
INSERT INTO public.system_settings (key, value)
SELECT 'training_course_url', 'https://partners.xcelsolutions.com/afe'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_settings WHERE key = 'training_course_url'
);
