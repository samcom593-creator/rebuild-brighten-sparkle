-- v_production_unified — the AgentLink book PLUS deals posted natively in APEX.
--
-- THE GAP: Jontay posted three real deals through the APEX form today
-- (dianne fields $673.92, bruce Duffield $1,440.00, barbara clark $537.72 —
-- $2,652 total) and every production surface showed him at ZERO. The roster,
-- leaderboard, dashboard and book truth all read agentlink_book, and a native
-- deal never lands there — it lives in public.deals until someone re-keys it
-- into AgentLink. So an agent using the tool Sam asks them to use gets no
-- credit for it, on the very screens used to judge them.
--
-- DOUBLE-COUNTING IS THE OBVIOUS WAY TO GET THIS WRONG, and Sam has already
-- been bitten by duplicates this week. A native deal re-keyed into AgentLink
-- would exist in BOTH tables. So natives are included ONLY when nothing in the
-- book matches them, on two independent keys:
--   1. policy_number (trimmed, case-insensitive) — the strong key when present
--   2. agent + client + premium + effective_date — for blank policy numbers
-- MEASURED at write time: 4 apex_native deals exist, 0 appear in the book, so
-- this adds exactly those 4 and duplicates nothing. The two match keys below
-- stay as a second line of defence for the day a native deal IS re-keyed into
-- AgentLink — then it must drop out of the native side, not appear twice.
--
-- Dead statuses are excluded on the native side the same way is_dead excludes
-- them on the book side, so the two halves mean the same thing.
create or replace view public.v_production_unified
with (security_invoker = on) as
select
  b.deal_key::text        as row_key,
  'agentlink'::text       as origin,
  b.agent_id, b.agent_name, b.client_name, b.carrier, b.product,
  b.policy_number, b.annual_premium, b.posted_date, b.effective_date, b.status
from public.v_agentlink_book_scoped b
where b.is_dead is not true

union all

select
  d.id::text              as row_key,
  'apex_native'::text     as origin,
  d.agent_id,
  coalesce(ag.display_name, 'Agent')                                   as agent_name,
  btrim(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')) as client_name,
  c.name                                                               as carrier,
  d.product_sold                                                       as product,
  d.policy_number,
  d.annual_premium,
  coalesce(d.posted_at::date, d.created_at::date)                      as posted_date,
  d.effective_date,
  d.status
from public.deals d
left join public.agents ag on ag.id = d.agent_id
left join public.carriers c on c.id = d.carrier_id
where d.agent_id is not null
  and d.annual_premium is not null
  -- ONLY deals that originated in APEX. public.deals is mostly an IMPORT MIRROR
  -- of AgentLink (source='agent_link'), so admitting every unmatched row
  -- re-creates the double-counting Sam reported this morning: a first cut of
  -- this view added 64 rows / $89,520, and 52 of them were agent_link mirrors —
  -- sampled, at least two already had a name+premium twin sitting in the book.
  -- A deal that originated in APEX cannot by definition already be in the book,
  -- which makes this the only side of the union that is safe to add.
  and d.source = 'apex_native'
  and lower(coalesce(d.status,'')) not in ('lapsed','cancelled','charged_back','withdrawn','not_taken','declined')
  and not public.fn_agent_is_roster_excluded(d.agent_id)
  -- strong key: same policy number already in the book
  and not exists (
    select 1 from public.v_agentlink_book_scoped b
    where nullif(btrim(coalesce(b.policy_number,'')),'') is not null
      and lower(btrim(b.policy_number)) = lower(btrim(coalesce(d.policy_number,'')))
  )
  -- fallback key: same agent + client + premium + effective date
  and not exists (
    select 1 from public.v_agentlink_book_scoped b2
    where b2.agent_id = d.agent_id
      and b2.annual_premium = d.annual_premium
      and b2.effective_date = d.effective_date
      and lower(btrim(coalesce(b2.client_name,''))) =
          lower(btrim(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')))
  );

grant select on public.v_production_unified to authenticated;
