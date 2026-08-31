-- wave-email-retry-loop — a permanently-rejected address was retried forever.
--
-- MEASURED before changing anything:
--   notification_log, channel='email', last 30 days
--     failed  1,882   sent  179
--   1,864 of those failures are one Resend error: "Invalid `to` field. Please
--   use our testing email address instead of domains like `example.com`."
--   Across ALL TIME: 2,222 wasted send attempts spread over exactly TWO
--   addresses, both @example.com test records. Newest attempt was minutes
--   before this migration was written. No real applicant is affected.
--
-- WHY IT LOOPS. MP-269 fixed a genuine disaster — 24,806 duplicate sends to 40
-- people in July, which exhausted the Resend monthly quota and silently killed
-- every new-application notification. Its fix was to stamp contacted_at ONLY on
-- a successful send, with the comment "do not stamp contacted_at, so it retries
-- next tick instead of silently dropping the applicant."
--
-- That is exactly right for a TRANSIENT failure and exactly wrong for a
-- PERMANENT one. Resend will never accept an @example.com recipient, so the
-- retry can never succeed, and system-health-check runs every 15 minutes: one
-- test row absorbed 663 send attempts in 7 days.
--
-- The cost is not the wasted calls. It is that 91% of the email failure log is
-- this single unfixable address, so a REAL delivery failure would be invisible
-- inside it — the same "channel three fifths one dead integration is a channel
-- nobody reads" problem as the 1,680 insuracloud_sync_error alerts.
--
-- Symmetric with phone_bad_at/phone_bad_reason, which already exist on this
-- table for the same reason on the other channel.

begin;

alter table public.applications
  add column if not exists email_bad_at timestamptz,
  add column if not exists email_bad_reason text;

comment on column public.applications.email_bad_at is
  'Set when a send was refused for a reason retrying cannot fix (invalid '
  'recipient, hard bounce). Automated email paths must exclude these rows. A '
  'transient failure must NOT set this — it should still retry. Mirrors '
  'phone_bad_at. See migration 20260831030000.';

-- Backfill the addresses that have already proven permanently undeliverable.
-- Derived from the delivery log rather than from a hardcoded list, so this
-- records what actually happened instead of what I assumed happened.
update public.applications a
   set email_bad_at = coalesce(a.email_bad_at, now()),
       email_bad_reason = coalesce(
         a.email_bad_reason,
         'provider refused recipient (backfilled from notification_log 2026-08-31)'
       )
 where a.email_bad_at is null
   and exists (
     select 1 from public.notification_log n
     where n.channel = 'email'
       and n.status = 'failed'
       and n.error_message ilike '%Invalid%to%field%'
       and lower(trim(n.recipient_email)) = lower(trim(a.email))
   );

create index if not exists applications_email_bad_at_idx
  on public.applications (email_bad_at)
  where email_bad_at is null;

commit;
