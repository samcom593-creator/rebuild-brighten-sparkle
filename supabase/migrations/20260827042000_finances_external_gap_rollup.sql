-- Preserve the proven commission calculations in finances_overview while
-- correcting its production header for admin/IMO scope. External agency
-- snapshots are production truth but are intentionally worth $0 commission
-- until attributed to real policies and writers.

begin;

do $$
begin
  if to_regprocedure('public.finances_overview_base(text,date)') is null then
    alter function public.finances_overview(text, date) rename to finances_overview_base;
  end if;
end $$;

create or replace function public.finances_overview(
  p_scope text default 'agency',
  p_month date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_scope text := lower(coalesce(p_scope, 'agency'));
  v_result jsonb;
  v_production jsonb;
begin
  v_result := public.finances_overview_base(p_scope, p_month);

  if public.apex_is_admin() and v_scope <> 'mine' then
    select jsonb_build_object(
      'policies', count(*)::int,
      'alp', coalesce(sum(t.annual_premium), 0),
      'producers', count(distinct t.agent_id) filter (
        where t.origin is distinct from 'external_daily_gap'
      )::int,
      'last_synced_at', max(t.synced_at),
      'unattributed_policies', count(*) filter (
        where t.origin = 'external_daily_gap'
      )::int,
      'unattributed_alp', coalesce(sum(t.annual_premium) filter (
        where t.origin = 'external_daily_gap'
      ), 0),
      'commission_pending_attribution', coalesce(sum(t.annual_premium) filter (
        where t.origin = 'external_daily_gap'
      ), 0)
    )
    into v_production
    from public.v_production_comp_truth t
    where t.origin = 'external_daily_gap'
       or (t.agent_id is not null and not public.fn_agent_is_roster_excluded(t.agent_id));

    v_result := jsonb_set(v_result, '{production}', v_production, true);
  end if;

  return v_result;
end;
$fn$;

revoke all on function public.finances_overview_base(text, date) from public, anon, authenticated;
revoke all on function public.finances_overview(text, date) from public, anon;
grant execute on function public.finances_overview(text, date) to authenticated, service_role;

comment on function public.finances_overview(text, date) is
  'Hierarchy-scoped finance overview. Admin production totals include external agency reconciliation; external volume remains explicitly unattributed and earns $0 until policy-level attribution exists.';

commit;
