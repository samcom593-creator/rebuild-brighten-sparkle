-- MP-SOCIAL-INBOX-TRUTH (2026-11-26). Sam: "fix the command center to show me the most up to date DMs that are relevant."
--
-- Measured on the live inbox (30d): 1,157 Instagram people, 27 of them split across TWO rows because
-- v_social_inbox_priority grouped by sender_handle, and the handle is "@username" when Meta resolves the
-- sender but the numeric IGSID when it cannot — and Sam's own replies (the webhook's echo rows) are ALWAYS
-- keyed by the IGSID. So 12 people Sam had already answered still sat in Hot / Waiting under their @name,
-- and one person's newest line hid in "Answered" under a number. Concrete: @adamrutt_ was a Hot row from
-- 11-07 ("Apex") while the same IGSID carried today's "Bro I'm super interested in sales" and Sam's reply
-- at 02:14Z. Since the Meta token died (~11-20 16:42Z, Meta code 190: session invalidated) every new
-- sender is a number, so the split now hits every fresh thread (14 people in 48h).
--
-- 1) Key a thread by PERSON: Instagram by external_id (the IGSID, present on 100% of rows), other sources
--    by handle (their external_id is per-message). Best handle = the latest @handle if any row has one.
-- 2) "Hot" = an unanswered BUSINESS message exists, even if a casual line followed it; ranked by recency.
-- 3) The instagram_token lane graded on token_expires_at (2026-12-28) and read "alive" while Meta refused
--    the token: it now goes dead the moment a lookup fails after the last success (stamps written by
--    instagram-webhook / the keepalive; seeded now from this probe).
-- Column list of the view is extended at the end only (last_business_at, last_business_intent, person_key).
--
-- Applied live 2026-11-27 02:42Z through the Supabase MCP apply_migration (version = file name).
-- After, as Sam: 500 inbox rows, 0 duplicate people (was 27 split), instagram_token lane = dead.

create or replace view public.v_social_inbox_priority as
 WITH msgs AS (
         SELECT i.source,
            CASE WHEN i.source = 'instagram' THEN COALESCE(NULLIF(i.external_id, ''), i.sender_handle) ELSE i.sender_handle END AS person_key,
            (array_agg(i.sender_handle ORDER BY (i.sender_handle LIKE '@%') DESC, i.received_at DESC) FILTER (WHERE i.sender_handle IS NOT NULL))[1] AS sender_handle,
            max(i.sender_name) AS sender_name,
            max(i.sender_avatar) AS avatar,
            max(i.received_at) FILTER (WHERE i.direction = 'inbound') AS last_in,
            max(i.received_at) FILTER (WHERE i.direction = 'outbound') AS last_out,
            count(*) FILTER (WHERE i.direction = 'inbound') AS inbound_count,
            (array_agg(i.intent ORDER BY i.received_at DESC) FILTER (WHERE i.direction = 'inbound' AND i.intent IS NOT NULL))[1] AS last_intent,
            max(i.received_at) FILTER (WHERE i.direction = 'inbound' AND i.intent = ANY (ARRAY['licensed','licensed_team','opportunity','mentorship','fitness','rentals','partnership','followup','winback'])) AS last_business_at,
            (array_agg(i.intent ORDER BY i.received_at DESC) FILTER (WHERE i.direction = 'inbound' AND i.intent = ANY (ARRAY['licensed','licensed_team','opportunity','mentorship','fitness','rentals','partnership','followup','winback'])))[1] AS last_business_intent,
            bool_or(i.intent = 'sam_thread') AS sam_touched,
            (array_agg("left"(i.body, 180) ORDER BY i.received_at DESC) FILTER (WHERE i.direction = 'inbound'))[1] AS last_text,
            (max(i.application_id::text))::uuid AS application_id,
            max(i.lead_score) AS lead_score,
            (array_agg((i.raw_payload ->> 'media_id') ORDER BY i.received_at DESC) FILTER (WHERE i.direction = 'inbound'))[1] AS media_id
           FROM inbox_messages i
          WHERE i.received_at > (now() - '30 days'::interval) AND i.sender_handle IS NOT NULL
          GROUP BY i.source, (CASE WHEN i.source = 'instagram' THEN COALESCE(NULLIF(i.external_id, ''), i.sender_handle) ELSE i.sender_handle END)
        )
 SELECT m.source,
    m.sender_handle,
    m.sender_name,
    m.avatar,
    m.last_in,
    m.last_out,
    m.inbound_count,
    m.last_intent,
    m.sam_touched,
    m.last_text,
    m.application_id,
    m.lead_score,
    m.media_id,
    (m.last_in > COALESCE(m.last_out, '1970-01-01 00:00:00+00'::timestamptz)) AS waiting_on_us,
        CASE
            WHEN m.last_intent = ANY (ARRAY['flirty','troll','spam','not_interested']) THEN 'silent'
            WHEN (a.status)::text = ANY (ARRAY['interview','contracting','paid','onboarding']) THEN 'booked'
            WHEN m.last_business_at > COALESCE(m.last_out, '1970-01-01 00:00:00+00'::timestamptz) THEN 'hot'
            WHEN m.sam_touched AND m.last_in > COALESCE(m.last_out, '1970-01-01 00:00:00+00'::timestamptz) THEN 'human_lane'
            WHEN m.last_in > COALESCE(m.last_out, '1970-01-01 00:00:00+00'::timestamptz) THEN 'waiting'
            ELSE 'answered'
        END AS bucket,
    (a.status)::text AS application_status,
    (a.license_status)::text AS application_license,
    m.last_business_at,
    m.last_business_intent,
    m.person_key
   FROM msgs m
     LEFT JOIN applications a ON a.id = m.application_id;

-- Token truth stamps (plain strings; the column is text and refuses JSON-quoted scalars).
insert into public.system_settings (key, value, updated_at) values
  ('meta_instagram_token_last_error_at', '2026-11-27T02:40:00Z', now()),
  ('meta_instagram_token_last_error', 'Meta code 190: Error validating access token: the session has been invalidated because the user changed their password or Facebook has changed the session for security reasons (probe from the command-center repair, 2026-11-27 02:40Z)', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace view public.v_social_lane_health as
 SELECT lane, tier, last_seen, expires_at, owner, fix,
        CASE
            WHEN (EXISTS (SELECT 1 FROM system_settings s WHERE s.key = 'instagram_automation_paused_at' AND NULLIF(btrim(s.value, '" '), '') IS NOT NULL))
                 AND lane = ANY (ARRAY['instagram_dm_replies','instagram_brain_answers','instagram_comments','ig_trial_reels']) THEN 'paused'
            WHEN last_seen IS NULL AND expires_at IS NULL THEN 'never'
            WHEN expires_at IS NOT NULL AND expires_at < (now() + grace) THEN 'dead'
            WHEN last_seen IS NOT NULL AND (now() - last_seen) > max_age THEN 'dead'
            ELSE 'alive'
        END AS verdict,
        CASE WHEN last_seen IS NULL THEN NULL::numeric ELSE round(EXTRACT(epoch FROM (now() - last_seen)) / 3600::numeric) END AS hours_silent,
        CASE WHEN expires_at IS NULL THEN NULL::numeric ELSE round(EXTRACT(epoch FROM (expires_at - now())) / 3600::numeric) END AS hours_left
   FROM ( VALUES
     ('youtube_oauth'::text,'page'::text,(SELECT min(youtube_connections.updated_at) FROM youtube_connections),NULL::timestamptz,'03:00:00'::interval,NULL::interval,'youtube-comments refreshes the Google access token on each poll and stamps youtube_connections.updated_at'::text,'The Google refresh token is dead (a Testing-mode OAuth app expires them after 7 days). Open the reconnect link signed in as the channel owner. Lasting fix: publish the OAuth consent screen (Testing -> In production) in Google Cloud.'::text),
     ('youtube_comments','report',(SELECT max(youtube_comment_events.created_at) FROM youtube_comment_events),NULL::timestamptz,'3 days'::interval,NULL::interval,'youtube-comments (pg_cron apex-youtube-comments-20m)','Comment volume follows the youtube_oauth lane. If youtube_oauth is alive and this is silent, check the apex-youtube-comments-20m cron and the function log.'),
     ('instagram_token','page',NULL::timestamptz,
        (SELECT CASE
           WHEN (SELECT NULLIF(btrim(e.value, '" '), '')::timestamptz FROM system_settings e WHERE e.key = 'meta_instagram_token_last_error_at')
                > COALESCE((SELECT NULLIF(btrim(o.value, '" '), '')::timestamptz FROM system_settings o WHERE o.key = 'meta_instagram_token_last_ok_at'), '-infinity'::timestamptz)
             THEN now() - interval '1 second'
           ELSE (SELECT min(instagram_connections.token_expires_at) FROM instagram_connections)
         END),
        NULL::interval,'7 days'::interval,
        'instagram-token-keepalive (pg_cron apex-instagram-token-keepalive-weekly) refreshes the 60-day token; instagram-webhook stamps meta_instagram_token_last_ok_at / _last_error_at on every sender lookup',
        'Meta refused the token (meta_instagram_token_last_error). Reconnect @sell4daddy: Dashboard > Admin > Integrations > Instagram > Connect (instagram-auth, force_reauth). Until then new DM senders show as numeric ids.'),
     ('instagram_webhook','page',(SELECT max(instagram_events.created_at) FROM instagram_events),NULL::timestamptz,'36:00:00'::interval,NULL::interval,'instagram-webhook (Meta delivers comments, mentions and messages here)','Meta stopped delivering: re-verify the webhook subscription (Meta app > Instagram > Webhooks) and the app token, then check the instagram-webhook function log.'),
     ('instagram_dm_inbound','page',(SELECT max(inbox_messages.received_at) FROM inbox_messages WHERE inbox_messages.source = 'instagram' AND inbox_messages.direction = 'inbound'),NULL::timestamptz,'36:00:00'::interval,NULL::interval,'manychat-webhook (ManyChat External Request on every DM)','ManyChat stopped posting to manychat-webhook: check the External Request action in ManyChat and the function log (MP-305 wave 0).'),
     ('instagram_dm_replies','page',(SELECT max(inbox_messages.received_at) FROM inbox_messages WHERE inbox_messages.source = 'instagram' AND inbox_messages.direction = 'outbound'),NULL::timestamptz,'36:00:00'::interval,NULL::interval,'send-instagram-dm / instagram-dm-nudge (pg_cron every 10 min)','Replies stopped leaving: check instagram_connections, v_ig_dm_delivery_truth and the send-instagram-dm log (MP-305 waves 1-3).'),
     ('instagram_comments','report',(SELECT max(ig_comment_events.created_at) FROM ig_comment_events),NULL::timestamptz,'3 days'::interval,NULL::interval,'instagram-comments-backfill (pg_cron 12,42 * * * *)','Check the apex-instagram-comments-backfill cron and the function log.'),
     ('tiktok_comments_in','page',(SELECT max(inbox_messages.received_at) FROM inbox_messages WHERE inbox_messages.source = 'tiktok' AND inbox_messages.direction = 'inbound'),NULL::timestamptz,'3 days'::interval,NULL::interval,'tiktok comment ingest -> manychat-webhook (ran once, 09-28..10-04, no owner process)','The one-week ingest had no scheduled owner. MP-307 wave 0 rebuilds it as a scheduled job that writes its own receipt.'),
     ('tiktok_replies','report',(SELECT max(inbox_messages.received_at) FROM inbox_messages WHERE inbox_messages.source = 'tiktok' AND inbox_messages.direction = 'outbound'),NULL::timestamptz,'3 days'::interval,NULL::interval,'tiktok reply lane (no delivery receipt exists)','MP-307 wave 1 builds the reply lane with a delivery receipt.'),
     ('metricool_instagram','report',(SELECT max(social_bot_analytics_snapshots.snapshot_ts) FROM social_bot_analytics_snapshots WHERE social_bot_analytics_snapshots.platform = 'instagram' AND social_bot_analytics_snapshots.subscribers IS NOT NULL),NULL::timestamptz,'3 days'::interval,NULL::interval,'business-ops/scripts/metricool-sync.sh (a NULL row is fake success and does not count)','Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'),
     ('metricool_tiktok','report',(SELECT max(social_bot_analytics_snapshots.snapshot_ts) FROM social_bot_analytics_snapshots WHERE social_bot_analytics_snapshots.platform = 'tiktok' AND social_bot_analytics_snapshots.subscribers IS NOT NULL),NULL::timestamptz,'3 days'::interval,NULL::interval,'business-ops/scripts/metricool-sync.sh','Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'),
     ('metricool_youtube','report',(SELECT max(social_bot_analytics_snapshots.snapshot_ts) FROM social_bot_analytics_snapshots WHERE social_bot_analytics_snapshots.platform = 'youtube' AND social_bot_analytics_snapshots.subscribers IS NOT NULL),NULL::timestamptz,'3 days'::interval,NULL::interval,'business-ops/scripts/metricool-sync.sh','Renew the Metricool token in metricool-sync.sh and make the script refuse to write a NULL snapshot.'),
     ('content_posts_instagram','report',(SELECT max(content_posts.stats_at) FROM content_posts WHERE content_posts.platform = 'instagram'),NULL::timestamptz,'3 days'::interval,NULL::interval,'business-ops/scripts/apex-instagram-sync.py writes content_posts.stats_at','Check apex-instagram-sync.py and its launchd job in business-ops.'),
     ('content_posts_youtube','report',(SELECT max(content_posts.stats_at) FROM content_posts WHERE content_posts.platform = 'youtube'),NULL::timestamptz,'3 days'::interval,NULL::interval,'business-ops/scripts/apex-youtube-sync.py writes content_posts.stats_at','Check apex-youtube-sync.py and its launchd job in business-ops.'),
     ('content_posts_tiktok','report',(SELECT max(content_posts.stats_at) FROM content_posts WHERE content_posts.platform = 'tiktok'),NULL::timestamptz,'3 days'::interval,NULL::interval,'no tiktok post sync exists','MP-307 wave 2 adds the TikTok post sync.'),
     ('instagram_brain_answers','page',(SELECT COALESCE(min(m.received_at), now()) FROM inbox_messages m WHERE m.source = 'instagram' AND m.direction = 'inbound' AND COALESCE((m.raw_payload ->> 'channel'), 'dm') = ANY (ARRAY['dm','story']) AND m.received_at >= (now() - '06:00:00'::interval) AND m.received_at <= (now() - '00:15:00'::interval) AND m.intent = ANY (ARRAY['opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup','winback','agent_support','greeting','assistant_ask','socials']) AND (m.raw_payload ->> 'muted') IS NULL AND NOT (EXISTS (SELECT 1 FROM inbox_messages o WHERE o.source = 'instagram' AND o.direction = 'outbound' AND o.sender_handle = m.sender_handle AND o.received_at >= m.received_at AND (o.raw_payload ->> 'error') IS NULL))),NULL::timestamptz,'00:15:00'::interval,NULL::interval,'manychat-webhook, the DM brain: every business DM answered inside 15 minutes','A business DM has waited over 15 minutes with no reply. Check manychat-webhook logs (ANTHROPIC_API_KEY, the ManyChat External Request, the Meta token behind send-instagram-dm) and probe it: POST manychat-webhook {dry_run:true, text:"im licensed"} with the bot token.'),
     ('ig_trial_reels','page',(SELECT CASE WHEN NOT (EXISTS (SELECT 1 FROM ig_trial_reel_queue q WHERE q.status = ANY (ARRAY['pending','container']))) THEN now() ELSE COALESCE((SELECT max(q.published_at) FROM ig_trial_reel_queue q WHERE q.status = 'published'), (SELECT min(q.created_at) FROM ig_trial_reel_queue q WHERE q.status = ANY (ARRAY['pending','container']))) END),NULL::timestamptz,'2 days'::interval,NULL::interval,'ig-trial-reel-publish (pg_cron apex-ig-trial-reels, every 20 min) posts queued clips to @sell4daddy as Trial Reels','Clips are waiting and nothing has published in 2 days. Read ig_trial_reel_queue.error on the newest failed/pending rows. A permission error means the token lacks instagram_business_content_publish: reconnect via instagram-auth?link=1.'),
     ('ig_trial_reels_queue','report',(SELECT max(q.created_at) FROM ig_trial_reel_queue q),NULL::timestamptz,'7 days'::interval,NULL::interval,'business-ops/scripts/ig-trial-reel-stock.py (launchd com.samjames.apex.ig-trial-reel-stock, hourly) fills the queue from Dropbox Reels/Trial Queue','No new clip queued in 7 days. Drop vertical clips in Dropbox Reels/Trial Queue, or check the stocker log in business-ops/logs/ig-trial-reels/.')
   ) v(lane, tier, last_seen, expires_at, max_age, grace, owner, fix);
