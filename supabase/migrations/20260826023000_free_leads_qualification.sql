-- Free Leads qualification, universal recruiting links, and weekly alert truth.
--
-- Qualification is individual producer production only. The Vantage external
-- aggregate gap is intentionally excluded because it cannot be attributed to a
-- real agent. Production comes from v_production_canonical, which already
-- deduplicates AgentLink and native APEX deals.

begin;

-- Every real agent row gets a stable recruiting slug. The UUID suffix makes the
-- backfill collision-safe; the existing BEFORE INSERT trigger covers new hires.
update public.agents a
set ref_slug = lower(regexp_replace(
  coalesce(nullif(btrim(a.display_name), ''), 'agent'),
  '[^a-zA-Z0-9]+', '-', 'g'
)) || '-' || left(a.id::text, 6)
where nullif(btrim(a.ref_slug), '') is null
  and a.id <> '00000000-0000-0000-0000-00000000a008'::uuid;

create or replace function public.my_recruiting_link()
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((
    select jsonb_build_object(
      'agent_id', a.id,
      'ref_slug', a.ref_slug,
      'link', 'https://apex-financial.org/apply?ref=' || a.ref_slug,
      'active', true
    )
    from public.agents a
    where a.user_id = auth.uid()
      and a.status = 'active'
      and coalesce(a.is_deactivated, false) = false
      and coalesce(a.is_inactive, false) = false
      and nullif(btrim(a.ref_slug), '') is not null
      and not public.fn_agent_is_roster_excluded(a.id)
    order by a.created_at
    limit 1
  ), jsonb_build_object('active', false));
$function$;

revoke all on function public.my_recruiting_link() from public, anon;
grant execute on function public.my_recruiting_link() to authenticated;

create or replace function public.crm_agent_free_leads_status()
returns table(
  agent_id uuid,
  qualifies boolean,
  reason text,
  l30_alp numeric,
  tenure_days integer,
  days_left_in_ramp integer,
  needed_for_qual numeric,
  qualifying_threshold numeric,
  ramp_days integer
)
language sql
stable
security definer
set search_path = public
as $function$
with params as (
  select
    (now() at time zone 'America/Phoenix')::date as today,
    20000.00::numeric as threshold,
    30::integer as ramp_days
), targets as (
  select
    a.id,
    coalesce(public.fn_canonical_agent_id(a.id), a.id) as canonical_id,
    greatest(0, case
      when a.start_date is not null then p.today - a.start_date
      when a.created_at is not null
        then p.today - (a.created_at at time zone 'America/Phoenix')::date
      else 0
    end)::integer as tenure_days
  from public.agents a
  cross join params p
  where a.status = 'active'
    and coalesce(a.is_deactivated, false) = false
    and coalesce(a.is_inactive, false) = false
    and a.id <> '00000000-0000-0000-0000-00000000a008'::uuid
    and not public.fn_agent_is_roster_excluded(a.id)
    and (
      auth.role() = 'service_role'
      or public.crm_can_read_agent_scope(a.id)
    )
), production as (
  select
    coalesce(public.fn_canonical_agent_id(v.agent_id), v.agent_id) as canonical_id,
    coalesce(sum(v.annual_premium), 0)::numeric as l30_alp
  from public.v_production_canonical v
  cross join params p
  where v.agent_id is not null
    and v.posted_date between p.today - 29 and p.today
  group by 1
), status as (
  select
    t.id as agent_id,
    t.tenure_days,
    coalesce(pr.l30_alp, 0)::numeric as l30_alp,
    p.threshold,
    p.ramp_days,
    (t.tenure_days <= p.ramp_days or coalesce(pr.l30_alp, 0) >= p.threshold) as qualifies,
    greatest(0, p.ramp_days - t.tenure_days) as days_left_in_ramp,
    greatest(0::numeric, p.threshold - coalesce(pr.l30_alp, 0)) as needed_for_qual
  from targets t
  cross join params p
  left join production pr on pr.canonical_id = t.canonical_id
)
select
  s.agent_id,
  s.qualifies,
  case
    when s.tenure_days <= s.ramp_days
      then 'First 30 Days Ramp Active (' || s.days_left_in_ramp || ' days remaining)'
    when s.qualifies
      then 'Producing Tier Qualified ($' || to_char(s.l30_alp, 'FM999,999,990') || ' L30 ALP)'
    else '$' || to_char(s.needed_for_qual, 'FM999,999,990') ||
      ' needed to unlock Free Leads ($' || to_char(s.l30_alp, 'FM999,999,990') || ' / $20K)'
  end,
  s.l30_alp,
  s.tenure_days,
  s.days_left_in_ramp,
  s.needed_for_qual,
  s.threshold,
  s.ramp_days
from status s;
$function$;

create or replace function public.get_agent_free_leads_status(p_agent_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select coalesce((
    select jsonb_build_object(
      'qualifies', s.qualifies,
      'reason', s.reason,
      'l30_alp', s.l30_alp,
      'tenure_days', s.tenure_days,
      'days_left_in_ramp', s.days_left_in_ramp,
      'needed_for_qual', s.needed_for_qual,
      'qualifying_threshold', s.qualifying_threshold,
      'ramp_days', s.ramp_days
    )
    from public.crm_agent_free_leads_status() s
    where s.agent_id = p_agent_id
  ), jsonb_build_object('qualifies', false, 'reason', 'Agent not found or outside your team'));
$function$;

revoke all on function public.crm_agent_free_leads_status() from public, anon;
revoke all on function public.get_agent_free_leads_status(uuid) from public, anon;
grant execute on function public.crm_agent_free_leads_status() to authenticated, service_role;
grant execute on function public.get_agent_free_leads_status(uuid) to authenticated, service_role;

create table if not exists public.free_leads_weekly_delivery_log (
  week_start date not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  channel text not null check (channel in ('email', 'slack')),
  status text not null check (status in ('delivered', 'skipped', 'failed')),
  provider_message_id text,
  error_redacted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (week_start, agent_id, channel)
);

alter table public.free_leads_weekly_delivery_log enable row level security;
revoke all on table public.free_leads_weekly_delivery_log from public, anon, authenticated;
grant all on table public.free_leads_weekly_delivery_log to service_role;

do $block$
declare
  v_installation_id uuid;
  v_destination_id uuid;
begin
  select i.id into v_installation_id
  from public.messaging_workspace_installations i
  where i.provider = 'slack'
    and i.environment = 'production'
    and i.workspace_id = 'T0BSN03M2AJ'
  order by i.created_at desc
  limit 1;

  select d.id into v_destination_id
  from public.messaging_destinations d
  where d.installation_id = v_installation_id
    and d.purpose = 'recruiting_growth'
    and d.scope_type = 'organization'
    and d.scope_key is null
  limit 1;

  if v_installation_id is not null and v_destination_id is not null then
    insert into public.messaging_route_rules(
      installation_id, event_type, destination_id, audience_scope,
      priority, batch_policy, is_enabled
    ) values (
      v_installation_id, 'free_leads.weekly_summary', v_destination_id,
      'organization', 1, 'instant', true
    )
    on conflict (installation_id, event_type, destination_id, audience_scope)
    do update set batch_policy = excluded.batch_policy, is_enabled = true;
  end if;
end;
$block$;

do $block$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'apex-free-leads-weekly-alerts';

    perform cron.schedule(
      'apex-free-leads-weekly-alerts',
      '0 15 * * 1',
      $cron$
        select net.http_post(
          url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/free-leads-weekly-alerts',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets
              where name = 'apex_bot_token' limit 1
            ),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 50000
        );
      $cron$
    );
  end if;
end;
$block$;

comment on function public.crm_agent_free_leads_status() is
  'Scoped Free Leads truth: first 30 days or >= $20K canonical individual ALP in the Phoenix trailing 30-day window.';
comment on function public.my_recruiting_link() is
  'Stable personal APEX recruiting link for every active authenticated agent.';

commit;
