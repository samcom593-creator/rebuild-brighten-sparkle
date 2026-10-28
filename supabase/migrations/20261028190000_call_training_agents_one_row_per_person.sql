-- Call Training leaderboard: one row per person, counted on real conversations.
--
-- v_call_training_agents grouped by (display name, agent_id, agent_raw), so a person split into
-- two rows whenever ReadyMode spelled them differently (Marlyn Johnson and "Marlyn Johnson
-- (deleted)" ranked as two people). It also counted voicemail and no-contact analyses as
-- "graded" while averaging only real conversations, so "graded 3, avg 81" could mean one call.
-- Group by agent_id, or by the dialer name with ReadyMode's " (deleted)" suffix stripped when no
-- agent is linked; count graded on the same real-conversation basis as the averages.
-- Same columns, order and types as 20261028070001, so the page needs no change to read it.
create or replace view public.v_call_training_agents with (security_invoker = true) as
with c as (
  select d.*, nullif(btrim(regexp_replace(d.agent_raw, '\s*\(deleted\)\s*$', '', 'i')), '') as raw_clean
  from public.readymode_dialer_calls d
  where d.call_started_at > now() - interval '90 days' and d.disposition <> 'Not Available'
)
select
  coalesce(max(ag.display_name), max(c.raw_clean), 'Unknown agent') as agent_name,
  (array_agg(c.agent_id) filter (where c.agent_id is not null))[1] as agent_id,
  max(c.raw_clean) as agent_raw,
  count(*)::int as calls_total,
  count(*) filter (where c.disposition = 'Completed Sale')::int as sold,
  count(a.id) filter (where a.stage_reached not in ('voicemail', 'no_contact'))::int as graded,
  round(avg(a.overall_score) filter (where a.stage_reached not in ('voicemail', 'no_contact')))::int as avg_score,
  count(*) filter (where a.great_call)::int as great_calls,
  round(avg((a.scores->>'objection_handling')::numeric) filter (where a.stage_reached not in ('voicemail', 'no_contact')), 1) as avg_objection_handling,
  round(avg((a.scores->>'close')::numeric) filter (where a.stage_reached not in ('voicemail', 'no_contact')), 1) as avg_close,
  count(*) filter (where a.coaching_priority = 'urgent')::int as urgent_flags,
  max(c.call_started_at) as last_call_at
from c
left join public.agents ag on ag.id = c.agent_id
left join public.readymode_call_analysis a on a.call_id = c.id and a.model = 'grade-v1'
group by coalesce(c.agent_id::text, 'raw:' || lower(coalesce(c.raw_clean, '')));
