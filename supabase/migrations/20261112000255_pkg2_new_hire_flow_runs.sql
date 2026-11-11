-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 7 of 11: the "your dashboard is live" flow can retry.
--
-- WHAT
--   new_hire_flow_runs: one row per agent for supabase/functions/trigger-new-hire-flow. The function now claims a
--   10-minute LEASE here instead of claiming the agent (production_unlocked_at) before sending, records each leg's
--   outcome in `legs`, and only on completion stamps agents.has_production_access / production_unlocked_at.
--     fn_new_hire_flow_claim(agent)            -> {claimed, reason, attempts, legs}   (3 attempts max)
--     fn_new_hire_flow_finish(agent, legs, done, error)
--     fn_new_hire_flow_retry_sweep()           -> re-invokes the function for runs that failed (hourly cron
--                                                 apex-new-hire-flow-retry); does nothing while
--                                                 new_hire_live_flow_enabled <> 'true'.
--
-- WHY
--   shipped_vs_live 6.2 / handoff reviewer finding: the edge function claimed the agent (production_unlocked_at)
--   BEFORE it sent, so a failed send left the agent claimed and the trigger (which only fires while
--   production_unlocked_at is null) could never retry. Forward-only by construction: a run row exists only after the
--   live flow fired for an agent, which needs the flag (still 'false'; the integrator flips it after review).

create table if not exists public.new_hire_flow_runs (
  agent_id     uuid primary key references public.agents(id) on delete cascade,
  claimed_at   timestamptz,
  attempts     integer not null default 0,
  legs         jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.new_hire_flow_runs is
  'PKG2: lease + per-leg receipts for trigger-new-hire-flow (the "your dashboard is live" flow). completed_at is set only when the welcome email reached a terminal outcome. Service role only.';

alter table public.new_hire_flow_runs enable row level security;
revoke all on table public.new_hire_flow_runs from public, anon, authenticated;
grant all on table public.new_hire_flow_runs to service_role;

create or replace function public.fn_new_hire_flow_claim(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v public.new_hire_flow_runs%rowtype;
begin
  if p_agent_id is null then
    return jsonb_build_object('claimed', false, 'reason', 'no_agent');
  end if;
  insert into public.new_hire_flow_runs as r (agent_id, claimed_at, attempts)
  values (p_agent_id, now(), 1)
  on conflict (agent_id) do update
     set claimed_at = now(), attempts = r.attempts + 1, updated_at = now()
   where r.completed_at is null
     and r.attempts < 3
     and (r.claimed_at is null or r.claimed_at < now() - interval '10 minutes')
  returning * into v;
  if not found then
    select * into v from public.new_hire_flow_runs where agent_id = p_agent_id;
    return jsonb_build_object('claimed', false,
      'reason', case when v.completed_at is not null then 'already_done'
                     when v.attempts >= 3 then 'attempts_exhausted'
                     else 'in_flight' end,
      'attempts', v.attempts, 'legs', v.legs);
  end if;
  return jsonb_build_object('claimed', true, 'attempts', v.attempts, 'legs', v.legs);
end;
$$;

create or replace function public.fn_new_hire_flow_finish(p_agent_id uuid, p_legs jsonb, p_done boolean, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.new_hire_flow_runs
     set legs = coalesce(legs, '{}'::jsonb) || coalesce(p_legs, '{}'::jsonb),
         completed_at = case when p_done then coalesce(completed_at, now()) end,
         claimed_at = null,
         last_error = case when p_done then null else left(p_error, 500) end,
         updated_at = now()
   where agent_id = p_agent_id;
  if p_done then
    -- the unlock is the LAST step now: a failed send leaves the agent unclaimed and retryable
    update public.agents
       set has_production_access = true, production_unlocked_at = coalesce(production_unlocked_at, now())
     where id = p_agent_id;
  end if;
  return jsonb_build_object('done', p_done);
end;
$$;

create or replace function public.fn_new_hire_flow_retry_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record; v_n int := 0;
begin
  if coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'new_hire_live_flow_enabled'))), 'false') <> 'true' then
    return jsonb_build_object('skipped', 'new_hire_live_flow_enabled is not true', 'at', now());
  end if;
  for r in
    select n.agent_id
      from public.new_hire_flow_runs n
      join public.agents a on a.id = n.agent_id
     where n.completed_at is null
       and n.attempts < 3
       and (n.claimed_at is null or n.claimed_at < now() - interval '10 minutes')
       and n.updated_at < now() - interval '1 hour'
       and a.production_unlocked_at is null
       and a.onboarding_stage::text = 'in_field_training'
       and a.status::text = 'active'
       and not public.fn_agent_is_suspended(a.id)
     order by n.updated_at
     limit 5
  loop
    perform public.run_automation_job('trigger-new-hire-flow-retry', 'trigger-new-hire-flow',
                                      jsonb_build_object('agentId', r.agent_id, 'triggerType', 'retry'));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('retried', v_n, 'at', now());
end;
$$;

comment on function public.fn_new_hire_flow_retry_sweep() is
  'PKG2: re-invokes trigger-new-hire-flow for runs whose welcome email failed (max 3 attempts, 1h apart, 5 per run). No-op while new_hire_live_flow_enabled <> true.';

revoke all on function public.fn_new_hire_flow_claim(uuid) from public, anon, authenticated;
revoke all on function public.fn_new_hire_flow_finish(uuid, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.fn_new_hire_flow_retry_sweep() from public, anon, authenticated;
grant execute on function public.fn_new_hire_flow_claim(uuid) to service_role;
grant execute on function public.fn_new_hire_flow_finish(uuid, jsonb, boolean, text) to service_role;
grant execute on function public.fn_new_hire_flow_retry_sweep() to service_role;

-- trigger-new-hire-flow reads these through the service-role client (suspension check, real poster id)
grant execute on function public.fn_agent_is_suspended(uuid) to service_role;
grant execute on function public.fn_user_is_suspended(uuid) to service_role;

select cron.schedule('apex-new-hire-flow-retry', '41 * * * *', 'select public.fn_new_hire_flow_retry_sweep()');
