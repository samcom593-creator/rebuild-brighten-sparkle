-- Head-to-toe audit 2026-08-27: agents.insuracloud_api_token (Sam's live AgentLink
-- session cookie) was readable by every authenticated account via the base-table
-- SELECT grant + the 'leaderboard' read policy. Revoke column-level access; edge
-- functions use the service role (unaffected). The owner reads/writes their own
-- token via SECURITY DEFINER RPCs. No RLS row-policy change, so the 200+ other
-- agents reads are untouched.

revoke select on public.agents from authenticated, anon;

grant select (id, user_id, profile_id, manager_id, agent_code, license_status, license_states, nipr_number, status, start_date, total_policies, total_premium, total_earnings, created_at, updated_at, verified_at, verified_by, invited_by_manager_id, attendance_status, performance_tier, field_training_started_at, has_training_course, has_dialer_login, has_discord_access, potential_rating, evaluation_result, evaluated_at, evaluated_by, is_deactivated, crm_setup_link, weekly_10k_badges, deactivation_reason, switched_to_manager_id, sort_order, portal_password_set, is_inactive, password_required, display_name, has_production_access, production_unlocked_at, max_recruits, ref_slug, onboarding_stage, contract_percentage, override_rate, insuracloud_user_id, is_presenting, stage_changed_at, contracted_at, metadata, onboarding_completed_at, first_appointment_at, first_appointment_set_by, first_deal_at, first_10k_at, telegram_chat_id, telegram_opt_out, next_step_stage_key, next_step_due_at, canonical_agent_id, builder_track, agency_owner_qualified_at, next_action_text, next_action_due_at, leader_notes, al_user_id, training_stage_override, training_stage_override_at, training_stage_override_by, source_application_id, license_expires_at, last_license_alert_at, is_manager, license_number, licensed_at, nipr_verified, nipr_verified_at, notes, comp_percentage, comp_approval_status, comp_approved_at, comp_approved_by, eo_certificate_url, eo_policy_number, eo_expires_at, eo_per_claim_limit, eo_aggregate_limit, eo_deductible, eft_ready, contracting_contact_name, license_progress) on public.agents to authenticated, anon;

create or replace function public.get_my_insuracloud_token() returns text language sql stable security definer set search_path=public as $fn$
   select insuracloud_api_token from public.agents where user_id = auth.uid() order by created_at asc limit 1 $fn$;

revoke all on function public.get_my_insuracloud_token() from public, anon;

grant execute on function public.get_my_insuracloud_token() to authenticated, service_role;

create or replace function public.set_my_insuracloud_token(p_token text) returns void language plpgsql security definer set search_path=public as $fn$
   begin update public.agents set insuracloud_api_token = nullif(p_token,''), updated_at=now() where user_id = auth.uid(); end $fn$;

revoke all on function public.set_my_insuracloud_token(text) from public, anon;

grant execute on function public.set_my_insuracloud_token(text) to authenticated, service_role;
