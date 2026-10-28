-- Mirrored 2026-10-28 from supabase_migrations.schema_migrations (applied via MCP by the MP-305 session on 10-28; the file
-- must exist under the recorded version or `supabase db push` refuses every later migration: see apex_mcp_migrations_must_mirror).
-- MP-305 BUILD C (applied live via Supabase MCP 2026-10-28): re-engagement inside Meta's rules.
--
-- Measured before writing (7-day window, business threads whose last inbound is 24h..6d old,
-- no Sam in 14d): 9 threads. 0 where OUR delivered message is last. 6 where the brain wrote a
-- reply that never landed (a same-body failure row 2-3 s later: "Invalid message id", the
-- link block). 3 where the brain wrote nothing after their message. Meta's RESPONSE type can
-- reach none of them now; only a HUMAN_AGENT-tagged message (<= 7 days after their last
-- message) or an email can.
--
-- Stage 3 lives in its OWN function. The deployed instagram-dm-nudge still runs the old code
-- and would treat an extra stage from fn_ig_nudge_candidates() as nudge1 text sent as
-- RESPONSE, refused by Meta, and (through the old sender) queued into the retry drain that
-- re-sent 373 dead rows in the last 3 days. fn_ig_nudge_candidates() is untouched.

-- ig_thread_actions does not exist yet (information_schema checked 2026-10-28). When a page
-- wave creates it, a thread marked handled/snoozed stops being a candidate with no change
-- here. The shape is checked before it is queried, so a differently-shaped table reads as
-- "no action" instead of breaking the engine.
CREATE OR REPLACE FUNCTION public.fn_ig_thread_action_latest(p_external_id text, p_within interval DEFAULT interval '14 days')
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text;
BEGIN
  IF to_regclass('public.ig_thread_actions') IS NULL THEN RETURN NULL; END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ig_thread_actions'
        AND column_name IN ('external_id', 'action', 'created_at')) < 3 THEN RETURN NULL; END IF;
  EXECUTE 'SELECT action::text FROM public.ig_thread_actions WHERE external_id = $1 AND created_at > now() - $2 ORDER BY created_at DESC LIMIT 1'
    INTO v_action USING p_external_id, p_within;
  RETURN v_action;
END $$;
REVOKE ALL ON FUNCTION public.fn_ig_thread_action_latest(text, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ig_thread_action_latest(text, interval) TO service_role;

-- Stage 3 candidates. A thread qualifies when a business intent was stated, their last message
-- is 24h..6d old, the LAST ROW IN THE THREAD IS OURS (never theirs: when they come back the
-- brain answers), Sam has not typed in it for 14 days, no nudge3 has been attempted, nothing
-- in the thread or the CRM says they already applied / booked / converted, and no page action
-- marked it handled or snoozed.
--   reason = went_quiet   our reply landed (mid, or an unshadowed row) and they went silent
--   reason = unanswered   the brain wrote a reply and it never landed (failure row, same body,
--                         inside 2 minutes); the person has heard nothing from us
-- A nudge3 attempt is recorded on an inbox_messages row (tag = nudge3, mid or refusal, written
-- by send-instagram-dm) or, for the email / no-channel outcomes, on the thread's own
-- partial_applications stub (form_data.reengage_at). Either stops a second attempt.
DROP FUNCTION IF EXISTS public.fn_ig_reengage_candidates();
CREATE FUNCTION public.fn_ig_reengage_candidates()
RETURNS TABLE(external_id text, sender_handle text, first_name text, lane text, reason text,
              last_in timestamptz, last_in_body text, last_out_delivered timestamptz, last_out_attempt timestamptz,
              email text, phone text, days_quiet numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH msgs AS (
    SELECT m.external_id, m.sender_handle, m.direction, m.intent, m.body, m.received_at, m.raw_payload,
      (m.direction = 'outbound' AND m.raw_payload->>'error' IS NULL AND m.raw_payload->>'queued' IS NULL) AS sent_row,
      (m.direction = 'outbound' AND m.raw_payload->>'mid' IS NULL AND EXISTS (
         SELECT 1 FROM public.inbox_messages f
         WHERE f.source = 'instagram' AND f.direction = 'outbound' AND f.external_id = m.external_id AND f.body = m.body
           AND f.raw_payload->>'error' IS NOT NULL
           AND f.received_at BETWEEN m.received_at AND m.received_at + interval '2 minutes')) AS shadowed
    FROM public.inbox_messages m
    WHERE m.source = 'instagram' AND m.external_id IS NOT NULL AND m.received_at > now() - interval '7 days'
  ), t AS (
    SELECT g.external_id,
      max(g.received_at) FILTER (WHERE g.direction = 'inbound') AS last_in,
      max(g.received_at) FILTER (WHERE g.sent_row AND NOT g.shadowed) AS last_out_delivered,
      max(g.received_at) FILTER (WHERE g.direction = 'outbound') AS last_out_attempt,
      bool_or(g.direction = 'inbound' AND g.intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup','assistant_ask')) AS business,
      bool_or(g.intent IN ('sam_manual','sam_thread') AND g.received_at > now() - interval '14 days') AS human,
      bool_or(g.direction = 'outbound' AND g.raw_payload->>'tag' = 'nudge3') AS nudge3_done,
      bool_or(g.sent_row AND NOT g.shadowed AND g.body ~* '^locked in') AS booked_in_thread,
      (array_agg(g.intent ORDER BY g.received_at DESC) FILTER (WHERE g.direction = 'inbound' AND g.intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup','assistant_ask')))[1] AS lane,
      (array_agg(g.sender_handle ORDER BY g.received_at DESC) FILTER (WHERE g.sender_handle IS NOT NULL AND g.sender_handle <> g.external_id))[1] AS handle,
      (array_agg(g.body ORDER BY g.received_at DESC) FILTER (WHERE g.direction = 'inbound'))[1] AS last_in_body,
      (array_agg(substring(g.body from '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}') ORDER BY g.received_at DESC)
         FILTER (WHERE g.direction = 'inbound' AND g.body ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1] AS email_in_body,
      (array_agg(substring(g.body from '(?:\+?1[[:space:].-]?)?\(?[0-9]{3}\)?[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4}') ORDER BY g.received_at DESC)
         FILTER (WHERE g.direction = 'inbound' AND g.body ~ '(?:\+?1[[:space:].-]?)?\(?[0-9]{3}\)?[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4}\y'))[1] AS phone_in_body
    FROM msgs g
    GROUP BY g.external_id
  )
  SELECT t.external_id, t.handle, p.first_name, t.lane,
    CASE WHEN t.last_out_delivered > t.last_in THEN 'went_quiet' ELSE 'unanswered' END AS reason,
    t.last_in, left(t.last_in_body, 200), t.last_out_delivered, t.last_out_attempt,
    COALESCE(NULLIF(lower(p.email), ''), lower(t.email_in_body)) AS email,
    COALESCE(NULLIF(p.phone, ''), t.phone_in_body) AS phone,
    round((extract(epoch FROM now() - t.last_in) / 86400.0)::numeric, 1) AS days_quiet
  FROM t
  LEFT JOIN LATERAL (
    SELECT pa.email, pa.phone, pa.first_name, pa.converted_at, pa.form_data
    FROM public.partial_applications pa WHERE pa.session_id = 'instagram:' || t.external_id LIMIT 1) p ON true
  WHERE t.business AND NOT t.human AND NOT t.nudge3_done AND NOT t.booked_in_thread
    AND t.last_in BETWEEN now() - interval '6 days' AND now() - interval '24 hours'
    AND t.last_out_attempt > t.last_in
    AND p.converted_at IS NULL
    AND (p.form_data IS NULL OR p.form_data->>'reengage_at' IS NULL
         OR p.form_data->>'reengage_at' !~ '^\d{4}-\d{2}-\d{2}' OR (p.form_data->>'reengage_at')::timestamptz < t.last_in)
    AND COALESCE(public.fn_ig_thread_action_latest(t.external_id), '') NOT IN ('handled', 'snoozed', 'done', 'closed')
    AND NOT EXISTS (SELECT 1 FROM public.applications a
                    WHERE t.handle IS NOT NULL AND a.instagram_handle IS NOT NULL
                      AND lower(ltrim(a.instagram_handle, '@')) = lower(ltrim(t.handle, '@'))
                      AND a.created_at > now() - interval '30 days')
    AND NOT EXISTS (SELECT 1 FROM public.interview_events e
                    WHERE t.handle IS NOT NULL AND e.instagram_handle IS NOT NULL
                      AND lower(ltrim(e.instagram_handle, '@')) = lower(ltrim(t.handle, '@'))
                      AND e.scheduled_at > now() - interval '1 day')
  ORDER BY t.last_in ASC
  LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.fn_ig_reengage_candidates() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ig_reengage_candidates() TO service_role;

-- Truth view: four columns appended (CREATE OR REPLACE keeps the existing six in place).
-- nudges_refused (all stages) still includes nudge3; nudge3_refused isolates stage 3.
-- reengage_emails / reengage_no_channel are read off the thread stub, where the engine stamps
-- those two outcomes (an email is not a DM and must not show up in v_ig_dm_delivery_truth).
CREATE OR REPLACE VIEW public.v_ig_followup_truth AS
WITH m AS (SELECT * FROM public.inbox_messages WHERE source = 'instagram' AND received_at >= now() - interval '30 days')
SELECT d.day,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag'='nudge1' AND raw_payload->>'mid' IS NOT NULL AND received_at::date = d.day) AS nudge1_delivered,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag'='nudge2' AND raw_payload->>'mid' IS NOT NULL AND received_at::date = d.day) AS nudge2_delivered,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag' LIKE 'nudge%' AND raw_payload->>'error' IS NOT NULL AND received_at::date = d.day) AS nudges_refused,
  (SELECT count(DISTINCT n.external_id) FROM m n WHERE n.direction='outbound' AND n.raw_payload->>'tag' LIKE 'nudge%' AND n.raw_payload->>'mid' IS NOT NULL AND n.received_at::date = d.day
     AND EXISTS (SELECT 1 FROM m i WHERE i.direction='inbound' AND i.external_id = n.external_id AND i.received_at BETWEEN n.received_at AND n.received_at + interval '6 hours')) AS replied_within_6h,
  (SELECT count(*) FROM public.partial_applications p WHERE p.recovery_email_sent_at::date = d.day) AS recovery_emails_sent,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag'='nudge3' AND raw_payload->>'mid' IS NOT NULL AND received_at::date = d.day) AS nudge3_delivered,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag'='nudge3' AND raw_payload->>'error' IS NOT NULL AND received_at::date = d.day) AS nudge3_refused,
  (SELECT count(*) FROM public.partial_applications p WHERE p.form_data->>'reengage_outcome' = 'email_sent'
     AND p.form_data->>'reengage_at' ~ '^\d{4}-\d{2}-\d{2}' AND (p.form_data->>'reengage_at')::timestamptz::date = d.day) AS reengage_emails,
  (SELECT count(*) FROM public.partial_applications p WHERE p.form_data->>'reengage_outcome' = 'no_channel'
     AND p.form_data->>'reengage_at' ~ '^\d{4}-\d{2}-\d{2}' AND (p.form_data->>'reengage_at')::timestamptz::date = d.day) AS reengage_no_channel
FROM (SELECT generate_series((now() - interval '29 days')::date, now()::date, '1 day')::date AS day) d
ORDER BY d.day DESC;
REVOKE ALL ON public.v_ig_followup_truth FROM anon, authenticated;
GRANT SELECT ON public.v_ig_followup_truth TO service_role;
