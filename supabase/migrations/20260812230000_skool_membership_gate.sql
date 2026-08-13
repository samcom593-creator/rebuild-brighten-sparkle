-- "Only count people in the Skool as active agents."
--
-- Skool has no membership API (see docs/skool-classroom-spec.md), and there is
-- NO Skool signal anywhere in this database today: no column on agents, no
-- table, integration_accounts is empty, and has_training_course is set on 143
-- of 167 agents so it is useless as a proxy. Gating the live active-agent count
-- on a field that does not exist would zero it out — fake-low data, the exact
-- disease this codebase keeps fighting.
--
-- So this migration builds the RECEIVING mechanism and gates on real membership,
-- but deliberately does NOT repoint any existing dashboard yet: skool_members is
-- empty on creation, and an empty gate must never silently drive a live number.
-- The moment the member list is loaded, the Skool-active count populates and the
-- dashboards can be flipped to it in a one-line follow-up.
--
-- The one input required is the Skool member export (owner feature: Skool →
-- Members → Export CSV, or paste the emails). That is a genuine external
-- dependency — no API exists to self-provision it.

create table if not exists public.skool_members (
  email       text primary key,   -- lowercased + trimmed; the join key to profiles.email
  full_name   text,
  joined_at   timestamptz,
  source      text not null default 'skool_export',
  imported_at timestamptz not null default now()
);

comment on table public.skool_members is
  'Members of the APEX Skool community, loaded from the Skool owner export (Skool has no membership API). An agent counts as Skool-active only if their profiles.email matches a row here. A full export REPLACES the set via fn_skool_members_replace, so someone who left Skool stops counting.';

-- Full-snapshot replace. The Skool export is the complete current membership, so
-- a load is authoritative: rows not in the new set are removed. Transactional.
-- p_members = [{"email":"a@b.com","full_name":"Jane Doe","joined_at":"2026-08-01"}, ...]
create or replace function public.fn_skool_members_replace(p_members jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'p_members must be a JSON array of {email, full_name?, joined_at?}';
  end if;

  delete from public.skool_members;

  insert into public.skool_members (email, full_name, joined_at, source)
  select distinct on (lower(btrim(m->>'email')))
         lower(btrim(m->>'email')),
         nullif(btrim(coalesce(m->>'full_name', '')), ''),
         case when nullif(btrim(coalesce(m->>'joined_at','')),'') is not null
              then (m->>'joined_at')::timestamptz else null end,
         'skool_export'
  from jsonb_array_elements(p_members) m
  where m ? 'email' and btrim(coalesce(m->>'email','')) <> ''
  order by lower(btrim(m->>'email'));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Per-agent membership: the gate. LEFT JOIN so agents with no email (30 of 167
-- have no profiles.email) surface as in_skool=false rather than vanishing.
create or replace view public.v_agent_skool_membership as
select a.id                                   as agent_id,
       a.display_name,
       lower(btrim(p.email))                  as email,
       coalesce(a.is_deactivated, false)      as is_deactivated,
       coalesce(a.is_inactive, false)         as is_inactive,
       a.status,
       (sm.email is not null)                 as in_skool
from public.agents a
left join public.profiles p on p.id = a.profile_id
left join public.skool_members sm on sm.email = lower(btrim(p.email))
where a.canonical_agent_id is null;

comment on view public.v_agent_skool_membership is
  'One row per unresolved agent with in_skool = does their profiles.email match a skool_members row. The gate behind the Skool-active count.';

-- The count, three ways, side by side — so the difference is visible and the
-- current live number is never silently replaced by an empty gate.
create or replace view public.v_active_agents_skool as
select
  (select count(*) from public.skool_members)                                   as skool_members_loaded,
  count(*) filter (where not is_deactivated and not is_inactive)                as active_current_definition,
  count(*) filter (where in_skool)                                              as active_in_skool,
  count(*) filter (where in_skool and not is_deactivated and not is_inactive)   as active_in_skool_and_enabled
from public.v_agent_skool_membership;

comment on view public.v_active_agents_skool is
  'Active-agent counts side by side: active_current_definition is what dashboards show today; active_in_skool is the Skool-gated number Sam asked for. Until skool_members is loaded, active_in_skool is 0 and must NOT drive any dashboard.';

-- Views are readable by the app; the membership REPLACE stays service-role only
-- (a full-table swap is an admin/import action, not something any authenticated
-- user should trigger).
grant select on public.v_agent_skool_membership to authenticated;
grant select on public.v_active_agents_skool to authenticated;
