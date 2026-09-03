-- MP-392: push a hire through onboarding from EVERY page they appear on.
--
-- advance_hire_stage() (MP-356) was the only audited write path for
-- agents.onboarding_stage and it was surfaced on exactly one page, the Hires
-- board. Every other surface either rendered the stage read-only or wrote the
-- column directly with no agent_stage_moves receipt. Two widenings so the one
-- RPC can own the column everywhere:
--
-- 1. Accept every label of the onboarding_stage enum, not only the five ladder
--    rungs. The off-ladder flags (inactive, need_followup, pending_review,
--    transfer, below_10k) are real states the admin surfaces already write;
--    refusing them from the RPC just pushes those writes back to the unaudited
--    direct path. Validated against pg_enum so an unknown string still fails
--    22023 instead of an enum cast error. Off-ladder returns rank null and
--    onLadder=false; the client already renders that case.
--
-- 2. fn_can_move_hire() gated on invited_by_manager_id only, while the
--    "Managers can view their team" policy also grants manager_id. Measured
--    2026-09-02: 194 agents carry manager_id, 149 invited_by_manager_id, 45
--    have manager_id ONLY — a manager could see those 45 on their team page
--    and be refused when moving them. Gate now matches the view policy.
--    Deliberately still NOT crm_can_read_agent_scope (recruiter/VA scopes
--    can read a hire; they do not get to move one).

create or replace function public.fn_can_move_hire(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.apex_is_admin()
     or (
       public.has_role(auth.uid(), 'manager')
       and exists (
         select 1 from public.agents a
         where a.id = p_agent_id
           and (a.invited_by_manager_id = public.current_agent_id()
             or a.manager_id = public.current_agent_id())
       )
     );
$$;

create or replace function public.advance_hire_stage(
  p_agent_id uuid,
  p_to_stage text,
  p_expected_stage text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current text;
  v_licensed text;
  v_to text := lower(btrim(coalesce(p_to_stage, '')));
  v_to_rank integer;
  v_queued text[];
begin
  if not public.fn_can_move_hire(p_agent_id) then
    raise exception 'You cannot move this hire' using errcode = '42501';
  end if;

  -- Any label of the enum is a legal target. Ladder rungs get a rank; the
  -- status flags get rank null and are reported as off-ladder.
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'onboarding_stage' and e.enumlabel = v_to
  ) then
    raise exception '% is not an onboarding stage', coalesce(nullif(v_to, ''), 'null')
      using errcode = '22023';
  end if;

  select a.onboarding_stage::text, a.license_status::text
    into v_current, v_licensed
  from public.agents a where a.id = p_agent_id
  for update;

  if not found then
    raise exception 'That hire no longer exists' using errcode = 'P0002';
  end if;

  v_to_rank := public.fn_hire_stage_rank(v_to);

  -- Optimistic concurrency, same contract the interview actions already use:
  -- two managers working the same hire cannot silently overwrite each other.
  -- A caller that passes nothing is explicitly opting out.
  if p_expected_stage is not null and coalesce(v_current, '') is distinct from coalesce(p_expected_stage, '') then
    raise exception 'This hire moved to % while you were looking. Refresh and try again.',
      coalesce(v_current, 'no stage') using errcode = '40001';
  end if;

  if coalesce(v_current, '') = v_to then
    return jsonb_build_object('ok', true, 'changed', false, 'stage', v_current,
      'rank', v_to_rank, 'onLadder', v_to_rank is not null,
      'message', 'Already at that stage — nothing was written.');
  end if;

  update public.agents
  set onboarding_stage = v_to::onboarding_stage,
      updated_at = now()
  where id = p_agent_id;

  insert into public.agent_stage_moves(agent_id, field, from_value, to_value, note, moved_by, moved_by_agent_id)
  values (p_agent_id, 'onboarding_stage', v_current, v_to,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), public.current_agent_id());

  -- Report what the move set in motion. trg_agents_hired_licensed_enqueue
  -- queues the course and Discord emails when a licensed hire reaches 'live',
  -- and the enqueue is ON CONFLICT DO NOTHING, so this reads what is actually
  -- pending rather than predicting it.
  select coalesce(array_agg(q.email_kind order by q.email_kind), '{}')
    into v_queued
  from public.agent_onboarding_queue q
  where q.agent_id = p_agent_id and q.sent_at is null;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'from', v_current,
    'stage', v_to,
    'rank', v_to_rank,
    'onLadder', v_to_rank is not null,
    'licenseStatus', v_licensed,
    'queuedEmails', to_jsonb(v_queued)
  );
end;
$$;

grant execute on function public.advance_hire_stage(uuid, text, text, text) to authenticated;
grant execute on function public.fn_can_move_hire(uuid) to authenticated;

insert into supabase_migrations.schema_migrations(version, name)
values ('20260902203000', 'hire_stage_control_everywhere')
on conflict (version) do nothing;
