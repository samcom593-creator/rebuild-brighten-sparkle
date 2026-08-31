begin;

-- Owner-only. is_agency_staff() covers operations (recruit queues, call lists)
-- and legitimately includes VAs, who work those queues all day. It must not
-- also be the gate on the agency's MONEY: a VA reading v_cfo_snapshot is a
-- worse version of the manager problem this wave started from.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'admin'
  );
$$;

comment on function public.is_owner() is
  'admin only. Gate for agency financials and owner-level rollups — CFO/CEO '
  'snapshots, commission grids, chargebacks, carrier money reconciliation and '
  'whole-agency production. Operational recruit queues use is_agency_staff(), '
  'which also admits VAs. See migration 20260831050000.';

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

do $$
declare
  v text;
  body text;
  money_views text[] := array[
    'v_cfo_snapshot','v_ceo_command_center',
    'v_business_analytics_summary','v_business_analytics_carriers','v_business_analytics_insights',
    'v_commission_grid','v_commission_recovery_by_agent','v_commission_recovery_status',
    'v_charge_anomalies','v_charge_anomalies_unresolved','v_charge_trend','v_agent_charge_rollup',
    'v_carrier_book_summary','v_carrier_book_recon','v_carrier_money_leak','v_carrier_reconciliation',
    'v_missed_opportunity_ledger','v_agent_command_center','v_manager_hierarchy_mtd',
    'v_manager_scorecard','v_team_analytics_producers','v_producer_trend_alert',
    'v_agents_needs_attention','v_agents_learn_from','v_inactive_agents_summary',
    'agent_lifetime_production','agent_revenue_estimate'
  ];
begin
  foreach v in array money_views loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=v and c.relkind='v') then
      raise notice 'skip (absent): %', v; continue;
    end if;
    body := pg_get_viewdef(format('public.%I', v)::regclass, true);
    if body like '%is_owner()%' then
      raise notice 'skip (already owner-gated): %', v; continue;
    end if;
    if body not like '%is_agency_staff()%' then
      raise warning 'not staff-gated, leaving alone: %', v; continue;
    end if;
    -- Swap the predicate in place; the wrapper shape is unchanged.
    -- pg_get_viewdef renders the call WITHOUT a schema prefix. The first cut
    -- replaced 'public.is_agency_staff()', matched nothing, and re-created an
    -- IDENTICAL view — which succeeds, so it reported success while changing
    -- nothing, and a VA still read the CFO snapshot. Handle both spellings and
    -- ASSERT the result instead of trusting the statement's exit.
    body := replace(body, 'public.is_agency_staff()', 'public.is_owner()');
    body := replace(body, 'is_agency_staff()', 'public.is_owner()');
    body := replace(body, 'public.public.is_owner()', 'public.is_owner()');
    body := rtrim(btrim(body), ';');
    execute format('create or replace view public.%I as %s', v, body);
    if pg_get_viewdef(format('public.%I', v)::regclass, true) like '%is_agency_staff()%' then
      raise exception 'view % is still staff-gated after re-gating', v;
    end if;
  end loop;
end $$;

commit;
