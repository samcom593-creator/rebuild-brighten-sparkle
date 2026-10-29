-- MP-310 (2026-10-28). Sam: "for the training hub, give managers or uplines access only to their agents' calls, and
-- give Aisha access to all agency calls", "see the client they talk to ... a button to show all the client's data",
-- and "rating best closers ... drop off and chargeback risk ... agents leaving a lot of deals on the table ... deals
-- that could be easily closed by more experienced agents ... deals where more coverage is left on the table".
create table if not exists public.readymode_agent_coaching (
  agent_name text primary key, summary text, habits text[] not null default '{}', watch_outs text[] not null default '{}',
  coaching_tips text[] not null default '{}', strengths text[] not null default '{}', next_call_focus text,
  source_count int not null default 0, last_graded_at timestamptz, model text, generated_at timestamptz not null default now()
);
alter table public.readymode_agent_coaching enable row level security;
revoke all on public.readymode_agent_coaching from anon;
revoke insert, update, delete, truncate on public.readymode_agent_coaching from authenticated;
grant select on public.readymode_agent_coaching to authenticated;
drop policy if exists readymode_agent_coaching_read on public.readymode_agent_coaching;
create policy readymode_agent_coaching_read on public.readymode_agent_coaching for select to authenticated using ((select public.can_view_sold_calls()));

-- 1. Uplines read their own team's calls, grades and coaching: my_downline_agent_ids(), the team the rest of the site uses.
drop policy if exists rmd_downline_read on public.readymode_dialer_calls;
create policy rmd_downline_read on public.readymode_dialer_calls for select to authenticated
  using (agent_id in (select d.agent_id from public.my_downline_agent_ids() d));
drop policy if exists rmca_downline_read on public.readymode_call_analysis;
create policy rmca_downline_read on public.readymode_call_analysis for select to authenticated
  using (exists (select 1 from public.readymode_dialer_calls c where c.id = readymode_call_analysis.call_id
                 and c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)));
drop policy if exists readymode_agent_coaching_downline_read on public.readymode_agent_coaching;
create policy readymode_agent_coaching_downline_read on public.readymode_agent_coaching for select to authenticated
  using (exists (select 1 from public.agents a where a.display_name = readymode_agent_coaching.agent_name
                 and a.id in (select d.agent_id from public.my_downline_agent_ids() d)));

-- 2. Audio: an upline hears the muted copy of any call on their team; unmuted sold-call audio stays Sam and Aisha's.
create or replace function public.can_play_call_audio(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.can_view_sold_calls() then exists (select 1 from public.readymode_call_audio a where a.raw_path = p_path or a.redacted_path = p_path)
    else exists (
      select 1 from public.readymode_call_audio a join public.readymode_dialer_calls c on c.id = a.call_id
      where a.redacted_path = p_path
        and ((a.team_visible and public.is_active_agent_login()) or c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)))
  end
$$;
create or replace function public.call_audio_for(p_call_ids uuid[])
returns table (call_id uuid, path text, variant text, duration_seconds int, muted_ranges jsonb)
language sql stable security definer set search_path = public as $$
  select a.call_id,
    case when public.can_view_sold_calls() and a.raw_path is not null then a.raw_path else a.redacted_path end,
    case when public.can_view_sold_calls() and a.raw_path is not null then 'full' else 'numbers_muted' end,
    a.duration_seconds,
    case when public.can_view_sold_calls() and a.raw_path is not null then '[]'::jsonb else a.muted_ranges end
  from public.readymode_call_audio a join public.readymode_dialer_calls c on c.id = a.call_id
  where a.call_id = any (p_call_ids)
    and (public.can_view_sold_calls() or (public.is_active_agent_login() and a.team_visible)
         or c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d))
$$;

-- 3. Best closers: close rate on reached calls, quality-adjusted by how many of their dialer sales stuck.
create or replace view public.v_best_closers with (security_invoker = true) as
with s as (
  select agent_name, sum(calls_30d)::int calls_30d, sum(contacts_30d)::int reached_30d, sum(sold_30d)::int sold_30d,
         sum(calls_all)::int calls_all, sum(contacts_all)::int reached_all, sum(sold_all)::int sold_all, max(last_call_at) last_call_at
  from public.v_readymode_agent_scorecard group by agent_name
), g as (
  select agent_name, round(avg(avg_score))::int avg_grade, sum(great_calls)::int great_calls,
         round(avg(avg_objection_handling), 1) avg_objection_handling, round(avg(avg_close), 1) avg_close
  from public.v_call_training_agents group by agent_name
), b as (
  select agent_name, sum(sold_calls)::int dialer_sales, sum(active)::int active, sum(pending)::int pending, sum(lapsing)::int lapsing,
         sum(fell_off)::int fell_off, sum(compliance_flagged)::int compliance_flagged
  from public.v_agent_business_quality group by agent_name
)
select s.agent_name, s.calls_30d, s.reached_30d, s.sold_30d, round(100.0 * s.sold_30d / nullif(s.reached_30d, 0), 1) as close_pct_30d,
  s.calls_all, s.reached_all, s.sold_all, round(100.0 * s.sold_all / nullif(s.reached_all, 0), 1) as close_pct_all,
  g.avg_grade, g.great_calls, g.avg_objection_handling, g.avg_close,
  b.dialer_sales, b.active, b.lapsing, b.fell_off, b.compliance_flagged,
  round(100.0 * (coalesce(b.lapsing, 0) + coalesce(b.fell_off, 0)) / nullif(coalesce(b.active, 0) + coalesce(b.pending, 0) + coalesce(b.lapsing, 0) + coalesce(b.fell_off, 0), 0), 1) as fall_off_pct,
  case when s.reached_all >= 50 then round((100.0 * s.sold_all / s.reached_all)
    * (1 - coalesce((coalesce(b.lapsing, 0) + coalesce(b.fell_off, 0))::numeric / nullif(coalesce(b.active, 0) + coalesce(b.pending, 0) + coalesce(b.lapsing, 0) + coalesce(b.fell_off, 0), 0), 0)), 2) end as sticky_close_score,
  s.last_call_at
from s left join g using (agent_name) left join b using (agent_name);

-- 4. Deals left on the table: per seat, warm leads (stopped at bank or SSN, booked an appointment, or the agent gave up)
--    whose number never bought and never asked not to be called.
create or replace view public.v_deals_left_on_table with (security_invoker = true) as
with warm as (
  select distinct on (c.lead_phone10) c.lead_phone10, coalesce(ag.display_name, c.agent_raw) as agent_name, c.disposition, c.call_started_at
  from public.readymode_dialer_calls c left join public.agents ag on ag.id = c.agent_id
  where c.lead_phone10 is not null and c.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection', '&rArr; Appointments', 'I Give Up')
  order by c.lead_phone10, c.call_started_at desc
), closed as (
  select distinct lead_phone10 from public.readymode_dialer_calls where lead_phone10 is not null and disposition in ('Completed Sale', 'Do Not Call')
)
select w.agent_name, count(*)::int as warm_not_sold,
  count(*) filter (where w.disposition in ('Bank Objection', 'No Bank Account'))::int as stopped_at_bank,
  count(*) filter (where w.disposition = 'Social Objection')::int as stopped_at_ssn,
  count(*) filter (where w.disposition = 'I Give Up')::int as gave_up,
  count(*) filter (where w.disposition = '&rArr; Appointments')::int as appointment_not_sold,
  count(*) filter (where w.call_started_at > now() - interval '30 days')::int as last_30d
from warm w left join closed x on x.lead_phone10 = w.lead_phone10
where x.lead_phone10 is null
group by w.agent_name;

-- 5. Easy closes for a stronger closer: the warm lead itself, what happened on its last warm call, and its grade.
create or replace view public.v_easy_closes with (security_invoker = true) as
with last_warm as (
  select distinct on (c.lead_phone10) c.lead_phone10, c.id as call_id, c.disposition, c.call_started_at, c.lead_first_name, c.lead_last_name,
    coalesce(ag.display_name, c.agent_raw) as agent_name
  from public.readymode_dialer_calls c left join public.agents ag on ag.id = c.agent_id
  where c.lead_phone10 is not null and c.disposition in ('Bank Objection', 'No Bank Account', 'Social Objection', '&rArr; Appointments')
  order by c.lead_phone10, c.call_started_at desc
), closed as (
  select distinct lead_phone10 from public.readymode_dialer_calls where lead_phone10 is not null and disposition in ('Completed Sale', 'Do Not Call')
), flip_dnc as (
  select distinct right(regexp_replace(coalesce(f.phone, ''), '[^0-9]', '', 'g'), 10) as phone10 from public.v_book_flip_worklist f where f.flip_status = 'do_not_call' or f.do_not_call
), marked as (
  select distinct phone10 from public.lead_bundle_items where status = 'do_not_call'
)
select w.lead_phone10 as phone10, w.lead_first_name as first_name, w.lead_last_name as last_name, w.call_id, w.disposition, w.call_started_at, w.agent_name,
  ((now() at time zone 'America/Chicago')::date - (w.call_started_at at time zone 'America/Chicago')::date) as days_ago,
  i.summary as what_happened, i.approval_status, i.price_objection, i.bank_objection, i.ssn_objection, i.gave_ssn, i.gave_bank,
  array_to_string(i.other_opportunities, '; ') as opportunities, g.overall_score as call_grade,
  exists (select 1 from public.lead_bundle_items b where b.phone10 = w.lead_phone10 and b.removed_at is null) as in_a_bundle
from last_warm w
left join closed x on x.lead_phone10 = w.lead_phone10
left join flip_dnc fd on fd.phone10 = w.lead_phone10
left join marked mk on mk.phone10 = w.lead_phone10
left join public.readymode_call_insights i on i.call_id = w.call_id
left join public.readymode_call_analysis g on g.call_id = w.call_id and g.model = 'grade-v1'
where x.lead_phone10 is null and fd.phone10 is null and mk.phone10 is null;

-- 6. More coverage left on the table: buyers who also wanted a spouse, mortgage, children or more coverage covered.
create or replace view public.v_more_coverage with (security_invoker = true) as
select q.call_id, q.call_started_at, q.agent_name, q.lead_first_name as first_name, q.lead_last_name as last_name, c.lead_phone10 as phone10,
  q.in_book, q.book_status, q.status_group, q.packet_carrier, q.packet_monthly_premium,
  i.spouse_coverage, i.mortgage_protection, array_to_string(i.other_opportunities, '; ') as opportunities, i.summary as what_happened
from public.v_sold_call_quality q
join public.readymode_dialer_calls c on c.id = q.call_id
join public.readymode_call_insights i on i.call_id = q.call_id
where (i.spouse_coverage or i.mortgage_protection or coalesce(cardinality(i.other_opportunities), 0) > 0)
  and coalesce(q.status_group, '') <> 'dead'
  and not exists (select 1 from public.readymode_dialer_calls d where d.lead_phone10 = c.lead_phone10 and d.disposition = 'Do Not Call');

-- 7. Drop-off and chargeback risk: dialer sales that fell off, are lapsing, were declined after SSN and bank, carry a
--    compliance flag, sit pending 3+ weeks, or never reached the book; each with the fix in plain words.
create or replace view public.v_dropoff_risk with (security_invoker = true) as
select q.call_id, q.call_started_at, q.agent_name, q.lead_first_name as first_name, q.lead_last_name as last_name, c.lead_phone10 as phone10,
  q.quality_verdict, q.book_status, q.status_group, q.book_carrier, q.packet_monthly_premium, q.compliance_flag_count,
  q.approval_status, q.declined_after_ssn_bank, q.coaching_notes, q.resell_summary as what_happened,
  case
    when q.quality_verdict = 'fell_off' then 'Fell off the book: call back and rewrite'
    when q.quality_verdict = 'lapsing' then 'Lapsing: save it before it lapses'
    when q.declined_after_ssn_bank then 'Declined after giving SSN and bank: try another carrier'
    when q.quality_verdict = 'compliance_flag' then 'Compliance flag on the sale: chargeback risk, hear the call'
    when q.status_group = 'pending' and q.call_started_at < now() - interval '21 days' then 'Pending 3+ weeks: chase the carrier'
    when q.quality_verdict = 'not_in_book' then 'Sold on the call, never booked'
    else 'Review'
  end as risk
from public.v_sold_call_quality q join public.readymode_dialer_calls c on c.id = q.call_id
where q.quality_verdict in ('fell_off', 'lapsing', 'compliance_flag', 'not_in_book') or q.declined_after_ssn_bank
   or (q.status_group = 'pending' and q.call_started_at < now() - interval '21 days');

-- 8. Everything the call picked up about the client, for the Client button (packet fields stay Sam and Aisha's by RLS).
create or replace view public.v_call_client with (security_invoker = true) as
select c.id as call_id, c.external_call_id, c.call_started_at, c.disposition, c.agent_raw, c.lead_first_name, c.lead_last_name, c.lead_phone10, c.lead_email,
  p.id as packet_id, p.client_first_name, p.client_last_name, p.client_dob, p.client_phone, p.client_email, p.client_street, p.client_city, p.client_state, p.client_zip,
  p.carrier, p.product, p.face_amount, p.monthly_premium, p.draft_day, p.payment_method_type, p.bank_name, p.policy_number, p.beneficiaries, p.health_notes,
  p.tobacco, p.missing_fields, p.call_summary, p.key_points, p.ssn_last4,
  i.summary as resell_angle, i.approval_status, i.approval_quote, i.gave_ssn, i.gave_bank, i.price_objection, i.bank_objection, i.ssn_objection,
  i.spouse_coverage, i.mortgage_protection, i.other_opportunities,
  exists (select 1 from public.readymode_dialer_calls d where d.lead_phone10 = c.lead_phone10 and d.disposition = 'Do Not Call') as do_not_call
from public.readymode_dialer_calls c
left join public.readymode_booking_packets p on p.call_id = c.id
left join public.readymode_call_insights i on i.call_id = c.id;

-- 9. Drop-off list carries the do-not-call flag so a buyer who asked not to be called never gets a Call link.
create or replace view public.v_dropoff_risk with (security_invoker = true) as
select q.call_id, q.call_started_at, q.agent_name, q.lead_first_name as first_name, q.lead_last_name as last_name, c.lead_phone10 as phone10,
  q.quality_verdict, q.book_status, q.status_group, q.book_carrier, q.packet_monthly_premium, q.compliance_flag_count,
  q.approval_status, q.declined_after_ssn_bank, q.coaching_notes, q.resell_summary as what_happened,
  case
    when q.quality_verdict = 'fell_off' then 'Fell off the book: call back and rewrite'
    when q.quality_verdict = 'lapsing' then 'Lapsing: save it before it lapses'
    when q.declined_after_ssn_bank then 'Declined after giving SSN and bank: try another carrier'
    when q.quality_verdict = 'compliance_flag' then 'Compliance flag on the sale: chargeback risk, hear the call'
    when q.status_group = 'pending' and q.call_started_at < now() - interval '21 days' then 'Pending 3+ weeks: chase the carrier'
    when q.quality_verdict = 'not_in_book' then 'Sold on the call, never booked'
    else 'Review'
  end as risk,
  exists (select 1 from public.readymode_dialer_calls d where d.lead_phone10 = c.lead_phone10 and d.disposition = 'Do Not Call') as do_not_call
from public.v_sold_call_quality q join public.readymode_dialer_calls c on c.id = q.call_id
where q.quality_verdict in ('fell_off', 'lapsing', 'compliance_flag', 'not_in_book') or q.declined_after_ssn_bank
   or (q.status_group = 'pending' and q.call_started_at < now() - interval '21 days');
