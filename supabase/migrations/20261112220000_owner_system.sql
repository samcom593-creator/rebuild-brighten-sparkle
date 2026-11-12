-- MP-302 part 8 (2026-11-12): the owner's System overview.
--
-- Subscriptions are a MANUAL record: nothing here infers a charge from a connected service.
-- Each row says where it came from (source) and when someone last checked it (last_verified).
-- Integrations and obligations are read live from views this database already maintains.
-- Jobs that run on the Studio (launchd) are not visible from here and the page says so.

set lock_timeout = '3s';

create table if not exists public.owner_subscriptions (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  purpose text,
  plan text,
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  billing_frequency text check (billing_frequency is null or billing_frequency in ('monthly', 'yearly', 'weekly', 'quarterly', 'usage', 'one_time')),
  currency text not null default 'USD',
  renewal_date date,
  account_owner text,
  billing_url text check (billing_url is null or billing_url ~ '^https://'),
  status text not null default 'needs_review' check (status in ('active', 'canceled', 'needs_review')),
  source text not null default 'entered by hand',
  last_verified date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists owner_subscriptions_service_key on public.owner_subscriptions (lower(btrim(service)));

alter table public.owner_subscriptions enable row level security;
drop policy if exists owner_subscriptions_sam_only on public.owner_subscriptions;
create policy owner_subscriptions_sam_only on public.owner_subscriptions for all to authenticated
  using (public.is_sam()) with check (public.is_sam());
revoke all on public.owner_subscriptions from anon;
grant select, insert, update, delete on public.owner_subscriptions to authenticated;

insert into public.private_surface_registry (kind, name, why) values
  ('private_table', 'owner_subscriptions', 'what the owner pays for, what it costs and where it is billed')
on conflict (kind, name) do update set why = excluded.why;

-- Seed from the one existing record of recurring charges, as "needs review": those rows were
-- written on 2026-06-01 from failed-payment notices and have not been checked since. The amount
-- is what that record states. No renewal date is set because none is recorded.
insert into public.owner_subscriptions (service, purpose, cost_cents, billing_frequency, status, source, notes)
select m.vendor_name, m.category, m.monthly_amount_cents, 'monthly', 'needs_review',
       'mercury_subscriptions record of ' || to_char(m.created_at at time zone 'America/Phoenix', 'YYYY-MM-DD'),
       'Recorded then as "' || m.status || '"' || case when m.failures_30d > 0 then ', ' || m.failures_30d || ' failed charges in the 30 days before' else '' end || '. Not checked since.'
  from public.mercury_subscriptions m
on conflict do nothing;

create or replace function public.owner_system_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_out jsonb;
  v_postiz text;
begin
  if not public.is_sam() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  select nullif(btrim(value), '') into v_postiz from public.system_settings where key = 'postiz_integrations';

  select jsonb_build_object(
    'as_of', now(),
    'integrations', (
      select coalesce(jsonb_agg(x order by x->>'group', x->>'service'), '[]'::jsonb) from (
        select jsonb_build_object(
                 'group', 'Production feeds', 'service', p.origin, 'last_success', p.last_posted,
                 'health', case when p.verdict = 'live' then 'ok' when p.verdict = 'dormant' then 'retired' else 'failing' end,
                 'detail', p.verdict || ' · ' || p.deals_30d || ' deals in 30 days',
                 'affects', 'Production numbers on Home, the scoreboard and Book of Business',
                 'recovery', case when p.verdict in ('live', 'dormant') then null else 'Check why this source stopped posting deals.' end) as x
          from public.v_production_origin_freshness p
        union all
        select jsonb_build_object(
                 'group', 'Social and messaging', 'service', l.lane, 'last_success', l.last_seen,
                 'health', case when l.verdict = 'alive' then 'ok' when l.verdict = 'paused' then 'paused' else 'failing' end,
                 'detail', l.verdict || coalesce(' · expires in ' || l.hours_left || ' hours', ''),
                 'affects', l.owner,
                 'recovery', case when l.verdict in ('alive', 'paused') then null else l.fix end)
          from public.v_social_lane_health l
        union all
        select jsonb_build_object(
                 'group', 'Money', 'service', 'Stripe events', 'last_success', s.last_event_at,
                 'health', case when s.events_30d > 0 then 'ok' when s.active_subs = 0 then 'idle' else 'failing' end,
                 'detail', s.events_30d || ' events in 30 days · ' || s.active_subs || ' active subscriptions',
                 'affects', 'Offer sales and subscription status',
                 'recovery', case when s.events_30d > 0 or s.active_subs = 0 then null else 'Check the Stripe webhook endpoint.' end)
          from public.v_stripe_ingest_freshness s
        union all
        select jsonb_build_object(
                 'group', 'Calling', 'service', 'ReadyMode call log', 'last_success', r.last_ingest_at,
                 'health', case when r.ingest_24h > 0 then 'ok' else 'failing' end,
                 'detail', r.ingest_24h || ' calls pulled in 24 hours',
                 'affects', 'Call Training, Sold Calls, dialer activity',
                 'recovery', case when r.ingest_24h > 0 then null else 'No calls are arriving. Check the ReadyMode account status first, then the call puller.' end)
          from public.v_readymode_ingest_health r
        union all
        select jsonb_build_object(
                 'group', 'Social and messaging', 'service', 'Postiz scheduling', 'last_success', null,
                 'health', case when v_postiz is null then 'not_connected' else 'unknown' end,
                 'detail', case when v_postiz is null then 'No channel map is stored' else 'A channel map is stored; the API key is checked on the Social Media Center' end,
                 'affects', 'Scheduling approved posts',
                 'recovery', case when v_postiz is null then 'Add the Postiz API key and the channel map, then approve a post.' else null end)
      ) i
    ),
    'obligations', jsonb_build_object(
      'failed_jobs_24h', (
        select coalesce(jsonb_agg(jsonb_build_object('job', t.jobname, 'failures', t.n, 'last', t.last_at, 'message', t.msg) order by t.n desc), '[]'::jsonb)
          from (
            select j.jobname, count(*) as n, max(d.start_time) as last_at,
                   left((array_agg(d.return_message order by d.start_time desc))[1], 160) as msg
              from cron.job_run_details d join cron.job j on j.jobid = d.jobid
             where d.status = 'failed' and d.start_time > now() - interval '24 hours'
             group by j.jobname order by count(*) desc limit 10
          ) t),
      'critical_alerts_24h', (
        select coalesce(jsonb_agg(jsonb_build_object('subject', a.subject, 'at', a.created_at, 'link', a.action_link) order by a.created_at desc), '[]'::jsonb)
          from (select subject, created_at, action_link from public.bot_alerts
                 where severity = 'critical' and created_at > now() - interval '24 hours'
                 order by created_at desc limit 10) a),
      'open_blockers', (
        select coalesce(jsonb_agg(jsonb_build_object('title', b.title, 'fix', b.fix_action) order by b.created_at desc), '[]'::jsonb)
          from public.social_bot_blockers b where b.status = 'open'),
      'renewals_30d', (
        select coalesce(jsonb_agg(jsonb_build_object('service', s.service, 'renewal_date', s.renewal_date, 'cost_cents', s.cost_cents, 'currency', s.currency) order by s.renewal_date), '[]'::jsonb)
          from public.owner_subscriptions s
         where s.status = 'active' and s.renewal_date between (now() at time zone 'America/Phoenix')::date and (now() at time zone 'America/Phoenix')::date + 30),
      'subscriptions_to_review', (select count(*) from public.owner_subscriptions s where s.status = 'needs_review')
    )
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.owner_system_overview() from public, anon;
grant execute on function public.owner_system_overview() to authenticated;

comment on function public.owner_system_overview() is
  'Owner System page (MP-302): integration health read from the existing health views, and what is owed (failed jobs, critical alerts, open blockers, recorded renewals, subscriptions to review). Owner only. Cloud systems only: Studio launchd jobs are not visible here.';
