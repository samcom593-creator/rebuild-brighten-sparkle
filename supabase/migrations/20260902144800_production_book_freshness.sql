-- MP-372: the dashboard read $0 on the 2nd of the month and looked dead.
-- Both headline surfaces (ScopedProductionScoreboard + Leaderboard) window on
-- posted_date, and AgentLink had posted nothing for September yet — so the
-- honest number WAS $0, but nothing on the page said "the book is live, just
-- empty so far". scoped_production_scoreboard's last_synced_at is max(synced_at)
-- over rows IN THE WINDOW, so an empty window returned null — blank instead of
-- context, the same failure MP-297's Stripe view had.
--
-- This RPC answers the freshness question independent of any window:
--   last_posted_date  — newest posted_date the CALLER may see (same scope rule
--                       as leaderboard_board: admin, else crm_can_read_agent_scope)
--   last_posted_count / last_posted_ap — what landed on that day, in scope
--   last_synced_at    — newest of agentlink_book.imported_at (global, not
--                       sensitive) and the scoped rows' own synced_at
--   live_policies     — live (non-dead, non-excluded) rows in scope
create or replace function public.production_book_freshness()
returns table (
  last_posted_date date,
  last_posted_count integer,
  last_posted_ap numeric,
  last_synced_at timestamptz,
  live_policies integer
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    -- Same source and the same visibility rule as leaderboard_board /
    -- scoped_production_scoreboard, so "last posted" agrees with the boards.
    -- (Aug 31 2026: 1 agentlink row + 8 apex_native rows — agentlink_book
    -- alone would have said 1 policy where the board says 9.)
    select t.posted_date, t.annual_premium, t.synced_at
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and (public.apex_is_admin() or public.crm_can_read_agent_scope(t.agent_id))
  ), newest as (
    select max(posted_date) as d from scoped
  )
  select
    (select d from newest) as last_posted_date,
    (select count(*)::integer from scoped s, newest n where s.posted_date = n.d) as last_posted_count,
    (select coalesce(sum(annual_premium), 0) from scoped s, newest n where s.posted_date = n.d) as last_posted_ap,
    greatest(
      (select max(imported_at) from public.agentlink_book),
      (select max(synced_at) from scoped)
    ) as last_synced_at,
    (select count(*)::integer from scoped) as live_policies;
$$;

revoke all on function public.production_book_freshness() from public, anon;
grant execute on function public.production_book_freshness() to authenticated, service_role;
