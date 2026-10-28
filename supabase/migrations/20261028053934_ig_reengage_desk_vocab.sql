-- Mirrored 2026-10-28 from supabase_migrations.schema_migrations (applied via MCP by the MP-305 session on 10-28; the file
-- must exist under the recorded version or `supabase db push` refuses every later migration: see apex_mcp_migrations_must_mirror).
-- MP-305 BUILD C follow-up (applied live via Supabase MCP 2026-10-28): the desk's thread-action
-- table landed while stage 3 was being built (20261028053436 ig_desk_actions_and_dashboard_v2:
-- ig_thread_actions with CHECK action IN (handled, unhandled, snoozed, unsnoozed, dismissed,
-- relabeled, mine, emailed, sam_sent, tag_refused, note, called, followup_sent) and a
-- snoozed_until column). The helper and the candidate filter are aligned to that vocabulary:
--   - an active snooze (snoozed_until > now()) blocks re-engagement however old it is;
--   - an expired snooze reads as 'unsnoozed';
--   - handled / dismissed / mine since their last message block; unhandled / unsnoozed lift;
--   - 'dismissed' also flips the last inbound to not_interested, which is excluded directly.
CREATE OR REPLACE FUNCTION public.fn_ig_thread_action_latest(p_external_id text, p_within interval DEFAULT interval '14 days')
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text; v_has_snooze boolean;
BEGIN
  IF to_regclass('public.ig_thread_actions') IS NULL THEN RETURN NULL; END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ig_thread_actions'
        AND column_name IN ('external_id', 'action', 'created_at')) < 3 THEN RETURN NULL; END IF;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'ig_thread_actions' AND column_name = 'snoozed_until') INTO v_has_snooze;
  IF v_has_snooze THEN
    EXECUTE 'SELECT CASE WHEN action = ''snoozed'' AND snoozed_until IS NOT NULL AND snoozed_until <= now() THEN ''unsnoozed'' ELSE action::text END
             FROM public.ig_thread_actions
             WHERE external_id = $1 AND (created_at > now() - $2 OR (action = ''snoozed'' AND snoozed_until > now()))
             ORDER BY created_at DESC LIMIT 1'
      INTO v_action USING p_external_id, p_within;
  ELSE
    EXECUTE 'SELECT action::text FROM public.ig_thread_actions WHERE external_id = $1 AND created_at > now() - $2 ORDER BY created_at DESC LIMIT 1'
      INTO v_action USING p_external_id, p_within;
  END IF;
  RETURN v_action;
END $$;
REVOKE ALL ON FUNCTION public.fn_ig_thread_action_latest(text, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ig_thread_action_latest(text, interval) TO service_role;

-- Same signature as 20261028053048; only the desk-action filter and the not_interested guard change.
-- Actions are read since their last message (a handled thread the person re-opened is live again);
-- an active snooze is honoured whenever it was set.
CREATE OR REPLACE FUNCTION public.fn_ig_reengage_candidates()
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
      (array_agg(g.intent ORDER BY g.received_at DESC) FILTER (WHERE g.direction = 'inbound'))[1] AS last_in_intent,
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
    AND COALESCE(t.last_in_intent, '') <> 'not_interested'
    AND t.last_in BETWEEN now() - interval '6 days' AND now() - interval '24 hours'
    AND t.last_out_attempt > t.last_in
    AND p.converted_at IS NULL
    AND (p.form_data IS NULL OR p.form_data->>'reengage_at' IS NULL
         OR p.form_data->>'reengage_at' !~ '^\d{4}-\d{2}-\d{2}' OR (p.form_data->>'reengage_at')::timestamptz < t.last_in)
    AND COALESCE(public.fn_ig_thread_action_latest(t.external_id, now() - t.last_in), '') NOT IN ('handled', 'snoozed', 'dismissed', 'mine')
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
