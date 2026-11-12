-- MP-BRAND-ENGINE parts 6-8 (2026-11-12): Glow-Up Ladder leads + nurture copy, attribution, proof wall consent.
-- Idempotent: IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING throughout.

-- ───────────────────────────── part 6: glow-up leads ─────────────────────────────
create table if not exists public.glowup_leads (
  id               uuid primary key default gen_random_uuid(),
  first_name       text not null,
  email            text not null,
  phone            text,
  stage            smallint not null check (stage between 1 and 4),
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_content      text,
  page             text,
  created_at       timestamptz not null default now(),
  checklist_sent_at timestamptz,
  checklist_email_id text,
  nurture_step     smallint not null default 0 check (nurture_step between 0 and 5),
  nurture_last_at  timestamptz
);
create unique index if not exists glowup_leads_email_key on public.glowup_leads (lower(email));
create index if not exists glowup_leads_created_idx on public.glowup_leads (created_at desc);
create index if not exists glowup_leads_utm_content_idx on public.glowup_leads (utm_content) where utm_content is not null;

create table if not exists public.glowup_nurture_emails (
  step       smallint primary key check (step between 1 and 5),
  day_offset smallint not null check (day_offset between 0 and 60),
  stage      smallint check (stage between 1 and 4),
  subject    text not null,
  body       text not null,
  updated_at timestamptz not null default now()
);

alter table public.glowup_leads          enable row level security;
alter table public.glowup_nurture_emails enable row level security;

do $$
declare t text;
begin
  foreach t in array array['glowup_leads','glowup_nurture_emails'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_role(auth.uid(), ''admin''::public.app_role)) with check (public.has_role(auth.uid(), ''admin''::public.app_role))',
      t || '_admin_all', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- The sequence: one email per ladder stage, then "pick your door". Plain text; {{first_name}} is filled
-- at send time. Sam edits this copy on Brand Command. Nothing sends while glowup_nurture_enabled is false.
insert into public.glowup_nurture_emails (step, day_offset, stage, subject, body) values
(1, 1, 1, 'Start with the body',
'{{first_name}},

When my sport ended, I let everything go. I got heavy. Nobody took me serious, and I did not take myself serious either.

I did not fix my money first. I fixed my body first. The body is the one thing you control today. No license, no capital, no permission needed.

Three rules I ran every single day:

1. Train before the world gets a vote.
2. Eat the same clean meals until the scale moves.
3. Take a photo every Sunday. Numbers do not lie to you.

I have lost 100 pounds doing that. It is not complicated. It is just daily.

Open your 30-Day Glow-Up and tap today done:
https://sell4daddy.com/glowup?utm_source=email&utm_medium=nurture&utm_campaign=glowup_1

If you want the exact plan I used, built for you:
https://sell4daddy.com/body?utm_source=email&utm_medium=nurture&utm_campaign=glowup_1

Hold the Standard.
Samuel'),
(2, 3, 2, 'Your sport ended. Your competition didn''t.',
'{{first_name}},

Nobody tells athletes this part. The season ends, the team is gone, and the thing that made you dangerous has nowhere to go.

Sales is where I put mine. You compete every day. There is a scoreboard. Nobody can bench you.

I sell life insurance and I run a team that does it remote, nationwide. I have taken 50+ people past $10K a month. Most of them had never sold anything. What they had was the thing you already have: they know how to be coached and they hate losing.

What it takes:

1. Get licensed. I walk you through it.
2. Learn the script. Run it until it is boring.
3. Make the calls every day. Volume first, skill second.

Results depend on your work. No income is guaranteed. But if you want a real shot at your first $10K month, this is the door:
https://sell4daddy.com/team?utm_source=email&utm_medium=nurture&utm_campaign=glowup_2

Hold the Standard.
Samuel'),
(3, 5, 3, 'When $10K is the ceiling',
'{{first_name}},

Getting to $10K a month is about you. Getting past it is about other people.

I learned that the hard way. I built an agency at 20. Then I lost my biggest team. Production I had counted on walked out the door.

It was the best thing that happened to my business, because it showed me what was actually mine. The system was mine. The standard was mine. So I am rebuilding it in public, and this time it is built to hold.

If you already produce and you are stuck selling alone, the next move is not more hours. It is building.

For people who run a team or want to own an agency, I start with four questions and then a call:
https://sell4daddy.com/build?utm_source=email&utm_medium=nurture&utm_campaign=glowup_3

Hold the Standard.
Samuel'),
(4, 7, 4, 'Become the man',
'{{first_name}},

The body gets you respect. The money gets you options. Neither one makes you the man.

What does is discipline you keep when nobody is watching, faith when the numbers are ugly, and enough freedom to say no.

I pray before I do anything else. 5:30 every morning. Then I train. Then I work. I do not negotiate with the schedule, because the schedule is the only thing that has ever worked for me.

Fits, the gym, fast cars. I like all of it. But those are what the life looks like, not what it is built on.

A small group of men work with me directly on all four: body, income, building, and the man underneath. It is by application, and I read every one:
https://sell4daddy.com/mentorship?utm_source=email&utm_medium=nurture&utm_campaign=glowup_4

Hold the Standard.
Samuel'),
(5, 10, null, 'Pick your door',
'{{first_name}},

Ten days ago you asked for the Glow-Up. Here is the whole ladder, and where each step goes.

1. Body. Look like the man.
https://sell4daddy.com/body?utm_source=email&utm_medium=nurture&utm_campaign=glowup_5

2. First $10K. Earn like him. Join my team.
https://sell4daddy.com/team?utm_source=email&utm_medium=nurture&utm_campaign=glowup_5

3. Break $10K. Build past yourself.
https://sell4daddy.com/build?utm_source=email&utm_medium=nurture&utm_campaign=glowup_5

4. Become the man. Private mentorship, by application.
https://sell4daddy.com/mentorship?utm_source=email&utm_medium=nurture&utm_campaign=glowup_5

You do not need all four. You need the next one. Pick it today.

Average is the disease.
Samuel')
on conflict (step) do nothing;

insert into public.system_settings (key, value) values ('glowup_nurture_enabled', 'false') on conflict (key) do nothing;
insert into public.system_settings (key, value)
values ('glowup_cron_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- The daily tick. The function itself refuses to send while glowup_nurture_enabled is not 'true', so the
-- job is safe to schedule now; the SQL also skips the HTTP call entirely while the sequence is off.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('glowup-nurture-daily', '0 16 * * *', $cron$
      select net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/glowup-nurture',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-key', (select value from public.system_settings where key = 'glowup_cron_key')),
        body := '{}'::jsonb)
      where (select value from public.system_settings where key = 'glowup_nurture_enabled') = 'true'
    $cron$);
  end if;
end $$;

-- ───────────────────────────── part 8: proof wall consent ─────────────────────────────
alter table public.agents add column if not exists proof_wall_consent boolean not null default false;

-- Read for sell4daddy.com (through the proof-wall edge function). SECURITY DEFINER function (never a definer view) that returns only
-- what the wall prints, and only for agents who said yes: first name + last initial, the plaque's own
-- label, its month, and the production amount on dollar milestones. No ids, no contact details.
create or replace function public.public_proof_wall(p_limit integer default 12)
returns table (who text, label text, month text, production numeric)
language sql
stable
security definer
set search_path = public
as $$
  -- One row per agent and plaque label (the most recent), so one busy agent cannot fill the wall.
  select who, label, month, production from (
    select distinct on (a.id, coalesce(nullif(btrim(p.badge_label), ''), p.milestone_type))
      split_part(btrim(a.display_name), ' ', 1)
        || case when position(' ' in btrim(a.display_name)) > 0
                then ' ' || left(split_part(btrim(a.display_name), ' ', array_length(string_to_array(btrim(a.display_name), ' '), 1)), 1) || '.'
                else '' end as who,
      coalesce(nullif(btrim(p.badge_label), ''), initcap(replace(p.milestone_type, '_', ' '))) as label,
      to_char(p.milestone_date, 'Mon YYYY') as month,
      case when p.amount >= 1000 then p.amount else null end as production,
      p.milestone_date as d
    from plaque_awards p
    join agents a on a.id = p.agent_id
    where a.proof_wall_consent
      and coalesce(btrim(a.display_name), '') <> ''
      and p.milestone_date is not null
    order by a.id, coalesce(nullif(btrim(p.badge_label), ''), p.milestone_type), p.milestone_date desc
  ) t
  order by d desc
  limit least(greatest(coalesce(p_limit, 12), 1), 24);
$$;
-- Not callable by anon or signed-in users: the proof-wall edge function reads it with the service role,
-- so the anon SECURITY DEFINER surface does not grow.
revoke all on function public.public_proof_wall(integer) from public, anon, authenticated;
grant execute on function public.public_proof_wall(integer) to service_role;

-- Admin list for the consent switches: agents who hold at least one plaque.
create or replace function public.brand_proof_wall_agents()
returns table (agent_id uuid, display_name text, plaques bigint, latest date, consent boolean)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.display_name, count(p.id), max(p.milestone_date), a.proof_wall_consent
    from agents a join plaque_awards p on p.agent_id = a.id
   where public.has_role(auth.uid(), 'admin'::public.app_role)
   group by a.id, a.display_name, a.proof_wall_consent
   order by max(p.milestone_date) desc nulls last;
$$;
revoke all on function public.brand_proof_wall_agents() from public, anon;
grant execute on function public.brand_proof_wall_agents() to authenticated;

create or replace function public.brand_set_proof_wall_consent(p_agent_id uuid, p_consent boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'Only the owner can change proof wall consent' using errcode = 'insufficient_privilege';
  end if;
  update agents set proof_wall_consent = coalesce(p_consent, false) where id = p_agent_id;
  if not found then raise exception 'Agent not found' using errcode = 'no_data_found'; end if;
  return coalesce(p_consent, false);
end $$;
revoke all on function public.brand_set_proof_wall_consent(uuid, boolean) from public, anon;
grant execute on function public.brand_set_proof_wall_consent(uuid, boolean) to authenticated;

-- ───────────────────────────── part 7: attribution ─────────────────────────────
-- "Leads captured" joins the lane vocabulary: glow-up leads plus brand funnel leads in the window.
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
    when 'leads' then (
      (select count(*)::numeric from glowup_leads where created_at >= p_from and created_at < p_to)
      + (select count(*)::numeric from brand_leads where created_at >= p_from and created_at < p_to))
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
revoke all on function public.brand_lane_value(text, timestamptz, timestamptz) from public, anon, authenticated;

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
  lanes jsonb; funnel jsonb; attributed jsonb;
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
    from (values (1,'views','Views'), (2,'keyword_dms','Keyword DMs'), (3,'leads','Leads captured'),
                 (4,'applications','Applications'), (5,'calls','Calls'), (6,'contracts','Contracts'),
                 (7,'producing_agents','Producing agents'), (8,'offer_sales','Offer sales')) as f(ord, k, label);

  -- Posts ranked by what they pulled in. A lead or application counts for a card when its utm_content
  -- is that card's id, which is the link the Launch Board hands out. Last 30 days.
  select jsonb_agg(x order by (x->>'applications')::int desc, (x->>'leads')::int desc)
    into attributed
    from (
      select jsonb_build_object(
               'card_id', c.id, 'title', c.title, 'url', c.published_url,
               'account', c.brief->>'account', 'pillar', c.brief->>'pillar', 'hook', c.hook,
               'leads', (select count(*) from glowup_leads g where g.utm_content = c.id::text and g.created_at > n - interval '30 days')
                      + (select count(*) from brand_leads b where b.answers->>'utm_content' = c.id::text and b.created_at > n - interval '30 days'),
               'applications', (select count(*) from v_applications_real a where a.utm_content = c.id::text and a.created_at > n - interval '30 days')
             ) as x
        from content_cards c
       where c.id::text in (
               select utm_content from glowup_leads where utm_content is not null and created_at > n - interval '30 days'
               union select answers->>'utm_content' from brand_leads where answers ? 'utm_content' and created_at > n - interval '30 days'
               union select utm_content from v_applications_real where utm_content is not null and created_at > n - interval '30 days')
    ) q;

  return jsonb_build_object(
    'week_start', ws,
    'generated_at', n,
    'lanes', coalesce(lanes, '[]'::jsonb),
    'funnel', coalesce(funnel, '[]'::jsonb),
    'attributed', coalesce(attributed, '[]'::jsonb),
    'views_days_logged', (select count(distinct metric_date) from brand_metrics_daily
                           where metric = 'views' and metric_date > (n at time zone 'America/Phoenix')::date - 7),
    'post_sync_at', (select max(stats_at) from content_posts),
    'glowup', jsonb_build_object(
      'leads_7d', (select count(*) from glowup_leads where created_at > n - interval '7 days'),
      'leads_total', (select count(*) from glowup_leads),
      'by_stage', (select coalesce(jsonb_object_agg(stage, c), '{}'::jsonb) from (select stage, count(*) c from glowup_leads group by 1) s),
      'nurture_enabled', (select value = 'true' from system_settings where key = 'glowup_nurture_enabled'),
      'nurture_sent', (select coalesce(sum(nurture_step), 0) from glowup_leads))
  );
end $$;
revoke all on function public.brand_command_summary(date) from public, anon;
grant execute on function public.brand_command_summary(date) to authenticated;
