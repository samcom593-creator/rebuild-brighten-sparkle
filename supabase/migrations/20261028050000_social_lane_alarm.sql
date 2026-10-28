-- MP-308 Social Command Center, wave 1: the lane alarm (2026-10-28). Sam: "metrics to make sure this never
-- happens again. These are major gaps, like tokens ending, things just webhook not working."
-- Measured the day this shipped:
--   * YouTube's Google refresh token died 2026-10-05 02:00 (a Testing-mode OAuth app expires refresh tokens after
--     7 days; the channel was connected 09-28). youtube-comments has reported token_refresh_failed every 20 minutes
--     since, while cron.job_run_details recorded 144 of 144 runs 'succeeded' in 48h: that column measures queueing,
--     not answering, and nothing paged.
--   * TikTok comment ingest fed 813 comments between 09-28 and 10-04 (max gap 4.0h) and then stopped.
--   * metricool-sync.sh has written NULL metric rows since 08-25 (instagram) / 09-04 (tiktok) / 05-19 (youtube).
--   * Instagram: the long-lived token expires 2026-12-08; instagram-token-keepalive (weekly) probes and refreshes it.
-- Thresholds come from the measured max gap between events over the last 30 days while each lane was alive
-- (ig_dm_in 14.6h, ig_dm_out 17.4h, instagram_events 14.5h, ig_comments 26.7h, yt_comments 17.3h) at roughly 2x
-- the worst observed, so a page-tier lane fires on a true death and, honestly, maybe once on a very quiet weekend.
-- It is not claimed unfireable.
-- Rules (the alerting waves of Aug 2026, apex-doctor Check #19's header): a lane that was never built is listed,
-- never paged; a lane that was alive and stopped pages once when it dies and once a day while it stays dead, each
-- with its fix; report-tier lanes (analytics syncs, comment volume = weather) show on the page and in the Sunday
-- report, never on Sam's phone. The alarm writes its own receipt (social_lane_alert_state.checked_at) so the
-- doctor grades it on its own log, never on cron.job_run_details.

drop view if exists public.v_social_lane_health;
create view public.v_social_lane_health as
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
    (select max(updated_at) from public.youtube_connections)::timestamptz, null::timestamptz, interval '3 hours', null::interval,
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
    'MP-307 wave 2 adds the TikTok post sync.')
) as v(lane, tier, last_seen, expires_at, max_age, grace, owner, fix);

-- The alarm's own log. One row per lane; checked_at is the receipt that the alarm ran.
create table if not exists public.social_lane_alert_state (
  lane text primary key,
  tier text not null,
  verdict text not null,
  dead_since timestamptz,
  last_alerted_at timestamptz,
  checked_at timestamptz not null default now()
);
alter table public.social_lane_alert_state enable row level security;
revoke all on public.social_lane_alert_state from public, anon, authenticated;

create or replace function public.fn_social_lane_alert()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r record;
  v_new text[] := '{}';
  v_due text[] := '{}';
  v_lines text := '';
  v_subject text;
  v_dead integer := 0;
begin
  for r in select * from public.v_social_lane_health loop
    insert into public.social_lane_alert_state as s (lane, tier, verdict, dead_since, checked_at)
    values (r.lane, r.tier, r.verdict, case when r.verdict = 'dead' then coalesce(r.last_seen, now()) end, now())
    on conflict (lane) do update set
      tier = excluded.tier,
      verdict = excluded.verdict,
      dead_since = case when excluded.verdict = 'dead' then coalesce(s.dead_since, excluded.dead_since) else null end,
      last_alerted_at = case when excluded.verdict = 'dead' then s.last_alerted_at else null end,
      checked_at = now();
  end loop;

  for r in select s.lane, s.dead_since, s.last_alerted_at, h.hours_silent, h.hours_left, h.fix
           from public.social_lane_alert_state s join public.v_social_lane_health h using (lane)
           where s.tier = 'page' and s.verdict = 'dead' order by s.dead_since loop
    v_dead := v_dead + 1;
    if r.last_alerted_at is null then v_new := v_new || r.lane;
    elsif r.last_alerted_at < now() - interval '24 hours' then v_due := v_due || r.lane; end if;
    v_lines := v_lines || format('<li><b>%s</b>: %s. %s</li>', r.lane,
      case when r.hours_left is not null then format('token expires in %sh', r.hours_left) else format('silent for %sh', r.hours_silent) end,
      coalesce(r.fix, ''));
  end loop;

  if cardinality(v_new) > 0 or cardinality(v_due) > 0 then
    v_subject := format('Social lane%s dead: %s', case when v_dead > 1 then 's' else '' end, array_to_string(v_new || v_due, ', '));
    insert into public.bot_alerts(source, event_type, severity, subject, body, sms_body, action_link, channels)
    values ('cron', 'social_lane_dead', 'critical', v_subject,
      format('<p>%s social lane(s) that used to work are dead. Each carries its fix.</p><ul>%s</ul><p>Social Command Center: https://apex-financial.org/dashboard/social-command</p>', v_dead, v_lines),
      left(format('APEX: %s. Fix: apex-financial.org/dashboard/social-command', v_subject), 300),
      'https://apex-financial.org/dashboard/social-command',
      array['email']::text[]);
    update public.social_lane_alert_state set last_alerted_at = now() where lane = any(v_new || v_due);
  end if;

  return jsonb_build_object('dead_page_lanes', v_dead, 'paged_new', to_jsonb(v_new), 'paged_reminder', to_jsonb(v_due), 'checked_at', now());
end $fn$;
revoke all on function public.fn_social_lane_alert() from public, anon, authenticated;

do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'apex-social-lane-watch' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('apex-social-lane-watch', '7,37 * * * *', 'select public.fn_social_lane_alert()');
end $$;

-- The page's one read grows the alarm's own receipt and the YouTube reconnect link (an HMAC of the bot token,
-- never the token; only Sam and Aisha can call this).
create or replace function public.social_command_center()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_sold_calls() then
    raise exception 'The social command center is for Sam and Aisha' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'inbox', (select coalesce(jsonb_agg(to_jsonb(i) order by
                case i.bucket when 'hot' then 0 when 'human_lane' then 1 when 'waiting' then 2 when 'booked' then 3 when 'answered' then 4 else 5 end,
                i.last_in desc), '[]'::jsonb)
              from (select * from public.v_social_inbox_priority
                    where bucket in ('hot','human_lane','waiting','booked') or last_in > now() - interval '2 days'
                    order by case bucket when 'hot' then 0 when 'human_lane' then 1 when 'waiting' then 2 when 'booked' then 3 when 'answered' then 4 else 5 end,
                             last_in desc
                    limit 500) i),
    'funnel', (select coalesce(jsonb_agg(to_jsonb(f) order by f.applications desc, f.people_in desc), '[]'::jsonb) from public.v_social_funnel_30d f),
    'pulls', (select coalesce(jsonb_agg(to_jsonb(w) order by w.applications desc), '[]'::jsonb) from (select * from public.v_social_what_pulls_90d order by applications desc limit 40) w),
    'lanes', (select coalesce(jsonb_agg(to_jsonb(l) order by l.verdict desc, l.lane), '[]'::jsonb) from public.v_social_lane_health l),
    'alarm', (select jsonb_build_object(
                'checked_at', max(s.checked_at),
                'dead_page_lanes', count(*) filter (where s.tier = 'page' and s.verdict = 'dead'),
                'last_alert_at', (select max(b.created_at) from public.bot_alerts b where b.event_type = 'social_lane_dead'),
                'last_alert_subject', (select b.subject from public.bot_alerts b where b.event_type = 'social_lane_dead' order by b.created_at desc limit 1))
              from public.social_lane_alert_state s),
    'youtube_reconnect_url', (select 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/youtube-auth?k='
                                || encode(extensions.hmac(convert_to('youtube-auth-connect-v1', 'UTF8'), convert_to(s.decrypted_secret, 'UTF8'), 'sha256'), 'hex')
                              from vault.decrypted_secrets s where s.name = 'apex_bot_token' limit 1),
    'drafts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.draft_date desc nulls last, d.created_at desc), '[]'::jsonb)
               from (select id, draft_date, platform, slot, pillar, title, hook, cta, status, approved_at, shipped_at, notes, created_at
                     from public.social_bot_drafts where status in ('awaiting_approval','awaiting_film','approved')
                     order by draft_date desc nulls last, created_at desc limit 150) d),
    'generated_at', now());
end $$;
revoke all on function public.social_command_center() from public, anon;
grant execute on function public.social_command_center() to authenticated, service_role;
