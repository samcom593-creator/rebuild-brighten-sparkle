-- MP-RECRUIT-BILLING + STALLED-ALERTS + FN-REVOKES (2026-11-10)

-- 1) anon loses EXECUTE on SECURITY DEFINER functions around deals / client pipeline.
--    Each carries an internal auth gate today; this makes a future gate regression
--    NOT equal an unauthenticated write path (same class as the 2026-08 recruit-write-path hole).
do $$
declare f record;
begin
  for f in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('admin_enqueue_onboarding_call','fn_can_access_pipeline_client','fn_client_pipeline_action',
        'fn_client_pipeline_create','fn_client_pipeline_update','lead_bundle_mark_sold','my_onboarding_roll_call',
        'save_apex_deal_draft','transition_apex_deal_status','fn_queue_onboarding_call_invites')
  loop
    execute format('revoke execute on function %s(%s) from anon', f.oid::regproc, pg_get_function_identity_arguments(f.oid));
  end loop;
end $$;

-- 2) Recruiting-system billing ledger + status + weekly behind-alert
alter table public.agent_recruiting_systems add column if not exists enrolled_at timestamptz;

create or replace function public.trg_ars_enrolled_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.enrolled and new.enrolled_at is null then new.enrolled_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ars_enrolled_at on public.agent_recruiting_systems;
create trigger ars_enrolled_at before insert or update on public.agent_recruiting_systems
for each row execute function public.trg_ars_enrolled_at();

create table if not exists public.agent_recruiting_payments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  week_start date not null,
  amount numeric(10,2) not null,
  method text,
  note text,
  recorded_by uuid default auth.uid(),
  paid_at timestamptz not null default now(),
  unique (agent_id, week_start)
);
alter table public.agent_recruiting_payments enable row level security;
drop policy if exists arp_admin_all on public.agent_recruiting_payments;
create policy arp_admin_all on public.agent_recruiting_payments for all to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role)) with check (has_role((select auth.uid()), 'admin'::app_role));
drop policy if exists arp_manager_all on public.agent_recruiting_payments;
create policy arp_manager_all on public.agent_recruiting_payments for all to authenticated
  using (has_role((select auth.uid()), 'manager'::app_role)) with check (has_role((select auth.uid()), 'manager'::app_role));
revoke all on public.agent_recruiting_payments from anon;
grant select, insert, update, delete on public.agent_recruiting_payments to authenticated;

create or replace view public.v_recruiting_billing_status with (security_invoker = true) as
select s.agent_id, a.display_name, s.plan, s.monthly_price, s.weekly_payment, s.enrolled_at,
  (floor(extract(epoch from (now() - s.enrolled_at)) / 604800)::int + 1) as weeks_due,
  coalesce(p.cnt, 0)::int as weeks_paid,
  coalesce(p.total, 0) as paid_total,
  round(((floor(extract(epoch from (now() - s.enrolled_at)) / 604800)::int + 1) * s.weekly_payment) - coalesce(p.total, 0), 2) as balance_due,
  p.last_paid
from public.agent_recruiting_systems s
join public.agents a on a.id = s.agent_id
left join (
  select agent_id, count(*) as cnt, sum(amount) as total, max(paid_at) as last_paid
  from public.agent_recruiting_payments group by 1
) p on p.agent_id = s.agent_id
where s.enrolled and s.enrolled_at is not null;
revoke all on public.v_recruiting_billing_status from anon;
grant select on public.v_recruiting_billing_status to authenticated;

create or replace function public.fn_recruiting_billing_weekly() returns void
language plpgsql security definer set search_path = public as $$
declare behind_list text; n int; total numeric;
begin
  -- weekly cron + 6-day lookback = at most one page per week even if rescheduled
  if exists (select 1 from bot_alerts where event_type = 'recruiting_billing_behind' and created_at > now() - interval '6 days') then
    return;
  end if;
  select string_agg(display_name || ' $' || balance_due, ', ' order by balance_due desc), count(*), round(sum(balance_due), 2)
    into behind_list, n, total
  from v_recruiting_billing_status where balance_due > 0;
  if coalesce(n, 0) > 0 then
    insert into bot_alerts (source, event_type, severity, subject, body, channels)
    values ('recruiting-billing', 'recruiting_billing_behind', 'critical',
      n || ' recruiting-system agent' || case when n = 1 then '' else 's' end || ' behind — $' || total || ' outstanding',
      'Behind on weekly recruiting-system payments: ' || behind_list || '. Record payments in the CRM person drawer (/dashboard/team).',
      array['ntfy','discord']);
  end if;
end $$;
revoke all on function public.fn_recruiting_billing_weekly() from public, anon, authenticated;
do $$ begin perform cron.unschedule('apex-recruiting-billing-weekly'); exception when others then null; end $$;
select cron.schedule('apex-recruiting-billing-weekly', '0 16 * * 1', 'select public.fn_recruiting_billing_weekly()');

-- 3) Stalled carrier-contracting bubbles -> daily check, per-agent 7d dedupe, one summary alert
alter table public.getting_started_progress add column if not exists contracting_stalled_alerted_at timestamptz;

create or replace function public.fn_onboarding_contracting_stalled_alert() returns void
language plpgsql security definer set search_path = public as $$
declare body_list text; n int;
begin
  with exempt as (
    with recursive down(id) as (
      select e.root_agent_id from carrier_hierarchy_exemptions e where e.carrier = 'american_home_life'
      union
      select ag.id from agents ag join down d on ag.manager_id = d.id or ag.invited_by_manager_id = d.id
    ) select id from down
  ),
  stalled as (
    select p.id, a.display_name,
      greatest(1, floor(extract(epoch from (now() - coalesce(p.last_activity_at, p.stage_entered_at))) / 86400)::int) as days_quiet,
      array_remove(array[
        case when p.agent_id not in (select id from exempt) and p.completed_ahl_onboarding is null then 'AHL onboarding' end,
        case when p.agent_id not in (select id from exempt) and p.contracted_ahl_sent is null then 'AHL contracting' end,
        case when p.contracted_ethos_sent is null then 'Ethos' end,
        case when p.contracted_chubb_sent is null then 'Chubb' end
      ], null) as missing
    from getting_started_progress p
    join agents a on a.id = p.agent_id and coalesce(a.is_deactivated, false) = false
    where p.current_stage = 'contracting'
      and coalesce(p.last_activity_at, p.stage_entered_at) < now() - interval '5 days'
      and (p.contracting_stalled_alerted_at is null or p.contracting_stalled_alerted_at < now() - interval '7 days')
  ),
  real_stalled as (select * from stalled where array_length(missing, 1) > 0),
  stamped as (
    update getting_started_progress gp set contracting_stalled_alerted_at = now()
    where gp.id in (select id from real_stalled) returning gp.id
  )
  select count(*), string_agg(display_name || ' (' || array_to_string(missing, ', ') || ' — quiet ' || days_quiet || 'd)', '; ')
    into n, body_list from real_stalled;
  if coalesce(n, 0) > 0 then
    insert into bot_alerts (source, event_type, severity, subject, body, channels)
    values ('onboarding', 'contracting_stalled', 'critical',
      n || ' hire' || case when n = 1 then '' else 's' end || ' stalled in contracting 5d+',
      'Stalled on carrier contracting: ' || body_list || '. Nudge them or open Getting Started (/dashboard/getting-started).',
      array['ntfy']);
  end if;
end $$;
revoke all on function public.fn_onboarding_contracting_stalled_alert() from public, anon, authenticated;
do $$ begin perform cron.unschedule('apex-onboarding-contracting-stalled'); exception when others then null; end $$;
select cron.schedule('apex-onboarding-contracting-stalled', '0 15 * * *', 'select public.fn_onboarding_contracting_stalled_alert()');

-- 1b) The anon revoke above is insufficient where EXECUTE flows through the default
--     PUBLIC grant (has_function_privilege('anon',...) stays true via PUBLIC).
--     Revoke PUBLIC, grant back the audiences that legitimately call these.
do $$
declare f record;
begin
  for f in
    select p.oid, p.proname, (select t.typname from pg_type t where t.oid = p.prorettype) as ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('admin_enqueue_onboarding_call','fn_can_access_pipeline_client','fn_client_pipeline_action',
        'fn_client_pipeline_create','fn_client_pipeline_update','lead_bundle_mark_sold','my_onboarding_roll_call',
        'save_apex_deal_draft','transition_apex_deal_status','fn_queue_onboarding_call_invites')
  loop
    execute format('revoke execute on function %s(%s) from public, anon', f.oid::regproc, pg_get_function_identity_arguments(f.oid));
    if f.ret <> 'trigger' then
      execute format('grant execute on function %s(%s) to authenticated, service_role', f.oid::regproc, pg_get_function_identity_arguments(f.oid));
    end if;
  end loop;
end $$;

-- 1c) PROVEN LIVE: sellable_pool / sellable_leads_match returned full lead PII
--     (names, phones, emails, DNC, policy face amounts) to the anon role with no
--     internal gate. Revoke public+anon on these and the other no-gate helpers
--     that have no business being callable logged-out; authenticated + service_role
--     keep execute (the Lead Manager UI calls them signed in).
do $$
declare f record;
begin
  for f in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sellable_leads_match','sellable_pool','fn_agent_contract_pct_live',
        'get_downline_agent_ids','sam_agent_ids_to_exclude','fn_agent_subagency_live',
        'apex_toolkit_can_work_application','apex_toolkit_is_staff')
  loop
    execute format('revoke execute on function %s(%s) from public, anon', f.oid::regproc, pg_get_function_identity_arguments(f.oid));
    execute format('grant execute on function %s(%s) to authenticated, service_role', f.oid::regproc, pg_get_function_identity_arguments(f.oid));
  end loop;
end $$;
