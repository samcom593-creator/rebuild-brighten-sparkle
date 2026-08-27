-- MP-329 — close the residual agents READ leak (MP-326 write-lockdown +
-- MP-328 comp/NIPR column-lockdown follow-through).
--
-- MP-328 revoked 17 sensitive columns (comp_*, contract_percentage, override_rate,
-- leader_notes, nipr_number, license_number, eo_*, telegram_chat_id, token) from
-- authenticated/anon on public.agents, and deactivation_reason has since joined
-- them. Three manager-internal columns were still readable by every logged-in
-- agent, and one monitoring view still published regulatory NPNs unauthenticated.
--
-- Columns: evaluation_result, potential_rating, next_action_text. These are the
-- recruiter's private read on a candidate — a hire's evaluation verdict, their
-- 1-5 potential score, the internal next-action note. VERIFIED zero client
-- base-reads: the only .select() that names them is DashboardCRM.tsx:1115, which
-- reads the staff-gated v_agents_full view, NOT the base table. Revoking from
-- base breaks nothing; staff keep reading via the owner-privileged view (which
-- exposes 91 cols WHERE is_agency_staff() OR own-row). Left GRANTED on purpose:
-- notes and crm_setup_link, which DO have live agent-facing base reads.
--
-- View: public.v_agent_license_alert_health is postgres-owned, UNGATED (no WHERE),
-- granted SELECT to authenticated, and OUTPUTS a.nipr_number (regulatory NPN) +
-- agent_name for every agent in agent_license_alerts. Owner-privilege means any
-- authenticated agent could hit /rest/v1/v_agent_license_alert_health and
-- enumerate NPNs. VERIFIED zero client reads (apex-doctor/service_role monitoring
-- only). service_role retains access; nothing agent-facing changes.
--
-- Restore path if ever needed:
--   grant select (evaluation_result, potential_rating, next_action_text) on public.agents to authenticated, anon;
--   grant select on public.v_agent_license_alert_health to authenticated;

revoke select (evaluation_result, potential_rating, next_action_text)
  on public.agents from authenticated, anon;

revoke select on public.v_agent_license_alert_health from authenticated, anon;
