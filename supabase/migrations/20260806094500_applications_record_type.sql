-- 2026-08-06 — "interviews are not applications" (Sam's #1 complaint).
--
-- public.applications held 784 rows, 35 of which were never an application:
--   * 34 rows, source='calendly_licensed_call_backfill', all created 2026-08-01 by the
--     auto-license ship (commit 9e3d0836). Their own notes say it: "Never submitted the
--     apply form — identity from the Calendly booking". 33 of them join to
--     interview_events. Most carry synthesised emails (noname+<hex>@noname.com).
--     Because they all landed on 2026-08-01 they counted as AUGUST applications and
--     showed the month as 45 when the truth was 11.
--   * 1 row, source='codex_e2e', a test probe.
--
-- NOTHING IS DELETED. Those rows carry real interview data and are referenced by 35
-- foreign-key tables. They get a record_type instead, and the Sam-facing counts learn
-- to exclude them while the interview surfaces keep seeing them.
--
-- The 355 NULL-source rows were investigated and are LEGITIMATE web applications — the
-- `source` column simply stopped being stamped on 2026-05-13 (website rows run
-- 2026-01-23..2026-05-13, NULL-source rows run 2026-05-13..2026-08-05, unbroken, all
-- with real phones and no synthesised emails). They stay as applications.

-- 1) record_type discriminator on applications.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS record_type text NOT NULL DEFAULT 'application';

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_record_type_check;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_record_type_check
  CHECK (record_type IN ('application', 'interview_booking', 'test'));

COMMENT ON COLUMN public.applications.record_type IS
  'Discriminator. application = a human submitted the apply form (the only thing that counts as an application). interview_booking = row synthesised from a Calendly booking for someone who never applied. test = e2e/probe row. Application counts and funnels must filter record_type = ''application''.';

CREATE INDEX IF NOT EXISTS idx_applications_record_type
  ON public.applications (record_type)
  WHERE record_type <> 'application';
-- 2) Classify the non-application rows. NOTHING IS DELETED.
UPDATE public.applications
   SET record_type = 'interview_booking'
 WHERE source = 'calendly_licensed_call_backfill'
   AND record_type <> 'interview_booking';

UPDATE public.applications
   SET record_type = 'test'
 WHERE source = 'codex_e2e'
   AND record_type <> 'test';
-- 3) Canonical seam: the only relation that means "an application Sam should count".
CREATE OR REPLACE VIEW public.v_applications_real
-- security_invoker is deliberately FALSE. The 17 dashboards that consume this view are
-- definer-security; an invoker seam re-imposes RLS inside them and blanks every one of
-- them to 0 rows for an `authenticated` session. It is therefore also NOT granted to
-- anon/authenticated, so it never becomes a new RLS-bypass surface. Frontend code filters
-- the base table with .eq('record_type','application'), which keeps RLS fully intact.
WITH (security_invoker = false) AS
  SELECT * FROM public.applications WHERE record_type = 'application';

COMMENT ON VIEW public.v_applications_real IS
  'Canonical application set: public.applications minus interview-booking backfills and test rows. INTERNAL ONLY (definer-security, not granted to anon/authenticated) so the definer dashboards that read it keep their prior RLS posture. Frontend must filter the base table with record_type = ''application''.';

REVOKE ALL ON public.v_applications_real FROM anon, authenticated;
GRANT SELECT ON public.v_applications_real TO service_role;

-- 4) Guard: anything inserted from a Calendly/e2e source self-classifies, so a future
--    backfill cannot silently re-inflate the application count.
CREATE OR REPLACE FUNCTION public.fn_applications_derive_record_type()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Only act when the writer left the column at its default; an explicit
  -- record_type from the caller always wins.
  IF NEW.record_type IS DISTINCT FROM 'application' THEN
    RETURN NEW;
  END IF;

  IF NEW.source IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source ~* '^calendly' OR NEW.source ~* 'calendly.*backfill' THEN
    NEW.record_type := 'interview_booking';
  ELSIF NEW.source ~* '^codex_e2e' OR NEW.source ~* '(^|_)e2e(_|$)' THEN
    NEW.record_type := 'test';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_applications_derive_record_type ON public.applications;
CREATE TRIGGER trg_applications_derive_record_type
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.fn_applications_derive_record_type();

-- 5) Ratchet: any row whose source says "not an application" but whose record_type
--    still says "application" is a leak. apex-doctor / data-quality can assert 0 rows.
CREATE OR REPLACE VIEW public.v_applications_record_type_leak
WITH (security_invoker = false) AS
  SELECT id, source, record_type, created_at, email
    FROM public.applications
   WHERE record_type = 'application'
     AND source IS NOT NULL
     AND (source ~* 'calendly' OR source ~* '(^|_)e2e(_|$)');

COMMENT ON VIEW public.v_applications_record_type_leak IS
  'INVARIANT: must always be 0 rows. Non-zero means a Calendly/e2e row was written into applications without record_type being stamped, and application counts are re-inflating.';

REVOKE ALL ON public.v_applications_record_type_leak FROM anon, authenticated;
GRANT SELECT ON public.v_applications_record_type_leak TO service_role;

-- 6) Sam-facing views repointed at the seam. Aliases are preserved so the
--    fully-qualified view bodies keep resolving unchanged.
--    NOT repointed on purpose: v_interviews_unified, v_interview_pipeline,
--    v_interview_match_candidates, v_licensed_booking_mismatch,
--    v_queue_interviews_no_outcome (interview truth), plus
--    v_agent_duplicate_candidates, v_data_quality_dashboard,
--    v_bulk_backfilled_timestamps, v_sync_pipeline_health,
--    v_offboarding_preservation (audit surfaces) and the VA/recovery call
--    queues — all of those must keep seeing every row.

-- v_admin_applicant_overview
CREATE OR REPLACE VIEW public.v_admin_applicant_overview AS
SELECT a.id,
    a.created_at,
    a.first_name,
    a.last_name,
    a.email,
    a.phone,
    a.state,
    a.city,
    a.status::text AS status,
    a.license_status::text AS license_status,
    a.licensed_states,
    a.nipr_number,
    a.has_insurance_experience,
    a.years_experience,
    a.previous_company,
    a.desired_income,
    a.referral_source,
    a.source,
    a.utm_source,
    a.utm_medium,
    a.utm_campaign,
    a.seminar_date,
    a.seminar_registered_at,
    a.seminar_attended_at,
    a.ica_paid,
    a.ica_paid_at,
    a.ica_amount_cents,
    a.stripe_customer_id,
    a.assigned_agent_id,
    recruiter_p.email AS assigned_recruiter_email,
    recruiter_ag.agent_code AS assigned_recruiter_code,
    a.contacted_at,
    a.qualified_at,
    a.closed_at,
    a.notes,
    a.is_duplicate,
    a.duplicate_of,
    a.next_action,
    a.next_action_due_at,
    a.tags,
    becomes_agent.id AS became_agent_id,
    becomes_agent.agent_code AS became_agent_code,
    becomes_agent.total_premium AS agent_total_premium,
    becomes_agent.total_policies AS agent_total_policies,
    becomes_agent.total_earnings AS agent_total_earnings,
    ( SELECT ch.created_at
           FROM contact_history ch
          WHERE ch.application_id = a.id
          ORDER BY ch.created_at DESC
         LIMIT 1) AS last_contact_at,
    ( SELECT count(*)::integer AS count
           FROM contact_history ch
          WHERE ch.application_id = a.id) AS total_contacts,
    ( SELECT count(*)::integer AS count
           FROM inbox_messages im
          WHERE im.application_id = a.id) AS inbox_message_count,
    EXTRACT(day FROM now() - a.updated_at)::integer AS days_in_status
   FROM v_applications_real a
     LEFT JOIN agents recruiter_ag ON recruiter_ag.id = (( SELECT m.canonical_agent_id
           FROM v_agent_canonical_map m
          WHERE m.agent_id = a.assigned_agent_id))
     LEFT JOIN profiles recruiter_p ON recruiter_p.id = recruiter_ag.profile_id
     LEFT JOIN agents becomes_agent ON becomes_agent.id = (( SELECT m.canonical_agent_id
           FROM v_agent_canonical_map m
          WHERE m.agent_id = (( SELECT ag2.id
                   FROM agents ag2
                     JOIN profiles p2 ON p2.id = ag2.profile_id
                  WHERE lower(p2.email) = lower(a.email)
                 LIMIT 1))));

-- v_agent_command_center
CREATE OR REPLACE VIEW public.v_agent_command_center AS
WITH dp AS (
         SELECT COALESCE(cm.canonical_agent_id, a_1.id) AS agent_id,
            sum(
                CASE
                    WHEN d.posted_at::date = (now() AT TIME ZONE 'America/Phoenix'::text)::date THEN 1
                    ELSE 0
                END)::integer AS deals_today,
            sum(
                CASE
                    WHEN d.posted_at >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone) THEN 1
                    ELSE 0
                END)::integer AS deals_wtd,
            sum(
                CASE
                    WHEN d.posted_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone) THEN 1
                    ELSE 0
                END)::integer AS deals_mtd,
            sum(
                CASE
                    WHEN d.posted_at >= (now() - '30 days'::interval) THEN 1
                    ELSE 0
                END)::integer AS deals_30d,
            sum(
                CASE
                    WHEN d.posted_at >= (now() - '60 days'::interval) AND d.posted_at < (now() - '30 days'::interval) THEN 1
                    ELSE 0
                END)::integer AS deals_30_60d,
            COALESCE(sum(d.annual_premium) FILTER (WHERE d.posted_at >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)), 0::numeric) AS ap_wtd,
            COALESCE(sum(d.annual_premium) FILTER (WHERE d.posted_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)), 0::numeric) AS ap_mtd,
            COALESCE(sum(d.annual_premium) FILTER (WHERE d.posted_at >= (now() - '30 days'::interval)), 0::numeric) AS ap_30d,
            COALESCE(sum(d.annual_premium) FILTER (WHERE d.posted_at >= (now() - '60 days'::interval) AND d.posted_at < (now() - '30 days'::interval)), 0::numeric) AS ap_30_60d,
            COALESCE(sum(d.commission_cents), 0::bigint)::integer AS commission_lifetime_cents,
            sum(
                CASE
                    WHEN d.chargeback_status = ANY (ARRAY['chargeback'::text, 'charged_back'::text]) THEN 1
                    ELSE 0
                END)::integer AS chargebacks,
            sum(
                CASE
                    WHEN d.status = 'lapsed'::text THEN 1
                    ELSE 0
                END)::integer AS lapses
           FROM agents a_1
             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = a_1.id
             LEFT JOIN deals d ON d.agent_id = a_1.id
          GROUP BY (COALESCE(cm.canonical_agent_id, a_1.id))
        ), prod AS (
         SELECT COALESCE(cm.canonical_agent_id, dpr.agent_id) AS agent_id,
            sum(
                CASE
                    WHEN dpr.production_date = (now() AT TIME ZONE 'America/Phoenix'::text)::date THEN dpr.presentations
                    ELSE 0
                END)::integer AS pres_today,
            sum(
                CASE
                    WHEN dpr.production_date >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.presentations
                    ELSE 0
                END)::integer AS pres_wtd,
            sum(
                CASE
                    WHEN dpr.production_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.presentations
                    ELSE 0
                END)::integer AS pres_mtd,
            sum(
                CASE
                    WHEN dpr.production_date = (now() AT TIME ZONE 'America/Phoenix'::text)::date THEN dpr.hours_called
                    ELSE 0::numeric
                END) AS hours_today,
            sum(
                CASE
                    WHEN dpr.production_date >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.hours_called
                    ELSE 0::numeric
                END) AS hours_wtd,
            sum(
                CASE
                    WHEN dpr.production_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.hours_called
                    ELSE 0::numeric
                END) AS hours_mtd,
            max(dpr.production_date) AS last_production_date,
            sum(
                CASE
                    WHEN dpr.production_date >= (CURRENT_DATE - '14 days'::interval) THEN dpr.deals_closed
                    ELSE 0
                END)::integer AS deals_closed_14d
           FROM daily_production dpr
             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = dpr.agent_id
          GROUP BY (COALESCE(cm.canonical_agent_id, dpr.agent_id))
        ), apps AS (
         SELECT COALESCE(cm.canonical_agent_id, applications.assigned_agent_id) AS agent_id,
            count(*)::integer AS apps_assigned,
            count(*) FILTER (WHERE (applications.status <> ALL (ARRAY['approved'::application_status, 'rejected'::application_status])) AND applications.terminated_at IS NULL)::integer AS apps_open,
            count(*) FILTER (WHERE applications.created_at >= (now() - '7 days'::interval))::integer AS apps_new_7d,
            count(*) FILTER (WHERE applications.last_contacted_at IS NULL OR applications.last_contacted_at < (now() - '24:00:00'::interval))::integer AS apps_needing_contact
           FROM v_applications_real applications
             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = applications.assigned_agent_id
          WHERE applications.assigned_agent_id IS NOT NULL
          GROUP BY (COALESCE(cm.canonical_agent_id, applications.assigned_agent_id))
        ), ranks AS (
         SELECT dp_1.agent_id,
            rank() OVER (ORDER BY dp_1.ap_mtd DESC NULLS LAST)::integer AS rank_agency_mtd,
            rank() OVER (ORDER BY dp_1.ap_wtd DESC NULLS LAST)::integer AS rank_agency_wtd
           FROM dp dp_1
        ), team_ranks AS (
         SELECT a_1.id AS agent_id,
            a_1.manager_id,
            rank() OVER (PARTITION BY a_1.manager_id ORDER BY (COALESCE(dp_1.ap_mtd, 0::numeric)) DESC)::integer AS rank_team_mtd
           FROM agents a_1
             LEFT JOIN dp dp_1 ON dp_1.agent_id = a_1.id
          WHERE a_1.canonical_agent_id IS NULL
        )
 SELECT a.id AS agent_id,
    a.user_id,
    a.agent_code,
    a.display_name,
    p.full_name,
    p.email,
    a.status::text AS agent_status,
    a.onboarding_stage::text AS onboarding_stage,
    a.license_status::text AS license_status,
    a.manager_id,
    mgr.display_name AS manager_name,
    a.is_presenting,
    COALESCE(dp.deals_today, 0) AS deals_today,
    COALESCE(dp.deals_wtd, 0) AS deals_wtd,
    COALESCE(dp.deals_mtd, 0) AS deals_mtd,
    COALESCE(dp.deals_30d, 0) AS deals_30d,
    COALESCE(dp.ap_wtd, 0::numeric) AS ap_wtd,
    COALESCE(dp.ap_mtd, 0::numeric) AS ap_mtd,
    COALESCE(dp.ap_30d, 0::numeric) AS ap_30d,
    COALESCE(dp.commission_lifetime_cents, 0) AS commission_lifetime_cents,
    COALESCE(dp.chargebacks, 0) AS chargebacks,
    COALESCE(dp.lapses, 0) AS lapses,
    COALESCE(prod.pres_today, 0) AS presentations_today,
    COALESCE(prod.pres_wtd, 0) AS presentations_wtd,
    COALESCE(prod.pres_mtd, 0) AS presentations_mtd,
    COALESCE(prod.hours_today, 0::numeric) AS hours_called_today,
    COALESCE(prod.hours_wtd, 0::numeric) AS hours_called_wtd,
    COALESCE(prod.hours_mtd, 0::numeric) AS hours_called_mtd,
    prod.last_production_date,
    COALESCE(apps.apps_assigned, 0) AS apps_assigned,
    COALESCE(apps.apps_open, 0) AS apps_open,
    COALESCE(apps.apps_new_7d, 0) AS apps_new_7d,
    COALESCE(apps.apps_needing_contact, 0) AS apps_needing_contact,
        CASE
            WHEN COALESCE(prod.pres_mtd, 0) > 0 THEN round(COALESCE(dp.deals_mtd, 0)::numeric / prod.pres_mtd::numeric * 100::numeric, 1)
            ELSE NULL::numeric
        END AS close_rate_mtd_pct,
        CASE
            WHEN COALESCE(dp.ap_30_60d, 0::numeric) > 0::numeric THEN round((COALESCE(dp.ap_30d, 0::numeric) - dp.ap_30_60d) / dp.ap_30_60d * 100::numeric, 1)
            ELSE NULL::numeric
        END AS ap_trend_pct,
    ranks.rank_agency_mtd,
    ranks.rank_agency_wtd,
    team_ranks.rank_team_mtd,
        CASE
            WHEN prod.last_production_date IS NULL THEN 'never_dialed'::text
            WHEN prod.last_production_date = CURRENT_DATE THEN 'active_today'::text
            WHEN prod.last_production_date >= (CURRENT_DATE - '2 days'::interval) THEN 'active_recent'::text
            WHEN prod.last_production_date >= (CURRENT_DATE - '7 days'::interval) THEN 'slipping'::text
            ELSE 'inactive_warning'::text
        END AS activity_state,
        CASE
            WHEN a.onboarding_stage = 'pre_licensed'::onboarding_stage THEN 'Complete licensing course'::text
            WHEN COALESCE(apps.apps_needing_contact, 0) > 0 THEN ('Contact '::text || apps.apps_needing_contact) || ' applicants'::text
            WHEN COALESCE(prod.pres_today, 0) = 0 AND a.status = 'active'::agent_status THEN 'Get on the phones'::text
            ELSE 'On track'::text
        END AS next_action
   FROM agents a
     LEFT JOIN profiles p ON p.id = a.profile_id
     LEFT JOIN agents mgr ON mgr.id = a.manager_id
     LEFT JOIN dp ON dp.agent_id = a.id
     LEFT JOIN prod ON prod.agent_id = a.id
     LEFT JOIN apps ON apps.agent_id = a.id
     LEFT JOIN ranks ON ranks.agent_id = a.id
     LEFT JOIN team_ranks ON team_ranks.agent_id = a.id
  WHERE a.is_deactivated IS NOT TRUE AND a.canonical_agent_id IS NULL;

-- v_application_conversion_funnel
CREATE OR REPLACE VIEW public.v_application_conversion_funnel AS
SELECT count(*) AS total,
    count(*) FILTER (WHERE status::text = 'new'::text) AS new_count,
    count(*) FILTER (WHERE contacted_at IS NOT NULL) AS contacted_count,
    count(*) FILTER (WHERE ica_paid_at IS NOT NULL) AS paid_count,
    count(*) FILTER (WHERE qualified_at IS NOT NULL) AS qualified_count,
    count(*) FILTER (WHERE status::text = ANY (ARRAY['approved'::text, 'attended'::text, 'producing'::text])) AS approved_count,
    count(*) FILTER (WHERE status::text = ANY (ARRAY['rejected'::text, 'disqualified'::text])) AS rejected_count,
    count(*) FILTER (WHERE created_at > (now() - '7 days'::interval)) AS last_7d,
    count(*) FILTER (WHERE created_at > (now() - '30 days'::interval)) AS last_30d,
        CASE
            WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE ica_paid_at IS NOT NULL)::numeric / count(*)::numeric, 1)
            ELSE 0::numeric
        END AS pct_paid_of_total,
        CASE
            WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE status::text = ANY (ARRAY['approved'::text, 'attended'::text, 'producing'::text]))::numeric / count(*)::numeric, 1)
            ELSE 0::numeric
        END AS pct_approved_of_total
   FROM v_applications_real applications;

-- v_builder_operating_dashboard
CREATE OR REPLACE VIEW public.v_builder_operating_dashboard AS
WITH RECURSIVE live_agents AS (
         SELECT agents.id,
            agents.user_id,
            agents.profile_id,
            agents.manager_id,
            agents.agent_code,
            agents.license_status,
            agents.license_states,
            agents.nipr_number,
            agents.status,
            agents.start_date,
            agents.total_policies,
            agents.total_premium,
            agents.total_earnings,
            agents.created_at,
            agents.updated_at,
            agents.verified_at,
            agents.verified_by,
            agents.invited_by_manager_id,
            agents.attendance_status,
            agents.performance_tier,
            agents.field_training_started_at,
            agents.has_training_course,
            agents.has_dialer_login,
            agents.has_discord_access,
            agents.potential_rating,
            agents.evaluation_result,
            agents.evaluated_at,
            agents.evaluated_by,
            agents.is_deactivated,
            agents.crm_setup_link,
            agents.weekly_10k_badges,
            agents.deactivation_reason,
            agents.switched_to_manager_id,
            agents.sort_order,
            agents.portal_password_set,
            agents.is_inactive,
            agents.password_required,
            agents.display_name,
            agents.has_production_access,
            agents.production_unlocked_at,
            agents.max_recruits,
            agents.ref_slug,
            agents.insuracloud_api_token,
            agents.onboarding_stage,
            agents.contract_percentage,
            agents.override_rate,
            agents.insuracloud_user_id,
            agents.is_presenting,
            agents.stage_changed_at,
            agents.contracted_at,
            agents.metadata,
            agents.onboarding_completed_at,
            agents.first_appointment_at,
            agents.first_appointment_set_by,
            agents.first_deal_at,
            agents.first_10k_at,
            agents.telegram_chat_id,
            agents.telegram_opt_out,
            agents.next_step_stage_key,
            agents.next_step_due_at,
            agents.canonical_agent_id,
            agents.builder_track,
            agents.agency_owner_qualified_at
           FROM agents
          WHERE COALESCE(agents.is_deactivated, false) = false AND agents.canonical_agent_id IS NULL
        ), hierarchy AS (
         SELECT a.id AS root_agent_id,
            a.id AS agent_id,
            0 AS depth,
            ARRAY[a.id] AS path
           FROM live_agents a
        UNION ALL
         SELECT h.root_agent_id,
            child.id AS agent_id,
            h.depth + 1 AS depth,
            h.path || child.id AS path
           FROM hierarchy h
             JOIN live_agents child ON child.invited_by_manager_id = h.agent_id OR child.manager_id = h.agent_id
          WHERE (child.id <> ALL (h.path)) AND h.depth < 8
        ), agent_rollup AS (
         SELECT h.root_agent_id,
            count(*) FILTER (WHERE h.depth = 1)::integer AS direct_agent_count,
            count(*) FILTER (WHERE h.depth > 0)::integer AS total_downline_count,
            count(*) FILTER (WHERE h.depth > 0 AND child.status = 'active'::agent_status AND COALESCE(child.is_inactive, false) = false)::integer AS active_agent_count,
            count(*) FILTER (WHERE h.depth > 0 AND child.license_status = 'licensed'::license_status)::integer AS licensed_agent_count,
            count(*) FILTER (WHERE h.depth > 0 AND child.license_status <> 'licensed'::license_status)::integer AS unlicensed_agent_count,
            count(*) FILTER (WHERE h.depth > 0 AND child.created_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone))::integer AS hires_this_month,
            max(child.updated_at) FILTER (WHERE h.depth > 0) AS last_agent_activity_at
           FROM ( SELECT hierarchy.root_agent_id,
                    hierarchy.agent_id,
                    min(hierarchy.depth) AS depth
                   FROM hierarchy
                  GROUP BY hierarchy.root_agent_id, hierarchy.agent_id) h
             LEFT JOIN live_agents child ON child.id = h.agent_id
          GROUP BY h.root_agent_id
        ), application_links AS (
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM hierarchy h
             JOIN v_agent_canonical_map m ON m.canonical_agent_id = h.agent_id
             JOIN v_applications_real app ON app.referrer_agent_id = m.agent_id
          WHERE COALESCE(app.is_duplicate, false) = false
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM hierarchy h
             JOIN v_agent_canonical_map m ON m.canonical_agent_id = h.agent_id
             JOIN v_applications_real app ON app.referral_manager_id = m.agent_id
          WHERE COALESCE(app.is_duplicate, false) = false
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM hierarchy h
             JOIN v_agent_canonical_map m ON m.canonical_agent_id = h.agent_id
             JOIN v_applications_real app ON app.recruiter_id = m.agent_id
          WHERE COALESCE(app.is_duplicate, false) = false
        UNION
         SELECT DISTINCT h.root_agent_id,
            app.id AS application_id
           FROM hierarchy h
             JOIN v_agent_canonical_map m ON m.canonical_agent_id = h.agent_id
             JOIN v_applications_real app ON app.assigned_agent_id = m.agent_id
          WHERE COALESCE(app.is_duplicate, false) = false
        ), application_rollup AS (
         SELECT al.root_agent_id,
            count(DISTINCT app.id)::integer AS applicant_count,
            count(DISTINCT app.id) FILTER (WHERE app.license_status = 'licensed'::license_status OR app.license_progress = 'licensed'::license_progress OR app.licensed_at IS NOT NULL OR app.license_approved_at IS NOT NULL)::integer AS licensed_recruits,
            count(DISTINCT app.id) FILTER (WHERE (app.status::text <> ALL (ARRAY['rejected'::text, 'disqualified'::text, 'lapsed'::text])) AND NOT (app.license_status = 'licensed'::license_status OR app.license_progress = 'licensed'::license_progress OR app.licensed_at IS NOT NULL OR app.license_approved_at IS NOT NULL))::integer AS unlicensed_recruits,
            count(DISTINCT app.id) FILTER (WHERE app.license_progress = ANY (ARRAY['finished_course'::license_progress, 'test_scheduled'::license_progress, 'passed_test'::license_progress, 'exam_passed'::license_progress, 'fingerprints_done'::license_progress, 'waiting_fingerprints'::license_progress, 'waiting_on_license'::license_progress, 'licensed'::license_progress, 'in_field_training'::license_progress]))::integer AS coursework_completed_count,
            count(DISTINCT app.id) FILTER (WHERE (app.status::text = ANY (ARRAY['paid'::text, 'onboarding'::text, 'producing'::text])) OR COALESCE(app.ica_paid, false) = true OR app.ica_paid_at IS NOT NULL OR app.contracted_at IS NOT NULL OR app.first_deal_at IS NOT NULL)::integer AS activation_count,
            count(DISTINCT app.id) FILTER (WHERE (app.status::text <> ALL (ARRAY['rejected'::text, 'disqualified'::text, 'lapsed'::text])) AND (COALESCE(app.is_ghosted, false) = true OR app.next_action_due_at < now() OR app.next_step_due_at < now() OR app.license_status = 'unlicensed'::license_status AND app.created_at < (now() - '7 days'::interval) AND app.course_purchased_at IS NULL AND app.course_started_at IS NULL OR (app.license_progress = ANY (ARRAY['unlicensed'::license_progress, 'course_purchased'::license_progress])) AND app.updated_at < (now() - '10 days'::interval)))::integer AS stuck_applicants,
            count(DISTINCT app.id) FILTER (WHERE app.created_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone))::integer AS applicants_this_month,
            max(app.updated_at) AS last_application_activity_at
           FROM application_links al
             JOIN v_applications_real app ON app.id = al.application_id
          GROUP BY al.root_agent_id
        ), personal_referral_rollup AS (
         SELECT a.id AS root_agent_id,
            count(DISTINCT app.id)::integer AS applicants_from_referral_link,
            count(DISTINCT app.id) FILTER (WHERE app.license_status = 'licensed'::license_status OR app.license_progress = 'licensed'::license_progress OR app.licensed_at IS NOT NULL OR app.license_approved_at IS NOT NULL)::integer AS licensed_from_referral_link,
            count(DISTINCT app.id) FILTER (WHERE (app.status::text = ANY (ARRAY['paid'::text, 'onboarding'::text, 'producing'::text])) OR COALESCE(app.ica_paid, false) = true OR app.ica_paid_at IS NOT NULL OR app.contracted_at IS NOT NULL OR app.first_deal_at IS NOT NULL)::integer AS activated_from_referral_link
           FROM live_agents a
             LEFT JOIN v_agent_canonical_map m ON m.canonical_agent_id = a.id
             LEFT JOIN v_applications_real app ON (app.referrer_agent_id = m.agent_id OR app.referral_manager_id = m.agent_id OR app.recruiter_id = m.agent_id) AND COALESCE(app.is_duplicate, false) = false
          GROUP BY a.id
        ), production_rollup AS (
         SELECT h.root_agent_id,
            count(dp.id) FILTER (WHERE dp.production_date >= (now() - '30 days'::interval)::date)::integer AS current_production_rows,
            COALESCE(sum(dp.aop) FILTER (WHERE dp.production_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date AND dp.production_date < (date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone) + '1 mon'::interval)::date), 0::numeric) AS current_month_aop,
            COALESCE(sum(dp.aop) FILTER (WHERE dp.production_date >= (date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone) - '1 mon'::interval)::date AND dp.production_date < date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date), 0::numeric) AS previous_month_aop,
            max(dp.production_date) AS last_production_date
           FROM ( SELECT DISTINCT hierarchy.root_agent_id,
                    hierarchy.agent_id
                   FROM hierarchy) h
             LEFT JOIN v_agent_canonical_map mdp ON mdp.canonical_agent_id = h.agent_id
             LEFT JOIN daily_production dp ON dp.agent_id = mdp.agent_id
          GROUP BY h.root_agent_id
        ), scored AS (
         SELECT a.id AS agent_id,
            COALESCE(p.full_name, a.display_name, p.email, 'Unknown'::text) AS builder_name,
            p.email,
            p.phone,
            p.state,
            a.user_id,
            a.profile_id,
            a.manager_id,
            COALESCE(a.invited_by_manager_id, a.manager_id) AS upline_id,
            a.invited_by_manager_id,
            a.builder_track,
            a.agency_owner_qualified_at,
            a.ref_slug,
            a.license_status,
            a.status,
            a.onboarding_stage,
            a.created_at,
            a.updated_at,
            COALESCE(ar.direct_agent_count, 0) AS direct_agent_count,
            COALESCE(ar.total_downline_count, 0) AS total_downline_count,
            COALESCE(ar.active_agent_count, 0) AS active_agent_count,
            COALESCE(ar.licensed_agent_count, 0) AS licensed_agent_count,
            COALESCE(ar.unlicensed_agent_count, 0) AS unlicensed_agent_count,
            COALESCE(ar.hires_this_month, 0) AS hires_this_month,
            COALESCE(ap.applicant_count, 0) AS applicant_count,
            COALESCE(ap.licensed_recruits, 0) AS licensed_recruits,
            COALESCE(ap.unlicensed_recruits, 0) AS unlicensed_recruits,
            COALESCE(ap.coursework_completed_count, 0) AS coursework_completed_count,
            COALESCE(ap.activation_count, 0) AS activation_count,
            COALESCE(ap.stuck_applicants, 0) AS stuck_applicants,
            COALESCE(ap.applicants_this_month, 0) AS applicants_this_month,
            COALESCE(pr.applicants_from_referral_link, 0) AS applicants_from_referral_link,
            COALESCE(pr.licensed_from_referral_link, 0) AS licensed_from_referral_link,
            COALESCE(pr.activated_from_referral_link, 0) AS activated_from_referral_link,
                CASE
                    WHEN pr.applicants_from_referral_link > 0 THEN round(pr.activated_from_referral_link::numeric / pr.applicants_from_referral_link::numeric * 100::numeric, 1)
                    ELSE NULL::numeric
                END AS referral_conversion_rate,
                CASE
                    WHEN ap.applicant_count > 0 THEN round(ap.coursework_completed_count::numeric / ap.applicant_count::numeric * 100::numeric, 1)
                    ELSE NULL::numeric
                END AS coursework_completion_rate,
                CASE
                    WHEN ap.applicant_count > 0 THEN round(ap.activation_count::numeric / ap.applicant_count::numeric * 100::numeric, 1)
                    ELSE NULL::numeric
                END AS activation_rate,
                CASE
                    WHEN prod.current_production_rows > 0 THEN prod.current_month_aop
                    ELSE NULL::numeric
                END AS monthly_production,
            prod.current_production_rows > 0 AS monthly_production_available,
                CASE
                    WHEN prod.current_production_rows > 0 AND prod.previous_month_aop > 0::numeric THEN round((prod.current_month_aop - prod.previous_month_aop) / prod.previous_month_aop * 100::numeric, 1)
                    ELSE NULL::numeric
                END AS growth_rate,
            prod.last_production_date,
            NULLIF(GREATEST(COALESCE(a.updated_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE(ar.last_agent_activity_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE(ap.last_application_activity_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE(prod.last_production_date::timestamp with time zone, '1970-01-01 00:00:00+00'::timestamp with time zone)), '1970-01-01 00:00:00+00'::timestamp with time zone) AS last_activity_at,
            COALESCE(a.ref_slug, a.id::text) AS referral_code,
            'https://apex-financial.org/apply?ref='::text || COALESCE(a.ref_slug, a.id::text) AS referral_link,
            ('https://apex-financial.org/apply?ref='::text || COALESCE(a.ref_slug, a.id::text)) || '&utm_source=builder_referral&utm_medium=link&utm_campaign=recruiting'::text AS application_link,
            COALESCE(ar.active_agent_count, 0) >= 10 AND COALESCE(ar.total_downline_count, 0) >= 10 AS qualifies_agency_owner
           FROM live_agents a
             LEFT JOIN profiles p ON p.id = a.profile_id
             LEFT JOIN agent_rollup ar ON ar.root_agent_id = a.id
             LEFT JOIN application_rollup ap ON ap.root_agent_id = a.id
             LEFT JOIN personal_referral_rollup pr ON pr.root_agent_id = a.id
             LEFT JOIN production_rollup prod ON prod.root_agent_id = a.id
        )
 SELECT agent_id,
    builder_name,
    email,
    phone,
    state,
    user_id,
    profile_id,
    manager_id,
    upline_id,
    invited_by_manager_id,
    builder_track,
    agency_owner_qualified_at,
    ref_slug,
    license_status,
    status,
    onboarding_stage,
    created_at,
    updated_at,
    direct_agent_count,
    total_downline_count,
    active_agent_count,
    licensed_agent_count,
    unlicensed_agent_count,
    hires_this_month,
    applicant_count,
    licensed_recruits,
    unlicensed_recruits,
    coursework_completed_count,
    activation_count,
    stuck_applicants,
    applicants_this_month,
    applicants_from_referral_link,
    licensed_from_referral_link,
    activated_from_referral_link,
    referral_conversion_rate,
    coursework_completion_rate,
    activation_rate,
    monthly_production,
    monthly_production_available,
    growth_rate,
    last_production_date,
    last_activity_at,
    referral_code,
    referral_link,
    application_link,
    qualifies_agency_owner,
        CASE
            WHEN qualifies_agency_owner THEN 'Agency Owner'::text
            WHEN builder_track = 'agency_owner_track'::text THEN 'Agency Owner Track - Not Qualified Yet'::text
            WHEN builder_track = 'manager_track'::text OR direct_agent_count > 0 OR total_downline_count > 0 OR applicant_count > 0 THEN 'Manager'::text
            ELSE 'Agent'::text
        END AS earned_title,
        CASE
            WHEN builder_track <> 'agent'::text OR direct_agent_count > 0 OR total_downline_count > 0 OR applicant_count > 0 THEN true
            ELSE false
        END AS is_builder,
        CASE
            WHEN monthly_production IS NULL THEN NULL::boolean
            ELSE monthly_production >= 100000::numeric
        END AS above_100k_monthly,
        CASE
            WHEN stuck_applicants > 0 THEN 'Call stuck recruits'::text
            WHEN builder_track = 'agency_owner_track'::text AND NOT qualifies_agency_owner THEN ('Push to '::text || GREATEST(10 - active_agent_count, 0)::text) || ' more active agents'::text
            WHEN unlicensed_recruits > licensed_recruits THEN 'Push licensing'::text
            WHEN last_activity_at IS NULL OR last_activity_at < (now() - '14 days'::interval) THEN 'Re-engage builder'::text
            WHEN hires_this_month = 0 AND active_agent_count > 0 THEN 'Ask for next hire'::text
            ELSE 'Support growth'::text
        END AS action_needed
   FROM scored s;

-- v_ceo_command_center
CREATE OR REPLACE VIEW public.v_ceo_command_center AS
WITH totals AS (
         SELECT count(*) FILTER (WHERE deals.posted_at::date = (now() AT TIME ZONE 'America/Phoenix'::text)::date)::integer AS deals_today,
            count(*) FILTER (WHERE deals.posted_at >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone))::integer AS deals_wtd,
            count(*) FILTER (WHERE deals.posted_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone))::integer AS deals_mtd,
            count(*) FILTER (WHERE deals.posted_at >= (now() - '30 days'::interval))::integer AS deals_30d,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)), 0::numeric) AS ap_wtd,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)), 0::numeric) AS ap_mtd,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= (now() - '30 days'::interval)), 0::numeric) AS ap_30d,
            COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= (now() - '60 days'::interval) AND deals.posted_at < (now() - '30 days'::interval)), 0::numeric) AS ap_prev_30d,
            ( SELECT count(*)::integer AS count
                   FROM v_chargebacks_30d) AS chargebacks_30d,
            count(*) FILTER (WHERE deals.status = 'lapsed'::text AND deals.status_updated_at >= (now() - '30 days'::interval))::integer AS lapses_30d
           FROM deals
        ), agent_counts AS (
         SELECT count(*)::integer AS total_agents,
            count(*) FILTER (WHERE agents.status = 'active'::agent_status)::integer AS active_agents,
            count(*) FILTER (WHERE agents.status = 'inactive'::agent_status)::integer AS inactive_agents,
            count(*) FILTER (WHERE agents.license_status = 'licensed'::license_status)::integer AS licensed_agents,
            count(*) FILTER (WHERE agents.license_status = 'unlicensed'::license_status)::integer AS unlicensed_agents,
            count(*) FILTER (WHERE agents.onboarding_stage = ANY (ARRAY['onboarding'::onboarding_stage, 'training_online'::onboarding_stage, 'in_field_training'::onboarding_stage]))::integer AS onboarding_agents,
            ( SELECT count(DISTINCT COALESCE(cm.canonical_agent_id, d.agent_id))::integer AS count
                   FROM deals d
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = d.agent_id
                  WHERE d.posted_at >= (now() - '30 days'::interval)) AS producing_agents_30d
           FROM agents
          WHERE agents.is_deactivated IS NOT TRUE AND agents.canonical_agent_id IS NULL
        ), app_counts AS (
         SELECT count(*)::integer AS total_applications,
            count(*) FILTER (WHERE applications.created_at >= (now() AT TIME ZONE 'America/Phoenix'::text)::date)::integer AS apps_today,
            count(*) FILTER (WHERE applications.created_at >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone))::integer AS apps_wtd,
            count(*) FILTER (WHERE applications.created_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone))::integer AS apps_mtd,
            count(*) FILTER (WHERE applications.ica_paid = true AND applications.ica_paid_at >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone))::integer AS paid_mtd,
            count(*) FILTER (WHERE (applications.status::text = ANY (ARRAY['new'::text, 'reviewing'::text])) AND applications.created_at < (now() - '3 days'::interval))::integer AS stale_new_3d,
            count(*) FILTER (WHERE applications.assigned_agent_id IS NULL AND (applications.status::text <> ALL (ARRAY['approved'::text, 'rejected'::text])))::integer AS unassigned_open,
            count(*) FILTER (WHERE applications.last_contacted_at IS NULL AND applications.created_at < (now() - '24:00:00'::interval) AND (applications.status::text <> ALL (ARRAY['approved'::text, 'rejected'::text])))::integer AS uncontacted_24h
           FROM v_applications_real applications
        ), seminar_counts AS (
         SELECT count(*)::integer AS sem_registrations_total,
            count(*) FILTER (WHERE seminar_registrations.seminar_date >= (now() AT TIME ZONE 'America/Phoenix'::text)::date)::integer AS sem_upcoming,
            count(*) FILTER (WHERE seminar_registrations.attended = true)::integer AS sem_attended,
            count(*) FILTER (WHERE seminar_registrations.paid_after = true)::integer AS sem_paid_after
           FROM seminar_registrations
        ), referral_counts AS (
         SELECT count(*)::integer AS ref_total,
            count(*) FILTER (WHERE referrals.status::text = 'submitted'::text)::integer AS ref_open,
            count(*) FILTER (WHERE referrals.created_at >= (now() - '30 days'::interval))::integer AS ref_30d,
            count(*) FILTER (WHERE referrals.status::text = ANY (ARRAY['contracted'::text, 'producing'::text]))::integer AS ref_won
           FROM referrals
        )
 SELECT totals.deals_today,
    totals.deals_wtd,
    totals.deals_mtd,
    totals.deals_30d,
    totals.ap_wtd,
    totals.ap_mtd,
    totals.ap_30d,
    totals.ap_prev_30d,
    totals.chargebacks_30d,
    totals.lapses_30d,
    agent_counts.total_agents,
    agent_counts.active_agents,
    agent_counts.inactive_agents,
    agent_counts.licensed_agents,
    agent_counts.unlicensed_agents,
    agent_counts.onboarding_agents,
    agent_counts.producing_agents_30d,
    app_counts.total_applications,
    app_counts.apps_today,
    app_counts.apps_wtd,
    app_counts.apps_mtd,
    app_counts.paid_mtd,
    app_counts.stale_new_3d,
    app_counts.unassigned_open,
    app_counts.uncontacted_24h,
    seminar_counts.sem_registrations_total,
    seminar_counts.sem_upcoming,
    seminar_counts.sem_attended,
    seminar_counts.sem_paid_after,
    referral_counts.ref_total,
    referral_counts.ref_open,
    referral_counts.ref_30d,
    referral_counts.ref_won,
    '[]'::json AS top_producers_mtd,
    '[]'::json AS underperformers_30d,
        CASE
            WHEN totals.ap_prev_30d > 0::numeric THEN round((totals.ap_30d - totals.ap_prev_30d) / totals.ap_prev_30d * 100::numeric, 1)
            ELSE NULL::numeric
        END AS ap_trend_pct,
    now() AS as_of
   FROM totals,
    agent_counts,
    app_counts,
    seminar_counts,
    referral_counts;

-- v_command_center_queue
CREATE OR REPLACE VIEW public.v_command_center_queue AS
WITH base AS (
         SELECT m.id::text AS entity_id,
            'manual'::text AS entity_type,
            m.source_application_id,
            m.candidate_name,
            m.phone,
            m.email,
            m.instagram_handle,
            m.scheduled_at AS scheduled_at_utc,
            (m.scheduled_at AT TIME ZONE 'America/Chicago'::text) AS scheduled_at_chicago,
            m.interview_type,
            m.contacted_at,
            m.called_at,
            m.rescheduled_at,
            m.no_show_at,
            m.hired_at,
            m.contracted_at,
            m.passed_at,
            m.outcome_notes,
            m.created_at
           FROM manual_interview_entries m
          WHERE m.scheduled_at >= '2026-06-01 00:00:00+00'::timestamp with time zone
        UNION ALL
         SELECT 'calendly:'::text || ie.id::text,
            'calendly'::text AS text,
            ie.application_id,
            COALESCE(NULLIF(TRIM(BOTH FROM ie.invitee_name), ''::text), 'Calendly Interview'::text) AS "coalesce",
            ie.invitee_phone,
            ie.invitee_email,
            ie.instagram_handle,
            ie.scheduled_at,
            (ie.scheduled_at AT TIME ZONE 'America/Chicago'::text) AS timezone,
            COALESCE(NULLIF(ie.call_track, ''::text), NULLIF(ie.event_type_name, ''::text), 'scheduled_call'::text) AS "coalesce",
            ie.contacted_at,
            NULL::timestamp with time zone AS timestamptz,
            NULL::timestamp with time zone AS timestamptz,
                CASE
                    WHEN ie.outcome = 'no_show'::text THEN ie.outcome_at
                    ELSE NULL::timestamp with time zone
                END AS "case",
            NULL::timestamp with time zone AS timestamptz,
            NULL::timestamp with time zone AS timestamptz,
                CASE
                    WHEN ie.outcome = ANY (ARRAY['passed'::text, 'licensed'::text, 'won'::text, 'hired'::text]) THEN ie.outcome_at
                    ELSE NULL::timestamp with time zone
                END AS "case",
            COALESCE(ie.notes, ie.va_notes) AS "coalesce",
            ie.scheduled_at
           FROM interview_events ie
          WHERE ie.scheduled_at >= '2026-06-01 00:00:00+00'::timestamp with time zone AND ie.canceled_at IS NULL
        UNION ALL
         SELECT 'application:'::text || a.id::text,
            'application'::text AS text,
            a.id,
            COALESCE(NULLIF(TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text)), ''::text), a.email, 'Unnamed Applicant'::text) AS "coalesce",
            a.phone,
            a.email,
            NULL::text AS text,
            a.created_at,
            (a.created_at AT TIME ZONE 'America/Chicago'::text) AS timezone,
            COALESCE(a.license_status::text, 'application'::text) AS "coalesce",
            NULL::timestamp with time zone AS timestamptz,
            NULL::timestamp with time zone AS timestamptz,
            NULL::timestamp with time zone AS timestamptz,
            NULL::timestamp with time zone AS timestamptz,
                CASE
                    WHEN a.status::text = ANY (ARRAY['hired'::text, 'active'::text]) THEN a.licensed_at
                    ELSE NULL::timestamp with time zone
                END AS "case",
            a.contracted_at,
            NULL::timestamp with time zone AS timestamptz,
            NULL::text AS text,
            a.created_at
           FROM v_applications_real a
          WHERE a.created_at >= '2026-06-01 00:00:00+00'::timestamp with time zone AND a.status IS NOT NULL AND NOT (EXISTS ( SELECT 1
                   FROM manual_interview_entries m
                  WHERE m.source_application_id = a.id)) AND NOT (EXISTS ( SELECT 1
                   FROM interview_events ie
                  WHERE ie.application_id = a.id AND ie.canceled_at IS NULL))
        )
 SELECT entity_id,
    entity_type,
    source_application_id,
    candidate_name,
    phone,
    email,
    instagram_handle,
    scheduled_at_utc,
    scheduled_at_chicago,
    interview_type,
    contacted_at,
    called_at,
    rescheduled_at,
    no_show_at,
    hired_at,
    contracted_at,
    passed_at,
    outcome_notes,
    created_at,
        CASE
            WHEN no_show_at IS NOT NULL THEN 'no_show'::text
            WHEN passed_at IS NOT NULL THEN 'passed'::text
            WHEN contracted_at IS NOT NULL THEN 'contracted'::text
            WHEN hired_at IS NOT NULL THEN 'hired'::text
            WHEN rescheduled_at IS NOT NULL AND called_at IS NULL THEN 'rescheduled'::text
            WHEN called_at IS NOT NULL THEN 'called'::text
            WHEN contacted_at IS NOT NULL THEN 'contacted'::text
            ELSE 'pending'::text
        END AS computed_status,
    no_show_at IS NULL AND passed_at IS NULL AND contracted_at IS NULL AND hired_at IS NULL AS computed_is_active,
    no_show_at IS NOT NULL OR passed_at IS NOT NULL OR contracted_at IS NOT NULL OR hired_at IS NOT NULL AS computed_is_done,
    ( SELECT ag.id
           FROM agents ag
          WHERE ag.source_application_id = b.source_application_id
         LIMIT 1) AS agent_id_if_promoted
   FROM base b;

-- v_content_utm_analytics
CREATE OR REPLACE VIEW public.v_content_utm_analytics AS
SELECT COALESCE(NULLIF(TRIM(BOTH FROM utm_source), ''::text), '(none)'::text) AS utm_source,
    count(*) FILTER (WHERE created_at >= (now() - '7 days'::interval)) AS applications_7d,
    count(*) FILTER (WHERE created_at >= (now() - '30 days'::interval)) AS applications_30d,
    count(*) FILTER (WHERE licensed_at IS NOT NULL AND licensed_at >= (now() - '7 days'::interval)) AS licensed_7d,
    count(*) FILTER (WHERE contracted_at IS NOT NULL AND contracted_at >= (now() - '7 days'::interval)) AS hired_7d
   FROM v_applications_real a
  WHERE created_at >= (now() - '30 days'::interval) OR licensed_at IS NOT NULL AND licensed_at >= (now() - '7 days'::interval) OR contracted_at IS NOT NULL AND contracted_at >= (now() - '7 days'::interval)
  GROUP BY (COALESCE(NULLIF(TRIM(BOTH FROM utm_source), ''::text), '(none)'::text))
  ORDER BY (count(*) FILTER (WHERE created_at >= (now() - '30 days'::interval))) DESC, (COALESCE(NULLIF(TRIM(BOTH FROM utm_source), ''::text), '(none)'::text));

-- v_funnel_by_source
CREATE OR REPLACE VIEW public.v_funnel_by_source AS
SELECT COALESCE(source, 'unknown'::text) AS source,
    COALESCE(utm_source, 'none'::text) AS utm_source,
    count(*)::integer AS total_applications,
    count(*) FILTER (WHERE status::text = ANY (ARRAY['reviewing'::text, 'interview'::text, 'contracting'::text, 'approved'::text, 'paid'::text, 'onboarding'::text, 'producing'::text]))::integer AS moved_past_new,
    count(*) FILTER (WHERE ica_paid = true)::integer AS paid,
    count(*) FILTER (WHERE status::text = 'rejected'::text)::integer AS rejected,
    count(*) FILTER (WHERE status::text = 'no_pickup'::text)::integer AS no_pickup,
    round(count(*) FILTER (WHERE ica_paid = true)::numeric / NULLIF(count(*), 0)::numeric * 100::numeric, 1) AS paid_pct
   FROM v_applications_real applications
  GROUP BY (COALESCE(source, 'unknown'::text)), (COALESCE(utm_source, 'none'::text))
  ORDER BY (count(*)::integer) DESC;

-- v_missed_opportunity_ledger
CREATE OR REPLACE VIEW public.v_missed_opportunity_ledger AS
WITH k AS (
         SELECT 0.164 AS contacted_conv,
            15233::numeric AS median_alp,
            2721::numeric AS p25_alp
        ), uncontacted AS (
         SELECT count(*)::numeric AS n
           FROM v_applications_real a
          WHERE a.contacted_at IS NULL AND a.terminated_at IS NULL AND a.created_at > (now() - '90 days'::interval) AND a.email IS NOT NULL
        ), outage AS (
         SELECT count(*)::numeric AS n
           FROM v_applications_real a
          WHERE a.contacted_at IS NULL AND a.created_at > '2026-07-06 04:34:51+00'::timestamp with time zone
        ), course_done AS (
         SELECT count(*)::numeric AS n
           FROM ( SELECT DISTINCT ON ((lower(TRIM(BOTH FROM s.email)))) s.application_id,
                    s.pct_complete,
                    s.date_completed
                   FROM xcel_pre_licensing_students s
                     JOIN xcel_pre_licensing_reports r ON r.id = s.report_id
                  ORDER BY (lower(TRIM(BOTH FROM s.email))), r.report_date DESC) t_1
             JOIN v_applications_real a ON a.id = t_1.application_id
          WHERE (t_1.pct_complete >= 100::numeric OR t_1.date_completed IS NOT NULL) AND lower(COALESCE(a.license_status::text, ''::text)) <> 'licensed'::text
        ), no_outcome AS (
         SELECT count(*)::numeric AS n
           FROM interview_events
          WHERE interview_events.scheduled_at < (now() - '24:00:00'::interval) AND interview_events.scheduled_at > (now() - '30 days'::interval) AND interview_events.canceled_at IS NULL AND interview_events.outcome IS NULL
        ), stuck_queue AS (
         SELECT count(*)::numeric AS n
           FROM outreach_queue
          WHERE outreach_queue.status = 'pending'::text
        )
 SELECT miss,
    people,
    why,
    est_agents_lost,
    est_alp_median,
    est_alp_conservative,
    sort_order
   FROM ( VALUES ('Applicants never contacted (90d)'::text,( SELECT uncontacted.n
                   FROM uncontacted),'Historical conversion for this group is 0.0%. Contacted applicants convert at 16.4%.'::text,round((( SELECT uncontacted.n
                   FROM uncontacted)) * (( SELECT k.contacted_conv
                   FROM k))),round((( SELECT uncontacted.n
                   FROM uncontacted)) * (( SELECT k.contacted_conv
                   FROM k)) * (( SELECT k.median_alp
                   FROM k))),round((( SELECT uncontacted.n
                   FROM uncontacted)) * (( SELECT k.contacted_conv
                   FROM k)) * (( SELECT k.p25_alp
                   FROM k))),1), ('— of which hit by the July email outage'::text,( SELECT outage.n
                   FROM outage),'Applied after 2026-07-06, got no confirmation, no admin alert, never called.'::text,round((( SELECT outage.n
                   FROM outage)) * (( SELECT k.contacted_conv
                   FROM k))),round((( SELECT outage.n
                   FROM outage)) * (( SELECT k.contacted_conv
                   FROM k)) * (( SELECT k.median_alp
                   FROM k))),round((( SELECT outage.n
                   FROM outage)) * (( SELECT k.contacted_conv
                   FROM k)) * (( SELECT k.p25_alp
                   FROM k))),2), ('Finished pre-licensing, not yet licensed'::text,( SELECT course_done.n
                   FROM course_done),'Already did the hard part. Treated as near-certain to license if pushed, so no conversion haircut applied.'::text,( SELECT course_done.n
                   FROM course_done),round((( SELECT course_done.n
                   FROM course_done)) * (( SELECT k.median_alp
                   FROM k))),round((( SELECT course_done.n
                   FROM course_done)) * (( SELECT k.p25_alp
                   FROM k))),3), ('Interviews with no outcome recorded (30d)'::text,( SELECT no_outcome.n
                   FROM no_outcome),'A call nobody closed out cannot be followed up. Value not modelled — these are already-spent conversations.'::text,NULL::numeric,NULL::numeric,NULL::numeric,4), ('Messages queued but unsent'::text,( SELECT stuck_queue.n
                   FROM stuck_queue),'Blocked on the exhausted Resend quota. Releases when the quota resets.'::text,NULL::numeric,NULL::numeric,NULL::numeric,5)) t(miss, people, why, est_agents_lost, est_alp_median, est_alp_conservative, sort_order);

-- v_queue_stalled_applications
CREATE OR REPLACE VIEW public.v_queue_stalled_applications AS
SELECT ap.id AS application_id,
    (ap.first_name || ' '::text) || ap.last_name AS applicant,
    ap.status::text AS app_status,
    ap.next_step_stage_key,
    ap.license_status::text AS license_status,
    COALESCE(ag.display_name, 'Sam James (default)'::text) AS owner,
    ap.recruiter_id,
    ap.assigned_agent_id,
    COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at) AS last_action_at,
    COALESCE(NULLIF(ap.next_action, ''::text), 'Re-contact: '::text || COALESCE(ap.next_step_stage_key, 'applied'::text)) AS next_action,
    COALESCE(ap.next_action_due_at, ap.next_step_due_at) AS due_at,
    (EXTRACT(epoch FROM now() - COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at)) / 86400::numeric)::numeric(8,1) AS days_stuck,
        CASE
            WHEN ap.license_status::text = 'licensed'::text THEN 1
            WHEN ap.next_step_stage_key = ANY (ARRAY['passed_exam'::text, 'finished_prelicense'::text]) THEN 2
            WHEN ap.next_step_stage_key = 'started_prelicense'::text THEN 3
            WHEN ap.next_step_stage_key = 'contacted'::text THEN 4
            ELSE 5
        END AS priority,
    ap.is_ghosted,
    ap.lead_score,
    ap.created_at
   FROM v_applications_real ap
     LEFT JOIN agents ag ON ag.id = ap.assigned_agent_id
  WHERE ap.terminated_at IS NULL AND COALESCE(ap.is_duplicate, false) = false AND (ap.next_step_stage_key = ANY (ARRAY['applied'::text, 'contacted'::text, 'started_prelicense'::text, 'finished_prelicense'::text, 'passed_exam'::text])) AND (COALESCE(ap.next_action_due_at, ap.next_step_due_at) < now() OR ap.next_action_due_at IS NULL AND ap.next_step_due_at IS NULL AND COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at) < (now() - '14 days'::interval))
  ORDER BY (
        CASE
            WHEN ap.license_status::text = 'licensed'::text THEN 1
            WHEN ap.next_step_stage_key = ANY (ARRAY['passed_exam'::text, 'finished_prelicense'::text]) THEN 2
            WHEN ap.next_step_stage_key = 'started_prelicense'::text THEN 3
            WHEN ap.next_step_stage_key = 'contacted'::text THEN 4
            ELSE 5
        END), ((EXTRACT(epoch FROM now() - COALESCE(ap.last_contacted_at, ap.last_response_at, ap.contacted_at, ap.created_at)) / 86400::numeric)::numeric(8,1)) DESC;

-- v_recruiter_pipeline
CREATE OR REPLACE VIEW public.v_recruiter_pipeline AS
SELECT ag.id AS recruiter_id,
    ag.agent_code,
    p.email AS recruiter_email,
    ag.display_name AS recruiter_name,
    count(a.id)::integer AS total_assigned,
    count(*) FILTER (WHERE a.status::text = ANY (ARRAY['new'::text, 'lead'::text]))::integer AS new_count,
    count(*) FILTER (WHERE a.status::text = ANY (ARRAY['reviewing'::text, 'interview'::text]))::integer AS in_progress_count,
    count(*) FILTER (WHERE a.status::text = 'contracting'::text)::integer AS contracting_count,
    count(*) FILTER (WHERE a.ica_paid = true)::integer AS paid_count,
    count(*) FILTER (WHERE a.status::text = 'rejected'::text)::integer AS rejected_count,
    count(*) FILTER (WHERE a.contacted_at IS NULL AND a.created_at < (now() - '3 days'::interval))::integer AS stale_no_contact,
    count(*) FILTER (WHERE a.contacted_at IS NOT NULL AND a.contacted_at < (now() - '7 days'::interval) AND (a.status::text <> ALL (ARRAY['rejected'::text, 'approved'::text, 'no_pickup'::text])))::integer AS ghosting_risk,
    max(a.contacted_at) AS last_contact_made,
    ag.total_premium,
    ag.total_earnings,
    ag.total_policies
   FROM agents ag
     LEFT JOIN profiles p ON p.id = ag.profile_id
     LEFT JOIN v_agent_canonical_map m ON m.canonical_agent_id = ag.id
     LEFT JOIN v_applications_real a ON a.assigned_agent_id = m.agent_id
  WHERE ag.is_deactivated IS NOT TRUE AND ag.canonical_agent_id IS NULL
  GROUP BY ag.id, ag.agent_code, p.email, ag.display_name, ag.total_premium, ag.total_earnings, ag.total_policies
  ORDER BY (count(a.id)::integer) DESC, ag.total_premium DESC NULLS LAST;

-- v_recruiting_inbox
CREATE OR REPLACE VIEW public.v_recruiting_inbox AS
SELECT a.id AS application_id,
    own_map.canonical_agent_id AS owner_agent_id,
    COALESCE(p_owner.full_name, 'Unassigned'::text) AS owner_name,
    TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text)) AS applicant_name,
    a.phone,
    a.email,
    a.city,
    a.state,
    a.license_status,
    a.created_at AS applied_at,
    EXTRACT(epoch FROM now() - a.created_at) / 3600::numeric AS hours_since_applied,
    a.contacted_at,
    a.next_action,
    a.next_action_at,
        CASE
            WHEN a.contacted_at IS NOT NULL THEN 'contacted'::text
            WHEN a.created_at < (now() - '48:00:00'::interval) THEN 'CRITICAL_48H_PLUS'::text
            WHEN a.created_at < (now() - '24:00:00'::interval) THEN 'overdue_24h'::text
            WHEN a.created_at < (now() - '04:00:00'::interval) THEN 'cooling'::text
            ELSE 'fresh'::text
        END AS urgency,
    a.referral_source
   FROM v_applications_real a
     LEFT JOIN v_agent_canonical_map own_map ON own_map.agent_id = a.assigned_agent_id
     LEFT JOIN agents ag_owner ON ag_owner.id = own_map.canonical_agent_id
     LEFT JOIN profiles p_owner ON p_owner.id = ag_owner.profile_id
  WHERE a.created_at >= (now() - '30 days'::interval);

-- v_recruiting_leaderboard
CREATE OR REPLACE VIEW public.v_recruiting_leaderboard AS
WITH src AS (
         SELECT COALESCE(m.canonical_agent_id, a.referral_recruiter_id, a.referral_manager_id) AS recruiter_id,
            a.created_at
           FROM v_applications_real a
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = COALESCE(a.referral_recruiter_id, a.referral_manager_id)
          WHERE COALESCE(a.referral_recruiter_id, a.referral_manager_id) IS NOT NULL AND a.terminated_at IS NULL
        )
 SELECT recruiter_id,
    count(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today,
    count(*) FILTER (WHERE created_at >= date_trunc('week'::text, CURRENT_DATE::timestamp with time zone)) AS this_week,
    count(*) FILTER (WHERE created_at >= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)) AS this_month,
    count(*) FILTER (WHERE created_at >= (now() - '30 days'::interval)) AS last_30d
   FROM src
  GROUP BY recruiter_id;

-- v_sam_inbox
CREATE OR REPLACE VIEW public.v_sam_inbox AS
SELECT id,
    first_name,
    last_name,
    email,
    phone,
    state,
    created_at,
    ica_paid,
    ica_paid_at,
    status::text AS status,
    EXTRACT(day FROM now() - created_at)::integer AS days_old,
    is_duplicate,
    referral_source,
        CASE
            WHEN ica_paid AND (status::text <> ALL (ARRAY['onboarding'::text, 'producing'::text, 'contracting'::text])) THEN 'paid_needs_onboarding'::text
            WHEN status::text = 'contracting'::text AND contacted_at IS NULL THEN 'contracting_uncontacted'::text
            WHEN status::text = 'new'::text AND created_at < (now() - '7 days'::interval) THEN 'stale_new_7d'::text
            WHEN status::text = 'new'::text AND created_at < (now() - '3 days'::interval) THEN 'stale_new_3d'::text
            WHEN contacted_at IS NULL AND created_at < (now() - '24:00:00'::interval) THEN 'uncontacted_24h'::text
            ELSE 'fresh'::text
        END AS triage_bucket
   FROM v_applications_real a
  WHERE is_duplicate IS NOT TRUE AND (status::text <> ALL (ARRAY['rejected'::text, 'no_pickup'::text]))
  ORDER BY created_at DESC;

-- v_stale_applicants
CREATE OR REPLACE VIEW public.v_stale_applicants AS
WITH base AS (
         SELECT a.id,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            a.city,
            a.state,
            a.license_status::text AS license_status,
            a.status::text AS status,
            a.assigned_agent_id,
            a.instagram_handle,
            a.created_at,
            EXTRACT(epoch FROM now() - a.created_at) / 3600::numeric AS hours_since_application,
            COALESCE(mgr.display_name, '(unassigned)'::text) AS assigned_manager_name,
            NULL::text AS assigned_manager_avatar
           FROM v_applications_real a
             LEFT JOIN agents mgr ON mgr.id = (( SELECT m.canonical_agent_id
                   FROM v_agent_canonical_map m
                  WHERE m.agent_id = a.assigned_agent_id))
          WHERE (a.status::text <> ALL (ARRAY['paid'::text, 'approved'::text, 'rejected'::text, 'disqualified'::text, 'attended'::text, 'producing'::text])) AND a.contacted_at IS NULL AND a.created_at > (now() - '60 days'::interval)
        )
 SELECT id,
    first_name,
    last_name,
    email,
    phone,
    city,
    state,
    license_status,
    status,
    assigned_agent_id,
    instagram_handle,
    created_at,
    hours_since_application,
    assigned_manager_name,
    assigned_manager_avatar,
        CASE
            WHEN hours_since_application >= 24::numeric AND hours_since_application <= 72::numeric THEN 'stale'::text
            WHEN hours_since_application >= 72::numeric AND hours_since_application <= 168::numeric THEN 'icy'::text
            WHEN hours_since_application > 168::numeric THEN 'cold'::text
            ELSE 'fresh'::text
        END AS staleness
   FROM base
  WHERE hours_since_application >= 24::numeric;

-- v_today_dashboard
CREATE OR REPLACE VIEW public.v_today_dashboard AS
WITH day_start AS (
         SELECT date_trunc('day'::text, (now() AT TIME ZONE 'America/Chicago'::text))::timestamp with time zone AS t
        ), week_start AS (
         SELECT date_trunc('week'::text, (now() AT TIME ZONE 'America/Chicago'::text))::timestamp with time zone AS t
        ), month_start AS (
         SELECT date_trunc('month'::text, (now() AT TIME ZONE 'America/Chicago'::text))::timestamp with time zone AS t
        ), truth AS (
         SELECT v_agentlink_book_truth.deals_today,
            v_agentlink_book_truth.premium_today,
            v_agentlink_book_truth.deals_this_week,
            v_agentlink_book_truth.premium_this_week,
            v_agentlink_book_truth.deals_this_month,
            v_agentlink_book_truth.premium_this_month
           FROM v_agentlink_book_truth
        )
 SELECT ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.created_at >= (( SELECT day_start.t
                   FROM day_start))) AS new_apps_today,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.ica_paid = true AND applications.ica_paid_at >= (( SELECT day_start.t
                   FROM day_start))) AS paid_today,
    COALESCE(( SELECT truth.premium_today
           FROM truth), 0::numeric) AS deal_premium_today,
    COALESCE(( SELECT truth.deals_today
           FROM truth), 0) AS deal_count_today,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.created_at >= (( SELECT week_start.t
                   FROM week_start))) AS new_apps_week,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.ica_paid = true AND applications.ica_paid_at >= (( SELECT week_start.t
                   FROM week_start))) AS paid_week,
    COALESCE(( SELECT truth.premium_this_week
           FROM truth), 0::numeric) AS deal_ap_week,
    COALESCE(( SELECT truth.deals_this_week
           FROM truth), 0) AS deal_count_week,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.created_at >= (( SELECT month_start.t
                   FROM month_start))) AS new_apps_mtd,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.ica_paid = true AND applications.ica_paid_at >= (( SELECT month_start.t
                   FROM month_start))) AS paid_mtd,
    COALESCE(( SELECT truth.premium_this_month
           FROM truth), 0::numeric) AS deal_ap_mtd,
    COALESCE(( SELECT truth.deals_this_month
           FROM truth), 0) AS deal_count_mtd,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.status::text = 'new'::text AND applications.created_at < (now() - '3 days'::interval)) AS stale_new_apps,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications
          WHERE applications.contacted_at IS NULL AND applications.created_at < (now() - '24:00:00'::interval)) AS uncontacted_24h,
    ( SELECT count(*)::integer AS count
           FROM partial_applications) AS partial_applications_total,
    ( SELECT count(*)::integer AS count
           FROM policy_quality_flags
          WHERE policy_quality_flags.resolved = false) AS unresolved_policy_flags,
    ( SELECT count(*)::integer AS count
           FROM v_applications_real applications) AS total_applications,
    ( SELECT count(*)::integer AS count
           FROM agents
          WHERE agents.is_deactivated IS NOT TRUE) AS active_agents,
    ( SELECT count(*)::integer AS count
           FROM aged_leads) AS aged_leads_total,
    ( SELECT count(*)::integer AS count
           FROM aged_leads
          WHERE aged_leads.dnc = true) AS aged_leads_dnc,
    now() AS generated_at;

-- v_unclaimed_new_apps
CREATE OR REPLACE VIEW public.v_unclaimed_new_apps AS
SELECT id,
    created_at,
    first_name,
    last_name,
    email,
    phone,
    state,
    license_status::text AS license_status,
    license_progress::text AS license_progress,
    assigned_agent_id,
    referral_manager_id,
    recruiter_id,
    (date_part('epoch'::text, now() - created_at) / 86400::double precision)::integer AS days_in_queue,
        CASE
            WHEN created_at < (now() - '14 days'::interval) THEN 'urgent'::text
            WHEN created_at < (now() - '7 days'::interval) THEN 'cold'::text
            WHEN created_at < (now() - '3 days'::interval) THEN 'warm'::text
            ELSE 'fresh'::text
        END AS heat
   FROM v_applications_real a
  WHERE status::text = 'new'::text AND terminated_at IS NULL;
CREATE OR REPLACE FUNCTION public.apex_dashboard_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT jsonb_build_object(
    'today',       (SELECT jsonb_build_object('deals', deals_today,      'premium', premium_today)      FROM v_agentlink_book_truth),
    'this_week',   (SELECT jsonb_build_object('deals', deals_this_week,  'premium', premium_this_week)  FROM v_agentlink_book_truth),
    'this_month',  (SELECT jsonb_build_object('deals', deals_this_month, 'premium', premium_this_month) FROM v_agentlink_book_truth),
    'total',       (SELECT jsonb_build_object('deals', total_deals,      'premium', total_annual_premium) FROM v_agentlink_book_truth),
    'last_sync_at',(SELECT last_synced_at FROM v_agentlink_book_truth),
    'new_apps_today',  (SELECT COUNT(*) FROM public.v_applications_real applications WHERE created_at >= CURRENT_DATE),
    'new_agents_today',(SELECT COUNT(*) FROM agents WHERE created_at >= CURRENT_DATE),
    'just_hired_7d',   (SELECT COUNT(*) FROM agents WHERE created_at >= NOW() - INTERVAL '7 days'),
    'stale_apps_14d',  (SELECT COUNT(*) FROM v_old_licensed_applicants),
    'inbound_open',    (SELECT COUNT(*) FROM inbound_leads WHERE stage NOT IN ('won','lost'))
  );
$function$;

CREATE OR REPLACE FUNCTION public.apex_daily_briefing()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    'generated_at', now(),
    'overview', (select row_to_json(d) from v_today_dashboard d),
    'top_5_recruiters_this_week', (
      select json_agg(row_to_json(r))
      from (
        select recruiter_name, agent_code, total_assigned, paid_count, stale_no_contact, total_premium
        from v_recruiter_pipeline
        where total_assigned > 0
        order by paid_count desc, total_assigned desc
        limit 5
      ) r
    ),
    'last_5_paid_applicants', (
      select json_agg(row_to_json(p))
      from (
        select first_name, last_name, email, state, ica_paid_at
        from v_paid_applicants
        order by ica_paid_at desc nulls last
        limit 5
      ) p
    ),
    'next_seminar_registrations', (
      select json_agg(row_to_json(s))
      from (
        select seminar_date, first_name, last_name, email, application_status, ica_paid
        from v_seminar_dashboard
        where seminar_date >= current_date
        order by seminar_date asc, registered_at desc
        limit 30
      ) s
    ),
    'duplicate_candidates', (select count(*)::int from public.v_applications_real applications where is_duplicate = true),
    'unresolved_policy_flags', (select count(*)::int from policy_quality_flags where resolved = false),
    'stale_applications_needing_contact', (
      select json_agg(row_to_json(x))
      from (
        select id, first_name, last_name, email, created_at, status::text
        from public.v_applications_real applications
        where status::text = 'new' and is_duplicate is not true and created_at < now() - interval '3 days'
        order by created_at asc
        limit 10
      ) x
    )
  )::json;
$function$;

CREATE OR REPLACE FUNCTION public.landing_live_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    -- 2026-06-18 Sam directive 'fix all this people numbers right'.
    -- BEFORE: counted every non-terminated row as 'active' — included 65 inactive
    -- agents (55 licensed inactive + 10 unlicensed inactive + 2 deactivated +
    -- 1 deactivated-unlicensed = 68 ghost agents inflating 55 truth to 123).
    -- AFTER: status='active' AND NOT is_deactivated AND NOT canonical_agent_id.
    -- Canonical dedup pointers (Mahmod->Moody etc) hide the secondary row so the
    -- same person doesn't count twice.
    'active_agents', (
      SELECT count(*)::int
      FROM agents
      WHERE status = 'active'
        AND NOT is_deactivated
        AND canonical_agent_id IS NULL
    ),
    'hires_recent',       (SELECT count(*)::int FROM landing_recent_hires()),
    'applications_30d',   (SELECT count(*)::int FROM public.v_applications_real applications WHERE created_at >= now() - interval '30 days'),
    'applications_total', (SELECT count(*)::int FROM public.v_applications_real applications),
    'carriers_partnered', greatest((select count(*)::int from public.carriers where coalesce(is_active,true)), 22),
    'generated_at',       now()
  );
$function$;

CREATE OR REPLACE FUNCTION public.landing_recent_applicants(p_limit integer DEFAULT 14)
 RETURNS TABLE(first_name text, city text, state text, hours_ago integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT first_name::text, city::text, state::text,
         ROUND(EXTRACT(epoch FROM (NOW() - created_at)) / 3600)::int AS hours_ago
  FROM public.v_applications_real applications
  WHERE terminated_at IS NULL AND first_name IS NOT NULL AND first_name <> ''
    AND created_at > NOW() - INTERVAL '30 days'
  ORDER BY created_at DESC
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.recruiting_pipeline_rollup()
 RETURNS TABLE(stage_label text, lane text, count integer, last_touch_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE
      WHEN license_progress = 'licensed' AND contracted_at IS NOT NULL THEN 'Licensed · Contracted'
      WHEN license_progress = 'licensed' THEN 'Licensed · Awaiting contract'
      WHEN license_progress IN ('passed_test','waiting_on_license') THEN 'Awaiting license'
      WHEN license_progress IN ('test_scheduled') THEN 'Exam scheduled'
      WHEN license_progress IN ('finished_course') THEN 'Course finished · exam pending'
      WHEN license_progress = 'course_purchased' THEN 'Course purchased'
      WHEN contacted_at IS NULL THEN 'Untouched'
      ELSE 'Unlicensed · in contact'
    END AS stage_label,
    CASE
      WHEN license_progress = 'licensed' THEN 'licensed'
      WHEN license_progress IS NULL OR license_progress = 'unlicensed' THEN 'unlicensed'
      ELSE 'unlicensed'
    END AS lane,
    COUNT(*)::int AS count,
    MAX(GREATEST(coalesce(contacted_at, '-infinity'::timestamptz), coalesce(updated_at, '-infinity'::timestamptz))) AS last_touch_at
  FROM public.v_applications_real applications
  WHERE terminated_at IS NULL
  GROUP BY 1, 2
  ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.post_midday_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_today_deals int;
  v_today_hires int;
  v_apps_today int;
  v_top text;
  v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT COUNT(*)::int INTO v_today_deals
  FROM public.deals
  WHERE effective_date = v_today
    AND status IN ('submitted', 'active')
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  SELECT COUNT(*)::int INTO v_today_hires FROM public.agents
  WHERE created_at::date = v_today;

  SELECT COUNT(*)::int INTO v_apps_today FROM public.v_applications_real applications
  WHERE created_at::date = v_today AND terminated_at IS NULL;

  IF v_today_deals = 0 AND v_today_hires = 0 AND v_apps_today = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no_activity');
  END IF;

  SELECT string_agg(line, E'\n' ORDER BY rn)
  INTO v_top
  FROM (
    SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rn,
      format('• %s — $%s · %s deal%s',
        p.full_name,
        to_char(SUM(d.annual_premium), 'FM999,990'),
        COUNT(*),
        CASE WHEN COUNT(*) = 1 THEN '' ELSE 's' END) AS line
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE d.effective_date = v_today
      AND d.status IN ('submitted', 'active')
      AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
    GROUP BY p.full_name
    ORDER BY SUM(d.annual_premium) DESC
    LIMIT 5
  ) t;

  v_body := jsonb_build_object('username','APEX Midday',
    'content', format(
      E'**☀️ MIDDAY CHECK — %s CT**\n\n' ||
      E'📊 **Deals today:** %s\n' ||
      E'📞 **New applications:** %s  ·  🎯 **Hires today:** %s\n\n' ||
      E'%s\n\n' ||
      E'Second half starts now. Who''s converting before 5?',
      to_char(now() AT TIME ZONE 'America/Chicago', 'Dy HH12:MIam'),
      v_today_deals,
      v_apps_today, v_today_hires,
      COALESCE(E'**Top 5 today:**\n' || v_top, '_no deals posted yet — who''s going to be first?_')));

  PERFORM public.discord_route('midday_snapshot',
    to_char(v_today, 'YYYY-MM-DD'),
    'leadership', v_body);

  RETURN jsonb_build_object('posted', true, 'today_deals', v_today_deals);
END $function$;
