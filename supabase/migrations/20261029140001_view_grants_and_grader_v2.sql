-- MP-310 (2026-10-29). Sam: "best closers and all that stuff says access denied" and "fix the grading process ...
-- how much they were on script". (1) Every ReadyMode view below is security_invoker, so the rows a login sees are decided
-- by RLS on the base tables; the views themselves had lost their SELECT grant to authenticated, which made every review
-- list, the dialer scorecard and Dialer leads fail with "permission denied" for Sam and Aisha. (2) Grades gain script
-- adherence and a reason with evidence behind every score (rubric v2).
alter table public.readymode_call_analysis
  add column if not exists script_score int,
  add column if not exists script_followed text,
  add column if not exists script_steps jsonb not null default '[]'::jsonb,
  add column if not exists score_reasons jsonb not null default '{}'::jsonb,
  add column if not exists rubric_version int not null default 1;
update public.readymode_call_analysis set rubric_version = 2 where model = 'grade-v1' and stage_reached in ('voicemail', 'no_contact') and rubric_version < 2;

drop view if exists public.v_call_training;
create view public.v_call_training with (security_invoker = true) as
select a.id as analysis_id, a.call_id, c.external_call_id, c.call_started_at, c.disposition, c.agent_raw, c.agent_id,
  coalesce(ag.display_name, c.agent_raw) as agent_name, c.duration_seconds, c.recording_url, c.lead_first_name,
  a.overall_score, a.scores, a.stage_reached,
  case a.outcome_quality when 4 then 'great' when 3 then 'good' when 2 then 'average' when 1 then 'poor' end as outcome_quality,
  a.great_call, a.training_tags, a.tactics, a.strengths, a.improvements,
  a.objection_moments, a.key_quotes, a.coaching_priority, a.coaching_notes, a.compliance_flags, a.sentiment, a.summary, a.analyzed_at,
  (p.id is not null) as has_packet, i.summary as resell_summary,
  a.script_score, a.script_followed, a.script_steps, a.score_reasons, a.rubric_version
from public.readymode_call_analysis a
join public.readymode_dialer_calls c on c.id = a.call_id
left join public.agents ag on ag.id = c.agent_id
left join public.readymode_booking_packets p on p.call_id = c.id
left join public.readymode_call_insights i on i.call_id = c.id
where a.model = 'grade-v1';

create or replace view public.v_call_training_agents with (security_invoker = true) as
select coalesce(ag.display_name, c.agent_raw) as agent_name, c.agent_id, c.agent_raw,
  count(*)::int as calls_total,
  count(*) filter (where c.disposition = 'Completed Sale')::int as sold,
  count(a.id)::int as graded,
  round(avg(a.overall_score) filter (where a.stage_reached not in ('voicemail', 'no_contact')))::int as avg_score,
  count(*) filter (where a.great_call)::int as great_calls,
  round(avg((a.scores->>'objection_handling')::numeric) filter (where a.stage_reached not in ('voicemail', 'no_contact')), 1) as avg_objection_handling,
  round(avg((a.scores->>'close')::numeric) filter (where a.stage_reached not in ('voicemail', 'no_contact')), 1) as avg_close,
  count(*) filter (where a.coaching_priority = 'urgent')::int as urgent_flags,
  max(c.call_started_at) as last_call_at,
  round(avg(a.script_score) filter (where a.script_score is not null), 1) as avg_script
from public.readymode_dialer_calls c
left join public.agents ag on ag.id = c.agent_id
left join public.readymode_call_analysis a on a.call_id = c.id and a.model = 'grade-v1'
where c.call_started_at > now() - interval '90 days' and c.disposition <> 'Not Available'
group by 1, 2, 3;

grant select on public.v_readymode_agent_daily, public.v_readymode_agent_scorecard, public.v_readymode_leads, public.v_readymode_lead_quality,
  public.v_agent_slump, public.v_sold_call_quality, public.v_agent_business_quality, public.v_lead_bundle_summary,
  public.v_best_closers, public.v_deals_left_on_table, public.v_easy_closes, public.v_more_coverage, public.v_dropoff_risk, public.v_call_client,
  public.v_book_row_calls, public.v_book_row_call_summary, public.v_book_row_call_detail, public.v_sold_call_book_match,
  public.v_call_training, public.v_call_training_agents to authenticated;
