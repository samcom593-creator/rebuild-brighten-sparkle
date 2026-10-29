-- MP-310 wave 2 (2026-10-28, Sam: "pull all the data as much as you can, give us everything possible").
-- ReadyMode's agent / dialer / user report screens are JavaScript apps the bot cannot read headless, and
-- ReadyMode has no lead-list URL, so the same data is computed from the full call log the bot pulls.
-- Applied live through bot-sql on 2026-10-28; this file mirrors it, and its version is recorded in
-- supabase_migrations.schema_migrations so supabase db push treats it as applied.

-- Second roster pass: departed agents ("(deleted)" stripped) whose dialer name matches exactly one roster row.
with raw as (
  select distinct agent_raw, regexp_replace(lower(regexp_replace(trim(agent_raw), '\s*\(deleted\)\s*', '', 'gi')), '[^a-z0-9]+', '', 'g') norm
  from public.readymode_dialer_calls where agent_id is null and nullif(trim(agent_raw), '') is not null
), cand as (
  select r.agent_raw, a.id from raw r
  join public.agents a on regexp_replace(lower(trim(coalesce(a.display_name, ''))), '[^a-z0-9]+', '', 'g') = r.norm
  where a.canonical_agent_id is null and length(r.norm) >= 6
), uniq as (select agent_raw, (array_agg(id))[1] id from cand group by agent_raw having count(distinct id) = 1)
update public.readymode_dialer_calls c set agent_id = u.id from uniq u where c.agent_id is null and c.agent_raw = u.agent_raw;

create or replace view public.v_readymode_agent_daily with (security_invoker = true) as
select coalesce(ag.display_name, c.agent_raw) as agent_name, c.agent_id, c.agent_raw,
  (c.call_started_at at time zone 'America/Chicago')::date as day,
  count(*)::int as calls,
  count(*) filter (where c.disposition <> 'Not Available')::int as contacts,
  count(*) filter (where c.disposition = 'Completed Sale')::int as sold,
  count(*) filter (where c.disposition = '&rArr; Appointments')::int as appointments,
  count(*) filter (where c.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection'))::int as objections,
  count(*) filter (where c.disposition = 'Do Not Call')::int as dnc,
  coalesce(sum(c.duration_seconds), 0)::int as talk_seconds,
  min(c.call_started_at) as first_call_at, max(c.call_started_at) as last_call_at
from public.readymode_dialer_calls c left join public.agents ag on ag.id = c.agent_id
where c.call_started_at is not null
group by 1, 2, 3, 4;

create or replace view public.v_readymode_agent_scorecard with (security_invoker = true) as
select agent_name, agent_id, agent_raw,
  coalesce(sum(calls) filter (where day >= current_date - 30), 0)::int as calls_30d,
  coalesce(sum(contacts) filter (where day >= current_date - 30), 0)::int as contacts_30d,
  coalesce(sum(sold) filter (where day >= current_date - 30), 0)::int as sold_30d,
  coalesce(sum(appointments) filter (where day >= current_date - 30), 0)::int as appointments_30d,
  coalesce(sum(talk_seconds) filter (where day >= current_date - 30), 0)::int as talk_seconds_30d,
  count(*) filter (where day >= current_date - 30 and calls > 0)::int as days_dialed_30d,
  sum(calls)::int as calls_all, sum(contacts)::int as contacts_all, sum(sold)::int as sold_all, sum(dnc)::int as dnc_all,
  round(100.0 * sum(sold) / nullif(sum(contacts), 0), 2) as sold_per_100_contacts,
  min(day) as first_day, max(last_call_at) as last_call_at
from public.v_readymode_agent_daily group by 1, 2, 3;

create or replace view public.v_readymode_leads with (security_invoker = true) as
select c.lead_phone10 as phone10,
  (array_agg(c.lead_first_name order by c.call_started_at desc nulls last))[1] as first_name,
  (array_agg(c.lead_last_name order by c.call_started_at desc nulls last))[1] as last_name,
  (array_agg(c.lead_email order by c.call_started_at desc nulls last) filter (where nullif(c.lead_email, '') is not null))[1] as email,
  count(*)::int as attempts,
  min(c.call_started_at) as first_dialed_at, max(c.call_started_at) as last_dialed_at,
  (array_agg(c.disposition order by c.call_started_at desc nulls last))[1] as last_disposition,
  (array_agg(c.agent_raw order by c.call_started_at desc nulls last))[1] as last_agent,
  bool_or(c.disposition = 'Completed Sale') as ever_sold,
  bool_or(c.disposition = 'Do Not Call') as do_not_call,
  bool_or(c.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection', 'I Give Up')) as ever_objection,
  bool_or(c.disposition = '&rArr; Appointments') as ever_appointment,
  bool_or(c.disposition <> 'Not Available') as ever_reached,
  (array_agg(c.campaign_name order by c.call_started_at desc nulls last) filter (where nullif(c.campaign_name, '') is not null))[1] as campaign
from public.readymode_dialer_calls c where c.lead_phone10 is not null group by c.lead_phone10;
