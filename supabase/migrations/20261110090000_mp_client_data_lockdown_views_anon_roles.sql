alter view public.v_client_error_summary       set (security_invoker = true);
alter view public.v_business_analytics_carriers set (security_invoker = true);
alter view public.v_licensed_booking_mismatch  set (security_invoker = true);
alter view public.v_blacklisted_carrier_deals  set (security_invoker = true);
alter view public.agent_revenue_estimate       set (security_invoker = true);
alter view public.v_agentlink_book_freshness   set (security_invoker = true);
alter view public.v_leads_book_fallout         set (security_invoker = true);
alter view public.v_carrier_book_summary       set (security_invoker = true);
alter view public.v_carrier_book_recon         set (security_invoker = true);
alter view public.v_carrier_money_leak         set (security_invoker = true);
alter view public.v_carrier_reconciliation     set (security_invoker = true);
alter view public.v_carrier_premium_data_gap   set (security_invoker = true);
alter view public.v_agentlink_book_scoped      set (security_invoker = true);
alter view public.v_carrier_products           set (security_invoker = true);
alter view public.v_stale_submitted_by_carrier set (security_invoker = true);
alter view public.v_carrier_reroute_plan       set (security_invoker = true);
alter view public.v_carrier_dormancy_watch     set (security_invoker = true);
alter view public.v_book_status_tiles          set (security_invoker = true);
alter view public.v_book_of_business           set (security_invoker = true);
alter view public.v_client_pipeline_stats      set (security_invoker = true);
alter view public.v_book_premium_parity        set (security_invoker = true);
revoke all on public.agent_carrier_comp, public.agentlink_book, public.agentlink_book_of_business,
  public.apex_call_reminders, public.apex_carrier_contracts, public.apex_scheduled_calls,
  public.call_activity, public.call_recordings, public.call_scores, public.call_transcripts,
  public.carrier_policies, public.client_leads, public.client_leads_age_out,
  public.deal_attachments, public.deal_drafts, public.deal_status_history,
  public.deal_sync_log, public.deal_sync_queue, public.deals, public.insuracloud_payouts,
  public.readymode_call_analysis, public.readymode_call_transcripts, public.readymode_dialer_calls
from anon;
revoke all on public.v_agent_carrier_mix, public.v_agentlink_book_freshness, public.v_agentlink_book_truth,
  public.v_book_by_month, public.v_book_status_tiles, public.v_business_analytics_carriers,
  public.v_call_winners, public.v_carrier_book_recon, public.v_carrier_book_summary,
  public.v_carrier_money_leak, public.v_carrier_premium_data_gap, public.v_carrier_production,
  public.v_carrier_reconciliation, public.v_client_error_summary, public.v_deals_needing_real_policy,
  public.v_ghost_deals, public.v_my_carrier_contracts, public.v_recruiting_inbox_summary,
  public.v_stale_submitted_by_carrier, public.v_upcoming_calls, public.v_licensed_booking_mismatch,
  public.v_blacklisted_carrier_deals, public.agent_revenue_estimate, public.v_leads_book_fallout,
  public.v_agentlink_book_scoped, public.v_carrier_products, public.v_carrier_reroute_plan,
  public.v_carrier_dormancy_watch, public.v_book_of_business, public.v_client_pipeline_stats,
  public.v_book_premium_parity
from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.carriers, public.supported_carriers, public.qe_carriers from anon;
delete from public.user_roles
where role = 'manager'
  and user_id = (select id from auth.users where email = 'altolifefinancial@gmail.com');
delete from public.user_roles ur
where not exists (select 1 from auth.users u where u.id = ur.user_id);
select 'lockdown applied' as done;
