-- 2026-06-18 Sam directive (verbatim): "in the interviews cap category.
-- Don't show that person if they didn't put me down as the refer[rer]."
-- Plus: "I'll go ahead and remove their readings if... they're not marking
-- me as a referrer. So... because I'm gonna go ahead and add in everyone
-- else's links now as well."
--
-- Sam (and shortly every other manager) is publishing Calendly links for
-- inbound recruit calls. The booking flow lets a prospect book WITHOUT
-- selecting/typing a referrer on the apex application form. Those
-- bookings get into apex_scheduled_calls via the calendly webhook, then
-- surface on /dashboard/interviews — but Sam (and other managers) don't
-- want them shown because they're not credited to anyone.
--
-- New filter on the Calendly half of v_interviews_unified: only include a
-- row IF the prospect's email maps to an applications row with a non-NULL
-- referral_manager_id OR referral_recruiter_id OR recruiter_id.
--
-- Before: 91 rows (83 manual + 6 application + 2 calendly).
-- After:  89 rows (83 manual + 6 application + 0 calendly) — both current
--         Calendly entries (Ibrahiim Dixon, Francisco Palomares) had
--         prospect_email = NULL and no matching application, so they were
--         the unattributed ones Sam was talking about.
--
-- When other managers publish their Calendly links + the referral flow
-- captures referral_manager_id, those bookings will appear correctly.
--
-- rollback: drop the EXISTS clause on the calendly half.

DROP VIEW IF EXISTS public.v_interviews_unified CASCADE;

CREATE VIEW public.v_interviews_unified AS
 SELECT m.id, 'manual'::text AS source,
    m.candidate_name, m.phone, m.email, m.instagram_handle,
    m.scheduled_at, m.interview_type,
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
    m.outcome_notes, NULL::uuid AS agent_id_if_known, m.created_at
   FROM public.manual_interview_entries m
  WHERE m.scheduled_at >= '2026-06-01 00:00:00+00'::timestamptz
UNION ALL
 SELECT uuid_from_text('calendly:'::text || c.id::text) AS id,
    'calendly'::text AS source,
    COALESCE(NULLIF(TRIM(BOTH FROM c.prospect_name), ''::text),
             NULLIF(TRIM(BOTH FROM c.summary), ''::text),
             'Calendly Interview'::text) AS candidate_name,
    c.prospect_phone AS phone, c.prospect_email AS email,
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
    c.outcome_notes, NULL::uuid AS agent_id_if_known, c.created_at
   FROM public.apex_scheduled_calls c
  WHERE c.start_at >= '2026-06-01 00:00:00+00'::timestamptz
    AND EXISTS (
      SELECT 1 FROM public.applications a
      WHERE lower(a.email) = lower(c.prospect_email)
        AND (a.referral_manager_id IS NOT NULL
             OR a.referral_recruiter_id IS NOT NULL
             OR a.recruiter_id IS NOT NULL)
    )
UNION ALL
 SELECT uuid_from_text('application:'::text || a.id::text) AS id,
    'application'::text AS source,
    TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text || COALESCE(a.last_name, ''::text))) AS candidate_name,
    a.phone, a.email, NULL::text AS instagram_handle,
    a.created_at AS scheduled_at,
    COALESCE(a.license_status::text, 'application'::text) AS interview_type,
    CASE
      WHEN a.status::text IN ('hired','active') THEN 'hired'::text
      WHEN a.status::text = 'rejected' THEN 'passed'::text
      ELSE COALESCE(a.status::text, 'pending'::text)
    END AS status,
    NULL::timestamptz AS called_at,
    CASE WHEN a.status::text IN ('hired','active') THEN a.licensed_at ELSE NULL END AS hired_at,
    NULL::timestamptz AS passed_at, a.contracted_at,
    NULL::timestamptz AS rescheduled_at, NULL::timestamptz AS no_show_at, NULL::timestamptz AS contacted_at,
    NULL::text AS outcome_notes, NULL::uuid AS agent_id_if_known, a.created_at
   FROM public.applications a
  WHERE a.created_at >= '2026-06-01 00:00:00+00'::timestamptz
    AND a.status IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.manual_interview_entries m WHERE m.source_application_id = a.id);

GRANT SELECT ON public.v_interviews_unified TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_interviews_unified IS
'Sam 2026-06-18: Calendly bookings without a credited referrer are hidden.
Only Calendly rows whose prospect_email maps to applications.referral_*
appear. When other managers publish their Calendly links + the referral
flow captures referral_manager_id, those bookings show automatically.';
