-- MP-351: full status control on an agent, and a list of who is not yet
-- connected to production.
--
-- Sam: "I should see all these new agents like Isaiah Caldwell, all those people
-- who have not been merged for production. When I tap on the agent we need to
-- modify fast whether they're hired, fired, etcetera. Full complete control."
--
-- WHAT "NOT MERGED FOR PRODUCTION" MEASURES. Isaiah Caldwell's duplicate row is
-- already merged (canonical_agent_id set), so the duplicate was not the issue.
-- The real gap is AgentLink linkage: 32 of 54 active agents have NO al_user_id,
-- 19 of them hired in the last 60 days. agentlink_book rows arrive keyed to an
-- AgentLink user, so an agent without one can never be credited for a sale no
-- matter how much they write. That is the population this surfaces.
--
-- WHAT WAS MISSING ON THE CONTROL SIDE. set_agent_active() flips active <->
-- inactive and CANNOT set 'terminated', so there was no way to fire someone
-- from the product — a third of the roster is in that state, all of it written
-- by other means. It also gates on "admin or manager" with NO downline check,
-- so any manager could deactivate any agent in the company including a peer.
--
-- This function fixes both: all three real statuses, and a manager is confined
-- to their own downline by the same walk the override is paid on. Admin is
-- unrestricted. Self-demotion is refused — locking yourself out by mis-tapping
-- your own row is not a recoverable action from inside the product.

begin;

create table if not exists public.agent_status_changes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index if not exists agent_status_changes_agent_idx
  on public.agent_status_changes (agent_id, changed_at desc);

alter table public.agent_status_changes enable row level security;

drop policy if exists "staff read agent status changes" on public.agent_status_changes;
create policy "staff read agent status changes" on public.agent_status_changes
  for select to authenticated using (public.apex_is_admin() or public.is_agency_staff());

grant select on public.agent_status_changes to authenticated;

create or replace function public.set_agent_status(
  p_agent_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from text;
  v_caller uuid;
  v_is_admin boolean;
  v_self uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_status not in ('active','inactive','terminated') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;

  select status::text into v_from from public.agents where id = p_agent_id;
  if v_from is null then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;

  v_is_admin := public.apex_is_admin();

  if not v_is_admin then
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) into v_caller
      from public.agents a
     where a.user_id = auth.uid() and coalesce(a.is_deactivated, false) = false
     limit 1;
    if v_caller is null then
      raise exception 'admin or manager only' using errcode = '42501';
    end if;

    v_self := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
    if v_self = v_caller then
      raise exception 'you cannot change your own status' using errcode = '42501';
    end if;

    -- Same walk the override is paid on, so "who is mine" and "who may I fire"
    -- cannot drift apart.
    if not exists (
      select 1 from public.fn_hierarchy_first_hops(array[v_caller]) h
       where h.member = v_self
    ) then
      raise exception 'that agent is not in your downline' using errcode = '42501';
    end if;
  end if;

  -- agents has NO terminated_at column — the termination state lives in
  -- status + is_deactivated + deactivation_reason. I assumed a timestamp
  -- existed and the write failed on the first live run; checking the catalog
  -- is cheaper than trusting the shape a table "obviously" has.
  update public.agents
     set status = p_status::public.agent_status,
         is_inactive    = (p_status <> 'active'),
         is_deactivated = (p_status = 'terminated'),
         -- deactivation_reason is an ENUM, not free text, so a typed reason
         -- cannot carry an arbitrary note. The note lives in
         -- agent_status_changes where it is free text; forcing it in here
         -- would either fail or require inventing an enum label.
         updated_at     = now()
   where id = p_agent_id;

  insert into public.agent_status_changes (agent_id, from_status, to_status, reason, changed_by)
  values (p_agent_id, v_from, p_status, nullif(btrim(p_reason), ''), auth.uid());

  return jsonb_build_object('agent_id', p_agent_id, 'from_status', v_from, 'to_status', p_status);
end;
$function$;

comment on function public.set_agent_status(uuid, text, text) is
  'MP-351: set an agent active / inactive / terminated. set_agent_active could '
  'not reach terminated and had no downline check. A manager is confined to '
  'their own downline and cannot change their own status; admin is '
  'unrestricted. Every change is written to agent_status_changes.';

revoke all on function public.set_agent_status(uuid, text, text) from public;
grant execute on function public.set_agent_status(uuid, text, text) to authenticated;

-- Who cannot be credited for production, scoped to the caller.
create or replace function public.my_unlinked_agents(p_days integer default 120)
returns table(
  agent_id uuid,
  display_name text,
  status text,
  hired_on date,
  days_since_hire integer,
  manager_name text,
  al_user_id text,
  book_rows integer,
  license_status text,
  blocker text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with caller as (
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) as id
    from public.agents a
    where a.user_id = auth.uid() and coalesce(a.is_deactivated, false) = false
    limit 1
  ), scope as (
    select a.id from public.agents a where public.apex_is_admin()
    union
    select h.member from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h
  )
  select a.id,
         a.display_name,
         a.status::text,
         a.created_at::date,
         (current_date - a.created_at::date)::integer,
         coalesce(m.display_name, 'Unassigned'),
         coalesce(a.al_user_id::text, ''),
         (select count(*) from public.agentlink_book b where b.agent_id = a.id)::integer,
         a.license_status::text,
         case
           when a.al_user_id is null then 'no AgentLink link — production cannot be credited'
           when (select count(*) from public.agentlink_book b where b.agent_id = a.id) = 0
             then 'linked, but no production has landed yet'
           else 'linked and producing'
         end
  from public.agents a
  left join public.agents m on m.id = a.manager_id
  join scope s on s.id = a.id
  where a.status <> 'terminated'
    and coalesce(a.is_deactivated, false) = false
    and a.created_at >= current_date - greatest(coalesce(p_days, 120), 1)
    and not public.fn_agent_is_roster_excluded(a.id)
    and a.canonical_agent_id is null
  order by (a.al_user_id is not null), a.created_at desc;
$function$;

comment on function public.my_unlinked_agents(integer) is
  'MP-351: recent agents and whether AgentLink can credit them. 32 of 54 active '
  'agents have no al_user_id, so no sale they write can ever attribute. Merged '
  'duplicates are excluded (canonical_agent_id is null) so a resolved duplicate '
  'does not read as an open problem.';

revoke all on function public.my_unlinked_agents(integer) from public;
grant execute on function public.my_unlinked_agents(integer) to authenticated;

commit;
