-- MP-311 Instagram Trial Reels auto-poster (2026-10-28).
-- Sam: "use my main page, just make them trials". Every clip goes to @sell4daddy as a
-- Trial Reel (shown to non-followers first; graduates to followers only if it performs).
-- Queue is filled by business-ops/scripts/ig-trial-reel-stock.py from Dropbox
-- "Reels/Trial Queue"; ig-trial-reel-publish drains it on pg_cron.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ig-trial-reels', 'ig-trial-reels', true, 104857600, array['video/mp4'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.ig_trial_reel_queue (
  id            uuid primary key default gen_random_uuid(),
  source_path   text not null unique,          -- Dropbox path the clip came from (dedupe key)
  storage_path  text not null,                 -- object in bucket ig-trial-reels
  video_url     text not null,                 -- public URL Meta fetches
  caption       text not null default '',
  duration_s    numeric,
  status        text not null default 'pending' check (status in ('pending','container','published','failed')),
  container_id  text,
  container_at  timestamptz,
  media_id      text,
  permalink     text,
  attempts      int not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);
create index if not exists ig_trial_reel_queue_status_idx on public.ig_trial_reel_queue (status, created_at);
alter table public.ig_trial_reel_queue enable row level security;
revoke all on public.ig_trial_reel_queue from anon, authenticated;

insert into public.system_settings (key, value)
values ('ig_trial_reels_per_day', '2'), ('ig_trial_reels_min_gap_hours', '5')
on conflict (key) do nothing;

create or replace view public.v_social_lane_health as
 SELECT lane,
    tier,
    last_seen,
    expires_at,
    owner,
    fix,
        CASE
            WHEN last_seen IS NULL AND expires_at IS NULL THEN 'never'::text
            WHEN expires_at IS NOT NULL AND expires_at < (now() + grace) THEN 'dead'::text
            WHEN last_seen IS NOT NULL AND (now() - last_seen) > max_age THEN 'dead'::text
            ELSE 'alive'::text
        END AS verdict,
        CASE
            WHEN last_seen IS NULL THEN NULL::numeric
            ELSE round(EXTRACT(epoch FROM now() - last_seen) / 3600::numeric)
        END AS hours_silent,
        CASE
            WHEN expires_at IS NULL THEN NULL::numeric
            ELSE round(EXTRACT(epoch FROM expires_at - now()) / 3600::numeric)
        END AS hours_left
   FROM ( VALUES ('youtube_oauth'::text,'page'::text,( SELECT min(youtube_connections.updated_at) AS min
                   FROM youtube_connections),NULL::timestamp with time zone,'03:00:00'::interval,NULL::interval,'youtube-comments refreshes the Google access token on each poll and stamps youtube_connections.updated_at'::text,'The Google refresh token is dead (a Testing-mode OAuth app expires them after 7 days). Open the reconnect link signed in as the channel owner. Lasting fix: publish the OAuth consent screen (Testing -> In production) in Google Cloud.'::text), ('youtube_comments'::text,'report'::text,( SELECT max(youtube_comment_events.created_at) AS max
                   FROM youtube_comment_events),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'youtube-comments (pg_cron apex-youtube-comments-20m)'::text,'Comment volume follows the youtube_oauth lane. If youtube_oauth is alive and this is silent, check the apex-youtube-comments-20m cron and the function log.'::text), ('instagram_token'::text,'page'::text,NULL::timestamp with time zone,( SELECT min(instagram_connections.token_expires_at) AS min
                   FROM instagram_connections),NULL::interval,'7 days'::interval,'instagram-token-keepalive (pg_cron apex-instagram-token-keepalive-weekly) probes Meta and refreshes the 60-day token'::text,'The keepalive missed at least one week. Call instagram-token-keepalive with force=1; if Meta says the token is invalid, reconnect via instagram-auth?link=1.'::text), ('instagram_webhook'::text,'page'::text,( SELECT max(instagram_events.created_at) AS max
                   FROM instagram_events),NULL::timestamp with time zone,'36:00:00'::interval,NULL::interval,'instagram-webhook (Meta delivers comments, mentions and messages here)'::text,'Meta stopped delivering: re-verify the webhook subscription (Meta app > Instagram > Webhooks) and the app token, then check the instagram-webhook function log.'::text), ('instagram_dm_inbound'::text,'page'::text,( SELECT max(inbox_messages.received_at) AS max
                   FROM inbox_messages
                  WHERE inbox_messages.source = 'instagram'::text AND inbox_messages.direction = 'inbound'::text),NULL::timestamp with time zone,'36:00:00'::interval,NULL::interval,'manychat-webhook (ManyChat External Request on every DM)'::text,'ManyChat stopped posting to manychat-webhook: check the External Request action in ManyChat and the function log (MP-305 wave 0).'::text), ('instagram_dm_replies'::text,'page'::text,( SELECT max(inbox_messages.received_at) AS max
                   FROM inbox_messages
                  WHERE inbox_messages.source = 'instagram'::text AND inbox_messages.direction = 'outbound'::text),NULL::timestamp with time zone,'36:00:00'::interval,NULL::interval,'send-instagram-dm / instagram-dm-nudge (pg_cron every 10 min)'::text,'Replies stopped leaving: check instagram_connections, v_ig_dm_delivery_truth and the send-instagram-dm log (MP-305 waves 1-3).'::text), ('instagram_comments'::text,'report'::text,( SELECT max(ig_comment_events.created_at) AS max
                   FROM ig_comment_events),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'instagram-comments-backfill (pg_cron 12,42 * * * *)'::text,'Check the apex-instagram-comments-backfill cron and the function log.'::text), ('tiktok_comments_in'::text,'page'::text,( SELECT max(inbox_messages.received_at) AS max
                   FROM inbox_messages
                  WHERE inbox_messages.source = 'tiktok'::text AND inbox_messages.direction = 'inbound'::text),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'tiktok comment ingest -> manychat-webhook (ran once, 09-28..10-04, no owner process)'::text,'The one-week ingest had no scheduled owner. MP-307 wave 0 rebuilds it as a scheduled job that writes its own receipt.'::text), ('tiktok_replies'::text,'report'::text,( SELECT max(inbox_messages.received_at) AS max
                   FROM inbox_messages
                  WHERE inbox_messages.source = 'tiktok'::text AND inbox_messages.direction = 'outbound'::text),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'tiktok reply lane (no delivery receipt exists)'::text,'MP-307 wave 1 builds the reply lane with a delivery receipt.'::text), ('metricool_instagram'::text,'report'::text,( SELECT max(social_bot_analytics_snapshots.snapshot_ts) AS max
                   FROM social_bot_analytics_snapshots
                  WHERE social_bot_analytics_snapshots.platform = 'instagram'::text AND social_bot_analytics_snapshots.subscribers IS NOT NULL),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'business-ops/scripts/metricool-sync.sh (a NULL row is fake success and does not count)'::text,'Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'::text), ('metricool_tiktok'::text,'report'::text,( SELECT max(social_bot_analytics_snapshots.snapshot_ts) AS max
                   FROM social_bot_analytics_snapshots
                  WHERE social_bot_analytics_snapshots.platform = 'tiktok'::text AND social_bot_analytics_snapshots.subscribers IS NOT NULL),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'business-ops/scripts/metricool-sync.sh'::text,'Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'::text), ('metricool_youtube'::text,'report'::text,( SELECT max(social_bot_analytics_snapshots.snapshot_ts) AS max
                   FROM social_bot_analytics_snapshots
                  WHERE social_bot_analytics_snapshots.platform = 'youtube'::text AND social_bot_analytics_snapshots.subscribers IS NOT NULL),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'business-ops/scripts/metricool-sync.sh'::text,'Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'::text), ('content_posts_instagram'::text,'report'::text,( SELECT max(content_posts.stats_at) AS max
                   FROM content_posts
                  WHERE content_posts.platform = 'instagram'::text),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'business-ops/scripts/apex-instagram-sync.py writes content_posts.stats_at'::text,'Check apex-instagram-sync.py and its launchd job in business-ops.'::text), ('content_posts_youtube'::text,'report'::text,( SELECT max(content_posts.stats_at) AS max
                   FROM content_posts
                  WHERE content_posts.platform = 'youtube'::text),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'business-ops/scripts/apex-youtube-sync.py writes content_posts.stats_at'::text,'Check apex-youtube-sync.py and its launchd job in business-ops.'::text), ('content_posts_tiktok'::text,'report'::text,( SELECT max(content_posts.stats_at) AS max
                   FROM content_posts
                  WHERE content_posts.platform = 'tiktok'::text),NULL::timestamp with time zone,'3 days'::interval,NULL::interval,'no tiktok post sync exists'::text,'MP-307 wave 2 adds the TikTok post sync.'::text), ('instagram_brain_answers'::text,'page'::text,( SELECT COALESCE(min(m.received_at), now()) AS "coalesce"
                   FROM inbox_messages m
                  WHERE m.source = 'instagram'::text AND m.direction = 'inbound'::text AND (COALESCE(m.raw_payload ->> 'channel'::text, 'dm'::text) = ANY (ARRAY['dm'::text, 'story'::text])) AND m.received_at >= (now() - '06:00:00'::interval) AND m.received_at <= (now() - '00:15:00'::interval) AND (m.intent = ANY (ARRAY['opportunity'::text, 'licensed'::text, 'licensed_team'::text, 'mentorship'::text, 'fitness'::text, 'rentals'::text, 'partnership'::text, 'followup'::text, 'winback'::text, 'agent_support'::text, 'greeting'::text, 'assistant_ask'::text, 'socials'::text])) AND (m.raw_payload ->> 'muted'::text) IS NULL AND NOT (EXISTS ( SELECT 1
                           FROM inbox_messages o
                          WHERE o.source = 'instagram'::text AND o.direction = 'outbound'::text AND o.sender_handle = m.sender_handle AND o.received_at >= m.received_at AND (o.raw_payload ->> 'error'::text) IS NULL))),NULL::timestamp with time zone,'00:15:00'::interval,NULL::interval,'manychat-webhook, the DM brain: every business DM answered inside 15 minutes'::text,'A business DM has waited over 15 minutes with no reply. Check manychat-webhook logs (ANTHROPIC_API_KEY, the ManyChat External Request, the Meta token behind send-instagram-dm) and probe it: POST manychat-webhook {dry_run:true, text:"im licensed"} with the bot token.'::text), ('ig_trial_reels'::text,'page'::text,( SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.ig_trial_reel_queue q WHERE q.status IN ('pending','container')) THEN now()
                   ELSE COALESCE((SELECT max(q.published_at) FROM public.ig_trial_reel_queue q WHERE q.status = 'published'), (SELECT min(q.created_at) FROM public.ig_trial_reel_queue q WHERE q.status IN ('pending','container'))) END),NULL::timestamp with time zone,'2 days'::interval,NULL::interval,'ig-trial-reel-publish (pg_cron apex-ig-trial-reels, every 20 min) posts queued clips to @sell4daddy as Trial Reels'::text,'Clips are waiting and nothing has published in 2 days. Read ig_trial_reel_queue.error on the newest failed/pending rows. A permission error means the token lacks instagram_business_content_publish: reconnect via instagram-auth?link=1.'::text), ('ig_trial_reels_queue'::text,'report'::text,( SELECT max(q.created_at) FROM public.ig_trial_reel_queue q),NULL::timestamp with time zone,'7 days'::interval,NULL::interval,'business-ops/scripts/ig-trial-reel-stock.py (launchd com.samjames.apex.ig-trial-reel-stock, hourly) fills the queue from Dropbox Reels/Trial Queue'::text,'No new clip queued in 7 days. Drop vertical clips in Dropbox Reels/Trial Queue, or check the stocker log in business-ops/logs/ig-trial-reels/.'::text)) v(lane, tier, last_seen, expires_at, max_age, grace, owner, fix);
revoke all on public.v_social_lane_health from anon, authenticated;

select cron.unschedule('apex-ig-trial-reels') where exists (select 1 from cron.job where jobname = 'apex-ig-trial-reels');
select cron.schedule('apex-ig-trial-reels', '4,24,44 * * * *', $cron$ select net.http_post(url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/ig-trial-reel-publish', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token'), 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 120000) $cron$);
