-- PL-WIB-HIRE-BOARD-CANONICAL: book_deals/book_ap read v_production_canonical (one row per
-- canonical seller, merged rows folded in) instead of raw agentlink_book, whose agent rows end
-- 2026-08-31 and repeat duplicate imports. A licensed hire with canonical production below the
-- producing rung is told to mark them producing, not to book an onboarding call, and a field-training
-- hire with canonical deals is not told to get a first deal.
CREATE OR REPLACE VIEW public.v_hire_launch_board AS
 WITH base AS (
         SELECT a.id AS agent_id,
            a.user_id,
            a.profile_id,
            a.display_name,
            a.license_status::text AS license_status,
            a.onboarding_stage::text AS onboarding_stage,
            fn_hire_stage_rank(a.onboarding_stage::text) AS stage_rank,
            a.created_at AS hired_at,
            a.stage_changed_at,
            a.contracted_at,
            a.first_deal_at,
            a.source_application_id,
            a.invited_by_manager_id
           FROM agents a
          WHERE a.status = 'active'::agent_status AND a.canonical_agent_id IS NULL AND COALESCE(a.is_deactivated, false) = false AND COALESCE(a.is_inactive, false) = false
        ), book AS (
         SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS agent_id,
            count(*) AS deals,
            COALESCE(sum(p.annual_premium), 0::numeric) AS ap
           FROM v_production_canonical p
             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = p.agent_id
          WHERE p.agent_id IS NOT NULL
          GROUP BY (COALESCE(cm.canonical_agent_id, p.agent_id))
        ), enriched AS (
         SELECT b.agent_id,
            b.user_id,
            b.profile_id,
            b.display_name,
            b.license_status,
            b.onboarding_stage,
            b.stage_rank,
            b.hired_at,
            b.stage_changed_at,
            b.contracted_at,
            b.first_deal_at,
            b.source_application_id,
            b.invited_by_manager_id,
            p.full_name,
            p.email,
            p.phone,
            mgr.display_name AS manager_name,
            GREATEST(0, CURRENT_DATE - COALESCE(b.stage_changed_at, b.hired_at)::date) AS days_in_stage,
            GREATEST(0, CURRENT_DATE - b.hired_at::date) AS days_since_hired,
            act.calls_7d,
            act.calls_30d,
            act.conversations_30d,
            act.last_call_at,
            COALESCE(bk.deals, 0::bigint) AS book_deals,
            COALESCE(bk.ap, 0::numeric) AS book_ap,
            cal.next_call_at,
            cal.last_outcome AS last_call_outcome,
            tr.modules_done
           FROM base b
             LEFT JOIN profiles p ON p.id = b.profile_id
             LEFT JOIN agents mgr ON mgr.id = b.invited_by_manager_id
             LEFT JOIN book bk ON bk.agent_id = b.agent_id
             LEFT JOIN LATERAL ( SELECT min(oc.scheduled_at) FILTER (WHERE oc.scheduled_at > now() AND oc.canceled_at IS NULL) AS next_call_at,
                    (array_agg(oc.outcome ORDER BY oc.scheduled_at DESC) FILTER (WHERE oc.outcome IS NOT NULL))[1] AS last_outcome
                   FROM v_onboarding_calls oc
                  WHERE oc.agent_id = b.agent_id) cal ON true
             LEFT JOIN LATERAL ( SELECT count(*) AS modules_done
                   FROM onboarding_progress op
                  WHERE op.agent_id = b.agent_id AND op.completed_at IS NOT NULL) tr ON true
             LEFT JOIN v_hire_activity act ON act.agent_id = b.agent_id
        )
 SELECT agent_id,
    user_id,
    COALESCE(NULLIF(btrim(display_name), ''::text), full_name, 'Name not on file'::text) AS display_name,
    email,
    phone,
    license_status,
    onboarding_stage,
    stage_rank,
    hired_at,
    stage_changed_at,
    days_in_stage,
    days_since_hired,
    contracted_at,
    first_deal_at,
    source_application_id,
    invited_by_manager_id,
    manager_name,
    book_deals,
    book_ap,
    next_call_at,
    last_call_outcome,
    modules_done,
    calls_7d,
    calls_30d,
    conversations_30d,
    last_call_at,
    hired_at >= (date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text))::date::timestamp with time zone + '07:00:00'::interval) AS hired_this_month,
        CASE
            WHEN license_status <> 'licensed'::text THEN 'license'::text
            WHEN stage_rank IS NULL THEN 'off_ladder'::text
            WHEN stage_rank < 3 AND book_deals > 0 THEN 'mark_producing'::text
            WHEN stage_rank = 0 THEN 'start_onboarding'::text
            WHEN stage_rank = 1 AND next_call_at IS NULL THEN 'book_call'::text
            WHEN stage_rank = 1 THEN 'move_to_course'::text
            WHEN stage_rank = 2 THEN 'move_to_field'::text
            WHEN stage_rank = 3 AND first_deal_at IS NULL AND book_deals = 0 THEN 'first_deal'::text
            WHEN stage_rank = 3 THEN 'mark_producing'::text
            ELSE 'coach'::text
        END AS next_action_key,
        CASE
            WHEN license_status <> 'licensed'::text THEN 'Get them licensed'::text
            WHEN stage_rank IS NULL THEN ('Off the ladder at '::text || COALESCE(onboarding_stage, 'no stage'::text)) || ' — put them back on it'::text
            WHEN stage_rank < 3 AND book_deals > 0 THEN 'Already writing business — mark them producing'::text
            WHEN stage_rank = 0 THEN 'Start onboarding'::text
            WHEN stage_rank = 1 AND next_call_at IS NULL THEN 'Book the onboarding call'::text
            WHEN stage_rank = 1 THEN 'Move them into the course'::text
            WHEN stage_rank = 2 THEN 'Course done — send them to field training'::text
            WHEN stage_rank = 3 AND first_deal_at IS NULL AND book_deals = 0 THEN 'Field training — get the first deal'::text
            WHEN stage_rank = 3 THEN 'First deal is in — mark them producing'::text
            ELSE 'Producing — coach the next win'::text
        END AS next_action_label,
    COALESCE(stage_rank, 0) < 4 AND GREATEST(0, CURRENT_DATE - COALESCE(stage_changed_at, hired_at)::date) > 14 AS is_stalled,
    email IS NULL OR btrim(email) = ''::text AS email_missing,
    phone IS NULL OR btrim(phone) = ''::text AS phone_missing
   FROM enriched e
  WHERE apex_is_admin() OR crm_can_read_agent_scope(agent_id);
