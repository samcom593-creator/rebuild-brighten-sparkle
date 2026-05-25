-- PL-AHO-WEB-001 — paid-social quick qualify intake.
-- Cold ad traffic creates an applications row before the full form is finished,
-- so managers can recover the lead if the applicant bounces.

ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'quick_qualified';
