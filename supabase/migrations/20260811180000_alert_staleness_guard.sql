-- Alert staleness guard — the precondition for restoring the dispatcher cron.
--
-- apex-doctor Check #18 reports CRITICAL: 1,533 of 2,779 bot_alerts were never
-- dispatched (oldest 106 days) because cron job 'apex-alert-dispatch-flush' does
-- not exist. The obvious fix — recreate the cron — is the wrong one on its own.
-- Measured composition of the backlog on 2026-08-11:
--
--   severity    never_sent   within 24h   within 72h   oldest
--   warn             1,419            2            5     106d
--   celebrate           97            0            0       4d
--   info                17            0            0      85d
--   critical             0            -            -        -
--
-- Restoring the cron against that queue sends 1,533 messages, 1,407 of them over
-- a week old. The 97 celebrate rows are a single applicant_newly_licensed
-- backfill batch sharing one created_at — Sam would get 97 separate phone pushes
-- congratulating him about people licensed days ago. That converts a silent
-- failure into a pager storm and calls it a fix, which is the same trade the
-- cron gate made four times this week (36 false pages/day -> couldn't cry at all
-- -> 39 true-but-misleading -> permanently red).
--
-- Note what the numbers also prove: ZERO criticals are stuck. Critical alerts
-- POST directly from their triggers and never depended on the flush, so the
-- loudest severity was never affected by the outage. The backlog is entirely
-- warn/celebrate/info.
--
-- WHY A NEW COLUMN AND NOT sent_at:
-- The tempting shortcut is to stamp sent_at on the stale rows so the existing
-- flush skips them. That would record 1,531 alerts as delivered when nothing was
-- delivered — precisely the 465-row InsuraCloud fake-success disease, inside the
-- table that exists to report on delivery. Deleting them destroys history just
-- as badly. So expiry gets its own column and its own state: never sent, never
-- going to be sent, and honest about both.

alter table public.bot_alerts
  add column if not exists expired_at timestamptz,
  add column if not exists expired_reason text;

comment on column public.bot_alerts.expired_at is
  'Set when an alert aged out before a dispatcher existed to send it. NEVER implies delivery — sent_at remains null. An alert with expired_at set is terminal: the dispatcher must skip it.';

-- Partial index: the dispatcher''s hot path is "undelivered and not expired".
create index if not exists bot_alerts_dispatchable_idx
  on public.bot_alerts (created_at desc)
  where sent_at is null and expired_at is null;

-- One-time reconciliation of the pre-existing backlog. Bounded to rows that are
-- BOTH undelivered and older than the dispatch window, so re-running is a no-op
-- and a fresh alert can never be caught by it.
update public.bot_alerts
   set expired_at = now(),
       expired_reason = 'aged out while cron apex-alert-dispatch-flush did not exist (restored 2026-08-11)'
 where sent_at is null
   and expired_at is null
   and created_at < now() - interval '24 hours';

-- Truth view gains a third state. queued_never_dispatched now means "still
-- deliverable"; expired_undelivered means "nobody will ever send this". Folding
-- them together is what made the doctor read 1,533 forever, and a permanently
-- red check is one everybody learns to skip.
create or replace view public.v_bot_alert_delivery_truth as
 SELECT id,
    event_type,
    severity,
    channels,
    created_at,
    sent_at,
    round(EXTRACT(epoch FROM now() - created_at) / 86400.0, 1) AS age_days,
        CASE
            WHEN sent_at IS NULL AND expired_at IS NOT NULL THEN 'expired_undelivered'::text
            WHEN sent_at IS NULL THEN 'queued_never_dispatched'::text
            WHEN sent_email_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-'::text THEN 'delivered_email_receipt'::text
            ELSE 'delivered_unprovable'::text
        END AS delivery_state,
    'email'::text = ANY (channels) AS email_requested,
    sent_email_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-'::text AS email_receipt_is_real,
    'sms'::text = ANY (channels) AS sms_requested,
    sent_sms_id IS NOT NULL AND (sent_sms_id = ANY (ARRAY['sent'::text, 'pg_net'::text])) AS sms_receipt_is_literal,
    -- Appended last on purpose: `create or replace view` cannot insert a column
    -- into the middle of an existing view's column list, and dropping the view
    -- would take any dependent with it.
    expired_at
   FROM bot_alerts a;

comment on view public.v_bot_alert_delivery_truth is
  'Delivery truth for bot_alerts, four-valued. expired_undelivered is its own verdict and is NOT laundered into either success or failure: those alerts were never sent and never will be. delivered_unprovable means a channel reported success without returning a message id (ntfy/discord return booleans) — it is not a failure and not a receipt.';

-- Restore the dispatcher cron. Safe ONLY because of the staleness guard above:
-- the flush now skips expired_at rows and anything older than ALERT_MAX_AGE_HOURS
-- (default 24), so the first tick cannot fire the 106-day backlog.
--
-- Proven before scheduling, not after: a manual flush against the live queue
-- returned {scanned:0,sent:0,expired:0} — no storm — and a freshly inserted
-- celebrate row returned {scanned:1,sent:1} and landed as delivered_unprovable
-- (ntfy returns a boolean, not a message id). Both directions confirmed, so this
-- is a dispatcher and not a silencer.
select cron.schedule(
  'apex-alert-dispatch-flush',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/apex-alert-dispatch',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
