-- PL-WIB-SEMINAR-RETIRE (2026-10-21). Hand-applied via bot-sql at 15:53Z, before
-- this file was pushed; REVOKE/GRANT are idempotent, so the CI re-apply is a no-op.
--
-- register_for_seminar is SECURITY DEFINER and reads no caller identity. It was
-- EXECUTE-granted to PUBLIC, anon and authenticated, so anyone holding the
-- site's public key could call it. Given an email or phone it would insert an
-- applications row, or overwrite an existing applicant's first name, last name
-- and phone (matched by email OR phone), queue an email and an SMS to that
-- address, and raise a bot_alerts email + Discord post.
--
-- 20261008160100 (secdef open writers) kept it open because its name appeared
-- in src/ (SeminarPage, AgentActionsMenu). Sam retired the seminar on
-- 2026-10-15, and this change removes both callers. The one remaining caller,
-- seminar-register, uses the service role and now returns 410 before any write.
--
-- Use, measured before the revoke: 0 bot_alerts of type seminar_registration
-- ever, 0 notification_log rows from this function, 0 applications it created.
-- It was never used, so there is no dollar figure here.
--
-- Proof, same zero-write probe both times (p_email '' raises 'Email is required'
-- before any write): anon before -> HTTP 400 P0001 (the body ran as anon);
-- anon after -> HTTP 401 42501 permission denied.
-- Pre-image ACL: business-ops/website-integrity-bot/ledger/snapshots/2026-10-21-register-for-seminar-acl.pre.json

revoke execute on function public.register_for_seminar(text, text, text, text, date, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.register_for_seminar(text, text, text, text, date, text, text, text, text, text, boolean) to service_role;

-- The two settings that held the dead Calendly event type
-- (calendly.com/apexfinancialempire/interview, event_type_deleted). Their readers:
-- public_seminar_meeting (its one caller, SeminarPage, is deleted), register_for_seminar
-- (now service-key only, and its caller returns 410), get_application_seminar_invite
-- (service-key only, no caller anywhere), seminar-reminder-tick (retired, no cron).
-- Every reader treats a missing key as empty. Matched on the dead value, so a live
-- URL set here later is never deleted by a CI re-apply. Same shape as 20261019220000.
-- Pre-image rows: business-ops/website-integrity-bot/ledger/snapshots/2026-10-21-seminar-url-settings.pre.json
delete from public.system_settings
 where key in ('seminar_meeting_url', 'seminar_zoom_url')
   and btrim(value, ' "') = 'https://calendly.com/apexfinancialempire/interview';
