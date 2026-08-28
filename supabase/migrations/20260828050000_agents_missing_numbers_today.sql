-- MP-340 — one operand for "who hasn't logged numbers today".
--
-- The 6 PM Central reminder (pg_cron 83/84 -> edge fn numbers-reminder) computed
-- this only inside TypeScript (index.ts:100-171), so apex-doctor, the admin UI and
-- any Slack channel post could not share it — the curl-vs-reaper drift class. This
-- view restates the SAME predicate: active, licensed, not deactivated/inactive
-- agents, minus anyone with a daily_production row or a unified-production deal
-- posted on today's Chicago business date, minus roster exclusions and active Slack
-- audience exclusions. Reminder-already-sent is deliberately NOT applied here — that
-- is the sender's dedupe, not the business fact. Staff-only.

create or replace view public.v_agents_missing_numbers_today as
with today as (
  select (now() at time zone 'America/Chicago')::date as d
),
logged as (
  select dp.agent_id from public.daily_production dp, today where dp.production_date = today.d
  union
  select u.agent_id from public.v_production_unified u, today where u.posted_date = today.d and u.agent_id is not null
),
excluded as (
  select agent_id from public.roster_exclusions
  union
  select agent_id from public.messaging_audience_exclusions where provider = 'slack' and is_active
)
select
  a.id as agent_id,
  a.display_name,
  a.user_id,
  (select d from today) as business_date
from public.agents a
where a.status = 'active'
  and coalesce(a.is_deactivated, false) = false
  and coalesce(a.is_inactive, false) = false
  and a.license_status = 'licensed'
  and a.id not in (select agent_id from logged where agent_id is not null)
  and a.id not in (select agent_id from excluded where agent_id is not null)
  and public.is_agency_staff();

grant select on public.v_agents_missing_numbers_today to authenticated, service_role;
