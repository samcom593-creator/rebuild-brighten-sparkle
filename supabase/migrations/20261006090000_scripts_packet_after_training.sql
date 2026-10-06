-- APEX OS redesign · scripts packet after hire + required training (2026-10-06)
--
-- The approved scripts/resources packet is emailed once when a person is hired AND every REQUIRED
-- active module is passed, whichever becomes true last. Evaluated from committed rows by triggers,
-- never by a page visit. The send key is (agent, packet version); the queue's existing
-- UNIQUE (agent_id, email_kind) makes it at most one packet email per agent.
--
-- Deployment guard: nothing is backfilled. Agents who already finished training before this
-- migration are not emailed by it; a historical send is a separate, reviewed operation.
--
-- Also: v_training_required_completion becomes the server-side completion truth that
-- notify-course-complete now checks (it used to trust the browser and accept any agentId).

begin;

alter table public.onboarding_modules add column if not exists is_required boolean not null default true;
comment on column public.onboarding_modules.is_required is
  'Required modules gate the scripts packet and course completion. Optional modules never block. Default true keeps today''s behaviour until an admin marks one optional.';

create or replace view public.v_training_required_completion
with (security_invoker = true) as
select a.id as agent_id,
       count(m.id)::integer as required_total,
       count(p.module_id)::integer as required_passed,
       (count(m.id) > 0 and count(p.module_id) = count(m.id)) as required_complete
from public.agents a
cross join public.onboarding_modules m
left join (select distinct op.agent_id, op.module_id from public.onboarding_progress op where op.passed) p
  on p.agent_id = a.id and p.module_id = m.id
where m.is_active and m.is_required
group by a.id;

grant select on public.v_training_required_completion to authenticated;

create table if not exists public.onboarding_packet_versions (
  version integer primary key,
  label text not null,
  script_ids uuid[] not null default '{}',
  links jsonb not null default '[]'::jsonb,
  is_current boolean not null default false,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.onboarding_packet_versions enable row level security;
drop policy if exists onboarding_packet_versions_read on public.onboarding_packet_versions;
create policy onboarding_packet_versions_read on public.onboarding_packet_versions for select using (auth.uid() is not null);

insert into public.onboarding_packet_versions (version, label, script_ids, is_current)
select 1, 'Scripts & call resources v1 (active sales_scripts at 2026-10-06)',
       coalesce(array_agg(s.id order by s.id), '{}'), true
from public.sales_scripts s
where s.is_active
on conflict (version) do nothing;

alter table public.agent_onboarding_queue drop constraint if exists agent_onboarding_queue_email_kind_check;
alter table public.agent_onboarding_queue add constraint agent_onboarding_queue_email_kind_check
  check (email_kind = any (array['course', 'discord', 'hired_whatsapp', 'onboarding_call', 'get_licensed', 'scripts_packet']));

create or replace function public.fn_enqueue_scripts_packet(p_agent_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_version integer;
  v_ok boolean;
begin
  select pv.version into v_version
  from public.onboarding_packet_versions pv
  where pv.is_current
  order by pv.version desc
  limit 1;
  if v_version is null then return false; end if;

  select true into v_ok
  from public.agents a
  join public.v_training_required_completion c on c.agent_id = a.id and c.required_complete
  left join public.profiles pr on pr.id = a.profile_id
  where a.id = p_agent_id
    and a.status::text = 'active'
    and coalesce(a.is_deactivated, false) = false
    and a.canonical_agent_id is null
    and not public.fn_agent_is_placeholder(a.id)
    and a.license_status::text = 'licensed'
    and nullif(btrim(pr.email), '') is not null
    and not exists (select 1 from public.email_unsubscribes u where lower(u.email) = lower(pr.email));
  if not coalesce(v_ok, false) then return false; end if;

  insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at, meta)
  values (p_agent_id, 'scripts_packet', now(),
          jsonb_build_object('packet_version', v_version,
                             'send_key', 'pkt:' || p_agent_id::text || ':v' || v_version,
                             'trigger', 'hired_and_required_training_complete'))
  on conflict (agent_id, email_kind) do nothing;
  return true;
end;
$$;

revoke all on function public.fn_enqueue_scripts_packet(uuid) from public, anon, authenticated;

create or replace function public.trg_scripts_packet_on_progress()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Only a transition to passed counts; re-saving an already-passed module is not an event.
  if new.passed and (tg_op = 'INSERT' or old.passed is distinct from new.passed) then
    perform public.fn_enqueue_scripts_packet(new.agent_id);
  end if;
  return new;
exception when others then
  raise warning 'scripts packet evaluation failed for agent %: %', new.agent_id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_scripts_packet_on_progress on public.onboarding_progress;
create trigger trg_scripts_packet_on_progress
  after insert or update of passed on public.onboarding_progress
  for each row execute function public.trg_scripts_packet_on_progress();

create or replace function public.trg_scripts_packet_on_agent()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.fn_enqueue_scripts_packet(new.id);
  return new;
exception when others then
  raise warning 'scripts packet evaluation failed for agent %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_scripts_packet_on_agent on public.agents;
create trigger trg_scripts_packet_on_agent
  after update of status, license_status, is_deactivated on public.agents
  for each row
  when (old.status is distinct from new.status
        or old.license_status is distinct from new.license_status
        or old.is_deactivated is distinct from new.is_deactivated)
  execute function public.trg_scripts_packet_on_agent();

commit;
