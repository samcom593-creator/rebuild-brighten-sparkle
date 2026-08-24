-- wave-view-leak part 2 — the three holes part 1 measured but did not close,
-- plus one regression part 1 introduced.
--
-- 1. REGRESSION FIRST. Part 1 put v_my_carrier_contracts on security_invoker.
--    That was right — the view has "my" in its name, no WHERE clause at all,
--    and was handing every agent all 21 carrier contracts including other
--    people's writing_number and contract_number. But apex_carrier_contracts
--    carries exactly ONE policy, contracts_admin_all, so under invoker mode a
--    contracted agent now reads zero rows and /dashboard/contracting (which is
--    NOT admin-gated) goes blank for them. The view was never the bug; the
--    table having no self-read policy was. Fixed on the table.
--
-- 2. daily_production carries a policy literally named "Authenticated agents
--    can view all production for leaderboard" whose USING clause is
--    `auth.uid() IS NOT NULL`. That is every logged-in user reading every
--    agent's production rows, and it is why agent_lifetime_production still
--    showed $3,489,303 to a plain agent even after security_invoker — the RLS
--    it now honours was itself wide open. The leaderboard does not need it:
--    every leaderboard view is SECURITY DEFINER and bypasses RLS regardless.
--    The one real consumer was useWeeklyBadges, which pulled the whole
--    agency's week into the browser to decide whether ONE agent won a badge;
--    that is replaced by an RPC that computes the badges server-side and
--    returns only the caller's own.
--
-- 3. The agency-level views. An aggregate has no per-row owner, so no RLS can
--    scope it — it is all-or-nothing, and these are the ones a plain agent has
--    no business reading at all. Guarded with is_agency_staff() rather than
--    security_invoker on purpose: several read ops/health tables that
--    `authenticated` holds no grant on, so invoker would turn a silent leak
--    into a hard error on Sam's own admin pages.
--
-- 4. skool_members had RLS switched off entirely (the lone rls_disabled_in_public
--    ERROR from the advisor).

begin;

-- ─── 1. The regression ───────────────────────────────────────────────────────
alter table public.apex_carrier_contracts enable row level security;

drop policy if exists carrier_contracts_own_read on public.apex_carrier_contracts;
create policy carrier_contracts_own_read
  on public.apex_carrier_contracts for select
  to authenticated
  using (
    agent_id in (select a.id from public.agents a where a.user_id = (select auth.uid()))
  );

drop policy if exists carrier_contracts_manager_read on public.apex_carrier_contracts;
create policy carrier_contracts_manager_read
  on public.apex_carrier_contracts for select
  to authenticated
  using (
    public.has_role((select auth.uid()), 'manager'::app_role)
    and agent_id in (select agent_id from public.my_downline_agent_ids())
  );

-- ─── 2. The leaderboard escape hatch ────────────────────────────────────────
-- Badges computed where the data lives. Returns ONLY the caller's own badges,
-- so winning still requires being measured against everyone while nobody's
-- production crosses the wire.
create or replace function public.my_weekly_badges()
returns table (
  id          text,
  name        text,
  description text,
  icon        text,
  color       text,
  week_start  date,
  value       numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agent   uuid;
  v_start   date := date_trunc('week', (now() at time zone 'America/Phoenix'))::date;
  v_end     date := v_start + 6;
begin
  select a.id into v_agent from public.agents a where a.user_id = auth.uid() limit 1;
  if v_agent is null then
    return;
  end if;

  return query
  with wk as (
    select dp.agent_id,
           sum(coalesce(dp.aop, 0))              as alp,
           sum(coalesce(dp.deals_closed, 0))     as deals,
           sum(coalesce(dp.presentations, 0))    as presentations,
           sum(coalesce(dp.referrals_caught, 0)) as referrals
    from public.daily_production dp
    where dp.production_date between v_start and v_end
    group by dp.agent_id
  ),
  ranked as (
    select w.*,
           case when w.presentations > 0 then (w.deals::numeric / w.presentations) * 100 else 0 end as close_rate,
           rank() over (order by w.alp desc)   as alp_rank,
           rank() over (order by w.deals desc) as deals_rank
    from wk w
  ),
  me as (select * from ranked where agent_id = v_agent)
  select b.id, b.name, b.description, b.icon, b.color, v_start, b.value
  from me,
  lateral (
    select 'alp-champion'::text, 'ALP Champion'::text,
           'Top ALP this week: $' || round(me.alp)::text, 'crown'::text, 'amber'::text, me.alp
    where me.alp > 0 and me.alp = (select max(alp) from ranked)
    union all
    select 'deal-machine', 'Deal Machine',
           'Most deals: ' || me.deals::text || ' closed', 'zap', 'primary', me.deals::numeric
    where me.deals > 0 and me.deals = (select max(deals) from ranked)
    union all
    select 'referral-king', 'Referral King',
           'Most referrals: ' || me.referrals::text || ' caught', 'star', 'violet', me.referrals::numeric
    where me.referrals > 0 and me.referrals = (select max(referrals) from ranked)
    union all
    select 'presentation-pro', 'Presentation Pro',
           'Most presentations: ' || me.presentations::text, 'flame', 'rose', me.presentations::numeric
    where me.presentations > 0 and me.presentations = (select max(presentations) from ranked)
    union all
    select 'top-closer', 'Top Closer',
           'Best close rate: ' || round(me.close_rate)::text || '%', 'target', 'emerald', me.close_rate
    where me.presentations >= 3
      and me.close_rate = (select max(close_rate) from ranked where presentations >= 3)
    union all
    select 'rising-star', 'Rising Star',
           'Top 3 in multiple categories', 'trophy', 'cyan', 2::numeric
    where (case when me.alp_rank <= 3 then 1 else 0 end)
        + (case when me.deals_rank <= 3 then 1 else 0 end) >= 2
  ) as b(id, name, description, icon, color, value);
end
$$;

revoke all on function public.my_weekly_badges() from public, anon;
grant execute on function public.my_weekly_badges() to authenticated, service_role;

comment on function public.my_weekly_badges() is
  'Weekly badges for the CALLER only, computed server-side. Replaces the client '
  'pulling every agent''s daily_production into the browser to decide one '
  'agent''s badge — which is what the wide-open "Authenticated agents can view '
  'all production for leaderboard" policy existed to serve.';

drop policy if exists "Authenticated agents can view all production for leaderboard"
  on public.daily_production;

-- ─── 3. Agency-level views → staff only ─────────────────────────────────────
-- Rewraps each view body as `select * from (<body>) t where is_agency_staff()`.
-- CREATE OR REPLACE VIEW keeps the column list, types and existing grants
-- identical, so nothing downstream needs to change. A non-staff caller gets
-- ZERO ROWS rather than an error, so an admin page opened by the wrong person
-- renders empty instead of exploding.
do $$
declare
  v    text;
  body text;
  guarded text[] := array[
    -- agency financials / exec
    'v_cfo_snapshot',
    'v_ceo_command_center',
    'v_business_analytics_summary',
    'v_business_analytics_carriers',
    'v_business_analytics_insights',
    'v_commission_grid',
    'v_commission_recovery_by_agent',
    'v_commission_recovery_status',
    'v_charge_anomalies',
    'v_charge_anomalies_unresolved',
    'v_charge_trend',
    'v_agent_charge_rollup',
    'v_carrier_book_summary',
    'v_carrier_book_recon',
    'v_carrier_money_leak',
    'v_carrier_reconciliation',
    'v_missed_opportunity_ledger',
    'v_agent_command_center',
    'v_manager_hierarchy_mtd',
    'v_manager_scorecard',
    'v_team_analytics_producers',
    'v_producer_trend_alert',
    'v_agents_needs_attention',
    'v_agents_learn_from',
    'v_inactive_agents_summary',
    'agent_lifetime_production',
    'agent_revenue_estimate',
    -- recruit rosters + contact detail
    'v_unlicensed_all',
    'v_hot_licensing_prospects',
    'v_recruiter_pipeline',
    'v_paid_applicants',
    'v_old_licensed_applicants',
    'v_old_manager_applicants',
    'v_admin_applicant_overview',
    'v_agent_reactivation_queue',
    'v_producer_reactivation',
    'v_command_center_queue',
    'v_prospect_review_queue',
    'v_interview_pipeline',
    'v_xcel_person_progress',
    'v_upcoming_calls'
  ];
begin
  foreach v in array guarded loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v and c.relkind = 'v'
    ) then
      raise notice 'skip (absent): %', v;
      continue;
    end if;

    body := pg_get_viewdef(format('public.%I', v)::regclass, true);

    -- Idempotent: never double-wrap on a re-run.
    if body like '%is_agency_staff()%' then
      raise notice 'skip (already guarded): %', v;
      continue;
    end if;

    body := rtrim(btrim(body), ';');

    begin
      execute format(
        'create or replace view public.%I as select * from (%s) t where public.is_agency_staff()',
        v, body
      );
    exception when others then
      -- A view whose body has duplicate output names cannot take `select *`.
      -- Name it rather than aborting the whole migration silently.
      raise warning 'could not guard %: %', v, SQLERRM;
    end;
  end loop;
end $$;

-- ─── 4. skool_members ───────────────────────────────────────────────────────
alter table public.skool_members enable row level security;

drop policy if exists skool_members_staff_read on public.skool_members;
create policy skool_members_staff_read
  on public.skool_members for select
  to authenticated
  using (public.is_agency_staff());

commit;
