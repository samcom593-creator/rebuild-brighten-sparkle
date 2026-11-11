-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 11 of 11: one guard row for apex-doctor drop-in #55.
--
-- WHAT
--   v_hire_activation_health: ONE row in every state (scalar subqueries only, so it cannot go blank-green):
--     starter packs   switch + since when, ready hires without a pack (now / for 2+ days), packs granted 7d,
--                     starter-pack emails sent / failed 7d
--     suspension      suspended people found in v_licensed_hire_clock, v_activation_seat_queue or
--                     v_numbers_reminder_audience (each must be 0; v_hire_launch_board is admin-scope only and is
--                     guarded by the same predicate)
--     contracting     licensed hires since the forward cutoff with no contracting_intakes row after 1 day;
--                     the pre-cutoff backlog since 10-09 as context; agents with a mark/deal and no contracted_at
--     dialer          dialer_status; invoice rows created since the 2026-11-10 cancellation
--     outbox          failed rows 24h, requested rows with no settle after 1h
--     crons           the four PKG2 jobs exist and are active
--   Read by ~/business-ops/scripts/apex-doctor.d/55-hire-activation.sh through bot-sql. Service role only.

create or replace view public.v_hire_activation_health with (security_barrier = true) as
select
  coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'onboarding_starter_pack_enabled'))), 'false') = 'true'
    as starter_pack_enabled,
  (select s.updated_at from public.system_settings s
    where s.key = 'onboarding_starter_pack_enabled' and lower(btrim(s.value)) = 'true') as starter_pack_enabled_since,
  (select count(*)::int from public.fn_starter_pack_candidates() k where k.eligible) as starter_ready_no_pack,
  (select count(*)::int from public.fn_starter_pack_candidates() k
    where k.eligible
      and greatest(k.hired_at,
                   coalesce((select s.updated_at from public.system_settings s
                              where s.key = 'onboarding_starter_pack_enabled' and lower(btrim(s.value)) = 'true'), 'infinity'::timestamptz))
          <= now() - interval '2 days') as starter_ready_no_pack_2d,
  (select string_agg(k.first_name || ' ' || left(k.agent_id::text, 8), ', ' order by k.hired_at)
     from public.fn_starter_pack_candidates() k where k.eligible) as starter_ready_names,
  (select string_agg(k.first_name || ' ' || left(k.agent_id::text, 8), ', ' order by k.hired_at)
     from public.fn_starter_pack_candidates() k
    where k.eligible
      and greatest(k.hired_at,
                   coalesce((select s.updated_at from public.system_settings s
                              where s.key = 'onboarding_starter_pack_enabled' and lower(btrim(s.value)) = 'true'), 'infinity'::timestamptz))
          <= now() - interval '2 days') as starter_ready_2d_names,
  (select count(*)::int from public.lead_bundles b
    where coalesce(b.criteria ->> 'starter_pack', '') = 'true' and b.created_at > now() - interval '7 days') as starter_packs_granted_7d,
  (select count(*)::int from public.hire_lane_email_outbox o
    where o.kind = 'starter_pack' and o.status = 'sent' and o.created_at > now() - interval '7 days') as starter_emails_sent_7d,
  (select count(*)::int from public.hire_lane_email_outbox o
    where o.kind = 'starter_pack' and o.status = 'failed' and o.created_at > now() - interval '7 days') as starter_emails_failed_7d,
  (select count(*)::int from public.v_licensed_hire_clock c where public.fn_agent_is_suspended(c.agent_id)) as suspended_in_hire_clock,
  (select count(*)::int from public.v_activation_seat_queue q where public.fn_agent_is_suspended(q.agent_id)) as suspended_in_seat_queue,
  (select count(*)::int from public.v_numbers_reminder_audience n where public.fn_agent_is_suspended(n.agent_id)) as suspended_in_numbers_audience,
  (select count(*)::int from public.v_numbers_reminder_audience) as numbers_audience,
  public.fn_contracting_request_cutoff() as contracting_cutoff,
  (select count(*)::int from public.fn_contracting_request_due(public.fn_contracting_request_cutoff()) d
    where greatest(d.hired_at, coalesce(d.licensed_at, d.hired_at)) < now() - interval '1 day') as licensed_hires_no_intake_1d,
  (select string_agg(d.first_name || ' ' || left(d.agent_id::text, 8), ', ' order by d.hired_at)
     from public.fn_contracting_request_due(public.fn_contracting_request_cutoff()) d
    where greatest(d.hired_at, coalesce(d.licensed_at, d.hired_at)) < now() - interval '1 day') as licensed_hires_no_intake_names,
  (select count(*)::int from public.fn_contracting_request_due('2026-10-09 00:00:00-07'::timestamptz, public.fn_contracting_request_cutoff())) as contracting_backlog_since_1009,
  (select count(*)::int from public.v_contracted_at_backfill_due) as contracted_at_backfill_due,
  coalesce((select lower(btrim(s.value)) from public.system_settings s where s.key = 'dialer_status'), 'unset') as dialer_status,
  (select count(*)::int from public.dialer_weekly_payments p where p.created_at > '2026-11-10 09:25:00+00'::timestamptz) as dialer_invoices_since_cancel,
  (select count(*)::int from public.hire_lane_email_outbox o where o.status = 'failed' and o.created_at > now() - interval '24 hours') as outbox_failed_24h,
  (select count(*)::int from public.hire_lane_email_outbox o where o.status = 'requested' and o.requested_at < now() - interval '1 hour') as outbox_unsettled_1h,
  (select count(*)::int from cron.job j where j.active and j.jobname in
     ('apex-hire-lane-email', 'apex-starter-pack-daily', 'apex-contracting-request-sweep', 'apex-new-hire-flow-retry')) as pkg2_crons_active,
  now() as measured_at;

revoke all on public.v_hire_activation_health from public, anon, authenticated;
grant select on public.v_hire_activation_health to service_role;

comment on view public.v_hire_activation_health is
  'PKG2: one guard row for apex-doctor #55 (starter packs, suspension leaks into hire lists and the numbers reminder, contracting requests, dialer invoices, PKG2 outbox and crons). Scalar subqueries only: one row in every state. Service role only.';
