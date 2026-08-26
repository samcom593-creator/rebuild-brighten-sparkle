-- numbers-reminder v2 (2026-08-26): per-channel delivery receipts.
--
-- The 6 PM Chicago reminder used to record ONE fact per agent/day: an email
-- send returned ok. Sam asked for the reminder to reach agents where they
-- actually look (SMS + Slack DM), and the closure audit graded the function
-- "email only". A row that says "sent" without saying WHICH channel landed is
-- the sent_at-without-receipt shape this repo has already paid for twice
-- (bot_alerts.sent_sms_id, agentlink sync_log). So every channel writes its
-- own outcome column and its own provider receipt; the row exists as soon as
-- ANY channel landed, and a channel that could not be attempted says why
-- ('no_phone', 'no_slack_link', 'unknown_carrier') instead of being absent.
--
-- Nothing here changes the once-per-agent-per-business-day rule: the primary
-- key (business_date, agent_id) is untouched.

alter table public.numbers_reminder_delivery_log
  add column if not exists email_status  text,
  add column if not exists email_receipt text,
  add column if not exists sms_status    text,
  add column if not exists sms_receipt   text,
  add column if not exists slack_status  text,
  add column if not exists slack_receipt text,
  add column if not exists channels      jsonb not null default '{}'::jsonb,
  add column if not exists updated_at    timestamptz not null default now();

comment on column public.numbers_reminder_delivery_log.email_status is
  'sent | failed | unsubscribed | no_email — outcome of the Resend email leg';
comment on column public.numbers_reminder_delivery_log.sms_status is
  'sent | skipped_unknown_carrier | failed | no_phone — outcome of the send-sms-auto-detect leg (email-to-carrier gateway; "sent" means the gateway accepted, never that the handset rang)';
comment on column public.numbers_reminder_delivery_log.slack_status is
  'sent | failed | no_slack_link | no_token — outcome of the Slack DM leg (messaging_identity_links.slack_user_id, verified + not revoked)';
comment on column public.numbers_reminder_delivery_log.channels is
  'Raw per-channel attempt record {channel: {status, receipt, error}} for the health view';

-- Health: what the reminder actually did, per business day, without a time
-- filter (a view that returns no row when nothing ran is a blank-green).
create or replace view public.v_numbers_reminder_channel_health as
select
  (select max(business_date) from public.numbers_reminder_delivery_log) as last_business_date,
  (select count(*) from public.numbers_reminder_delivery_log
     where business_date = (select max(business_date) from public.numbers_reminder_delivery_log)) as agents_reminded_last_run,
  (select count(*) filter (where email_status = 'sent') from public.numbers_reminder_delivery_log
     where business_date = (select max(business_date) from public.numbers_reminder_delivery_log)) as email_sent_last_run,
  (select count(*) filter (where sms_status = 'sent') from public.numbers_reminder_delivery_log
     where business_date = (select max(business_date) from public.numbers_reminder_delivery_log)) as sms_sent_last_run,
  (select count(*) filter (where slack_status = 'sent') from public.numbers_reminder_delivery_log
     where business_date = (select max(business_date) from public.numbers_reminder_delivery_log)) as slack_sent_last_run,
  (select count(*) filter (where sms_status = 'skipped_unknown_carrier') from public.numbers_reminder_delivery_log
     where business_date = (select max(business_date) from public.numbers_reminder_delivery_log)) as sms_unknown_carrier_last_run,
  (select count(*) filter (where slack_status = 'no_slack_link') from public.numbers_reminder_delivery_log
     where business_date = (select max(business_date) from public.numbers_reminder_delivery_log)) as slack_unlinked_last_run,
  (select count(*) from public.messaging_identity_links
     where slack_user_id is not null and revoked_at is null) as slack_links_available,
  (select value from public.system_settings where key = 'last_numbers_reminder') as last_run_at;

grant select on public.v_numbers_reminder_channel_health to authenticated, service_role;
