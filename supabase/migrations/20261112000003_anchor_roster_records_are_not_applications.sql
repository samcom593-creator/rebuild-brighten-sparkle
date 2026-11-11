-- MP-ONBOARD-ANCHOR (2026-11-12) FIX: an Xcel roster record is not an application.
--
-- WHAT WENT WRONG: PKG3 (20261112000391) created applications rows for 8 Xcel course students who
-- matched no application, so each would have an owner. Their notes say "excluded from the funnel
-- views by source", but nothing excluded them: v_applications_real (the canonical "real
-- applications" view) filtered only record_type = 'application', which those rows carry. So all
-- 22 of its readers counted 8 course students as fresh applicants, including the public homepage
-- ticker (landing_recent_applicants), which listed them by first name and state as having applied
-- "0 hours ago" on 2026-11-11. None of them applied through the site, and none gave email consent.
--
-- FIX: v_applications_real also excludes rows tagged 'xcel_roster' (fn_course_lane_create_xcel_roster_records
-- writes tags {xcel_roster,pkg3} on every record it creates, now and later). Same column list, same
-- options (security_invoker = false, as before), and CREATE OR REPLACE keeps the grants. Every reader
-- of the view (public ticker + counters, daily briefing, dashboard summary, conversion funnel, funnel
-- by source, recruiter leaderboard, inbox and queue views) now excludes them.
--
-- WHY THE TAG AND NOT source = 'xcel_roster': three older rows (Marcus, Kenneth, Meja; created
-- 2026-08-29, tags {}) share that source. They have been in the pipeline for 2.5 months and one is in
-- contracting. Filtering on source pulled them out too (applications_total fell by 11, not 8, on the
-- first apply), rewriting history and dropping them from owners' queues. The tag scopes the fix to the
-- rows this build created. Measured after: applications_30d 41 -> 33, applications_total 864 -> 856.
--
-- WHY NOT record_type: fn_course_lane_block_reason refuses the course lane for any row whose
-- record_type is not 'application', so re-typing these rows would switch off the very lane they
-- were created for (Kaleb/Leslie/Michael's day-3 check-in, Clyde's exam message at 100%). The
-- course lane, owner tasks and next-step ladder read public.applications directly and are untouched.
--
-- ROLLBACK: re-create the view with the original WHERE (record_type = 'application'::text only).
-- Pre-image: business-ops/2026-11-11-onboarding-anchor/receipts/preimage-v_applications_real.sql

create or replace view public.v_applications_real with (security_invoker = false) as
 SELECT id,
    first_name,
    last_name,
    email,
    phone,
    city,
    state,
    license_status,
    licensed_states,
    nipr_number,
    has_insurance_experience,
    years_experience,
    previous_company,
    previous_production,
    desired_income,
    availability,
    start_date,
    referral_source,
    resume_url,
    license_doc_url,
    status,
    notes,
    reviewed_by,
    reviewed_at,
    created_at,
    updated_at,
    assigned_agent_id,
    instagram_handle,
    contacted_at,
    qualified_at,
    closed_at,
    started_training,
    terminated_at,
    termination_reason,
    followup_sent_at,
    followup_licensed_sent_at,
    followup_unlicensed_2_sent_at,
    manual_followup_sent_at,
    license_progress,
    contracted_at,
    sms_consent_given,
    sms_consent_text,
    email_consent_given,
    email_consent_text,
    consent_timestamp_utc,
    consent_source_url,
    consent_ip_address,
    consent_user_agent,
    consent_form_version,
    test_scheduled_date,
    last_contacted_at,
    lead_score,
    next_action_at,
    next_action_type,
    carrier,
    ai_score_tier,
    referral_manager_id,
    referral_source_detail,
    course_purchased_at,
    exam_scheduled_at,
    exam_passed_at,
    fingerprints_submitted_at,
    license_approved_at,
    is_duplicate,
    duplicate_of,
    first_contact_attempt_at,
    last_response_at,
    is_ghosted,
    course_started_at,
    licensed_at,
    first_deal_at,
    winback_sent_at,
    fingerprint_date,
    fingerprint_done,
    recruiter_id,
    hiring_manager_user_id,
    hiring_scope_at_intake,
    is_transfer,
    last_automated_email_at,
    source,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    landing_url,
    referrer_agent_id,
    ica_paid,
    ica_paid_at,
    ica_amount_cents,
    stripe_customer_id,
    stripe_checkout_session_id,
    seminar_date,
    seminar_registered_at,
    seminar_attended_at,
    next_action,
    next_action_due_at,
    tags,
    vsl_watched_at,
    vsl_watch_percent,
    telegram_chat_id,
    telegram_opt_out,
    next_step_stage_key,
    next_step_due_at,
    seminar_invited_at,
    seminar_slot_at,
    seminar_zoom_link,
    seminar_ics_uid,
    qualified_role,
    previous_team_size,
    manager_track_flagged_at,
    referral_recruiter_id,
    assigned_va_id,
    assigned_va_at,
    next_touch_by,
    phone_bad_at,
    phone_bad_reason,
    couldnt_reach_email_sent_at,
    nipr_verified,
    nipr_verified_at,
    nipr_data,
    gclid,
    gbraid,
    wbraid,
    fbclid,
    ttclid,
    msclkid,
    first_touch_at,
    first_landing_url,
    first_referrer,
    attribution_json,
    record_type
   FROM public.applications
  WHERE record_type = 'application'::text
    AND NOT COALESCE(tags @> ARRAY['xcel_roster'::text], false);
