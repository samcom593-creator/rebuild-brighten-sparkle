-- MP-334: put every agent under the manager who actually recruited them.
--
-- THE COMPLAINT was "he can't see his people." The cause is not a permission:
-- it is that an agent's owner is spread across three columns and the surfaces
-- disagree about which one is the answer. Measured for one manager (Obiajulu
-- Ifediora): agents.manager_id says he has 1 person, invited_by_manager_id says
-- 6, applications.assigned_agent_id says 24, recruiter_id says 15. Whichever
-- column a page happens to filter on decides what he sees.
--
-- IT IS NOT A DISPLAY BUG. fn_hierarchy_first_hops resolves an agent's parent
-- as coalesce(manager_id, switched_to_manager_id, invited_by_manager_id), and
-- finances_overview_base pays the override to that first hop — "spread to the
-- DIRECT report only". fn_default_agent_manager_to_sam stamps manager_id := Sam
-- on any insert that arrives without one, so the DEFAULTED value outranks the
-- real recruiter in the resolver and the override lands on Sam.
--
-- Proven on live prod, not inferred: of Obiajulu's 6 recruits, exactly ONE
-- returns a non-null first_hop for him — Ramon Lopez, and only because the
-- previous wave corrected that single row by hand. Active producer Cyril Onyia
-- returns null, so he pays his recruiter nothing.
--
-- WHY THIS IS SAFE FOR SAM'S OWN VIEW, measured rather than assumed: the
-- hierarchy walk is recursive, so a reparented agent stays in Sam's downline at
-- depth 2 instead of depth 1. Ramon Lopez already reads depth 2 from Sam via
-- Obiajulu. Nobody disappears from the owner's roster; the layered spread just
-- splits at the correct point, which is what a layered comp plan is for.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not reorder the coalesce in
-- fn_hierarchy_first_hops. switched_to_manager_id exists to record a deliberate
-- transfer, and putting invited_by first would let the original recruiter
-- silently outrank a real transfer forever. The defaulted rows are corrected as
-- DATA; the resolver's precedence is left alone.

begin;

-- ---------------------------------------------------------------------------
-- 1. Stop making new ones.
-- ---------------------------------------------------------------------------
-- The old body set manager_id := Sam whenever it was null, which is how all 62
-- rows below were created. Prefer the recruiter the caller already supplied and
-- keep Sam only as the genuine last resort. The "never make Sam his own
-- manager" guard is preserved, and extended to the SJAMES02 duplicate.
create or replace function public.fn_default_agent_manager_to_sam()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  SAM_AGENT_ID constant uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
  v_canonical_self uuid;
  v_candidate uuid;
begin
  if new.manager_id is not null then
    return new;
  end if;

  select coalesce(cm.canonical_agent_id, new.id) into v_canonical_self
    from (select 1) _ left join public.v_agent_canonical_map cm on cm.agent_id = new.id;

  -- Prefer the manager who actually recruited them. Resolve through the
  -- canonical map first: invited_by_manager_id points at the DUPLICATE Samuel
  -- James row (SJAMES02) on 9 existing agents, and parenting anyone to a
  -- phantom twin is worse than parenting them to the owner.
  select coalesce(cm.canonical_agent_id, new.invited_by_manager_id)
    into v_candidate
    from (select 1) _
    left join public.v_agent_canonical_map cm on cm.agent_id = new.invited_by_manager_id;

  if v_candidate is not null and v_candidate is distinct from v_canonical_self then
    new.manager_id := v_candidate;
  elsif v_canonical_self is distinct from SAM_AGENT_ID then
    new.manager_id := SAM_AGENT_ID;
  end if;

  return new;
end;
$function$;

comment on function public.fn_default_agent_manager_to_sam() is
  'MP-334: defaults agents.manager_id to the recruiting manager (canonicalised) '
  'and only falls back to the owner. The previous body always chose the owner, '
  'which outranked the real recruiter in fn_hierarchy_first_hops and sent the '
  'override to Sam. Name kept so the existing trigger binding is untouched.';

-- ---------------------------------------------------------------------------
-- 2. Snapshot before correcting, so this is reversible.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_manager_reparent_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id),
  manager_id_before uuid,
  manager_id_after uuid,
  reason text not null,
  reparented_at timestamptz not null default now()
);

alter table public.agent_manager_reparent_log enable row level security;

drop policy if exists "owner reads reparent log" on public.agent_manager_reparent_log;
create policy "owner reads reparent log" on public.agent_manager_reparent_log
  for select to authenticated using (public.is_owner());

grant select on public.agent_manager_reparent_log to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Correct the defaulted rows.
-- ---------------------------------------------------------------------------
-- Scope, and why each clause is here:
--   * manager_id is the owner            -> this is the value the trigger wrote
--   * invited_by resolves to someone else -> there is a real recruiter to move to
--   * switched_to_manager_id is null      -> 0 of the 62 have one; a deliberate
--                                            transfer must never be overwritten
--   * canonical comparison on BOTH sides  -> excludes the 9 pointing at SJAMES02,
--                                            which would have been a Sam->Sam move
with candidates as (
  select a.id as agent_id,
         a.manager_id as before_id,
         coalesce(im.canonical_agent_id, a.invited_by_manager_id) as after_id
  from public.agents a
  left join public.v_agent_canonical_map im on im.agent_id = a.invited_by_manager_id
  left join public.v_agent_canonical_map sm on sm.agent_id = a.id
  where a.manager_id = '7c3c5581-3544-437f-bfe2-91391afb217d'
    and a.invited_by_manager_id is not null
    and a.switched_to_manager_id is null
    and coalesce(im.canonical_agent_id, a.invited_by_manager_id)
        is distinct from '7c3c5581-3544-437f-bfe2-91391afb217d'
    and coalesce(im.canonical_agent_id, a.invited_by_manager_id)
        is distinct from coalesce(sm.canonical_agent_id, a.id)
),
logged as (
  insert into public.agent_manager_reparent_log (agent_id, manager_id_before, manager_id_after, reason)
  select agent_id, before_id, after_id,
         'MP-334: manager_id was defaulted to the owner by fn_default_agent_manager_to_sam; '
         'invited_by_manager_id holds the real recruiter and no deliberate switch exists'
  from candidates
  returning agent_id, manager_id_after
)
update public.agents a
   set manager_id = l.manager_id_after
  from logged l
 where a.id = l.agent_id;

-- ---------------------------------------------------------------------------
-- 4. Keep it honest: one place that answers "whose agent is this?"
-- ---------------------------------------------------------------------------
create or replace view public.v_agent_owner_truth
with (security_invoker = true) as
select a.id as agent_id,
       a.display_name,
       a.status,
       coalesce(a.manager_id, a.switched_to_manager_id, a.invited_by_manager_id) as owner_agent_id,
       m.display_name as owner_name,
       case
         when a.manager_id is not null then 'manager_id'
         when a.switched_to_manager_id is not null then 'switched_to_manager_id'
         when a.invited_by_manager_id is not null then 'invited_by_manager_id'
         else 'unowned'
       end as owner_source,
       -- Non-zero means a surface filtering the wrong column shows a different
       -- roster than the one the override is actually paid on.
       --
       -- Both sides are canonicalised and self-reference is excluded, because
       -- the raw comparison reports 10 rows that NO action can ever clear: 9
       -- point at the duplicate Samuel James row (SJAMES02, canonically the
       -- same person, so there is no disagreement) and 1 is Aisha Kebbeh whose
       -- invited_by_manager_id is her own id. A guard pinned at a number
       -- nobody can move is a guard everybody learns to skip.
       (a.invited_by_manager_id is not null
        and a.manager_id is not null
        and a.switched_to_manager_id is null
        and coalesce(im.canonical_agent_id, a.invited_by_manager_id)
            is distinct from coalesce(mm.canonical_agent_id, a.manager_id)
        and coalesce(im.canonical_agent_id, a.invited_by_manager_id)
            is distinct from coalesce(sm.canonical_agent_id, a.id)) as disagrees_with_recruiter
  from public.agents a
  left join public.agents m
    on m.id = coalesce(a.manager_id, a.switched_to_manager_id, a.invited_by_manager_id)
  left join public.v_agent_canonical_map im on im.agent_id = a.invited_by_manager_id
  left join public.v_agent_canonical_map mm on mm.agent_id = a.manager_id
  left join public.v_agent_canonical_map sm on sm.agent_id = a.id;

comment on view public.v_agent_owner_truth is
  'MP-334: single answer to "whose agent is this?", using the same precedence '
  'fn_hierarchy_first_hops pays the override on. disagrees_with_recruiter is the '
  'drift operand: it counts rows where a roster filtered on manager_id and one '
  'filtered on invited_by_manager_id would disagree.';

grant select on public.v_agent_owner_truth to authenticated;

commit;
