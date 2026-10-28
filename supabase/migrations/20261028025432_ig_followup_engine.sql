-- MP-305 Wave 3: the Instagram follow-up engine. Candidates are computed here so the
-- edge function (instagram-dm-nudge) and the truth view cannot drift. A thread is a
-- candidate only when OUR delivered message is the last one, it asked something,
-- the prospect has been silent, Meta's 24h window is still open, and Sam has not
-- typed in the thread. Nudges carry raw_payload.tag = nudge1 | nudge2 (written by
-- send-instagram-dm on the delivered row).
CREATE OR REPLACE FUNCTION public.fn_ig_nudge_candidates()
RETURNS TABLE(external_id text, sender_handle text, last_in timestamptz, last_out timestamptz, last_out_body text, nudges int, business boolean, stage int)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT m.external_id,
      max(m.received_at) FILTER (WHERE m.direction = 'inbound') AS last_in,
      max(m.received_at) FILTER (WHERE m.direction = 'outbound' AND m.raw_payload->>'error' IS NULL AND m.raw_payload->>'queued' IS NULL) AS last_out,
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
REVOKE ALL ON FUNCTION public.fn_ig_nudge_candidates() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ig_nudge_candidates() TO service_role;

-- Abandoned applications that came from Instagram and left an email. The brain's
-- own 'inbound_dm' stubs are not applications and are excluded.
CREATE OR REPLACE FUNCTION public.fn_ig_abandoned_partials()
RETURNS TABLE(id uuid, email text, first_name text, step text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.email, p.first_name, p.step
  FROM public.partial_applications p
  WHERE p.email IS NOT NULL AND p.email ~ '@'
    AND COALESCE(p.step, '') <> 'inbound_dm'
    AND p.converted_at IS NULL AND p.recovered_at IS NULL
    AND p.recovery_email_sent_at IS NULL
    AND p.created_at BETWEEN now() - interval '14 days' AND now() - interval '2 hours'
    AND (p.form_data::text ILIKE '%instagram%' OR p.form_data::text ILIKE '%"utm_source": "ig"%'
         OR EXISTS (SELECT 1 FROM public.inbox_messages m WHERE m.raw_payload->>'partial_application_id' = p.id::text))
    AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE lower(a.email) = lower(p.email))
  ORDER BY p.created_at DESC
  LIMIT 25;
$$;
REVOKE ALL ON FUNCTION public.fn_ig_abandoned_partials() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ig_abandoned_partials() TO service_role;

-- One row per day, never blank: what the follow-up engine did and whether it worked.
CREATE OR REPLACE VIEW public.v_ig_followup_truth AS
WITH m AS (SELECT * FROM public.inbox_messages WHERE source = 'instagram' AND received_at >= now() - interval '30 days')
SELECT d.day,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag'='nudge1' AND raw_payload->>'mid' IS NOT NULL AND received_at::date = d.day) AS nudge1_delivered,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag'='nudge2' AND raw_payload->>'mid' IS NOT NULL AND received_at::date = d.day) AS nudge2_delivered,
  (SELECT count(*) FROM m WHERE direction='outbound' AND raw_payload->>'tag' LIKE 'nudge%' AND raw_payload->>'error' IS NOT NULL AND received_at::date = d.day) AS nudges_refused,
  (SELECT count(DISTINCT n.external_id) FROM m n WHERE n.direction='outbound' AND n.raw_payload->>'tag' LIKE 'nudge%' AND n.raw_payload->>'mid' IS NOT NULL AND n.received_at::date = d.day
     AND EXISTS (SELECT 1 FROM m i WHERE i.direction='inbound' AND i.external_id = n.external_id AND i.received_at BETWEEN n.received_at AND n.received_at + interval '6 hours')) AS replied_within_6h,
  (SELECT count(*) FROM public.partial_applications p WHERE p.recovery_email_sent_at::date = d.day) AS recovery_emails_sent
FROM (SELECT generate_series((now() - interval '29 days')::date, now()::date, '1 day')::date AS day) d
ORDER BY d.day DESC;
REVOKE ALL ON public.v_ig_followup_truth FROM anon, authenticated;
GRANT SELECT ON public.v_ig_followup_truth TO service_role;

-- Every 10 minutes. Same bearer pattern as apex-instagram-comments-backfill.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'apex-instagram-dm-nudge';
SELECT cron.schedule('apex-instagram-dm-nudge', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/instagram-dm-nudge',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token'), 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$cron$);
