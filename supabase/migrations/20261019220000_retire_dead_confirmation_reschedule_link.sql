-- PL-WIB-CONFIRM-NO-DEAD-LINK (2026-10-19)
-- system_settings.seminar_calendly_url held calendly.com/apexfinancialempire/interview,
-- an event type Calendly deleted with the seminar. Its only reader is
-- send-candidate-confirmation, which used it as the "Reschedule" button in every
-- interview confirmation email. That function no longer has a hardcoded
-- fallback and renders a reply line when this key is absent.
-- Guarded on the dead value: a live URL set later is left alone.
-- Revert: insert into system_settings(key,value,created_at,updated_at)
--   values ('seminar_calendly_url','https://calendly.com/apexfinancialempire/interview',
--           '2026-05-22T07:52:21.049239+00:00','2026-05-22T07:52:21.049239+00:00');
delete from public.system_settings
 where key = 'seminar_calendly_url'
   and btrim(value, ' "') = 'https://calendly.com/apexfinancialempire/interview';
