begin;

-- MP-353: onboarding must never fire for someone who does not work here.
--
-- fn_enqueue_hired_licensed_onboarding fires when license_status becomes
-- 'licensed', and checked NOTHING about employment. MP-352's licence backfill
-- corrected 17 producers to licensed — a true and legally sound correction —
-- and this trigger read every one of them as a fresh hire, queueing 35
-- onboarding emails. 30 were aimed at INACTIVE or TERMINATED people: "welcome,
-- start your course, join Discord" to ex-agents, some gone since 2025.
--
-- Caught before the cron fired; the 30 were marked terminal with an honest
-- reason rather than deleted, so the record of what happened survives.
--
-- The trigger's own INSERT branch already used `new.status = 'active'` as the
-- fire condition. The UPDATE branch simply never applied the same test to the
-- licence path. A hire event is "licensed AND employed", never "licensed".
create or replace function public.fn_enqueue_hired_licensed_onboarding()
returns trigger
language plpgsql
security definer
as $function$
declare
  should_fire boolean;
begin
  if new.license_status is distinct from 'licensed' then
    return new;
  end if;

  -- MP-353: employment gate. A backfill that corrects a historical licence is
  -- not a hire, and a terminated agent is never onboarded.
  if coalesce(new.status::text, '') <> 'active'
     or coalesce(new.is_deactivated, false)
     or coalesce(new.is_inactive, false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_fire := (new.onboarding_stage = 'live') or (new.status = 'active');
  else
    should_fire := (
         (old.onboarding_stage is distinct from new.onboarding_stage and new.onboarding_stage = 'live')
      or (old.status is distinct from new.status and new.status = 'active' and coalesce(old.status::text, '') not in ('active', 'live'))
      or (old.license_status is distinct from new.license_status and new.license_status = 'licensed')
    );
  end if;

  if not should_fire then
    return new;
  end if;

  if pg_trigger_depth() = 1 and coalesce(new.has_training_course, false) = false then
    update public.agents
    set has_training_course = true,
        updated_at = now()
    where id = new.id
      and coalesce(has_training_course, false) = false;
  end if;

  insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  values
    (new.id, 'course', now()),
    (new.id, 'discord', now())
  on conflict (agent_id, email_kind) do nothing;

  begin
    perform public.fn_enqueue_onboarding_call_booking(new.id, 'trigger:' || tg_op);
  exception when others then
    raise warning 'fn_enqueue_onboarding_call_booking failed for agent %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

comment on function public.fn_enqueue_hired_licensed_onboarding() is
  'MP-353: queues onboarding only for agents who are ACTIVE and licensed. The '
  'licence path previously fired for anyone flipped to licensed regardless of '
  'employment, so a historical-licence backfill queued 30 onboarding emails to '
  'inactive and terminated ex-agents.';

commit;
