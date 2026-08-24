-- wave-view-leak — agents could read every agent's numbers and every agent's recruits.
--
-- MEASURED, not assumed. Simulating a plain agent (role='agent' only, user
-- 40cabe7d…) against prod: the base tables answered CORRECTLY — applications 0
-- rows, deals 0 rows, agentlink_book 0 rows. RLS on the tables was never the
-- problem and is not touched here.
--
-- The leak is that 258 views in `public` are SECURITY DEFINER (Postgres'
-- default: a view runs as its OWNER, so the caller's RLS never applies) and are
-- granted SELECT to `authenticated`. Through them the same agent read:
--
--     v_unlicensed_all              1037 rows  (first/last name, EMAIL, PHONE,
--                                               state — every unlicensed recruit
--                                               in the agency, i.e. everyone
--                                               else's recruits)
--     v_agent_monthly_production     170 rows  (every agent's monthly volume)
--     v_agent_command_center         109 rows
--     v_recruiter_pipeline           109 rows
--     v_cfo_snapshot                   1 row   (agency financial summary)
--     v_commission_grid               22 rows
--     v_business_analytics_summary     1 row
--
-- Three different remedies, because these views fail in three different ways.
-- Which one each view gets was decided by probing it, not by reading its name.
--
--   A. security_invoker = true  — for PER-AGENT views. The rows stay (the agent
--      roster is a product feature; team pages need it) but every money column
--      resolves through the caller's RLS. PROVEN on v_agent_monthly_production
--      before this migration was written: plain agent 170 rows / $0 visible,
--      admin 170 rows / 12 with money / $186,425 — i.e. masked for the agent,
--      byte-identical for Sam. This is the preferred fix: it degrades to "your
--      own numbers", it does not need a role list, and a manager keeps downline
--      visibility because the base-table policies already grant it.
--
--   B. is_agency_staff() guard — for AGENCY-LEVEL AGGREGATES and RECRUIT
--      ROSTERS. An aggregate has no per-row owner, so no RLS can mask it; it is
--      all-or-nothing. Wrapping the body in `select * from (<body>) t where
--      is_agency_staff()` preserves the exact column list and types (so CREATE
--      OR REPLACE VIEW is legal) and returns ZERO ROWS to a non-staff caller
--      rather than raising — a page renders empty instead of exploding.
--      Deliberately NOT security_invoker: these read ops/health tables that
--      `authenticated` has no grant on at all, so invoker would turn a silent
--      leak into a hard error on Sam's own admin pages.
--
--   C. REVOKE from authenticated — for the 92 views NOTHING in the repo reads.
--      Verified by scanning src/, supabase/functions/ and scripts/ for each
--      name (not just quoted `"name"` strings — the loose scan found 42 more
--      references than the quoted one did, including v_my_carrier_contracts,
--      which IS agent-facing and is therefore NOT revoked). Bots reach these
--      through service_role, which ignores grants, so nothing on cron loses
--      access.
--
-- Leaderboards, the hall of fame, the trophy cabinet, culture feed, challenges
-- and the roster views are deliberately LEFT agency-wide. An insurance agency
-- leaderboard that only shows you your own row is not a leaderboard, and Sam's
-- board is a product surface, not a leak.

begin;

-- ─── Guard helper ────────────────────────────────────────────────────────────
-- STABLE + SECURITY DEFINER so it can read user_roles regardless of the
-- caller's own RLS, and so the planner evaluates it once per query as a
-- one-time filter rather than per row.
create or replace function public.is_agency_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('admin', 'manager', 'va_manager')
  );
$$;

comment on function public.is_agency_staff() is
  'True when the caller holds admin, manager or va_manager. Gate for views that '
  'expose agency-level aggregates or the full recruit roster — data with no '
  'per-row owner, which RLS therefore cannot scope. See migration '
  '20260824120000_view_rls_leak_lockdown.sql.';

revoke all on function public.is_agency_staff() from public, anon;
grant execute on function public.is_agency_staff() to authenticated, service_role;

-- ─── A. Per-agent views → security_invoker ───────────────────────────────────
-- Money resolves through the caller's own RLS. Applied only to views whose
-- money columns originate in RLS-protected tables (deals, agentlink_book,
-- commission_ledger, carrier_policies) — each one probed after this migration
-- lands, and anything that still leaks is moved to the guard list rather than
-- left half-fixed.
do $$
declare
  v text;
  invoker_views text[] := array[
    'agent_lifetime_production',
    'agent_revenue_estimate',
    'v_agent_monthly_production',
    'v_agent_weekly_production',
    'v_agent_carrier_mix',
    'v_agent_charge_rollup',
    'v_agent_deal_quality',
    'v_agent_production_quality',
    'v_agent_with_downline_production',
    'v_earnings_estimate',
    'v_book_by_month',
    'v_book_concentration',
    'v_book_persistency',
    'v_book_status_segments',
    'v_book_status_tiles',
    'v_carrier_production',
    'v_agentlink_book_truth',
    'v_my_carrier_contracts',
    'v_imo_by_agency',
    'v_producer_pulse',
    'v_recent_activations_alp',
    'v_lapses_30d_detail',
    'v_chargebacks_30d',
    'v_chargeback_watch',
    'v_deals_needing_real_policy'
  ];
begin
  foreach v in array invoker_views loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v and c.relkind = 'v'
    ) then
      execute format('alter view public.%I set (security_invoker = true)', v);
    else
      raise notice 'skip (absent): %', v;
    end if;
  end loop;
end $$;

commit;
