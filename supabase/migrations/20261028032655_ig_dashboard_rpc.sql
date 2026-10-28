-- MP-305 Wave 4: one call that renders Sam's Instagram command center.
-- Everything is graded on DELIVERIES (an outbound row with no refusal, mid when the
-- sender stamped one), never on rows written. Admin/manager only; the service role
-- and the migration owner may call it for proofs.
CREATE OR REPLACE FUNCTION public.fn_ig_dashboard(p_window text DEFAULT '7d')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_since timestamptz;
  v_links_at timestamptz;
  v_health jsonb;
  v_status jsonb; v_kpis jsonb; v_queues jsonb; v_winners jsonb; v_people jsonb;
  PHONE constant text := '\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}';
  EMAIL constant text := '[\w.+-]+@[\w-]+\.[\w.-]+';
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR current_user = 'postgres'
          OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_since := CASE p_window
    WHEN 'today' THEN (date_trunc('day', now() AT TIME ZONE 'America/Phoenix') AT TIME ZONE 'America/Phoenix')
    WHEN '30d'   THEN now() - interval '30 days'
    ELSE now() - interval '7 days' END;

  BEGIN
    SELECT trim(both '"' from value)::timestamptz INTO v_links_at FROM system_settings WHERE key = 'instagram_links_blocked_at';
  EXCEPTION WHEN OTHERS THEN v_links_at := NULL; END;

  BEGIN
    SELECT content::jsonb INTO v_health FROM net._http_response
    WHERE content::text LIKE '%"healthy"%' AND created > now() - interval '1 hour' ORDER BY created DESC LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_health := NULL; END;

  CREATE TEMP TABLE IF NOT EXISTS _ig ON COMMIT DROP AS
    SELECT id, coalesce(external_id, sender_handle) AS ext, sender_handle, sender_name, body, direction, intent, auto_replied, received_at, raw_payload,
           (direction = 'outbound' AND raw_payload->>'error' IS NULL AND raw_payload->>'queued' IS NULL) AS delivered
    FROM inbox_messages WHERE source = 'instagram' AND received_at >= now() - interval '31 days';
  CREATE INDEX IF NOT EXISTS _ig_ext ON _ig(ext, received_at);

  v_status := jsonb_build_object(
    'links_blocked', (v_links_at IS NOT NULL AND v_links_at > now() - interval '24 hours'),
    'links_blocked_at', v_links_at,
    'last_link_refusal_at', (SELECT max(received_at) FROM _ig WHERE direction='outbound' AND (raw_payload->>'send_failed_kind' = 'link_blocked' OR raw_payload->>'error' ILIKE 'Invalid message id%')),
    'links_proven_at', (SELECT max(received_at) FROM _ig WHERE delivered AND raw_payload->>'mid' IS NOT NULL AND body ~* 'https?://'),
    'token_ok', CASE WHEN v_health IS NULL THEN NULL ELSE NOT coalesce((v_health->'token'->>'dead')::boolean, false) END,
    'token_checked_at', v_health->>'ts',
    'ig_username', coalesce(v_health->'token'->>'username', 'sell4daddy'),
    'last_delivered_at', (SELECT max(received_at) FROM _ig WHERE delivered),
    'last_bot_delivered_at', (SELECT max(received_at) FROM _ig WHERE delivered AND auto_replied),
    'last_inbound_at', (SELECT max(received_at) FROM _ig WHERE direction='inbound'),
    'nudge_cron_last_at', (SELECT max(d.start_time) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='apex-instagram-dm-nudge'),
    'nudge_cron_last_status', (SELECT d.status FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='apex-instagram-dm-nudge' ORDER BY d.start_time DESC LIMIT 1),
    'generated_at', now()
  );

  v_kpis := jsonb_build_object(
    'window', p_window, 'since', v_since,
    'inbound_msgs', (SELECT count(*) FROM _ig WHERE direction='inbound' AND received_at >= v_since),
    'inbound_people', (SELECT count(DISTINCT ext) FROM _ig WHERE direction='inbound' AND received_at >= v_since),
    'replied_people', (SELECT count(DISTINCT i.ext) FROM _ig i WHERE i.direction='inbound' AND i.received_at >= v_since
        AND EXISTS (SELECT 1 FROM _ig o WHERE o.delivered AND o.ext = i.ext AND o.received_at BETWEEN i.received_at AND i.received_at + interval '24 hours')),
    'unanswered_people', (SELECT count(*) FROM (
        SELECT ext, max(received_at) FILTER (WHERE direction='inbound') li, max(received_at) FILTER (WHERE delivered) lo
        FROM _ig WHERE received_at >= v_since GROUP BY ext) t WHERE li IS NOT NULL AND (lo IS NULL OR lo < li)),
    'delivered_msgs', (SELECT count(*) FROM _ig WHERE delivered AND received_at >= v_since),
    'bot_msgs', (SELECT count(*) FROM _ig WHERE delivered AND auto_replied AND received_at >= v_since),
    'sam_msgs', (SELECT count(*) FROM _ig WHERE delivered AND NOT auto_replied AND received_at >= v_since),
    'refused_msgs', (SELECT count(*) FROM _ig WHERE direction='outbound' AND raw_payload->>'error' IS NOT NULL AND received_at >= v_since),
    'licensed_leads', (SELECT count(DISTINCT ext) FROM _ig WHERE direction='inbound' AND intent IN ('licensed','licensed_team') AND received_at >= v_since),
    'phones_captured', (SELECT count(DISTINCT ext) FROM _ig WHERE direction='inbound' AND received_at >= v_since AND body ~ PHONE),
    'emails_captured', (SELECT count(DISTINCT ext) FROM _ig WHERE direction='inbound' AND received_at >= v_since AND body ~ EMAIL),
    'calls_booked', (SELECT count(*) FROM interview_events WHERE match_method='instagram' AND created_at >= v_since),
    'applicants', (SELECT count(*) FROM applications WHERE lower(coalesce(utm_source,'')) IN ('instagram','ig') AND created_at >= v_since),
    'nudges_delivered', (SELECT count(*) FROM _ig WHERE delivered AND raw_payload->>'tag' LIKE 'nudge%' AND received_at >= v_since),
    'recovery_emails', (SELECT count(*) FROM partial_applications WHERE recovery_email_sent_at >= v_since),
    'median_reply_secs', (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (f.first_out - f.received_at))) FROM (
        SELECT i.received_at, (SELECT min(o.received_at) FROM _ig o WHERE o.delivered AND o.ext = i.ext AND o.received_at >= i.received_at) first_out
        FROM _ig i WHERE i.direction='inbound' AND i.received_at >= v_since) f WHERE f.first_out IS NOT NULL)
  );

  v_queues := jsonb_build_object(
    'hot', coalesce((SELECT jsonb_agg(h ORDER BY h.booked ASC, h.last_at DESC) FROM (
        SELECT t.ext AS external_id,
          (SELECT sender_handle FROM _ig WHERE ext = t.ext AND direction='inbound' AND sender_handle IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS handle,
          (SELECT sender_name FROM _ig WHERE ext = t.ext AND sender_name IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS name,
          (SELECT substring(body FROM PHONE) FROM _ig WHERE ext = t.ext AND direction='inbound' AND body ~ PHONE ORDER BY received_at DESC LIMIT 1) AS phone,
          (SELECT substring(body FROM EMAIL) FROM _ig WHERE ext = t.ext AND direction='inbound' AND body ~ EMAIL ORDER BY received_at DESC LIMIT 1) AS email,
          EXISTS (SELECT 1 FROM _ig WHERE ext = t.ext AND direction='outbound' AND body ~* '^locked in') AS booked,
          t.last_at,
          (SELECT body FROM _ig WHERE ext = t.ext ORDER BY received_at DESC LIMIT 1) AS last_body,
          (SELECT direction FROM _ig WHERE ext = t.ext ORDER BY received_at DESC LIMIT 1) AS last_direction
        FROM (SELECT ext, max(received_at) last_at FROM _ig WHERE direction='inbound' AND intent IN ('licensed','licensed_team') AND received_at >= now() - interval '14 days' GROUP BY ext) t) h), '[]'::jsonb),
    'waiting', coalesce((SELECT jsonb_agg(w ORDER BY (w.intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup')) DESC, w.last_at ASC) FROM (
        SELECT t.ext AS external_id,
          (SELECT sender_handle FROM _ig WHERE ext = t.ext AND direction='inbound' AND sender_handle IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS handle,
          (SELECT sender_name FROM _ig WHERE ext = t.ext AND sender_name IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS name,
          t.li AS last_at,
          round(extract(epoch FROM (now() - t.li)) / 60) AS age_min,
          (SELECT body FROM _ig WHERE ext = t.ext AND direction='inbound' ORDER BY received_at DESC LIMIT 1) AS last_body,
          (SELECT intent FROM _ig WHERE ext = t.ext AND direction='inbound' ORDER BY received_at DESC LIMIT 1) AS intent,
          EXISTS (SELECT 1 FROM _ig WHERE ext = t.ext AND intent IN ('sam_manual','sam_thread') AND received_at > now() - interval '14 days') AS human_lane,
          (now() - t.li) < interval '24 hours' AS window_open
        FROM (SELECT ext, max(received_at) FILTER (WHERE direction='inbound') li, max(received_at) FILTER (WHERE delivered) lo
              FROM _ig WHERE received_at >= now() - interval '7 days' GROUP BY ext) t
        WHERE t.li IS NOT NULL AND (t.lo IS NULL OR t.lo < t.li)
          AND coalesce((SELECT intent FROM _ig WHERE ext = t.ext AND direction='inbound' ORDER BY received_at DESC LIMIT 1), '') NOT IN ('spam','troll','not_interested')) w), '[]'::jsonb),
    'booked', coalesce((SELECT jsonb_agg(b ORDER BY b.scheduled_at) FROM (
        SELECT id, invitee_name, invitee_phone, instagram_handle, scheduled_at, event_type_name, source
        FROM interview_events WHERE match_method='instagram' AND scheduled_at >= now() - interval '1 day' ORDER BY scheduled_at LIMIT 20) b), '[]'::jsonb),
    'nudged', coalesce((SELECT jsonb_agg(n ORDER BY n.at DESC) FROM (
        SELECT o.ext AS external_id, (SELECT sender_handle FROM _ig WHERE ext = o.ext AND direction='inbound' AND sender_handle IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS handle,
          o.raw_payload->>'tag' AS tag, o.body, o.received_at AS at, (o.raw_payload->>'mid' IS NOT NULL) AS delivered,
          EXISTS (SELECT 1 FROM _ig i WHERE i.ext = o.ext AND i.direction='inbound' AND i.received_at > o.received_at) AS replied
        FROM _ig o WHERE o.direction='outbound' AND o.raw_payload->>'tag' LIKE 'nudge%' AND o.received_at >= now() - interval '48 hours') n), '[]'::jsonb),
    'recovery', coalesce((SELECT jsonb_agg(r ORDER BY r.sent_at DESC) FROM (
        SELECT p.id, p.email, p.first_name, p.recovery_email_sent_at AS sent_at,
          (p.converted_at IS NOT NULL OR p.recovered_at IS NOT NULL OR EXISTS (SELECT 1 FROM applications a WHERE lower(a.email) = lower(p.email) AND a.created_at > p.recovery_email_sent_at)) AS recovered
        FROM partial_applications p WHERE p.recovery_email_sent_at >= now() - interval '14 days') r), '[]'::jsonb)
  );

  v_winners := jsonb_build_object(
    'reels', coalesce((SELECT jsonb_agg(r) FROM (
        SELECT external_id, title, url, views, likes, comments, posted_at, thumb_url,
          (SELECT count(*) FROM ig_comment_events c WHERE c.media_id = x.external_id) AS comment_events,
          (SELECT count(*) FROM ig_comment_events c WHERE c.media_id = x.external_id AND c.text ~* '\mapex\M') AS keyword_comments,
          (SELECT count(*) FROM ig_comment_events c WHERE c.media_id = x.external_id AND c.dm_sent) AS dms_from_comments
        FROM (SELECT DISTINCT ON (external_id) external_id, title, url, views, likes, comments, posted_at, thumb_url
              FROM content_posts WHERE platform='instagram' AND posted_at >= now() - interval '30 days' ORDER BY external_id, stats_at DESC NULLS LAST) x
        ORDER BY views DESC NULLS LAST LIMIT 10) r), '[]'::jsonb),
    'intents', coalesce((SELECT jsonb_agg(i ORDER BY i.people DESC) FROM (
        SELECT intent, count(DISTINCT ext) AS people FROM _ig WHERE direction='inbound' AND received_at >= now() - interval '30 days'
          AND intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','greeting','casual','props') GROUP BY intent) i), '[]'::jsonb),
    'applicants', coalesce((SELECT jsonb_agg(a ORDER BY a.created_at DESC) FROM (
        SELECT id, first_name, left(coalesce(last_name,''),1) AS last_initial, created_at, status, instagram_handle, utm_source
        FROM applications WHERE lower(coalesce(utm_source,'')) IN ('instagram','ig') AND created_at >= now() - interval '30 days' ORDER BY created_at DESC LIMIT 20) a), '[]'::jsonb),
    'best_lines', coalesce((SELECT jsonb_agg(l ORDER BY l.reply_rate DESC, l.sends DESC) FROM (
        SELECT line, sends, replies, round(100.0 * replies / sends) AS reply_rate FROM (
          SELECT left(regexp_replace(o.body, 'https?://\S+', '<link>', 'g'), 90) AS line, count(*) AS sends,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _ig i WHERE i.ext = o.ext AND i.direction='inbound' AND i.received_at BETWEEN o.received_at AND o.received_at + interval '24 hours')) AS replies
          FROM _ig o WHERE o.delivered AND o.auto_replied AND o.received_at >= now() - interval '30 days' AND length(o.body) > 6 GROUP BY 1) s
        WHERE sends >= 4 ORDER BY reply_rate DESC, sends DESC LIMIT 8) l), '[]'::jsonb)
  );

  v_people := coalesce((SELECT jsonb_agg(p ORDER BY p.last_at DESC) FROM (
      SELECT t.ext AS external_id,
        (SELECT sender_handle FROM _ig WHERE ext = t.ext AND direction='inbound' AND sender_handle IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS handle,
        (SELECT sender_name FROM _ig WHERE ext = t.ext AND sender_name IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS name,
        t.last_at,
        (SELECT body FROM _ig WHERE ext = t.ext ORDER BY received_at DESC LIMIT 1) AS last_body,
        (SELECT direction FROM _ig WHERE ext = t.ext ORDER BY received_at DESC LIMIT 1) AS last_direction,
        coalesce((SELECT intent FROM _ig WHERE ext = t.ext AND direction='inbound' AND intent IN ('licensed','licensed_team','opportunity','mentorship','fitness','rentals','partnership') ORDER BY received_at DESC LIMIT 1),
                 (SELECT intent FROM _ig WHERE ext = t.ext AND direction='inbound' ORDER BY received_at DESC LIMIT 1)) AS intent,
        t.msgs,
        (SELECT substring(body FROM PHONE) FROM _ig WHERE ext = t.ext AND direction='inbound' AND body ~ PHONE ORDER BY received_at DESC LIMIT 1) AS phone,
        EXISTS (SELECT 1 FROM _ig WHERE ext = t.ext AND direction='outbound' AND body ~* '^locked in') AS booked,
        EXISTS (SELECT 1 FROM _ig WHERE ext = t.ext AND intent IN ('sam_manual','sam_thread') AND received_at > now() - interval '14 days') AS human_lane,
        (t.li IS NOT NULL AND (t.lo IS NULL OR t.lo < t.li)) AS awaiting_us
      FROM (SELECT ext, max(received_at) last_at, count(*) msgs, max(received_at) FILTER (WHERE direction='inbound') li, max(received_at) FILTER (WHERE delivered) lo
            FROM _ig WHERE received_at >= now() - interval '14 days' GROUP BY ext ORDER BY max(received_at) DESC LIMIT 60) t) p), '[]'::jsonb);

  RETURN jsonb_build_object('status', v_status, 'kpis', v_kpis, 'queues', v_queues, 'winners', v_winners, 'people', v_people);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ig_dashboard(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_ig_dashboard(text) TO authenticated, service_role;
