-- MP-BRAND-ENGINE (2026-11-12). Brand Command + Social Media Center + Launch Board plan + My Day Q4 schedule.
-- Idempotent: every object is IF NOT EXISTS / OR REPLACE / ON CONFLICT, and the day-plan reseed is keyed
-- on template_version so a second run changes nothing.
--
-- New tables: brand_metrics_daily, brand_targets, brand_activities, keyword_dm_log (admin-only RLS).
-- Extended:   social_bot_drafts (+account, card_id, reject_reason, postiz_post_id, ship_source),
--             day_plan_defaults / day_plan_tasks (+activity_kind, template_version).
-- Launch Board card fields (account, format, pillar, keyword, outfit note) live in content_cards.brief,
-- which already exists, so the card table itself is unchanged.

-- ───────────────────────────── tables ─────────────────────────────
create table if not exists public.brand_metrics_daily (
  id          bigint generated always as identity primary key,
  metric_date date        not null,
  account     text        not null,
  metric      text        not null,
  value       numeric     not null,
  source      text        not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint brand_metrics_daily_day_account_metric_key unique (metric_date, account, metric),
  constraint brand_metrics_daily_account_chk check (account in ('youtube','tiktok-main','tiktok-sales','tiktok-rant','snapchat','instagram','all')),
  constraint brand_metrics_daily_metric_chk check (metric ~ '^[a-z][a-z0-9_]{1,39}$')
);

create table if not exists public.brand_targets (
  lane_key      text primary key,
  label         text    not null,
  weekly_target numeric not null check (weekly_target >= 0),
  kind          text    not null check (kind in ('output','result')),
  activity_kind text,
  sort          integer not null default 0,
  updated_at    timestamptz not null default now()
);

create table if not exists public.brand_activities (
  id            bigint generated always as identity primary key,
  activity_date date    not null,
  kind          text    not null,
  done          boolean not null default true,
  notes         text,
  task_id       uuid,
  created_at    timestamptz not null default now()
);
create unique index if not exists brand_activities_task_day_key on public.brand_activities (activity_date, task_id) where task_id is not null;
create index if not exists brand_activities_kind_day_idx on public.brand_activities (kind, activity_date);

create table if not exists public.keyword_dm_log (
  id          bigint generated always as identity primary key,
  happened_at timestamptz not null default now(),
  account     text not null,
  keyword     text not null check (keyword in ('TEAM','BODY','BUILD')),
  handle      text,
  status      text not null default 'new' check (status in ('new','pitched','converted','dead')),
  inbound_id  bigint,
  post_url    text,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists keyword_dm_log_happened_idx on public.keyword_dm_log (happened_at desc);
create unique index if not exists keyword_dm_log_inbound_key on public.keyword_dm_log (inbound_id) where inbound_id is not null;

alter table public.brand_metrics_daily enable row level security;
alter table public.brand_targets       enable row level security;
alter table public.brand_activities    enable row level security;
alter table public.keyword_dm_log      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['brand_metrics_daily','brand_targets','brand_activities','keyword_dm_log'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_role(auth.uid(), ''admin''::public.app_role)) with check (public.has_role(auth.uid(), ''admin''::public.app_role))',
      t || '_admin_all', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ───────────────────────────── weekly targets ─────────────────────────────
insert into public.brand_targets (lane_key, label, weekly_target, kind, activity_kind, sort) values
  ('long_forms',       'Long-forms posted',    4,  'output', null,              10),
  ('banked',           'Long-forms banked',    1,  'output', null,              20),
  ('shorts',           'Shorts posted',        35, 'output', null,              30),
  ('keyword_dms',      'Keyword DMs',          25, 'result', null,              40),
  ('applications',     'Applications',         10, 'result', null,              50),
  ('calls',            'Calls',                5,  'result', null,              60),
  ('contracts',        'Contracts',            2,  'result', null,              70),
  ('body_sales',       'Standard Body sales',  2,  'result', null,              80),
  ('agent_checkins',   'Agent check-ins',      5,  'output', 'agent_checkin',   90),
  ('manager_huddles',  'Manager huddles',      5,  'output', 'manager_huddle',  100),
  ('business_audits',  'Business audits',      2,  'output', 'business_audit',  110),
  ('builder_meetings', 'Builder meetings',     3,  'output', 'builder_meeting', 120),
  ('dm_blitzes',       'DM blitzes',           4,  'output', 'dm_blitz',        130),
  ('data_reviews',     'Data reviews',         2,  'output', 'data_review',     140)
on conflict (lane_key) do nothing;

-- ───────────────────────────── drafts: account + card link ─────────────────────────────
alter table public.social_bot_drafts add column if not exists account        text;
alter table public.social_bot_drafts add column if not exists card_id        uuid references public.content_cards(id) on delete set null;
alter table public.social_bot_drafts add column if not exists reject_reason  text;
alter table public.social_bot_drafts add column if not exists postiz_post_id text;
alter table public.social_bot_drafts add column if not exists ship_source    text;
create unique index if not exists social_bot_drafts_card_key on public.social_bot_drafts (card_id) where card_id is not null;

-- ───────────────────────────── one lane value, any window ─────────────────────────────
-- Used for this week, last week and the rolling 7-day funnel, so the three can never disagree on a predicate.
create or replace function public.brand_lane_value(p_key text, p_from timestamptz, p_to timestamptz)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with w as (
    select (p_from at time zone 'America/Phoenix')::date as d0,
           ((p_to - interval '1 second') at time zone 'America/Phoenix')::date as d1
  )
  select case p_key
    when 'long_forms' then (
      select count(*)::numeric from content_posts
       where platform = 'youtube' and format = 'long' and posted_at >= p_from and posted_at < p_to)
    when 'banked' then (
      select count(*)::numeric from content_cards
       where (content_type = 'long' or brand = 'YT' or brief->>'format' like 'long%')
         and status in ('ready','scheduled') and archived_at is null)
    when 'shorts' then (
      -- Per account: a hand-entered "posts" count wins for that account; otherwise the synced post rows.
      select coalesce(sum(coalesce(m.n, s.n)), 0)::numeric
        from (select account, sum(value) n from brand_metrics_daily, w
               where metric = 'posts' and account <> 'all' and metric_date between w.d0 and w.d1 group by 1) m
        full join (
              select case platform when 'youtube' then 'youtube' when 'instagram' then 'instagram' when 'tiktok' then 'tiktok-main' else platform end as account,
                     count(*)::numeric n
                from content_posts where format = 'short' and posted_at >= p_from and posted_at < p_to group by 1) s
          using (account))
    when 'keyword_dms' then (
      select count(*)::numeric from keyword_dm_log where happened_at >= p_from and happened_at < p_to)
    when 'applications' then (
      select count(*)::numeric from v_applications_real where created_at >= p_from and created_at < p_to)
    when 'calls' then (
      select count(*)::numeric from interview_events
       where scheduled_at >= p_from and scheduled_at < p_to and canceled_at is null
         and coalesce(is_backfill_duplicate, false) = false)
    when 'contracts' then (
      select count(*)::numeric from agents where contracted_at >= p_from and contracted_at < p_to)
    when 'body_sales' then (
      (select count(*)::numeric from brand_leads
        where source like 'fitness_plan%' and status = 'won' and created_at >= p_from and created_at < p_to)
      + (select coalesce(sum(value), 0) from brand_metrics_daily, w
          where metric = 'body_sales' and metric_date between w.d0 and w.d1))
    when 'offer_sales' then (
      (select count(*)::numeric from brand_leads
        where (source like 'fitness_plan%' or source like 'mentorship%') and status = 'won'
          and created_at >= p_from and created_at < p_to)
      + (select coalesce(sum(value), 0) from brand_metrics_daily, w
          where metric in ('body_sales','mentorship_sales') and metric_date between w.d0 and w.d1))
    when 'views' then (
      select coalesce(sum(value), 0) from brand_metrics_daily, w
       where metric = 'views' and account <> 'all' and metric_date between w.d0 and w.d1)
    when 'producing_agents' then (
      select count(distinct agent_id)::numeric from deals
       where created_at >= p_from and created_at < p_to and agent_id is not null)
    else (
      select count(*)::numeric from brand_activities a, w
       where a.done and a.activity_date between w.d0 and w.d1
         and a.kind = (select activity_kind from brand_targets where lane_key = p_key))
  end;
$$;

-- SECURITY DEFINER function (never a definer view) with the admin check inside: the applicant, interview,
-- agent and deal relations are not readable by the authenticated role directly, so an invoker read fails
-- with 42501. Non-admins get NULL.
create or replace function public.brand_command_summary(p_week_start date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ws date := coalesce(p_week_start, date_trunc('week', (now() at time zone 'America/Phoenix'))::date);
  t0 timestamptz; t1 timestamptz; p0 timestamptz;
  n timestamptz := now();
  lanes jsonb; funnel jsonb;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::public.app_role) then
    return null;
  end if;
  t0 := ws::timestamp at time zone 'America/Phoenix';
  t1 := t0 + interval '7 days';
  p0 := t0 - interval '7 days';

  select jsonb_agg(jsonb_build_object(
           'key', bt.lane_key, 'label', bt.label, 'target', bt.weekly_target, 'kind', bt.kind,
           'value', coalesce(public.brand_lane_value(bt.lane_key, t0, t1), 0),
           'prev',  coalesce(public.brand_lane_value(bt.lane_key, p0, t0), 0)) order by bt.sort)
    into lanes
    from brand_targets bt;

  select jsonb_agg(jsonb_build_object(
           'key', f.k, 'label', f.label,
           'value', coalesce(public.brand_lane_value(f.k, n - interval '7 days', n), 0),
           'prev',  coalesce(public.brand_lane_value(f.k, n - interval '14 days', n - interval '7 days'), 0)) order by f.ord)
    into funnel
    from (values (1,'views','Views'), (2,'keyword_dms','Keyword DMs'), (3,'applications','Applications'),
                 (4,'calls','Calls'), (5,'contracts','Contracts'), (6,'producing_agents','Producing agents'),
                 (7,'offer_sales','Offer sales')) as f(ord, k, label);

  return jsonb_build_object(
    'week_start', ws,
    'generated_at', n,
    'lanes', coalesce(lanes, '[]'::jsonb),
    'funnel', coalesce(funnel, '[]'::jsonb),
    'views_days_logged', (select count(distinct metric_date) from brand_metrics_daily
                           where metric = 'views' and metric_date > (n at time zone 'America/Phoenix')::date - 7),
    'post_sync_at', (select max(stats_at) from content_posts)
  );
end $$;

revoke all on function public.brand_lane_value(text, timestamptz, timestamptz) from public, anon;
revoke all on function public.brand_command_summary(date) from public, anon;
revoke all on function public.brand_lane_value(text, timestamptz, timestamptz) from authenticated;
grant execute on function public.brand_command_summary(date) to authenticated;

-- ───────────────────────────── YouTube: copy the existing sync into brand metrics ─────────────────────────────
-- No API key needed: the channel sync already writes system_settings.youtube_channel_stats and content_posts.
-- This only republishes what that sync last saw, dated by the sync's own timestamp, so a stale sync
-- produces no new rows instead of a flat line dressed as fresh data.
create or replace function public.brand_metrics_youtube_pull()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  raw jsonb; d date; subs numeric; total numeric; prev numeric; wrote int := 0;
begin
  select value::jsonb into raw from system_settings where key = 'youtube_channel_stats';
  if raw is null then return jsonb_build_object('ok', false, 'reason', 'no youtube_channel_stats'); end if;
  if jsonb_typeof(raw) = 'string' then raw := (raw #>> '{}')::jsonb; end if;
  d := ((raw->>'at')::timestamptz at time zone 'America/Phoenix')::date;
  subs := nullif(raw->>'subscribers', '')::numeric;
  if d is null then return jsonb_build_object('ok', false, 'reason', 'no sync timestamp'); end if;

  if subs is not null then
    insert into brand_metrics_daily (metric_date, account, metric, value, source)
    values (d, 'youtube', 'followers', subs, 'youtube_sync')
    on conflict (metric_date, account, metric) do update set value = excluded.value, updated_at = now()
      where brand_metrics_daily.source = 'youtube_sync';
    wrote := wrote + 1;
  end if;

  select sum(views), ((max(stats_at)) at time zone 'America/Phoenix')::date into total, d
    from content_posts where platform = 'youtube';
  if total is not null and d is not null then
    select value into prev from brand_metrics_daily
     where account = 'youtube' and metric = 'views_total' and metric_date < d order by metric_date desc limit 1;
    insert into brand_metrics_daily (metric_date, account, metric, value, source)
    values (d, 'youtube', 'views_total', total, 'youtube_sync')
    on conflict (metric_date, account, metric) do update set value = excluded.value, updated_at = now()
      where brand_metrics_daily.source = 'youtube_sync';
    if prev is not null and total >= prev then
      insert into brand_metrics_daily (metric_date, account, metric, value, source)
      values (d, 'youtube', 'views', total - prev, 'youtube_sync')
      on conflict (metric_date, account, metric) do update set value = excluded.value, updated_at = now()
        where brand_metrics_daily.source = 'youtube_sync';
    end if;
    wrote := wrote + 1;
  end if;
  return jsonb_build_object('ok', true, 'wrote', wrote, 'as_of', d);
end $$;
revoke all on function public.brand_metrics_youtube_pull() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('brand-metrics-youtube-pull', '15 13 * * *', 'select public.brand_metrics_youtube_pull()');
  end if;
end $$;

-- Ingest key for bots and iOS Shortcuts. Generated once; admin-readable only (the key name matches the
-- system_settings secret pattern).
insert into public.system_settings (key, value)
values ('brand_ingest_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- ───────────────────────────── Launch Board: the Scheduled gate + the approval queue ─────────────────────────────
create or replace function public.content_cards_brand_gate()
returns trigger
language plpgsql
set search_path = public
as $$
declare missing text[] := '{}';
begin
  if new.status = 'scheduled' and (tg_op = 'INSERT' or old.status is distinct from 'scheduled') then
    if coalesce(btrim(new.title), '') = '' then missing := missing || 'title'; end if;
    if coalesce(btrim(new.brief->>'account'), '') = '' then missing := missing || 'account'; end if;
    if coalesce(btrim(new.brief->>'pillar'), '') = '' then missing := missing || 'pillar'; end if;
    if coalesce(btrim(new.brief->>'keyword'), '') = '' then missing := missing || 'CTA keyword'; end if;
    if array_length(missing, 1) > 0 then
      raise exception 'A card cannot be Scheduled without %. Add it on the Launch Board Plan tab.', array_to_string(missing, ', ')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_content_cards_brand_gate on public.content_cards;
create trigger trg_content_cards_brand_gate
  before insert or update of status on public.content_cards
  for each row execute function public.content_cards_brand_gate();

create or replace function public.content_cards_to_approval_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare acct text; plat text; local_ts timestamp;
begin
  if new.status <> 'scheduled' or (tg_op = 'UPDATE' and old.status = 'scheduled') then return new; end if;
  acct := new.brief->>'account';
  plat := case when acct like 'tiktok%' then 'tiktok' when acct = 'youtube' then 'youtube' else acct end;
  local_ts := new.scheduled_for at time zone 'America/Phoenix';
  insert into social_bot_drafts (draft_date, platform, account, slot, pillar, title, hook, caption, cta, status, card_id, notes)
  values (local_ts::date, plat, acct, to_char(local_ts, 'HH24:MI'), new.brief->>'pillar', new.title, new.hook, new.caption,
          new.brief->>'keyword', 'awaiting_approval', new.id, 'From the Launch Board')
  on conflict (card_id) where card_id is not null do update
    set draft_date = excluded.draft_date, platform = excluded.platform, account = excluded.account, slot = excluded.slot,
        pillar = excluded.pillar, title = excluded.title, hook = excluded.hook, caption = excluded.caption, cta = excluded.cta,
        status = 'awaiting_approval', reject_reason = null, updated_at = now();
  return new;
end $$;

drop trigger if exists trg_content_cards_to_approval_queue on public.content_cards;
create trigger trg_content_cards_to_approval_queue
  after insert or update of status on public.content_cards
  for each row execute function public.content_cards_to_approval_queue();

-- A draft that is rejected or shipped reports back to its card.
create or replace function public.social_bot_drafts_card_backflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.card_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'rejected' then
    update content_cards
       set status = 'ready',
           brief = brief || jsonb_build_object('reject_reason', coalesce(new.reject_reason, ''), 'rejected_at', now())
     where id = new.card_id and status = 'scheduled';
  elsif new.status = 'shipped' and public.content_publish_url_ok(new.shipped_url) then
    update content_cards
       set status = 'published', published_url = new.shipped_url, posted_at = coalesce(new.shipped_at, now()),
           publish_evidence = case when new.ship_source = 'postiz' and coalesce(auth.role(), '') <> 'authenticated'
                                   then 'provider' else 'manual_confirmation' end
     where id = new.card_id and status = 'scheduled';
  end if;
  return new;
end $$;

drop trigger if exists trg_social_bot_drafts_card_backflow on public.social_bot_drafts;
create trigger trg_social_bot_drafts_card_backflow
  after update of status on public.social_bot_drafts
  for each row execute function public.social_bot_drafts_card_backflow();

-- ───────────────────────────── My Day: Q4 schedule + done-tap -> brand_activities ─────────────────────────────
alter table public.day_plan_defaults add column if not exists activity_kind    text;
alter table public.day_plan_defaults add column if not exists template_version text;
alter table public.day_plan_tasks    add column if not exists activity_kind    text;
alter table public.day_plan_tasks    add column if not exists template_version text;

create or replace function public.day_plan_check_to_brand_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare t record;
begin
  if tg_op = 'DELETE' then
    delete from brand_activities where task_id = old.task_id and activity_date = old.day;
    return old;
  end if;
  select title, category, activity_kind into t from day_plan_tasks where id = new.task_id;
  if not found then return new; end if;
  insert into brand_activities (activity_date, kind, done, notes, task_id)
  values (new.day, coalesce(t.activity_kind, 'block_' || t.category), true, t.title, new.task_id)
  on conflict (activity_date, task_id) where task_id is not null do update set done = true, kind = excluded.kind, notes = excluded.notes;
  return new;
end $$;

drop trigger if exists trg_day_plan_check_to_brand_activity on public.day_plan_checks;
create trigger trg_day_plan_check_to_brand_activity
  after insert or delete on public.day_plan_checks
  for each row execute function public.day_plan_check_to_brand_activity();

-- The Q4 template. Weekdays share one spine; 12:30 and 2:00 rotate by day.
do $$
declare
  ver constant text := 'q4-2026';
  u uuid;
begin
  if exists (select 1 from public.day_plan_defaults where template_version = ver) then
    return;
  end if;

  create temp table _q4 (weekday smallint, start_min smallint, duration_min smallint, title text, detail text, category text, activity_kind text) on commit drop;

  insert into _q4
  select d, s.start_min, s.duration_min, s.title, s.detail, s.category, s.activity_kind
    from generate_series(1, 5) d
    cross join (values
      (330,  30, 'Wake, prayer, today''s top 3',        null,                                                   'faith',      'wake'),
      (360,  60, 'Gym: train and film 2 clips',         'Two clips on the phone before you leave.',             'health',     'gym'),
      (420,  60, 'Record and post the day''s Shorts',   'Batch them. Shorts once a day.',                       'content',    'shorts_session'),
      (480,  45, 'Lead messages',                       null,                                                   'sales',      'lead_messages'),
      (525,  15, 'Manager huddle',                      '15 minutes.',                                          'leadership', 'manager_huddle'),
      (540,  30, 'Team meeting',                        null,                                                   'leadership', 'team_meeting'),
      (570,  30, 'Prep: call list',                     null,                                                   'sales',      'call_prep'),
      (600, 120, 'Sales calls',                         null,                                                   'sales',      'sales_calls'),
      (900,  60, 'DMs to zero, every platform',         'Once a day. TEAM, BODY, BUILD replies from the Social Media Center.', 'content', 'dm_blitz'),
      (960,  60, 'Agent check-ins',                     'Every agent: closed today, or booked for tomorrow.',   'leadership', 'agent_checkin'),
      (1020, 60, 'Leadership call',                     null,                                                   'leadership', 'leadership_call'),
      (1080, 60, 'Dinner and family',                   null,                                                   'rest',       'family'),
      (1140, 60, 'Lead messages + evening post',        null,                                                   'sales',      'evening_post'),
      (1200, 90, 'Approve edits',                       'Approval queue in the Social Media Center.',           'content',    'approve_edits'),
      (1290, 120,'Shutdown',                            'Phone down. Asleep by 11:30. Energy is output.',       'rest',       'shutdown')
    ) as s(start_min, duration_min, title, detail, category, activity_kind);

  insert into _q4 values
    (1, 750, 90, 'Business audit',     null, 'ceo', 'business_audit'),
    (1, 840, 60, 'Builder meeting',    null, 'leadership', 'builder_meeting'),
    (2, 750, 90, 'Content planning',   'Saturday''s 4 titles, scored in vidIQ. Launch Board, Tuesday planning.', 'content', 'content_planning'),
    (2, 840, 60, 'Builder meeting',    null, 'leadership', 'builder_meeting'),
    (3, 750, 90, 'Data check',         'Brand Command, What''s working. Remake the top 3 hooks for next week.', 'planning', 'data_review'),
    (3, 840, 60, 'Pre-licensing push', null, 'recruiting', 'prelicensing_push'),
    (4, 750, 90, 'Business audit',     null, 'ceo', 'business_audit'),
    (4, 840, 60, 'Builder meeting',    null, 'leadership', 'builder_meeting'),
    (5, 750, 90, 'Applicant calls',    null, 'recruiting', 'applicant_calls'),
    (5, 840, 60, 'Haircut, script Saturday, pick outfits', null, 'planning', 'saturday_prep'),
    (6, 540, 360,'Record Day',         '4 long-forms, 5 rants, fit/gym/car b-roll. Launch Board, Saturday checklist.', 'content', 'record_day'),
    (7, 690, 30, 'Record my numbers video', null, 'content', 'numbers_video'),
    (7, 720, 240,'Edit and schedule the week', null, 'content', 'edit_schedule'),
    (7, 960, 60, 'Weekly review on Brand Command', 'The 5 numbers, account vs account, then the two rules.', 'planning', 'data_review');

  -- Template: the old default rows are replaced (they are a template, not history).
  delete from public.day_plan_defaults where template_version is null;
  insert into public.day_plan_defaults (weekday, start_min, duration_min, title, detail, category, sort, activity_kind, template_version)
  select weekday, start_min, duration_min, title, detail, category,
         (row_number() over (partition by weekday order by start_min))::smallint - 1, activity_kind, ver
    from _q4;

  -- People who already have a plan: retire the old blocks (kept, inactive, so past done-taps still resolve)
  -- and add the Q4 blocks.
  for u in select distinct user_id from public.day_plan_tasks loop
    update public.day_plan_tasks set active = false, updated_at = now()
     where user_id = u and template_version is null and active;
    insert into public.day_plan_tasks (user_id, weekday, start_min, duration_min, title, detail, category, sort, activity_kind, template_version)
    select u, weekday, start_min, duration_min, title, detail, category, sort, activity_kind, template_version
      from public.day_plan_defaults where template_version = ver;
  end loop;
end $$;

-- New users are seeded with the activity kind too.
create or replace function public.day_plan_ensure_seeded()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then return 0; end if;
  -- One seeding per user at a time; the second caller waits, then sees the rows.
  perform pg_advisory_xact_lock(hashtext('day_plan_seed:' || auth.uid()::text));
  select count(*) into n from public.day_plan_tasks where user_id = auth.uid();
  if n > 0 then return n; end if;
  insert into public.day_plan_tasks (user_id, weekday, start_min, duration_min, title, detail, category, sort, activity_kind, template_version)
    select auth.uid(), weekday, start_min, duration_min, title, detail, category, sort, activity_kind, template_version from public.day_plan_defaults;
  get diagnostics n = row_count;
  return n;
end $function$;
