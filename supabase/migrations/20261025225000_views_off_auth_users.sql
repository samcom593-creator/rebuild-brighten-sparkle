-- Security advisor auth_users_exposed (2026-10-25): these four views joined auth.users only to read an email for a
-- display-name fallback. public.profiles carries the same email, so the join moves there and no view readable by a
-- login touches the auth schema. Column lists are unchanged (CREATE OR REPLACE), grants and in-body staff gates untouched.
-- profiles is read through DISTINCT ON (user_id) so a duplicated profile row can never fan a strike out twice; the
-- subquery exposes id = user_id so joins written against auth.users(id) downstream keep working as-is.

CREATE OR REPLACE VIEW public.v_agent_strikes AS
 SELECT s.id,
    s.agent_id,
    COALESCE(a.display_name, p.full_name, u.email::text, 'Unknown'::text) AS agent_name,
    a.agent_code,
    s.reason_code,
    s.severity,
    s.description,
    s.evidence_urls,
        CASE
            WHEN s.status = 'active'::strike_status AND s.expires_at IS NOT NULL AND s.expires_at < now() THEN 'expired'::strike_status
            ELSE s.status
        END AS status,
    s.issued_at,
    s.expires_at,
    s.resolved_at,
    s.resolution_note,
    s.issued_by,
    COALESCE(ip.full_name, iu.email::text) AS issued_by_name,
    s.resolved_by,
    COALESCE(rp.full_name, ru.email::text) AS resolved_by_name,
    s.related_application_id,
    s.related_lead_purchase_id,
    s.metadata,
    s.created_at,
    s.updated_at
   FROM agent_strikes s
     LEFT JOIN agents a ON a.id = s.agent_id
     LEFT JOIN profiles p ON p.id = a.profile_id
     LEFT JOIN (SELECT DISTINCT ON (pr.user_id) pr.user_id AS id, pr.user_id, pr.email FROM public.profiles pr WHERE pr.user_id IS NOT NULL ORDER BY pr.user_id, pr.created_at) u ON u.user_id = a.user_id
     LEFT JOIN (SELECT DISTINCT ON (pr.user_id) pr.user_id AS id, pr.user_id, pr.email FROM public.profiles pr WHERE pr.user_id IS NOT NULL ORDER BY pr.user_id, pr.created_at) iu ON iu.user_id = s.issued_by
     LEFT JOIN profiles ip ON ip.id = iu.id
     LEFT JOIN (SELECT DISTINCT ON (pr.user_id) pr.user_id AS id, pr.user_id, pr.email FROM public.profiles pr WHERE pr.user_id IS NOT NULL ORDER BY pr.user_id, pr.created_at) ru ON ru.user_id = s.resolved_by
     LEFT JOIN profiles rp ON rp.id = ru.id;

CREATE OR REPLACE VIEW public.v_strike_summary AS
 SELECT agent_id,
    agent_name,
    agent_code,
    active_count,
    active_warnings,
    active_minor,
    active_major,
    active_terminal,
    resolved_count,
    total_count,
    most_recent_active_at,
    standing
   FROM ( SELECT a.id AS agent_id,
            COALESCE(a.display_name, p.full_name, u.email::text, 'Unknown'::text) AS agent_name,
            a.agent_code,
            count(s.*) FILTER (WHERE s.status = 'active'::strike_status) AS active_count,
            count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'warning'::strike_severity) AS active_warnings,
            count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'minor'::strike_severity) AS active_minor,
            count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'major'::strike_severity) AS active_major,
            count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'terminal'::strike_severity) AS active_terminal,
            count(s.*) FILTER (WHERE s.status = 'resolved'::strike_status) AS resolved_count,
            count(s.*) AS total_count,
            max(s.issued_at) FILTER (WHERE s.status = 'active'::strike_status) AS most_recent_active_at,
                CASE
                    WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'terminal'::strike_severity) > 0 THEN 'terminal'::text
                    WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'major'::strike_severity) >= 3 THEN 'review_required'::text
                    WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status AND s.severity = 'major'::strike_severity) > 0 THEN 'on_notice'::text
                    WHEN count(s.*) FILTER (WHERE s.status = 'active'::strike_status) > 0 THEN 'flagged'::text
                    ELSE 'clear'::text
                END AS standing
           FROM agents a
             LEFT JOIN profiles p ON p.id = a.profile_id
             LEFT JOIN (SELECT DISTINCT ON (pr.user_id) pr.user_id AS id, pr.user_id, pr.email FROM public.profiles pr WHERE pr.user_id IS NOT NULL ORDER BY pr.user_id, pr.created_at) u ON u.user_id = a.user_id
             LEFT JOIN agent_strikes s ON (s.agent_id IN ( SELECT m.agent_id
                   FROM v_agent_canonical_map m
                  WHERE m.canonical_agent_id = a.id))
          WHERE a.canonical_agent_id IS NULL
          GROUP BY a.id, a.display_name, p.full_name, u.email, a.agent_code) _g
  WHERE is_agency_staff() OR auth.uid() IS NULL;

CREATE OR REPLACE VIEW public.v_recent_conduct_events AS
 SELECT 'strike'::text AS event_type,
    s.id::text AS event_id,
    s.issued_at AS occurred_at,
    s.agent_id,
    COALESCE(ag.display_name, p.full_name, u.email::text) AS agent_name,
    s.severity::text AS severity_or_flag,
    format('Strike issued: %s'::text, s.reason_code::text) AS title,
    s.description,
    jsonb_build_object('reason_code', s.reason_code, 'severity', s.severity, 'status', s.status, 'expires_at', s.expires_at) AS detail
   FROM agent_strikes s
     LEFT JOIN agents ag ON ag.id = (( SELECT m.canonical_agent_id
           FROM v_agent_canonical_map m
          WHERE m.agent_id = s.agent_id))
     LEFT JOIN profiles p ON p.id = ag.profile_id
     LEFT JOIN (SELECT DISTINCT ON (pr.user_id) pr.user_id AS id, pr.user_id, pr.email FROM public.profiles pr WHERE pr.user_id IS NOT NULL ORDER BY pr.user_id, pr.created_at) u ON u.user_id = ag.user_id
UNION ALL
 SELECT 'charge_anomaly'::text AS event_type,
    c.id::text AS event_id,
    c.charged_at AS occurred_at,
    c.resolved_agent_id AS agent_id,
    c.resolved_agent_name AS agent_name,
        CASE
            WHEN c.flag_duplicate_window THEN 'duplicate_window'::text
            WHEN c.flag_name_mismatch THEN 'name_mismatch'::text
            WHEN c.flag_unlinked THEN 'unlinked'::text
            WHEN c.flag_unusual_amount THEN 'unusual_amount'::text
            ELSE NULL::text
        END AS severity_or_flag,
    format('Charge flag: $%s — %s'::text, c.amount_usd::text, COALESCE(c.customer_name, '(no name)'::text)) AS title,
    COALESCE(c.description, ''::text) AS description,
    jsonb_build_object('amount_usd', c.amount_usd, 'customer_email', c.customer_email, 'stripe_charge_id', c.stripe_charge_id, 'flag_name_mismatch', c.flag_name_mismatch, 'flag_unlinked', c.flag_unlinked, 'flag_unusual_amount', c.flag_unusual_amount, 'flag_duplicate_window', c.flag_duplicate_window) AS detail
   FROM v_charge_anomalies c
  WHERE c.flag_name_mismatch OR c.flag_unlinked OR c.flag_unusual_amount OR c.flag_duplicate_window;

CREATE OR REPLACE VIEW public.v_unlicensed_all AS
 SELECT id,
    source,
    first_name,
    last_name,
    email,
    phone,
    state,
    license_status,
    license_progress,
    created_at,
    last_contacted_at,
    next_action_due_at,
    assigned_va_id,
    assigned_va_at,
    next_touch_by,
    phone_bad_at,
    days_since_touch,
    days_since_applied,
    assigned_va_email
   FROM ( SELECT a.id::text AS id,
            'applied'::text AS source,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            a.state,
            a.license_status::text AS license_status,
            a.license_progress::text AS license_progress,
            a.created_at,
            a.last_contacted_at,
            a.next_action_due_at,
            a.assigned_va_id,
            a.assigned_va_at,
            a.next_touch_by,
            a.phone_bad_at,
            EXTRACT(day FROM now() - COALESCE(a.last_contacted_at, a.created_at))::integer AS days_since_touch,
            EXTRACT(day FROM now() - a.created_at)::integer AS days_since_applied,
            va.email AS assigned_va_email
           FROM applications a
             LEFT JOIN (SELECT DISTINCT ON (pr.user_id) pr.user_id AS id, pr.user_id, pr.email FROM public.profiles pr WHERE pr.user_id IS NOT NULL ORDER BY pr.user_id, pr.created_at) va ON va.user_id = a.assigned_va_id
          WHERE a.terminated_at IS NULL AND (a.license_status IS NULL OR (a.license_status::text = ANY (ARRAY['unlicensed'::text, 'pending'::text])))
        UNION ALL
         SELECT al.id::text AS id,
            'aged_lead'::text AS source,
            al.first_name,
            al.last_name,
            al.email,
            al.phone,
            al.state,
            COALESCE(al.license_status, 'unlicensed'::text) AS license_status,
            al.license_progress,
            al.created_at,
            al.last_contacted_at,
            al.next_action_due_at,
            al.assigned_va_id,
            al.assigned_va_at,
            al.next_touch_by,
            al.phone_bad_at,
            EXTRACT(day FROM now() - COALESCE(al.last_contacted_at, al.created_at))::integer AS days_since_touch,
            EXTRACT(day FROM now() - al.created_at)::integer AS days_since_applied,
            vau.email AS assigned_va_email
           FROM aged_leads al
             LEFT JOIN (SELECT DISTINCT ON (pr.user_id) pr.user_id AS id, pr.user_id, pr.email FROM public.profiles pr WHERE pr.user_id IS NOT NULL ORDER BY pr.user_id, pr.created_at) vau ON vau.user_id = al.assigned_va_id
          WHERE al.dnc IS NOT TRUE AND (al.license_status IS NULL OR (al.license_status = ANY (ARRAY['unlicensed'::text, 'pending'::text, 'licensed'::text]))) AND (al.status IS NULL OR (al.status <> ALL (ARRAY['hired'::text, 'terminated'::text, 'promoted_to_application'::text])))) t
  WHERE is_agency_staff();
