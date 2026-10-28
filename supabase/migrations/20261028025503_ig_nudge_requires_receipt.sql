-- MP-305: a nudge only follows a message that PROVABLY landed (Meta mid on the row).
-- Pre-receipt rows cannot distinguish "delivered" from "refused with a link", and
-- "still there?" to someone who never got the first message is worse than silence.
CREATE OR REPLACE FUNCTION public.fn_ig_nudge_candidates()
RETURNS TABLE(external_id text, sender_handle text, last_in timestamptz, last_out timestamptz, last_out_body text, nudges int, business boolean, stage int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT m.external_id,
      max(m.received_at) FILTER (WHERE m.direction = 'inbound') AS last_in,
      max(m.received_at) FILTER (WHERE m.direction = 'outbound' AND m.raw_payload->>'error' IS NULL AND m.raw_payload->>'queued' IS NULL AND m.raw_payload->>'mid' IS NOT NULL AND m.auto_replied) AS last_out,
      count(*) FILTER (WHERE m.direction = 'outbound' AND m.raw_payload->>'tag' LIKE 'nudge%' AND m.received_at > now() - interval '24 hours') AS nudges,
      bool_or(m.direction = 'inbound' AND m.intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup','assistant_ask')) AS business,
      bool_or(m.intent IN ('sam_manual','sam_thread') AND m.received_at > now() - interval '14 days') AS human,
      (array_agg(m.sender_handle ORDER BY m.received_at DESC))[1] AS handle
    FROM public.inbox_messages m
    WHERE m.source = 'instagram' AND m.external_id IS NOT NULL AND m.received_at > now() - interval '2 days'
    GROUP BY m.external_id
  ), x AS (
    SELECT t.*, (SELECT o.body FROM public.inbox_messages o WHERE o.source='instagram' AND o.direction='outbound' AND o.external_id = t.external_id AND o.received_at = t.last_out ORDER BY o.created_at DESC LIMIT 1) AS last_out_body
    FROM t
  )
  SELECT external_id, handle, last_in, last_out, last_out_body, nudges::int, business,
         CASE WHEN nudges = 0 THEN 1 ELSE 2 END AS stage
  FROM x
  WHERE last_in IS NOT NULL AND last_out IS NOT NULL AND last_out > last_in
    AND NOT human
    AND last_out_body ~ '\?' AND length(last_out_body) > 8
    AND last_in > now() - interval '23 hours'
    AND (   (nudges = 0 AND last_out < now() - interval '60 minutes')
         OR (nudges = 1 AND business AND last_in < now() - interval '20 hours' AND last_out < now() - interval '60 minutes'))
  ORDER BY business DESC, last_in ASC
  LIMIT 50;
$$;
