-- 20260907203000_unlicensed_slack_room_and_next_step_urls.sql
-- Sam, 2026-09-07, on the phone with a stuck unlicensed applicant:
--   "every unlicensed application is put into the unlicensed chat ... when
--    they're put in, the bot should automatically tell them to send a
--    screenshot of confirmation once they purchase the course."
--
-- 1) slack_channel_welcomes — one row per (channel, slack user) the
--    slack-unlicensed-welcome function has greeted, so the 5-minute sweep
--    never welcomes anyone twice. A failed post leaves no row -> retried.
-- 2) pg_cron: sweep #unlicensed every 5 minutes.
-- 3) messaging_destinations.general_unlicensed pointed at C0BSUGBR62G
--    (general-unlicensed), which is ARCHIVED with 0 members; the live room is
--    #unlicensed C0BUTAKNB38 (5 members). Repoint + enable.
-- 4) next_step_stages.next_action_url: five of fifteen were 404s since the
--    2026-05-19 seed (/welcome, /schedule-exam, /fingerprints, /contracting,
--    /infield) — the first automated text every applicant gets pointed at a
--    404. /training and the Zoom "/j/apex-seminar" slug were dead too.

create table if not exists public.slack_channel_welcomes (
  channel_id     text not null,
  slack_user_id  text not null,
  message_ts     text,
  welcomed_at    timestamptz not null default now(),
  primary key (channel_id, slack_user_id)
);
alter table public.slack_channel_welcomes enable row level security;
-- service role only (the edge function). No grants to authenticated/anon.
grant all on public.slack_channel_welcomes to service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='apex-slack-unlicensed-welcome') THEN
    PERFORM cron.unschedule('apex-slack-unlicensed-welcome');
  END IF;
  PERFORM cron.schedule('apex-slack-unlicensed-welcome','*/5 * * * *', $j$
    SELECT net.http_post(
      url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/slack-unlicensed-welcome',
      headers := jsonb_build_object('Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),'Content-Type','application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  $j$);
END $$;

update public.messaging_destinations
   set channel_id = 'C0BUTAKNB38', channel_name = 'unlicensed', is_enabled = true, updated_at = now()
 where purpose = 'general_unlicensed' and channel_id = 'C0BSUGBR62G';

update public.next_step_stages set next_action_url = v.url
from (values
  ('applied',              'https://apex-financial.org/vsl'),
  ('watched_vsl',          'https://apex-financial.org/apply'),
  ('booked_seminar',       'https://apex-financial.org/seminar'),
  ('finished_prelicense',  'https://apex-financial.org/get-licensed#licensing-actions'),
  ('passed_exam',          'https://apex-financial.org/get-licensed#licensing-actions'),
  ('contracting',          'https://apex-financial.org/start-contracting'),
  ('hired',                'https://apex-financial.org/dashboard/training/sales-course'),
  ('course_started',       'https://apex-financial.org/dashboard/training/sales-course'),
  ('course_completed',     'https://apex-financial.org/dashboard/getting-started')
) as v(stage_key, url)
where next_step_stages.stage_key = v.stage_key;
