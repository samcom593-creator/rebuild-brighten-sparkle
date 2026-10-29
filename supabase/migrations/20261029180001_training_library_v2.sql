-- MP-310 (2026-10-29). Sam: "fix call training even more". The team's training library carries the rubric v2 breakdown
-- (scores, the reason behind each, the script checklist) so agents learn from the same evidence Sam sees.
drop function if exists public.call_training_library();
create function public.call_training_library()
returns table (call_id uuid, call_started_at timestamptz, agent_name text, disposition text, duration_seconds int, overall_score int,
               stage_reached text, great_call boolean, training_tags text[], tactics text[], strengths text[],
               objection_moments jsonb, key_quotes jsonb, summary text,
               scores jsonb, script_score int, script_followed text, script_steps jsonb, score_reasons jsonb)
language sql stable security definer set search_path = public as $$
  select g.call_id, c.call_started_at, coalesce(ag.display_name, c.agent_raw), c.disposition, a.duration_seconds, g.overall_score,
         g.stage_reached, g.great_call, g.training_tags, g.tactics, g.strengths, g.objection_moments, g.key_quotes, g.summary,
         g.scores, g.script_score, g.script_followed, g.script_steps, g.score_reasons
  from public.readymode_call_audio a
  join public.readymode_call_analysis g on g.call_id = a.call_id and g.model = 'grade-v1'
  join public.readymode_dialer_calls c on c.id = a.call_id
  left join public.agents ag on ag.id = c.agent_id
  where a.team_visible and (public.can_view_sold_calls() or public.is_active_agent_login())
  order by g.great_call desc, g.overall_score desc nulls last
  limit 300
$$;
revoke execute on function public.call_training_library() from public, anon;
grant execute on function public.call_training_library() to authenticated;
