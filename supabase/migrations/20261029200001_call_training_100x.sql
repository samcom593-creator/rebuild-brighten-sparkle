-- MP-310 (2026-10-29). Sam: "make 100 times better" then "make live". Script-step analytics, grade calibration, one-tap
-- handoff of a warm lead to a closer, agents' own coaching and calls in-app, and a daily review queue for uplines.

-- 1. Where calls are won and lost, step by step of the agency scripts (rubric v2 grades only).
create or replace view public.v_script_step_impact with (security_invoker = true) as
with s as (
  select a.script_followed, st.value ->> 'step' as step, st.value ->> 'status' as status, st.ordinality as ord,
         (c.disposition = 'Completed Sale') as sold
  from public.readymode_call_analysis a
  join public.readymode_dialer_calls c on c.id = a.call_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(a.script_steps) = 'array' then a.script_steps else '[]'::jsonb end) with ordinality as st(value, ordinality)
  where a.model = 'grade-v1' and a.rubric_version >= 2 and a.stage_reached not in ('voicemail', 'no_contact')
    and a.script_followed is not null and a.script_followed <> 'none'
)
select script_followed, step, min(ord)::int as step_order, count(*)::int as calls,
  count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'partly')::int as partly,
  count(*) filter (where status = 'skipped')::int as skipped,
  round(100.0 * count(*) filter (where status = 'skipped') / nullif(count(*), 0), 1) as skipped_pct,
  round(100.0 * count(*) filter (where status = 'done' and sold) / nullif(count(*) filter (where status = 'done'), 0), 1) as close_pct_when_done,
  round(100.0 * count(*) filter (where status <> 'done' and sold) / nullif(count(*) filter (where status <> 'done'), 0), 1) as close_pct_when_missed
from s group by script_followed, step;
grant select on public.v_script_step_impact to authenticated;

-- 2. Grade calibration: Sam, Aisha or the agent's upline says a grade is right, too high or too low; the grader reads the
--    latest corrections as examples. Reviewing a call also takes it off that reviewer's daily queue.
create table if not exists public.readymode_grade_feedback (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.readymode_dialer_calls(id) on delete cascade,
  verdict text not null check (verdict in ('agree', 'too_high', 'too_low')),
  corrected_score int check (corrected_score between 0 and 100),
  note text,
  graded_score int,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists readymode_grade_feedback_call on public.readymode_grade_feedback (call_id);
alter table public.readymode_grade_feedback enable row level security;
revoke all on public.readymode_grade_feedback from anon;
revoke insert, update, delete, truncate on public.readymode_grade_feedback from authenticated;
grant select on public.readymode_grade_feedback to authenticated;
drop policy if exists readymode_grade_feedback_read on public.readymode_grade_feedback;
create policy readymode_grade_feedback_read on public.readymode_grade_feedback for select to authenticated
  using ((select public.can_view_sold_calls()) or created_by = (select auth.uid())
         or exists (select 1 from public.readymode_dialer_calls c where c.id = readymode_grade_feedback.call_id
                    and c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)));

create or replace function public.grade_feedback_set(p_call_id uuid, p_verdict text, p_corrected_score int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_agent uuid; v_score int; v_id uuid;
begin
  select c.agent_id into v_agent from public.readymode_dialer_calls c where c.id = p_call_id;
  if not found then raise exception 'No such call.' using errcode = '22023'; end if;
  if not (public.can_view_sold_calls() or v_agent in (select d.agent_id from public.my_downline_agent_ids() d)) then
    raise exception 'Only Sam, Aisha and this agent''s upline can review this grade.' using errcode = '42501';
  end if;
  if p_verdict not in ('agree', 'too_high', 'too_low') then raise exception 'Verdict must be agree, too_high or too_low.' using errcode = '22023'; end if;
  if p_corrected_score is not null and (p_corrected_score < 0 or p_corrected_score > 100) then raise exception 'A corrected score is 0 to 100.' using errcode = '22023'; end if;
  select a.overall_score into v_score from public.readymode_call_analysis a where a.call_id = p_call_id and a.model = 'grade-v1';
  insert into public.readymode_grade_feedback (call_id, verdict, corrected_score, note, graded_score)
  values (p_call_id, p_verdict, p_corrected_score, left(nullif(btrim(p_note), ''), 500), v_score) returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- 3. Daily review queue: the calls this reviewer should hear next (agency for Sam and Aisha, own team for an upline),
--    compliance first, then urgent and high coaching, then off script, then the lowest scores; reviewed ones drop off.
create or replace function public.call_review_queue(p_limit int default 5)
returns table (call_id uuid, agent_name text, call_started_at timestamptz, disposition text, overall_score int, script_score int, coaching_priority text, reason text)
language sql stable security definer set search_path = public as $$
  select a.call_id, coalesce(ag.display_name, c.agent_raw), c.call_started_at, c.disposition, a.overall_score, a.script_score, a.coaching_priority,
    case when (case when jsonb_typeof(a.compliance_flags) = 'array' then jsonb_array_length(a.compliance_flags) else 0 end) > 0 then 'Compliance flag'
         when a.coaching_priority = 'urgent' then 'Urgent coaching'
         when a.coaching_priority = 'high' then 'Weak close or warm deal lost'
         when coalesce(a.script_score, 10) <= 4 then 'Off script'
         else 'Lowest score lately' end
  from public.readymode_call_analysis a
  join public.readymode_dialer_calls c on c.id = a.call_id
  left join public.agents ag on ag.id = c.agent_id
  where a.model = 'grade-v1' and a.stage_reached not in ('voicemail', 'no_contact')
    and c.call_started_at > now() - interval '30 days'
    and (public.can_view_sold_calls() or c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d))
    and not exists (select 1 from public.readymode_grade_feedback f where f.call_id = a.call_id and f.created_by = auth.uid())
  order by (case when jsonb_typeof(a.compliance_flags) = 'array' then jsonb_array_length(a.compliance_flags) else 0 end) > 0 desc,
           case a.coaching_priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
           (coalesce(a.script_score, 10) <= 4) desc, a.overall_score asc nulls last, c.call_started_at desc
  limit greatest(1, least(coalesce(p_limit, 5), 20))
$$;

-- 4. One-tap handoff: put a warm lead into the closer's own handoff bundle and give them access (Sam and Aisha only).
create or replace function public.lead_bundle_handoff(p_phone10 text, p_user uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_bundle uuid; v_name text; v_q record;
begin
  if not public.can_view_sold_calls() then raise exception 'Only Sam and Aisha can hand a lead to a closer.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No login %.', p_user using errcode = '22023'; end if;
  select * into v_q from public.v_readymode_lead_quality where phone10 = p_phone10 limit 1;
  if v_q.phone10 is null then raise exception 'That number is not in the dialer history.' using errcode = '22023'; end if;
  if v_q.quality_tier = 'blocked' then raise exception 'That number asked not to be called.' using errcode = '22023'; end if;
  if exists (select 1 from public.lead_bundle_items where phone10 = p_phone10 and removed_at is null) then
    raise exception 'That lead is already with someone.' using errcode = '22023';
  end if;
  select coalesce((select a.display_name from public.agents a where a.user_id = p_user order by (a.canonical_agent_id is null) desc limit 1), 'closer') into v_name;
  select b.id into v_bundle from public.lead_bundles b where b.archived_at is null and b.criteria ->> 'handoff_to' = p_user::text order by b.created_at desc limit 1;
  if v_bundle is null then
    insert into public.lead_bundles (name, format, criteria, note, created_by)
    values ('Handoffs for ' || v_name, 'called_leads', jsonb_build_object('handoff_to', p_user::text), 'Warm leads handed over one at a time', auth.uid())
    returning id into v_bundle;
  end if;
  insert into public.lead_bundle_items (bundle_id, phone10, first_name, last_name, email, quality_tier, quality_reason, attempts, last_dialed_at, last_disposition, last_agent, status_note)
  values (v_bundle, v_q.phone10, v_q.first_name, v_q.last_name, v_q.email, v_q.quality_tier, v_q.quality_reason, v_q.attempts, v_q.last_dialed_at, v_q.last_disposition, v_q.last_agent, left(nullif(btrim(p_note), ''), 500));
  if not exists (select 1 from public.lead_bundle_grants where bundle_id = v_bundle and user_id = p_user and revoked_at is null) then
    insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note) values (v_bundle, p_user, auth.uid(), 'handoff');
  end if;
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail) values (v_bundle, p_user, auth.uid(), 'handoff', jsonb_build_object('phone_last4', right(p_phone10, 4)));
  return jsonb_build_object('bundle_id', v_bundle, 'closer', v_name);
end $$;

-- Closers to hand to: active logins, best sticky close rate first (Sam and Aisha only).
create or replace function public.closer_candidates()
returns table (user_id uuid, agent_name text, close_pct_all numeric, sticky_close_score numeric)
language sql stable security definer set search_path = public as $$
  select x.user_id, x.display_name, b.close_pct_all, b.sticky_close_score
  from (select distinct on (a.user_id) a.user_id, a.display_name from public.agents a
         where a.user_id is not null and a.is_deactivated is not true and a.is_inactive is not true and a.display_name is not null
         order by a.user_id, (a.canonical_agent_id is null) desc) x
  left join (select agent_name, max(close_pct_all) close_pct_all, max(sticky_close_score) sticky_close_score from public.v_best_closers group by agent_name) b on b.agent_name = x.display_name
  where public.can_view_sold_calls()
$$;

-- 5. Each agent reads their own coaching and their own graded calls, and hears the muted copy of their own calls.
drop policy if exists readymode_agent_coaching_self_read on public.readymode_agent_coaching;
create policy readymode_agent_coaching_self_read on public.readymode_agent_coaching for select to authenticated
  using (exists (select 1 from public.agents a where a.user_id = (select auth.uid()) and a.display_name = readymode_agent_coaching.agent_name));
drop policy if exists rmca_self_read on public.readymode_call_analysis;
create policy rmca_self_read on public.readymode_call_analysis for select to authenticated
  using (exists (select 1 from public.readymode_dialer_calls c where c.id = readymode_call_analysis.call_id
                 and c.agent_id in (select a.id from public.agents a where a.user_id = (select auth.uid()))));
create or replace function public.can_play_call_audio(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.can_view_sold_calls() then exists (select 1 from public.readymode_call_audio a where a.raw_path = p_path or a.redacted_path = p_path)
    else exists (
      select 1 from public.readymode_call_audio a join public.readymode_dialer_calls c on c.id = a.call_id
      where a.redacted_path = p_path
        and ((a.team_visible and public.is_active_agent_login())
             or c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
             or c.agent_id in (select g.id from public.agents g where g.user_id = auth.uid())))
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
         or c.agent_id in (select d.agent_id from public.my_downline_agent_ids() d)
         or c.agent_id in (select g.id from public.agents g where g.user_id = auth.uid()))
$$;

revoke execute on function public.grade_feedback_set(uuid, text, int, text) from public, anon;
revoke execute on function public.call_review_queue(int) from public, anon;
revoke execute on function public.lead_bundle_handoff(text, uuid, text) from public, anon;
revoke execute on function public.closer_candidates() from public, anon;
grant execute on function public.grade_feedback_set(uuid, text, int, text), public.call_review_queue(int), public.lead_bundle_handoff(text, uuid, text), public.closer_candidates() to authenticated;

-- 6. In-app weekly coaching digest (no outbound): the last 7 days against the 7 before, on the current rubric only, so
--    the comparison is like for like. Security invoker: Sam and Aisha get the agency, an upline gets their own team.
create or replace function public.call_training_digest()
returns jsonb language sql stable security invoker set search_path = public as $$
with g as (
  select a.call_id, a.overall_score, a.great_call, a.script_score, a.script_steps, a.coaching_priority,
         case when jsonb_typeof(a.compliance_flags) = 'array' then jsonb_array_length(a.compliance_flags) else 0 end as flags,
         coalesce(ag.display_name, c.agent_raw) as agent_name, c.disposition, c.call_started_at,
         case when c.call_started_at >= now() - interval '7 days' then 'this' else 'prev' end as wk
  from public.readymode_call_analysis a
  join public.readymode_dialer_calls c on c.id = a.call_id
  left join public.agents ag on ag.id = c.agent_id
  where a.model = 'grade-v1' and coalesce(a.rubric_version, 1) >= 2 and a.stage_reached not in ('voicemail', 'no_contact')
    and c.call_started_at >= now() - interval '14 days'
), w as (
  select wk, count(*)::int as graded, round(avg(overall_score))::int as avg_score, count(*) filter (where great_call)::int as great,
         count(*) filter (where flags > 0)::int as flagged, round(avg(script_score), 1) as avg_script,
         count(*) filter (where disposition = 'Completed Sale')::int as sold
  from g group by wk
), per_agent as (
  select agent_name, count(*) filter (where wk = 'this')::int as n_this, count(*) filter (where wk = 'prev')::int as n_prev,
         round(avg(overall_score) filter (where wk = 'this'))::int as avg_this, round(avg(overall_score) filter (where wk = 'prev'))::int as avg_prev
  from g where agent_name is not null group by agent_name
), steps as (
  select st.value ->> 'step' as step, count(*) as n, count(*) filter (where st.value ->> 'status' = 'skipped') as skipped
  from g cross join lateral jsonb_array_elements(case when jsonb_typeof(g.script_steps) = 'array' then g.script_steps else '[]'::jsonb end) as st(value)
  where g.wk = 'this' group by 1
)
select jsonb_build_object(
  'this_week', (select to_jsonb(w) - 'wk' from w where w.wk = 'this'),
  'prev_week', (select to_jsonb(w) - 'wk' from w where w.wk = 'prev'),
  'movers', coalesce((select jsonb_agg(m order by abs(m.delta) desc) from (
      select agent_name, n_this, n_prev, avg_this, avg_prev, avg_this - avg_prev as delta from per_agent
      where n_this >= 3 and n_prev >= 3 order by abs(avg_this - avg_prev) desc limit 6) m), '[]'::jsonb),
  'most_skipped', coalesce((select jsonb_agg(s order by s.skipped_pct desc) from (
      select step, n::int as calls, round(100.0 * skipped / n)::int as skipped_pct from steps where n >= 5 order by 100.0 * skipped / n desc limit 3) s), '[]'::jsonb),
  'best_calls', coalesce((select jsonb_agg(b order by b.overall_score desc) from (
      select call_id, agent_name, overall_score, disposition, call_started_at from g where wk = 'this' and flags = 0
      order by overall_score desc nulls last limit 3) b), '[]'::jsonb),
  'urgent', (select count(*)::int from g where wk = 'this' and coaching_priority = 'urgent')
)
$$;
revoke execute on function public.call_training_digest() from public, anon;
grant execute on function public.call_training_digest() to authenticated;
