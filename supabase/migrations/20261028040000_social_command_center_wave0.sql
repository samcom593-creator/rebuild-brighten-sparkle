-- MP-308 Social Command Center, wave 0 (2026-10-28). One place for Sam + Aisha: prioritized messages across
-- Instagram / TikTok / YouTube, the content queue with one-tap approve, conversions per platform, what pulls
-- applications, and whether each lane is alive. Measured before writing: inbox_messages 30d = instagram 561
-- people (314 never replied), tiktok 566 people (501 never replied, nothing ingested since 2026-10-04),
-- youtube 76 people (0 replies ever through the inbox; poller dead since 10-04 on token_refresh_failed);
-- applications 90d by source: untracked 73, bio link 25, snapchat 17, instagram 22, youtube 3, tiktok 1.
-- The views are owner-rights and NOT granted to logins; the only read is social_command_center(), gated like
-- Sold Calls (admins + Aisha).

create or replace function public.social_source_of(utm text, landing text, referrer text)
returns text language sql immutable as $$
  select case
    when lower(coalesce(utm,'')) in ('ig','instagram') or (lower(coalesce(landing,'')) || lower(coalesce(referrer,''))) ~ 'instagram' then 'instagram'
    when lower(coalesce(utm,'')) in ('youtube','yt') or lower(coalesce(referrer,'')) ~ 'youtube|youtu\.be' then 'youtube'
    when lower(coalesce(utm,'')) = 'tiktok' or lower(coalesce(referrer,'')) ~ 'tiktok' then 'tiktok'
    when lower(coalesce(utm,'')) in ('snapchat','snap') or lower(coalesce(referrer,'')) ~ 'snapchat' then 'snapchat'
    when lower(coalesce(utm,'')) = 'sell4daddy' then 'bio_link'
    when coalesce(utm,'') <> '' then lower(utm)
    else 'untracked' end
$$;

create or replace view public.v_social_inbox_priority as
with msgs as (
  select source, sender_handle,
    max(sender_name) as sender_name, max(sender_avatar) as avatar,
    max(received_at) filter (where direction = 'inbound') as last_in,
    max(received_at) filter (where direction = 'outbound') as last_out,
    count(*) filter (where direction = 'inbound') as inbound_count,
    (array_agg(intent order by received_at desc) filter (where direction = 'inbound' and intent is not null))[1] as last_intent,
    bool_or(intent = 'sam_thread') as sam_touched,
    (array_agg(left(body, 180) order by received_at desc) filter (where direction = 'inbound'))[1] as last_text,
    max(application_id::text)::uuid as application_id,
    max(lead_score) as lead_score,
    (array_agg(raw_payload->>'media_id' order by received_at desc) filter (where direction = 'inbound'))[1] as media_id
  from public.inbox_messages
  where received_at > now() - interval '30 days' and sender_handle is not null
  group by 1, 2)
select m.*,
  (m.last_in > coalesce(m.last_out, 'epoch'::timestamptz)) as waiting_on_us,
  case
    when m.last_intent in ('flirty','troll','spam','not_interested') then 'silent'
    when a.status::text in ('interview','contracting','paid','onboarding') then 'booked'
    when m.last_intent in ('licensed','opportunity','mentorship','fitness','rentals','partnership','followup')
         and m.last_in > coalesce(m.last_out, 'epoch'::timestamptz) then 'hot'
    when m.sam_touched and m.last_in > coalesce(m.last_out, 'epoch'::timestamptz) then 'human_lane'
    when m.last_in > coalesce(m.last_out, 'epoch'::timestamptz) then 'waiting'
    else 'answered' end as bucket,
  a.status::text as application_status, a.license_status::text as application_license
from msgs m left join public.applications a on a.id = m.application_id;

create or replace view public.v_social_funnel_30d as
with plats as (select unnest(array['instagram','youtube','tiktok','snapchat','bio_link','untracked']) as platform),
posts as (select platform, count(*) as posts, coalesce(sum(views),0) as views, coalesce(sum(comments),0) as post_comments
          from public.content_posts where posted_at > now() - interval '30 days' group by 1),
inbox as (select source as platform,
            count(distinct sender_handle) filter (where direction = 'inbound') as people_in,
            count(distinct sender_handle) filter (where direction = 'outbound') as people_replied,
            count(*) filter (where direction = 'inbound') as messages_in
          from public.inbox_messages where received_at > now() - interval '30 days' group by 1),
apps as (select public.social_source_of(utm_source, landing_url, first_referrer) as platform,
           count(*) as applications,
           count(*) filter (where license_status::text = 'licensed') as licensed,
           count(*) filter (where status::text in ('interview','contracting','paid','onboarding')) as booked_or_further
         from public.applications where created_at > now() - interval '30 days' and coalesce(is_duplicate,false) = false group by 1),
partials as (select public.social_source_of(form_data->>'utm_source', null, null) as platform, count(*) as partials
             from public.partial_applications where created_at > now() - interval '30 days' and converted_at is null group by 1)
select p.platform, coalesce(po.posts,0) as posts, coalesce(po.views,0) as views, coalesce(po.post_comments,0) as post_comments,
  coalesce(i.messages_in,0) as messages_in, coalesce(i.people_in,0) as people_in, coalesce(i.people_replied,0) as people_replied,
  coalesce(pa.partials,0) as partials_abandoned, coalesce(a.applications,0) as applications, coalesce(a.licensed,0) as licensed,
  coalesce(a.booked_or_further,0) as booked_or_further
from plats p
left join posts po on po.platform = p.platform
left join inbox i on i.platform = p.platform
left join apps a on a.platform = p.platform
left join partials pa on pa.platform = p.platform;

create or replace view public.v_social_what_pulls_90d as
select public.social_source_of(utm_source, landing_url, first_referrer) as platform,
  coalesce(nullif(utm_campaign,''), nullif(utm_content,''), nullif(regexp_replace(coalesce(landing_url,''), '^https?://[^/]+', ''), ''), '(no campaign)') as lever,
  count(*) as applications,
  count(*) filter (where license_status::text = 'licensed') as licensed,
  count(*) filter (where status::text in ('interview','contracting','paid','onboarding')) as booked_or_further,
  count(*) filter (where created_at > now() - interval '30 days') as last_30d,
  max(created_at)::date as last_application
from public.applications
where created_at > now() - interval '90 days' and coalesce(is_duplicate,false) = false
group by 1, 2;

create or replace view public.v_social_lane_health as
select v.lane, v.last_seen, v.owner,
  case when v.last_seen is null then 'never' when now() - v.last_seen > v.max_age then 'dead' else 'alive' end as verdict,
  round(extract(epoch from (now() - v.last_seen)) / 3600) as hours_silent
from (values
  ('instagram_dm_replies', (select max(received_at) from public.inbox_messages where source = 'instagram' and direction = 'outbound'), interval '6 hours', 'send-instagram-dm / manychat-webhook'),
  ('instagram_comments', (select max(created_at) from public.ig_comment_events), interval '2 days', 'instagram-comments-backfill (pg_cron 30 min)'),
  ('youtube_comments', (select max(created_at) from public.youtube_comment_events), interval '2 days', 'youtube-comments (pg_cron 20 min); dead since 10-04 = token_refresh_failed'),
  ('tiktok_comments_in', (select max(received_at) from public.inbox_messages where source = 'tiktok' and direction = 'inbound'), interval '3 days', 'tiktok comment ingest -> manychat-webhook (ran once 09-28..10-04)'),
  ('tiktok_replies', (select max(received_at) from public.inbox_messages where source = 'tiktok' and direction = 'outbound'), interval '3 days', 'tiktok reply lane'),
  ('metricool_instagram', (select max(snapshot_ts) from public.social_bot_analytics_snapshots where platform = 'instagram' and subscribers is not null), interval '3 days', 'metricool-sync.sh (null rows are fake success)'),
  ('metricool_tiktok', (select max(snapshot_ts) from public.social_bot_analytics_snapshots where platform = 'tiktok' and subscribers is not null), interval '3 days', 'metricool-sync.sh'),
  ('metricool_youtube', (select max(snapshot_ts) from public.social_bot_analytics_snapshots where platform = 'youtube' and subscribers is not null), interval '3 days', 'metricool-sync.sh'),
  ('content_posts_instagram', (select max(stats_at) from public.content_posts where platform = 'instagram'), interval '3 days', 'content stats sync'),
  ('content_posts_youtube', (select max(stats_at) from public.content_posts where platform = 'youtube'), interval '3 days', 'content stats sync'),
  ('content_posts_tiktok', (select max(stats_at) from public.content_posts where platform = 'tiktok'), interval '3 days', 'no tiktok post sync exists')
) as v(lane, last_seen, max_age, owner);

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
                    order by last_in desc limit 500) i),
    'funnel', (select coalesce(jsonb_agg(to_jsonb(f) order by f.applications desc, f.people_in desc), '[]'::jsonb) from public.v_social_funnel_30d f),
    'pulls', (select coalesce(jsonb_agg(to_jsonb(w) order by w.applications desc), '[]'::jsonb) from (select * from public.v_social_what_pulls_90d order by applications desc limit 40) w),
    'lanes', (select coalesce(jsonb_agg(to_jsonb(l) order by l.verdict desc, l.lane), '[]'::jsonb) from public.v_social_lane_health l),
    'drafts', (select coalesce(jsonb_agg(to_jsonb(d) order by d.draft_date desc nulls last, d.created_at desc), '[]'::jsonb)
               from (select id, draft_date, platform, slot, pillar, title, hook, cta, status, approved_at, shipped_at, notes, created_at
                     from public.social_bot_drafts where status in ('awaiting_approval','awaiting_film','approved')
                     order by draft_date desc nulls last, created_at desc limit 150) d),
    'generated_at', now());
end $$;
revoke all on function public.social_command_center() from public, anon;
grant execute on function public.social_command_center() to authenticated, service_role;

create or replace function public.social_draft_set_status(p_id bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.social_bot_drafts;
begin
  if not public.can_view_sold_calls() then
    raise exception 'The social command center is for Sam and Aisha' using errcode = '42501';
  end if;
  if p_status not in ('approved','archived','rejected','awaiting_film','awaiting_approval') then
    raise exception 'unknown draft status %', p_status using errcode = '22023';
  end if;
  update public.social_bot_drafts set
    status = p_status,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid()::text else approved_by end,
    notes = case when p_note is null or p_note = '' then notes else coalesce(notes,'') || E'\n' || p_note end,
    updated_at = now()
  where id = p_id returning * into r;
  if r.id is null then raise exception 'draft not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'approved_at', r.approved_at);
end $$;
revoke all on function public.social_draft_set_status(bigint, text, text) from public, anon;
grant execute on function public.social_draft_set_status(bigint, text, text) to authenticated, service_role;
