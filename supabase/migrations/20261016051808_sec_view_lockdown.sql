-- PL-SEC-VIEW-LOCKDOWN (2026-10-15): logged-in accounts could read ~80 reporting views in full.
--
-- Postgres views run with their OWNER's rights unless created security_invoker, so they skip
-- every row-level-security policy on the tables beneath them, and Supabase grants SELECT on every
-- public view to anon + authenticated by default. Measured before this migration with a simulated
-- ordinary agent JWT: 1,751 client deals (names, phones), 125,547 + 99,451 lead rows (DOB,
-- beneficiary, contacts), 182,169 notification rows, Sam's inbox (697), Stripe customer emails,
-- 978 recruiting records, and 73 other agents' production rows. Anonymous visitors were blocked.
--
-- The full book is Sam's (admin role) and Aisha's (public.book_readers; sold calls keep their own
-- can_view_sold_calls() check, which names the same two people). Admin-only pages stay admin-only. Managers see their own
-- and their downline's rows, agents their own, VAs/VA managers/recruiters the applicant pipelines
-- their pages use. Views no page reads lose client access entirely; server code (service role,
-- SECURITY DEFINER functions, pg_cron) is unaffected because the gate passes any role other than
-- anon/authenticated.

create table if not exists public.book_readers (
  user_id uuid primary key,
  note text not null,
  added_at timestamptz not null default now()
);

alter table public.book_readers enable row level security;

revoke all on table public.book_readers from public, anon, authenticated;

insert into public.book_readers (user_id, note) values ('66bc4464-f10b-4ecf-8e8b-144486f18a44', 'Aisha Kebbeh: reads the full production book (Sam, 2026-10-15).') on conflict (user_id) do nothing;

create or replace function public.api_is_admin_role()
returns boolean language sql stable security definer set search_path = public
as $fn$
  select auth.uid() is not null
     and exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role::text = 'admin')
$fn$;

create or replace function public.api_is_full_reader()
returns boolean language sql stable security definer set search_path = public
as $fn$
  select auth.uid() is not null and (
    exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role::text = 'admin')
    or exists (select 1 from public.book_readers b where b.user_id = auth.uid())
  )
$fn$;

create or replace function public.api_is_ops_staff()
returns boolean language sql stable security definer set search_path = public
as $fn$
  select public.api_is_admin_role()
      or exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role::text in ('va', 'va_manager', 'recruiter'))
$fn$;

create or replace function public.api_is_staff()
returns boolean language sql stable security definer set search_path = public
as $fn$
  select public.api_is_ops_staff()
      or exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role::text = 'manager')
$fn$;

create or replace function public.api_scope_agent_ids()
returns uuid[] language sql stable security definer set search_path = public
as $fn$
  with mine as (
    select a.id from public.agents a where a.user_id = auth.uid()
    union
    select a.canonical_agent_id from public.agents a where a.user_id = auth.uid() and a.canonical_agent_id is not null
  ), team as (
    select d.agent_id as id
    from mine m cross join lateral public.get_downline_agent_ids(m.id) d
    where exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role::text = 'manager')
  )
  select coalesce(array_agg(distinct x.id) filter (where x.id is not null), '{}'::uuid[])
  from (select id from mine union all select id from team) x
$fn$;

create or replace function public.api_my_application_ids()
returns uuid[] language sql stable security definer set search_path = public
as $fn$
  select coalesce(array_agg(a.id), '{}'::uuid[])
  from public.applications a
  where auth.uid() is not null and (
    (auth.email() is not null and lower(a.email) = lower(auth.email()))
    or a.hiring_manager_user_id = auth.uid()
    or a.recruiting_owner_user_id = auth.uid()
  )
$fn$;

create or replace function public.api_is_presenter()
returns boolean language sql stable security definer set search_path = public
as $fn$
  select exists (select 1 from public.agents a where a.user_id = auth.uid() and coalesce(a.is_presenting, false))
$fn$;

revoke all on function public.api_is_admin_role() from public, anon;

grant execute on function public.api_is_admin_role() to authenticated, service_role;

revoke all on function public.api_is_full_reader() from public, anon;

grant execute on function public.api_is_full_reader() to authenticated, service_role;

revoke all on function public.api_is_ops_staff() from public, anon;

grant execute on function public.api_is_ops_staff() to authenticated, service_role;

revoke all on function public.api_is_staff() from public, anon;

grant execute on function public.api_is_staff() to authenticated, service_role;

revoke all on function public.api_scope_agent_ids() from public, anon;

grant execute on function public.api_scope_agent_ids() to authenticated, service_role;

revoke all on function public.api_my_application_ids() from public, anon;

grant execute on function public.api_my_application_ids() to authenticated, service_role;

revoke all on function public.api_is_presenter() from public, anon;

grant execute on function public.api_is_presenter() to authenticated, service_role;

drop policy if exists deals_book_readers_read on public.deals;

create policy deals_book_readers_read on public.deals for select to authenticated using ((select public.api_is_full_reader()));

drop policy if exists agentlink_book_book_readers_read on public.agentlink_book;

create policy agentlink_book_book_readers_read on public.agentlink_book for select to authenticated using ((select public.api_is_full_reader()));

drop policy if exists production_external_deals_book_readers_read on public.production_external_deals;

create policy production_external_deals_book_readers_read on public.production_external_deals for select to authenticated using ((select public.api_is_full_reader()));

drop policy if exists rmd_sold_call_viewers_read on public.readymode_dialer_calls;

create policy rmd_sold_call_viewers_read on public.readymode_dialer_calls for select to authenticated using (disposition = 'Completed Sale' and (select public.can_view_sold_calls()));

create or replace function public._sec_gate_view(p_view text, p_predicate text)
returns void language plpgsql set search_path = public
as $fn$
declare
  rel regclass := ('public.' || quote_ident(p_view))::regclass;
  invoker text;
  d text;
begin
  select coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false')
    into invoker from pg_class c where c.oid = rel;
  if invoker in ('true', 'on') then
    raise exception 'refusing to gate %: it is a security_invoker view', p_view;
  end if;
  d := pg_get_viewdef(rel, true);
  if d ~ 'api_is_(full_reader|staff|ops_staff)|api_scope_agent_ids' then
    return; -- already gated: never nest a second wrapper
  end if;
  d := regexp_replace(d, ';\s*$', '');
  execute format('create or replace view public.%I with (security_barrier = true) as select * from (%s) q where %s', p_view, d, p_predicate);
end
$fn$;

select public._sec_gate_view('v_agent_account_gaps', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_agents_missing_al_link', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_builder_operating_dashboard', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_dormant_dialer_seats', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_insuracloud_push_eligible', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_insuracloud_push_verdict', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_notification_log_with_role', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_onboarding_call_truth', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_readymode_agent_today', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_readymode_today', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_sam_builders_dashboard', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_sam_inbox', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_telegram_stuck_users', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_admin_role())');

select public._sec_gate_view('v_production_unified', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_full_reader()) or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[])');

select public._sec_gate_view('v_ghost_deals', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_full_reader()) or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[])');

select public._sec_gate_view('v_falloff_watch', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_full_reader()) or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[])');

select public._sec_gate_view('v_lapsed_recovery', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_full_reader()) or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[])');

select public._sec_gate_view('v_licensing_kanban', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_licensing_stalled', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_next_step_stuck_pool', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_recruiting_pipeline', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_stale_applicants', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_unclaimed_new_apps', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_xcel_latest', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_xcel_pipeline', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff())');

select public._sec_gate_view('v_kj_seminar_control', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_staff()) or (select public.api_is_presenter())');

select public._sec_gate_view('v_agent_referrals', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_ops_staff()) or q.referrer_agent_id = any ((select public.api_scope_agent_ids())::uuid[])');

select public._sec_gate_view('v_referral_pipeline', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_ops_staff()) or q.referrer_agent_id = any ((select public.api_scope_agent_ids())::uuid[])');

select public._sec_gate_view('v_agents_onboarding_status', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_ops_staff()) or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[])');

select public._sec_gate_view('v_next_step_candidate', 'current_user not in (''anon'', ''authenticated'') or (select public.api_is_ops_staff()) or q.agent_id = any ((select public.api_scope_agent_ids())::uuid[]) or q.application_id = any ((select public.api_my_application_ids())::uuid[])');

revoke all on table public.v_admin_applicant_overview from public, anon, authenticated;

revoke all on table public.v_agent_skool_membership from public, anon, authenticated;

revoke all on table public.v_blacklisted_carrier_deals from public, anon, authenticated;

revoke all on table public.v_bot_alert_delivery_truth from public, anon, authenticated;

revoke all on table public.v_channel_deprovision_needed from public, anon, authenticated;

revoke all on table public.v_charge_anomalies from public, anon, authenticated;

revoke all on table public.v_charge_anomalies_unresolved from public, anon, authenticated;

revoke all on table public.v_deals_leaderboard from public, anon, authenticated;

revoke all on table public.v_dunning_classification from public, anon, authenticated;

revoke all on table public.v_duplicate_active_subs from public, anon, authenticated;

revoke all on table public.v_hh_hires_not_in_apex from public, anon, authenticated;

revoke all on table public.v_hired_licensed_missing_course from public, anon, authenticated;

revoke all on table public.v_ica_paid_missing_data from public, anon, authenticated;

revoke all on table public.v_identity_collision_verdict from public, anon, authenticated;

revoke all on table public.v_insuracloud_outbox_root_causes from public, anon, authenticated;

revoke all on table public.v_insuracloud_outbox_truth from public, anon, authenticated;

revoke all on table public.v_insuracloud_outbox_verdict from public, anon, authenticated;

revoke all on table public.v_insuracloud_push_blocked from public, anon, authenticated;

revoke all on table public.v_insuracloud_push_refused from public, anon, authenticated;

revoke all on table public.v_interview_capture_health from public, anon, authenticated;

revoke all on table public.v_interview_conflicts from public, anon, authenticated;

revoke all on table public.v_interviews_unified from public, anon, authenticated;

revoke all on table public.v_june_hires_needs_attention from public, anon, authenticated;

revoke all on table public.v_lead_purchases_today from public, anon, authenticated;

revoke all on table public.v_leads_book_fallout from public, anon, authenticated;

revoke all on table public.v_leads_do_not_dial from public, anon, authenticated;

revoke all on table public.v_leads_orphan_rewrite from public, anon, authenticated;

revoke all on table public.v_leads_quality_flags from public, anon, authenticated;

revoke all on table public.v_leads_sold_already from public, anon, authenticated;

revoke all on table public.v_leads_va_equity from public, anon, authenticated;

revoke all on table public.v_leads_veteran_fe_priority from public, anon, authenticated;

revoke all on table public.v_licensed_booking_mismatch from public, anon, authenticated;

revoke all on table public.v_licensing_stage_canonical from public, anon, authenticated;

revoke all on table public.v_licensing_stage_drift from public, anon, authenticated;

revoke all on table public.v_next_step_current from public, anon, authenticated;

revoke all on table public.v_numbers_reminder_channel_health from public, anon, authenticated;

revoke all on table public.v_paid_applicants from public, anon, authenticated;

revoke all on table public.v_phantom_lead_purchases from public, anon, authenticated;

revoke all on table public.v_pre_licensing_tracker from public, anon, authenticated;

revoke all on table public.v_reclaimable_dialer_seats from public, anon, authenticated;

revoke all on table public.v_recovery_queue from public, anon, authenticated;

revoke all on table public.v_recruiter_pipeline from public, anon, authenticated;

revoke all on table public.v_recruiting_inbox from public, anon, authenticated;

revoke all on table public.v_seminar_dashboard from public, anon, authenticated;

revoke all on table public.v_stripe_dunning_early_warning from public, anon, authenticated;

revoke all on table public.v_stripe_dunning_watch from public, anon, authenticated;

revoke all on table public.v_stripe_refund_watch from public, anon, authenticated;

revoke all on table public.v_stripe_subscription_status from public, anon, authenticated;

revoke all on table public.v_telegram_application_link from public, anon, authenticated;

revoke all on table public.v_va_call_queue from public, anon, authenticated;

revoke all on table public.v_xcel_stage_gaps from public, anon, authenticated;

drop function public._sec_gate_view(text, text);
