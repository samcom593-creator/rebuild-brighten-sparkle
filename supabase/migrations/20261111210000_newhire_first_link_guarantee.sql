-- MP-ONBOARD-FIRST-LINK (2026-11-11). Sam: "conversion is the metric ... don't ask me."
--
-- Measured: three active licensed hires (hired 25-43 days ago) have not opened their agent portal
-- since being hired and were never sent a login link — one was handed a 51-lead pack on 11-10.
-- Two causes in v_newhire_needs_portal_login:
--   1. It required last_sign_in_at IS NULL. These three signed in once as APPLICANTS, before the
--      agent row existed, so they read as "has signed in" forever. The staged list
--      (v_newhire_never_signed_in_staged) already uses the right operand: no sign-in SINCE HIRE.
--      Two views answering one question with different operands; the sender now matches the list.
--   2. The window is 30 days from hire (45 after the WP6 cutoff). A hire the sender never reached
--      aged out with zero sends. A hire who has never received a link is not backlog being
--      re-sent, it is the first send: zero real portal sends -> eligible for 120 days.
-- Unchanged: real email, not deactivated/terminated, 72h dedupe, 24h failure backoff, 30d refusal
-- backoff, max 6. After the first link the hire falls back to the normal window, so no drip.
create or replace view public.v_newhire_needs_portal_login as
SELECT a.id AS agent_id,
    a.created_at AS hired_at,
    p.email,
    COALESCE(p.full_name, a.display_name, 'Agent'::text) AS full_name,
    lower(COALESCE(a.license_status::text, ''::text)) AS license_status,
    a.invited_by_manager_id AS manager_id,
    mp.email AS manager_email,
    tk.portal_sends AS portal_sends_so_far
   FROM agents a
     JOIN auth.users u ON u.id = a.user_id
     JOIN profiles p ON p.user_id = a.user_id
     LEFT JOIN agents ma ON ma.id = a.invited_by_manager_id
     LEFT JOIN profiles mp ON mp.user_id = ma.user_id
     CROSS JOIN LATERAL ( SELECT count(*) FILTER (WHERE COALESCE(t.send_status, 'sent'::text) = 'sent'::text) AS portal_sends,
            bool_or(t.created_at > (now() - '72:00:00'::interval) AND (COALESCE(t.send_status, 'sent'::text) = ANY (ARRAY['sent'::text, 'pending'::text]))) AS recent_send,
            bool_or(t.created_at > (now() - '24:00:00'::interval) AND t.send_status = 'failed'::text) AS recent_failure,
            bool_or(t.created_at > (now() - '30 days'::interval) AND t.send_status = 'refused'::text) AS recent_refusal
           FROM magic_login_tokens t
          WHERE t.agent_id = a.id AND t.destination = 'portal'::text) tk
  WHERE a.created_at > (now() -
        CASE
            WHEN COALESCE(tk.portal_sends, 0::bigint) = 0 THEN '120 days'::interval
            WHEN a.created_at >= fn_onboarding_wp6_cutoff() THEN '45 days'::interval
            ELSE '30 days'::interval
        END) AND a.user_id IS NOT NULL AND COALESCE(a.is_deactivated, false) = false AND COALESCE(a.status::text, ''::text) <> 'terminated'::text AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < a.created_at) AND p.email IS NOT NULL AND p.email <> ''::text AND POSITION(('placeholder'::text) IN (lower(p.email))) = 0 AND NOT COALESCE(tk.recent_send, false) AND NOT COALESCE(tk.recent_failure, false) AND NOT COALESCE(tk.recent_refusal, false) AND COALESCE(tk.portal_sends, 0::bigint) < 6;
