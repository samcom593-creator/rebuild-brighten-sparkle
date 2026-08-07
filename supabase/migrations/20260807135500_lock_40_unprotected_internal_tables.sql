-- Security audit 2026-08-07: these internal tables had RLS disabled while
-- anon/authenticated retained PostgreSQL's full table privilege set, including
-- DELETE and TRUNCATE. Lock the default surface to admins, then add the narrow
-- read/update paths the authenticated product actually uses.

do $lockdown$
declare
  table_name text;
  internal_tables constant text[] := array[
    'aged_leads_daily_snapshot', 'agent_attribution_audit',
    'agentlink_carriers', 'agentlink_deals_snapshot', 'apex_commands',
    'apex_manychat_push_log', 'automation_expectations',
    'autoposter_watchdog_log', 'carrier_registry', 'cfo_approval_requests',
    'cfo_cron_run_log', 'channel_deprovision_queue', 'codex_blockers',
    'commission_recovery_attempts', 'contract_sends', 'contract_templates',
    'critical_loss_events', 'cron_health_probe', 'dialer_weekly_payments',
    'discord_rate_limit', 'ig_reels_cache', 'lead_purchases_dedup_archive',
    'license_milestone_outbox', 'license_milestone_templates',
    'licensing_courses', 'licensing_students', 'manager_touches',
    'mentorship_leads', 'mercury_subscriptions', 'outreach_queue',
    'outreach_templates', 'pg_cron_emulator_state', 'poke_queue',
    'sam_todo_dismissed', 'sam_todo_manual_items', 'sam_todo_push_log',
    'sam_todo_snoozed', 'security_change_log', 'strike_templates',
    'system_health_events'
  ];
begin
  foreach table_name in array internal_tables loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'Expected security target public.% is missing', table_name;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    execute format('drop policy if exists internal_admin_all on public.%I', table_name);
    execute format(
      'create policy internal_admin_all on public.%I for all to authenticated using (public.has_role((select auth.uid()), ''admin''::public.app_role)) with check (public.has_role((select auth.uid()), ''admin''::public.app_role))',
      table_name
    );
  end loop;
end
$lockdown$;

-- Every signed-in role needs carrier names to render scoped book rows.
drop policy if exists agentlink_carriers_authenticated_read on public.agentlink_carriers;
create policy agentlink_carriers_authenticated_read
  on public.agentlink_carriers for select to authenticated
  using (true);

-- Snapshot production is limited to the signed-in producer and a manager's
-- downline. Admins are already covered by internal_admin_all.
drop policy if exists agentlink_snapshot_own_or_downline_read on public.agentlink_deals_snapshot;
create policy agentlink_snapshot_own_or_downline_read
  on public.agentlink_deals_snapshot for select to authenticated
  using (
    exists (
      select 1
      from public.agents a
      where a.al_user_id = agentlink_deals_snapshot.user_id
        and (
          a.user_id = (select auth.uid())
          or (
            public.has_role((select auth.uid()), 'manager'::public.app_role)
            and a.id in (select agent_id from public.my_downline_agent_ids())
          )
        )
    )
  );

-- Managers operate the licensing board but do not get insert/delete access.
drop policy if exists licensing_students_manager_read on public.licensing_students;
create policy licensing_students_manager_read
  on public.licensing_students for select to authenticated
  using (public.has_role((select auth.uid()), 'manager'::public.app_role));

drop policy if exists licensing_students_manager_update on public.licensing_students;
create policy licensing_students_manager_update
  on public.licensing_students for update to authenticated
  using (public.has_role((select auth.uid()), 'manager'::public.app_role))
  with check (public.has_role((select auth.uid()), 'manager'::public.app_role));

comment on policy internal_admin_all on public.apex_commands is
  '2026-08-07 lockdown: replaces RLS-disabled tables with admin-only default access.';
