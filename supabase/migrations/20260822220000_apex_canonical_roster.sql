-- THE ROSTER TRUTH LAYER
--
-- Sam: "I have like 15 agents", "fix profiles and crm to have all agents",
-- "remove Alyjah Rowland", "make sure I'm no longer missing deals being counted
-- from my team at all".
--
-- Measured state that made all three true at once:
--   agents table          182 rows (63 'active') — CRM header rendered 663
--   ever produced         23 of the 63 active
--   produced in 90d       19  <- this is the real working roster
--   GHOST_* agents        10, ALL status='inactive', 109 book rows / $204,862.
--                         Sync artifacts. Alyjah Rowland (GHOST_336) alone was
--                         $112,530 of a $196,962 month = 57% of MTD, ranked #1
--                         on the leaderboard above every real producer.
--   XAGENT01..08, MP232V_HIRED, NULL-display_name rows — test/junk in the roster.
--
-- AND THE INVERSE, which is the "missing deals" half: real producers carry the
-- wrong status flag, so any surface filtering on status='active' drops them and
-- their money. KJ Vaughn is status='terminated' with 23 deals / $31,237 posted
-- as recently as 2026-08-08 — and Sam has said explicitly KJ is still on his
-- team and that production counts toward him. Same shape: Pranav Kodali
-- ('inactive', $35,833, last deal 08-06), Matthew Anduha, Taylen Nash, Isaac
-- Assaba, Jorge Oyervidez. Six real producers, one stale flag each.
--
-- So membership is NOT status. It is: a real identity, not excluded by Sam, and
-- either marked active OR demonstrably producing. Recent production always wins
-- over a stale flag — that is the only rule that cannot silently lose money.

create table if not exists public.roster_exclusions (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  reason text,
  excluded_at timestamptz not null default now(),
  excluded_by uuid
);
alter table public.roster_exclusions enable row level security;
drop policy if exists roster_excl_read on public.roster_exclusions;
create policy roster_excl_read on public.roster_exclusions for select to authenticated using (true);
drop policy if exists roster_excl_admin on public.roster_exclusions;
create policy roster_excl_admin on public.roster_exclusions for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- Window for "demonstrably producing". 120d not 90d: Dalton Rowland's last deal
-- is 2026-06-12 (71d) and Moody Imran's 2026-06-17 — a 90d window would drop a
-- real producer the moment he had a slow quarter, which is the exact failure
-- this view exists to prevent.
create or replace view public.v_apex_roster
with (security_invoker = on) as
with produced as (
  select b.agent_id, count(*) as deals_120d, sum(b.annual_premium) as ap_120d, max(b.posted_date) as last_deal
  from public.agentlink_book b
  where b.is_dead is not true and b.agent_id is not null
    and b.posted_date > (now() at time zone 'America/Phoenix')::date - 120
  group by b.agent_id
),
lifetime as (
  select b.agent_id, count(*) as deals_lifetime, sum(b.annual_premium) as ap_lifetime
  from public.agentlink_book b
  where b.is_dead is not true and b.agent_id is not null
  group by b.agent_id
)
select
  a.id, a.agent_code, a.display_name, a.status, a.license_status, a.manager_id,
  a.insuracloud_user_id, a.onboarding_stage, a.created_at, a.user_id,
  coalesce(p.deals_120d, 0)      as deals_120d,
  coalesce(p.ap_120d, 0)         as ap_120d,
  p.last_deal,
  coalesce(l.deals_lifetime, 0)  as deals_lifetime,
  coalesce(l.ap_lifetime, 0)     as ap_lifetime,
  (p.agent_id is not null)       as is_producing,
  case
    when p.agent_id is not null and a.status = 'active' then 'producing'
    when p.agent_id is not null then 'producing_flag_stale'
    when a.status = 'active' then 'active_no_production'
    else a.status::text
  end::text as roster_state
from public.agents a
left join produced p on p.agent_id = a.id
left join lifetime l on l.agent_id = a.id
where
  -- real identity only
  a.display_name is not null
  and btrim(a.display_name) <> ''
  and coalesce(a.agent_code, '') not like 'GHOST^_%' escape '^'
  and coalesce(a.agent_code, '') not like 'XAGENT%'
  and a.display_name not like 'MP%^_HIRED' escape '^'
  and a.display_name not like 'XAGENT%'
  -- Sam's explicit removals
  and not exists (select 1 from public.roster_exclusions x where x.agent_id = a.id)
  -- membership: active OR demonstrably producing (a stale flag can never drop money)
  and (a.status = 'active' or p.agent_id is not null);

grant select on public.v_apex_roster to authenticated;

-- Sam's directive: remove Alyjah Rowland. Recorded as a reversible row, not a
-- delete — the agent and all 30 book rows stay intact; he simply stops being
-- roster. Undo is: delete from roster_exclusions where agent_id = '<id>'.
insert into public.roster_exclusions (agent_id, reason)
select id, 'Removed by Sam 2026-08-22 — not on the APEX roster (GHOST_336 sync artifact)'
from public.agents where agent_code = 'GHOST_336'
on conflict (agent_id) do nothing;
