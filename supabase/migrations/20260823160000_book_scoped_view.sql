-- v_agentlink_book_scoped — agentlink_book with roster exclusions applied, for
-- the CLIENT to read instead of the raw table.
--
-- Why this has to exist: several pages query public.agentlink_book directly from
-- the browser, so no amount of patching views/RPCs reaches them. On the admin
-- dashboard that produced the worst possible shape — AgentCommandDashboard's
-- periodDeals summed EVERY row into the headline, then mapped user_id -> agent
-- to build the per-agent list. Once Alyjah was excluded his agent no longer
-- resolved, so his $121,082 was counted in "Month-to-date ALP" while his name
-- vanished from the list underneath: money on screen with no visible source,
-- and a headline of $197.0k against a true $84,432.
--
-- security_invoker so the caller's RLS still applies exactly as on the table.
create or replace view public.v_agentlink_book_scoped
with (security_invoker = on) as
select b.*
from public.agentlink_book b
where not public.fn_agent_is_roster_excluded(b.agent_id);

grant select on public.v_agentlink_book_scoped to authenticated, anon;
