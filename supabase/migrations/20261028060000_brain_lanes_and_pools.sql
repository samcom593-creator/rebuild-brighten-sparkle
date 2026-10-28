-- MP-308 wave 2 (2026-10-28): the DM brain's goal lanes, the alarm that watches the brain itself, and the two call
-- lists the brain keeps warm. Sam: "hire as many people as possible ... find as many leads for ReadyMode from old
-- applications as possible, bring back as many agents as possible ... while taking the stress of responding to DMs off."
-- Measured before writing: 7d inbound intents on Instagram DMs were casual 34 people, opportunity 10, props 8,
-- licensed 1; business DMs were answered inside 10 min (opportunity 3/4, mentorship 2/2, greeting 2/2) while
-- 'casual' got 1 of 16 replies, and the 1,028 'failed' outbound rows were all comment private-replies Meta refuses
-- after the window (settled dead by MP-305 at 02:30Z, 0 new since). Old applications with a dialable number, not
-- Do Not Call, not on the team, status new/reviewing/no_pickup/attended_no_show: 664 (75 already licensed, 623
-- untouched 30+ days). Agents inactive and not bad_business: 66 (51 with a phone). Drafts awaiting approval: 921,
-- 870 older than 14 days (oldest 2025-12-10), nothing posts approved ones.
--
-- 1. Lane instagram_brain_answers (page tier): the oldest business DM that has waited > 15 min with no reply.
-- 2. v_readymode_lead_pool / v_agent_winback_pool: live, owner-rights, granted to nobody; social_lead_csv() turns them
--    into ReadyMode-ready CSV behind a 64-hex feed key (same contract as contracting-sheet-csv).
-- 3. social_command_center() gains 'pools' (counts + the two download URLs).
-- 4. Unapproved drafts older than 14 days are archived (MP-305's own rule), weekly on pg_cron from now on.

-- 1. The lane that watches the brain.
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

-- 2a. Old applicants the dialer should call. One row per phone, licensed first, longest-untouched first.
create or replace view public.v_readymode_lead_pool as
with dnc as (
  select distinct right(regexp_replace(coalesce(lead_phone, ''), '\D', '', 'g'), 10) as p
    from public.readymode_dialer_calls where lower(btrim(disposition)) = 'do not call'),
team as (
  select distinct right(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), 10) as p
    from public.agents a join public.profiles pr on pr.user_id = a.user_id
   where a.status = 'active' and pr.phone is not null),
base as (
  select a.id as application_id, a.first_name, a.last_name, a.phone,
         right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) as phone10,
         a.email, a.state, a.created_at::date as applied_on,
         (a.license_status::text = 'licensed') as licensed, a.status::text as app_status,
         coalesce(a.last_contacted_at, a.contacted_at) as last_contacted, a.last_contact_outcome, a.utm_source, a.created_at
    from public.applications a
   where coalesce(a.is_duplicate, false) = false and a.do_not_contact_at is null and a.phone_bad_at is null
     and a.status::text in ('new', 'reviewing', 'no_pickup', 'attended_no_show')
     and right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
     and (coalesce(a.last_contacted_at, a.contacted_at) is null or coalesce(a.last_contacted_at, a.contacted_at) < now() - interval '14 days'))
select distinct on (b.phone10) b.application_id, b.first_name, b.last_name, b.phone, b.phone10, b.email, b.state, b.applied_on,
       b.licensed, b.app_status, b.last_contacted, b.last_contact_outcome, b.utm_source
  from base b
 where b.phone10 not in (select p from dnc) and b.phone10 not in (select p from team)
 order by b.phone10, b.licensed desc, b.created_at desc;

-- 2b. Former agents worth a call back: inactive, not let go for bad business, never flagged do-not-rehire.
create or replace view public.v_agent_winback_pool as
select a.id as agent_id, a.display_name, pr.email, pr.phone, a.status::text as status,
       a.deactivation_reason::text as deactivation_reason, a.updated_at::date as inactive_since, a.notes
  from public.agents a
  left join public.profiles pr on pr.user_id = a.user_id
 where a.status = 'inactive'
   and coalesce(a.deactivation_reason::text, '') <> 'bad_business'
   and coalesce(a.notes, '') !~* '(do not rehire|never rehire|banned|terminated for)'
 order by (pr.phone is not null) desc, a.updated_at desc;

-- csv_cell(): one CSV cell, always quoted, quotes doubled. Its own function so the two lists cannot drift.
create or replace function public.csv_cell(t text) returns text language sql immutable as $$
  select '"' || replace(coalesce(t, ''), '"', '""') || '"'
$$;
-- 2c. The CSV behind social-lead-csv. ReadyMode's importer wants plain headers; every field is quoted.
create or replace function public.social_lead_csv(p_list text)
returns text language plpgsql stable security definer set search_path = public as $fn$
declare v text; v_rows text;
begin
  if p_list = 'readymode' then
    select string_agg(format('%s,%s,%s,%s,%s,%s,%s,%s,%s,%s',
             csv_cell(first_name), csv_cell(last_name), csv_cell(phone10), csv_cell(email), csv_cell(state), csv_cell(applied_on::text),
             csv_cell(case when licensed then 'yes' else 'no' end), csv_cell(app_status), csv_cell(coalesce(last_contacted::date::text, '')), csv_cell(coalesce(last_contact_outcome, ''))),
           E'\n' order by licensed desc, last_contacted asc nulls first, applied_on desc)
      into v_rows
      from public.v_readymode_lead_pool;
    v := 'first_name,last_name,phone,email,state,applied_on,licensed,status,last_contacted,last_outcome';
  elsif p_list = 'winback' then
    select string_agg(format('%s,%s,%s,%s,%s,%s',
             csv_cell(display_name), csv_cell(coalesce(phone, '')), csv_cell(coalesce(email, '')), csv_cell(coalesce(inactive_since::text, '')),
             csv_cell(coalesce(deactivation_reason, '')), csv_cell(left(coalesce(notes, ''), 200))),
           E'\n' order by (phone is not null) desc, inactive_since desc)
      into v_rows
      from public.v_agent_winback_pool;
    v := 'name,phone,email,inactive_since,reason,notes';
  else
    raise exception 'unknown list %', p_list using errcode = '22023';
  end if;
  return v || E'\n' || coalesce(v_rows, '');
end $fn$;
revoke all on function public.social_lead_csv(text) from public, anon, authenticated;
revoke all on function public.csv_cell(text) from public, anon, authenticated;

-- 2d. The feed key. Minted once; rotate by updating the row and the page picks the new URL up on its next read.
insert into public.system_settings(key, value)
select 'social_lead_feed_key', encode(extensions.gen_random_bytes(32), 'hex')
 where not exists (select 1 from public.system_settings where key = 'social_lead_feed_key');

-- 3. The page's read grows 'pools'.
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
    'pools', (select jsonb_build_object(
                'readymode_leads', (select count(*) from public.v_readymode_lead_pool),
                'readymode_licensed', (select count(*) from public.v_readymode_lead_pool where licensed),
                'readymode_never_contacted', (select count(*) from public.v_readymode_lead_pool where last_contacted is null),
                'winback_agents', (select count(*) from public.v_agent_winback_pool),
                'winback_with_phone', (select count(*) from public.v_agent_winback_pool where phone is not null),
                'readymode_csv_url', (select 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/social-lead-csv?list=readymode&k=' || s.value from public.system_settings s where s.key = 'social_lead_feed_key' limit 1),
                'winback_csv_url', (select 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/social-lead-csv?list=winback&k=' || s.value from public.system_settings s where s.key = 'social_lead_feed_key' limit 1))),
    'drafts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.draft_date desc nulls last, d.created_at desc), '[]'::jsonb)
               from (select id, draft_date, platform, slot, pillar, title, hook, cta, status, approved_at, shipped_at, notes, created_at
                     from public.social_bot_drafts where status in ('awaiting_approval','awaiting_film','approved')
                     order by draft_date desc nulls last, created_at desc limit 150) d),
    'generated_at', now());
end $$;
revoke all on function public.social_command_center() from public, anon;
grant execute on function public.social_command_center() to authenticated, service_role;

-- 4. The content queue: MP-305's rule is "archive anything older than 14 days". 870 drafts had never been looked at.
create or replace function public.fn_social_drafts_archive_stale()
returns integer language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  with u as (
    update public.social_bot_drafts
       set status = 'archived',
           notes = coalesce(notes, '') || E'\nauto-archived ' || current_date::text || ': unapproved for more than 14 days (MP-308 wave 2)',
           updated_at = now()
     where status = 'awaiting_approval' and coalesce(draft_date, created_at::date) < current_date - 14
     returning 1)
  select count(*) into n from u;
  return n;
end $fn$;
revoke all on function public.fn_social_drafts_archive_stale() from public, anon, authenticated;
do $$ begin perform public.fn_social_drafts_archive_stale(); end $$;
do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'apex-social-drafts-archive' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('apex-social-drafts-archive', '0 5 * * 1', 'select public.fn_social_drafts_archive_stale()');
end $$;
