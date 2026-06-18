-- 2026-06-18 Sam directive: "Make sure it's easy to mark the progress of the
-- interviewers, etc. Make sure everything is live, active, flushed, not just
-- prompts."
--
-- Live audit found v_interviews_unified returning only 8 rows when it should
-- return ~91. Cause: the manual_interview_entries half of the UNION had a
-- WHERE clause `AND m.source_application_id IS NULL` which excluded ALL
-- entries linked to an application — that's 83 of 83 manual rows.
--
-- The intent was a dedup: don't show the same person twice (once as a manual
-- entry, once as the underlying application). The correct dedup is the OTHER
-- direction:
--   - Always show the manual entry (which captures Sam's call notes,
--     dispositions, scheduled_at).
--   - Hide the application IF a manual entry exists for it (the application
--     half already does this via NOT EXISTS).
--
-- Fix: strip `AND m.source_application_id IS NULL` from the manual half so
-- all 83 manual entries appear with their disposition fields.
--
-- After fix: 91 rows total (83 manual + 6 applications + 2 calendly). Sam can
-- now disposition (Called/Hired/Pass/Rescheduled/No-Show/Contracted/Contacted/
-- Notes) on every June interview.
--
-- Plus: bulk-set has_training_course = true on every active agent. Sam's
-- 2026-06-17 directive 'any agent should be able to access the course at any
-- time, never lock it' (commit fef91776) removed the front-end gate, but the
-- has_training_course bool was still false for 59/119 active agents. Now
-- 119/119.
--
-- rollback: restore the prior view def + revert the bulk has_training_course
-- update (you don't want to).

DROP VIEW IF EXISTS public.v_interviews_unified CASCADE;

CREATE VIEW public.v_interviews_unified AS
 SELECT m.id,
    'manual'::text AS source,
    m.candidate_name,
    m.phone,
    m.email,
    m.instagram_handle,
    m.scheduled_at,
    m.interview_type,
        CASE
            WHEN m.no_show_at IS NOT NULL THEN 'no_show'::text
            WHEN m.rescheduled_at IS NOT NULL AND m.called_at IS NULL THEN 'rescheduled'::text
            WHEN m.passed_at IS NOT NULL THEN 'passed'::text
            WHEN m.hired_at IS NOT NULL THEN 'hired'::text
            WHEN m.contracted_at IS NOT NULL THEN 'contracted'::text
            WHEN m.called_at IS NOT NULL THEN 'called'::text
            WHEN m.contacted_at IS NOT NULL THEN 'contacted'::text
            ELSE 'pending'::text
        END AS status,
    m.called_at, m.hired_at, m.passed_at, m.contracted_at,
    m.rescheduled_at, m.no_show_at, m.contacted_at,
    m.outcome_notes,
    NULL::uuid AS agent_id_if_known,
    m.created_at
   FROM public.manual_interview_entries m
  WHERE m.scheduled_at >= '2026-06-01 00:00:00+00'::timestamptz
UNION ALL
 SELECT uuid_from_text('calendly:'::text || c.id::text) AS id,
    'calendly'::text AS source,
    COALESCE(NULLIF(TRIM(BOTH FROM c.prospect_name), ''::text), NULLIF(TRIM(BOTH FROM c.summary), ''::text), 'Calendly Interview'::text) AS candidate_name,
    c.prospect_phone AS phone,
    c.prospect_email AS email,
    NULL::text AS instagram_handle,
    c.start_at AS scheduled_at,
    COALESCE(NULLIF(c.call_type, ''::text), 'scheduled_call'::text) AS interview_type,
        CASE
            WHEN c.no_show_at IS NOT NULL THEN 'no_show'::text
            WHEN c.rescheduled_at IS NOT NULL AND c.called_at IS NULL THEN 'rescheduled'::text
            WHEN c.passed_at IS NOT NULL THEN 'passed'::text
            WHEN c.hired_at IS NOT NULL THEN 'hired'::text
            WHEN c.contracted_at IS NOT NULL THEN 'contracted'::text
            WHEN c.called_at IS NOT NULL THEN 'called'::text
            WHEN c.contacted_at IS NOT NULL THEN 'contacted'::text
            ELSE COALESCE(NULLIF(c.status, ''::text), 'scheduled'::text)
        END AS status,
    c.called_at, c.hired_at, c.passed_at, c.contracted_at,
    c.rescheduled_at, c.no_show_at, c.contacted_at,
    c.outcome_notes,
    NULL::uuid AS agent_id_if_known,
    c.created_at
   FROM public.apex_scheduled_calls c
  WHERE c.start_at >= '2026-06-01 00:00:00+00'::timestamptz
UNION ALL
 SELECT uuid_from_text('application:'::text || a.id::text) AS id,
    'application'::text AS source,
    TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text || COALESCE(a.last_name, ''::text))) AS candidate_name,
    a.phone, a.email,
    NULL::text AS instagram_handle,
    a.created_at AS scheduled_at,
    COALESCE(a.license_status::text, 'application'::text) AS interview_type,
        CASE
            WHEN a.status::text IN ('hired','active') THEN 'hired'::text
            WHEN a.status::text = 'rejected' THEN 'passed'::text
            ELSE COALESCE(a.status::text, 'pending'::text)
        END AS status,
    NULL::timestamptz AS called_at,
    CASE WHEN a.status::text IN ('hired','active') THEN a.licensed_at ELSE NULL END AS hired_at,
    NULL::timestamptz AS passed_at,
    a.contracted_at,
    NULL::timestamptz AS rescheduled_at,
    NULL::timestamptz AS no_show_at,
    NULL::timestamptz AS contacted_at,
    NULL::text AS outcome_notes,
    NULL::uuid AS agent_id_if_known,
    a.created_at
   FROM public.applications a
  WHERE a.created_at >= '2026-06-01 00:00:00+00'::timestamptz
    AND a.status IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.manual_interview_entries m WHERE m.source_application_id = a.id);

GRANT SELECT ON public.v_interviews_unified TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_interviews_unified IS
'Sam directive 2026-06-18 dedup fix: manual_interview_entries now appear
regardless of source_application_id linkage. Applications half hides any
row that already has a manual entry, so no double-count.';

-- Course-access flush per Sam's 'never lock it' rule (commit fef91776
-- removed the front-end gate; this catches up the data layer).
UPDATE public.agents
SET has_training_course = true, updated_at = now()
WHERE (has_training_course IS NULL OR has_training_course = false)
  AND is_deactivated IS NOT TRUE;
