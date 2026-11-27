-- Training follows the verified canonical person without changing global
-- current_agent_id(), historical progress, manager grants, or attempt limits.
begin;

create or replace function public.training_canonical_self_id()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return (public.personal_task_identity()->>'agent_id')::uuid;
exception when insufficient_privilege then
  -- RLS policies are ORed with existing staff policies. An ineligible personal
  -- identity must be false here, not an exception that breaks staff evaluation.
  -- Other failures still propagate instead of authorizing an uncertain caller.
  return null;
end;
$function$;

create or replace function public.training_progress_access()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_identity jsonb := public.personal_task_identity();
  v_root uuid := (v_identity->>'agent_id')::uuid;
  v_family uuid[];
  v_history integer;
begin
  select array_agg(value::uuid) into v_family
    from jsonb_array_elements_text(v_identity->'agent_ids');
  select count(*)::integer into v_history
    from public.onboarding_progress p
    join public.onboarding_modules m on m.id = p.module_id and m.is_active
   where p.agent_id = any(v_family) and p.agent_id <> v_root;
  -- Read only. A collision left on an alias is a review task, not evidence
  -- that the learner restarted or completed a canonical module.
  return v_identity || jsonb_build_object('alias_progress_count', v_history);
end;
$function$;

revoke all on function public.training_canonical_self_id() from public, anon, authenticated;
revoke all on function public.training_progress_access() from public, anon, authenticated;
grant execute on function public.training_canonical_self_id() to authenticated;
grant execute on function public.training_progress_access() to authenticated;

drop policy if exists "Agents can view canonical training progress" on public.onboarding_progress;
create policy "Agents can view canonical training progress"
on public.onboarding_progress for select to authenticated
using (agent_id = (select public.training_canonical_self_id()));

drop policy if exists "Agents can insert canonical training progress" on public.onboarding_progress;
create policy "Agents can insert canonical training progress"
on public.onboarding_progress for insert to authenticated
with check (agent_id = (select public.training_canonical_self_id()));

drop policy if exists "Agents can update canonical training progress" on public.onboarding_progress;
create policy "Agents can update canonical training progress"
on public.onboarding_progress for update to authenticated
using (agent_id = (select public.training_canonical_self_id()))
with check (agent_id = (select public.training_canonical_self_id()));

notify pgrst, 'reload schema';
commit;
