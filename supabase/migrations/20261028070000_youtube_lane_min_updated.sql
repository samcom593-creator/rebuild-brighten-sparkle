-- MP-307 wave 1 (2026-10-28): while reconnecting YouTube, the first consent attached a second, 4-video channel
-- (UC_d4bznWhBgNCGqtN0V94CQ) next to @sell4daddy. The youtube_oauth lane read max(updated_at) across
-- youtube_connections, so one freshly connected spare channel would have kept the lane alive while the real
-- channel's token lay dead: a false-alive by construction. The spare row was deleted; the lane now reads the
-- OLDEST refresh across connections, so any dead channel shows. Every other row is unchanged (the view is
-- restated in full because a VALUES list cannot be edited in place).
create or replace view public.v_social_lane_health as
select v.lane, v.tier, v.last_seen, v.expires_at, v.owner, v.fix,
  case
    when v.last_seen is null and v.expires_at is null then 'never'
    when v.expires_at is not null and v.expires_at < now() + v.grace then 'dead'
    when v.last_seen is not null and now() - v.last_seen > v.max_age then 'dead'
    else 'alive' end as verdict,
  case when v.last_seen is null then null else round(extract(epoch from (now() - v.last_seen)) / 3600) end as hours_silent,
  case when v.expires_at is null then null else round(extract(epoch from (v.expires_at - now())) / 3600) end as hours_left
from (values
  ('youtube_oauth'::text, 'page'::text,
    (select min(updated_at) from public.youtube_connections)::timestamptz, null::timestamptz, interval '3 hours', null::interval,
    'youtube-comments refreshes the Google access token on each poll and stamps youtube_connections.updated_at'::text,
    'The Google refresh token is dead (a Testing-mode OAuth app expires them after 7 days). Open the reconnect link signed in as the channel owner. Lasting fix: publish the OAuth consent screen (Testing -> In production) in Google Cloud.'::text),
  ('youtube_comments', 'report',
    (select max(created_at) from public.youtube_comment_events), null, interval '3 days', null,
    'youtube-comments (pg_cron apex-youtube-comments-20m)',
    'Comment volume follows the youtube_oauth lane. If youtube_oauth is alive and this is silent, check the apex-youtube-comments-20m cron and the function log.'),
  ('instagram_token', 'page',
    null, (select min(token_expires_at) from public.instagram_connections), null, interval '7 days',
    'instagram-token-keepalive (pg_cron apex-instagram-token-keepalive-weekly) probes Meta and refreshes the 60-day token',
    'The keepalive missed at least one week. Call instagram-token-keepalive with force=1; if Meta says the token is invalid, reconnect via instagram-auth?link=1.'),
  ('instagram_webhook', 'page',
    (select max(created_at) from public.instagram_events), null, interval '36 hours', null,
    'instagram-webhook (Meta delivers comments, mentions and messages here)',
    'Meta stopped delivering: re-verify the webhook subscription (Meta app > Instagram > Webhooks) and the app token, then check the instagram-webhook function log.'),
  ('instagram_dm_inbound', 'page',
    (select max(received_at) from public.inbox_messages where source = 'instagram' and direction = 'inbound'), null, interval '36 hours', null,
    'manychat-webhook (ManyChat External Request on every DM)',
    'ManyChat stopped posting to manychat-webhook: check the External Request action in ManyChat and the function log (MP-305 wave 0).'),
  ('instagram_dm_replies', 'page',
    (select max(received_at) from public.inbox_messages where source = 'instagram' and direction = 'outbound'), null, interval '36 hours', null,
    'send-instagram-dm / instagram-dm-nudge (pg_cron every 10 min)',
    'Replies stopped leaving: check instagram_connections, v_ig_dm_delivery_truth and the send-instagram-dm log (MP-305 waves 1-3).'),
  ('instagram_comments', 'report',
    (select max(created_at) from public.ig_comment_events), null, interval '3 days', null,
    'instagram-comments-backfill (pg_cron 12,42 * * * *)',
    'Check the apex-instagram-comments-backfill cron and the function log.'),
  ('tiktok_comments_in', 'page',
    (select max(received_at) from public.inbox_messages where source = 'tiktok' and direction = 'inbound'), null, interval '3 days', null,
    'tiktok comment ingest -> manychat-webhook (ran once, 09-28..10-04, no owner process)',
    'The one-week ingest had no scheduled owner. MP-307 wave 0 rebuilds it as a scheduled job that writes its own receipt.'),
  ('tiktok_replies', 'report',
    (select max(received_at) from public.inbox_messages where source = 'tiktok' and direction = 'outbound'), null, interval '3 days', null,
    'tiktok reply lane (no delivery receipt exists)',
    'MP-307 wave 1 builds the reply lane with a delivery receipt.'),
  ('metricool_instagram', 'report',
    (select max(snapshot_ts) from public.social_bot_analytics_snapshots where platform = 'instagram' and subscribers is not null), null, interval '3 days', null,
    'business-ops/scripts/metricool-sync.sh (a NULL row is fake success and does not count)',
    'Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'),
  ('metricool_tiktok', 'report',
    (select max(snapshot_ts) from public.social_bot_analytics_snapshots where platform = 'tiktok' and subscribers is not null), null, interval '3 days', null,
    'business-ops/scripts/metricool-sync.sh',
    'Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'),
  ('metricool_youtube', 'report',
    (select max(snapshot_ts) from public.social_bot_analytics_snapshots where platform = 'youtube' and subscribers is not null), null, interval '3 days', null,
    'business-ops/scripts/metricool-sync.sh',
    'Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'),
  ('content_posts_instagram', 'report',
    (select max(stats_at) from public.content_posts where platform = 'instagram'), null, interval '3 days', null,
    'business-ops/scripts/apex-instagram-sync.py writes content_posts.stats_at',
    'Check apex-instagram-sync.py and its launchd job in business-ops.'),
  ('content_posts_youtube', 'report',
    (select max(stats_at) from public.content_posts where platform = 'youtube'), null, interval '3 days', null,
    'business-ops/scripts/apex-youtube-sync.py writes content_posts.stats_at',
    'Check apex-youtube-sync.py and its launchd job in business-ops.'),
  ('content_posts_tiktok', 'report',
    (select max(stats_at) from public.content_posts where platform = 'tiktok'), null, interval '3 days', null,
    'no tiktok post sync exists',
    'MP-307 wave 2 adds the TikTok post sync.'),
  ('instagram_brain_answers', 'page',
    (select coalesce(min(m.received_at), now()) from public.inbox_messages m
      where m.source = 'instagram' and m.direction = 'inbound'
        and coalesce(m.raw_payload->>'channel', 'dm') in ('dm', 'story')
        and m.received_at between now() - interval '6 hours' and now() - interval '15 minutes'
        and m.intent in ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup','winback','agent_support','greeting','assistant_ask','socials')
        and m.raw_payload->>'muted' is null
        and not exists (select 1 from public.inbox_messages o where o.source = 'instagram' and o.direction = 'outbound'
                          and o.sender_handle = m.sender_handle and o.received_at >= m.received_at and o.raw_payload->>'error' is null)),
    null, interval '15 minutes', null,
    'manychat-webhook, the DM brain: every business DM answered inside 15 minutes',
    'A business DM has waited over 15 minutes with no reply. Check manychat-webhook logs (ANTHROPIC_API_KEY, the ManyChat External Request, the Meta token behind send-instagram-dm) and probe it: POST manychat-webhook {dry_run:true, text:"im licensed"} with the bot token.')
) as v(lane, tier, last_seen, expires_at, max_age, grace, owner, fix);
