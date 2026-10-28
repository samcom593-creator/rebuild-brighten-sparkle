-- Mirrored 2026-10-28 from supabase_migrations.schema_migrations (applied via MCP by the MP-305 session on 10-28; the file
-- must exist under the recorded version or `supabase db push` refuses every later migration: see apex_mcp_migrations_must_mirror).
-- MP-305 Wave 5 (2026-10-28): the IG desk. One list, one lever, six small numbers.
--
-- What this migration adds
--   ig_thread_actions      what Sam did to a thread from the desk (handled / snoozed / dismissed /
--                          relabeled / mine / emailed / sam_sent / tag_refused ...). Append-only.
--   fn_ig_phone10(text)    the ONE phone extractor: a NANP 10-digit national number or NULL.
--   fn_ig_thread_action()  writes one action row and performs its side effect inside the
--                          SECURITY DEFINER boundary (intent relabels on inbox_messages, the
--                          pre-insert of Sam's own outbound row) so the client needs no grant on
--                          inbox_messages.
--   fn_ig_thread()         the last 24 messages of one thread, for the History sheet.
--   fn_ig_dashboard() v2   needs[] / everyone[] / later[] / lever{} / funnel{} / working{} /
--                          health{} / people[] / status{}. Replaces kpis/queues/winners, whose only
--                          consumer (src/pages/InstagramInbox.tsx) is rewritten in the same commit.
--
-- CONVERSION TRACKING — source and window of every stage, in writing (check:metric-truth operand).
--   window        fixed 30 days (p_window '30d'; '7d'/'today' still accepted). prior = the same
--                 length immediately before. Ages are computed from received_at in UTC here; only
--                 the client formats America/Phoenix.
--   person key    ext = coalesce(external_id, sender_handle) on inbox_messages (source='instagram').
--   in            distinct ext with an inbound row in the window whose intent is not spam/troll.      caption 'by dm'
--   business      ext in 'in' with any inbound intent in the window IN (opportunity, licensed,
--                 licensed_team, mentorship, fitness, rentals, partnership, followup). Relabels from
--                 the desk UPDATE the row's intent, so they count here.                               caption 'said business'
--   licensed      ext in 'in' with any inbound intent IN (licensed, licensed_team). Self-reported.  caption 'said licensed'
--   number        ext in 'in' with an inbound body in the window carrying a valid 10-digit NANP
--                 number (fn_ig_phone10), OR an applications row matched by instagram_handle with
--                 phone IS NOT NULL.                                                                  caption 'gave a number'
--   booked        count(*) interview_events WHERE match_method='instagram' AND canceled_at IS NULL
--                 AND created_at in the window. The bot's "locked in" text is NEVER the source; the
--                 gap between the two is printed as funnel.locked_in_gap.                             caption 'calendly'
--   showed        booked rows with outcome IN (completed, hired, contracted, passed) OR ended_at
--                 IS NOT NULL. no_show = outcome 'no_show'. not_marked = outcome NULL and past.       caption 'outcome tapped'
--   applied       applications created in the window with utm_source IN (instagram, ig, sell4daddy)
--                 ('by link') OR instagram_handle matching any IG inbound sender ('by handle').       caption 'by link or handle'
--   hired         agents rows created in the window whose source_application_id is an IG-attributed
--                 application (any time) and whose status IN (active, pending).                       caption 'agents table'
--   recovered     partial_applications with recovery_email_sent_at in the window, step <> inbound_dm
--                 (the brain's own stubs), numerator = converted/recovered/or a later application
--                 with the same email.                                                                caption 'recovery email'
--   delivery      proven  = outbound with raw_payload->>'mid' (Meta receipt). Only this may be
--                 labelled "delivered" anywhere.
--                 handed  = auto_replied AND no error AND no mid (the brain's ManyChat path; it gets
--                 no receipt).
--                 refused = raw_payload->>'error' IS NOT NULL.
--   needs[]       business threads that need Sam, one status word each, ranked:
--                 call (business + 10-digit phone + no interview_events row, licensed first) >
--                 today (interview_events match_method='instagram', canceled NULL, scheduled now-24h
--                 .. now+48h, outcome exposed) > closing (theirs last, 20h-24h) > reply (theirs
--                 last, <20h) > tag_it (theirs last, 24h-7d, no tag refusal in 7d, and only when
--                 system_settings.instagram_human_agent_supported = true) > closed (theirs last,
--                 window shut). "theirs last" = last inbound newer than the last unrefused outbound.
--                 A thread whose latest visibility action is 'handled' newer than its last inbound,
--                 or 'snoozed' with snoozed_until in the future, is excluded; a newer inbound reopens
--                 it. Thread intent = the latest inbound intent, except that small talk (ack,
--                 greeting, casual, props, socials, flirty, assistant_ask, sam_thread) does not erase
--                 a business intent seen in the window; not_interested/spam/troll always win.

CREATE TABLE IF NOT EXISTS public.ig_thread_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('handled','unhandled','snoozed','unsnoozed','dismissed','relabeled','mine','emailed','sam_sent','tag_refused','note','called','followup_sent')),
  snoozed_until timestamptz,
  note text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ig_thread_actions_ext_created_idx ON public.ig_thread_actions (external_id, created_at DESC);
ALTER TABLE public.ig_thread_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ig_thread_actions_staff_select ON public.ig_thread_actions;
CREATE POLICY ig_thread_actions_staff_select ON public.ig_thread_actions FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));
DROP POLICY IF EXISTS ig_thread_actions_staff_insert ON public.ig_thread_actions;
CREATE POLICY ig_thread_actions_staff_insert ON public.ig_thread_actions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));
REVOKE ALL ON public.ig_thread_actions FROM public, anon;
GRANT SELECT, INSERT ON public.ig_thread_actions TO authenticated;
GRANT ALL ON public.ig_thread_actions TO service_role;

-- A NANP national number out of free text, or NULL. Lookarounds refuse a longer digit run; the
-- area code and exchange must start 2-9, so "1234567890" (an order number) is not a phone.
CREATE OR REPLACE FUNCTION public.fn_ig_phone10(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = public AS $$
  SELECT CASE WHEN length(d) = 10 THEN d WHEN length(d) = 11 AND left(d, 1) = '1' THEN right(d, 10) END
  FROM (SELECT regexp_replace(coalesce(substring(p_text FROM '(?<!\d)1?[\s.-]?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?!\d)'), ''), '\D', '', 'g') AS d) s;
$$;

CREATE OR REPLACE FUNCTION public.fn_ig_thread_action(
  p_external_id text, p_action text, p_until timestamptz DEFAULT NULL, p_note text DEFAULT NULL,
  p_intent text DEFAULT NULL, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_last_id uuid; v_last_intent text; v_last_handle text; v_last_name text;
  v_row public.ig_thread_actions; v_meta jsonb := coalesce(p_meta, '{}'::jsonb); v_new_id uuid;
  ALLOWED_INTENTS constant text[] := ARRAY['opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup','greeting','casual','props','socials','flirty','ack','assistant_ask'];
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR current_user = 'postgres'
          OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_external_id IS NULL OR length(trim(p_external_id)) = 0 THEN RAISE EXCEPTION 'external_id required'; END IF;

  SELECT id, intent, sender_handle, sender_name INTO v_last_id, v_last_intent, v_last_handle, v_last_name
  FROM inbox_messages WHERE source = 'instagram' AND direction = 'inbound' AND coalesce(external_id, sender_handle) = p_external_id
  ORDER BY received_at DESC LIMIT 1;

  CASE p_action
    WHEN 'snoozed' THEN
      IF p_until IS NULL THEN RAISE EXCEPTION 'snoozed needs p_until'; END IF;
    WHEN 'dismissed' THEN
      -- The waiting filter and fn_ig_nudge_candidates both stop chasing not_interested.
      IF v_last_id IS NOT NULL THEN
        v_meta := v_meta || jsonb_build_object('from', v_last_intent, 'to', 'not_interested', 'inbox_message_id', v_last_id);
        UPDATE inbox_messages SET intent = 'not_interested' WHERE id = v_last_id;
      END IF;
    WHEN 'relabeled' THEN
      -- 'that's a lead' offers opportunity / licensed; the undo of 'not a lead' restores whatever was there.
      IF p_intent IS NULL OR NOT (p_intent = ANY (ALLOWED_INTENTS)) THEN RAISE EXCEPTION 'relabeled needs a known intent, got %', p_intent; END IF;
      IF v_last_id IS NOT NULL THEN
        v_meta := v_meta || jsonb_build_object('from', v_last_intent, 'to', p_intent, 'inbox_message_id', v_last_id);
        UPDATE inbox_messages SET intent = p_intent WHERE id = v_last_id;
      END IF;
    WHEN 'mine' THEN
      -- Dashboards and fn_ig_nudge_candidates read sam_thread as the human lane; manychat-webhook
      -- reads THIS table ('mine' within 14 days) before it answers.
      IF v_last_id IS NOT NULL THEN
        v_meta := v_meta || jsonb_build_object('from', v_last_intent, 'to', 'sam_thread', 'inbox_message_id', v_last_id);
        UPDATE inbox_messages SET intent = 'sam_thread' WHERE id = v_last_id;
      END IF;
    WHEN 'sam_sent' THEN
      -- Sam's own outbound row goes in BEFORE send-instagram-dm runs, so its stampOutcome (body +
      -- external_id within 15 min) lands the Meta mid on HIS row instead of inserting an
      -- auto_replied:true row that grades his words as bot lines. intent sam_manual also mutes the
      -- brain on this thread for 14 days, exactly as a reply typed in the app does.
      IF p_note IS NULL OR length(trim(p_note)) = 0 THEN RAISE EXCEPTION 'sam_sent needs the message in p_note'; END IF;
      INSERT INTO inbox_messages (source, external_id, sender_handle, sender_name, body, direction, auto_replied, intent, received_at, raw_payload)
      VALUES ('instagram', p_external_id, coalesce(v_last_handle, p_external_id), v_last_name, p_note, 'outbound', false, 'sam_manual', now(),
              jsonb_build_object('path', 'desk', 'actor_id', auth.uid()) || CASE WHEN coalesce((p_meta->>'human_agent')::boolean, false) THEN '{"human_agent": true}'::jsonb ELSE '{}'::jsonb END)
      RETURNING id INTO v_new_id;
      v_meta := v_meta || jsonb_build_object('inbox_message_id', v_new_id);
    WHEN 'handled', 'unhandled', 'unsnoozed', 'emailed', 'tag_refused', 'note', 'called', 'followup_sent' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'unknown action %', p_action;
  END CASE;

  INSERT INTO ig_thread_actions (external_id, action, snoozed_until, note, meta, actor_id)
  VALUES (p_external_id, p_action, CASE WHEN p_action = 'snoozed' THEN p_until END, p_note, v_meta, auth.uid())
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row) || jsonb_build_object('inbox_message_id', v_new_id);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ig_thread_action(text, text, timestamptz, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_ig_thread_action(text, text, timestamptz, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ig_thread(p_external_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_msgs jsonb; v_handle text; v_name text;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR current_user = 'postgres'
          OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT sender_handle, sender_name INTO v_handle, v_name FROM inbox_messages
  WHERE source = 'instagram' AND direction = 'inbound' AND coalesce(external_id, sender_handle) = p_external_id AND sender_handle IS NOT NULL
  ORDER BY received_at DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(r ORDER BY r.received_at DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT id, direction, body, intent, auto_replied, received_at,
      raw_payload->>'mid' AS mid, raw_payload->>'send_failed_kind' AS send_failed_kind, raw_payload->>'error' AS error,
      raw_payload->>'queued' AS queued, raw_payload->>'tag' AS tag, raw_payload->>'path' AS path,
      coalesce((raw_payload->>'link_stripped')::boolean, false) AS link_stripped
    FROM inbox_messages WHERE source = 'instagram' AND coalesce(external_id, sender_handle) = p_external_id
    ORDER BY received_at DESC LIMIT 24) r;
  RETURN jsonb_build_object('external_id', p_external_id, 'handle', v_handle, 'name', v_name, 'messages', v_msgs);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ig_thread(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_ig_thread(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_ig_dashboard(p_window text DEFAULT '30d')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_since timestamptz; v_prior timestamptz; v_links_at timestamptz; v_health jsonb; v_hat boolean := false;
  v_status jsonb; v_needs jsonb; v_everyone jsonb; v_later jsonb; v_lever jsonb; v_funnel jsonb; v_working jsonb; v_hlth jsonb; v_people jsonb;
  c_in int; c_business int; c_licensed int; c_number int; c_booked int; c_showed int; c_noshow int; c_notmarked int;
  c_applied int; c_applied_link int; c_applied_handle int; c_hired int; c_rec_n int; c_rec_d int;
  p_in int; p_business int; p_licensed int; p_number int; p_booked int; p_showed int; p_applied int; p_hired int; p_rec_n int; p_rec_d int;
  v_gap int; v_bn int; v_nb int; v_bs int; v_biz_with_number int; v_best int;
  v_lever_key text; v_lever_sentence text; v_lever_button text; v_lever_people jsonb;
  v_top_cta jsonb; v_top_views jsonb;
  EMAIL constant text := '[\w.+-]+@[\w-]+\.[\w.-]+';
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR current_user = 'postgres'
          OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_since := CASE p_window
    WHEN 'today' THEN (date_trunc('day', now() AT TIME ZONE 'America/Phoenix') AT TIME ZONE 'America/Phoenix')
    WHEN '7d'    THEN now() - interval '7 days'
    ELSE now() - interval '30 days' END;
  v_prior := v_since - (now() - v_since);

  BEGIN
    SELECT trim(both '"' from value::text)::timestamptz INTO v_links_at FROM system_settings WHERE key = 'instagram_links_blocked_at';
  EXCEPTION WHEN OTHERS THEN v_links_at := NULL; END;
  BEGIN
    SELECT lower(trim(both '"' from value::text)) = 'true' INTO v_hat FROM system_settings WHERE key = 'instagram_human_agent_supported';
  EXCEPTION WHEN OTHERS THEN v_hat := false; END;
  v_hat := coalesce(v_hat, false);
  BEGIN
    SELECT content::jsonb INTO v_health FROM net._http_response
    WHERE content::text LIKE '%"healthy"%' AND content::text LIKE '%"token"%' AND created > now() - interval '1 hour'
    ORDER BY created DESC LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_health := NULL; END;

  DROP TABLE IF EXISTS _ig; DROP TABLE IF EXISTS _act; DROP TABLE IF EXISTS _app; DROP TABLE IF EXISTS _ie; DROP TABLE IF EXISTS _thr; DROP TABLE IF EXISTS _rows; DROP TABLE IF EXISTS _st;

  CREATE TEMP TABLE _ig ON COMMIT DROP AS
    SELECT id, coalesce(external_id, sender_handle) AS ext, sender_handle, sender_name, body, direction, intent, auto_replied, received_at, raw_payload,
           (direction = 'outbound' AND raw_payload->>'error' IS NULL AND raw_payload->>'queued' IS NULL) AS delivered,
           (direction = 'outbound' AND raw_payload->>'mid' IS NOT NULL) AS proven,
           CASE WHEN direction = 'inbound' THEN fn_ig_phone10(body) END AS phone10,
           CASE WHEN direction = 'inbound' THEN substring(body FROM EMAIL) END AS email
    FROM inbox_messages WHERE source = 'instagram' AND received_at >= now() - interval '61 days';
  CREATE INDEX ON _ig (ext, received_at);

  CREATE TEMP TABLE _act ON COMMIT DROP AS
    SELECT a.external_id AS ext,
      v.action AS vis_action, v.created_at AS vis_at, v.snoozed_until AS vis_until,
      max(a.created_at) FILTER (WHERE a.action = 'tag_refused' AND a.created_at > now() - interval '7 days') AS tag_refused_at,
      max(a.created_at) FILTER (WHERE a.action = 'mine' AND a.created_at > now() - interval '14 days') AS mine_at,
      (SELECT n.note FROM ig_thread_actions n WHERE n.external_id = a.external_id AND n.action = 'note' ORDER BY n.created_at DESC LIMIT 1) AS note
    FROM ig_thread_actions a
    LEFT JOIN LATERAL (SELECT action, created_at, snoozed_until FROM ig_thread_actions x WHERE x.external_id = a.external_id AND x.action IN ('handled','unhandled','snoozed','unsnoozed') ORDER BY x.created_at DESC LIMIT 1) v ON true
    GROUP BY a.external_id, v.action, v.created_at, v.snoozed_until;

  CREATE TEMP TABLE _app ON COMMIT DROP AS
    SELECT a.id, a.created_at, a.email, a.phone, fn_ig_phone10(a.phone) AS phone10, a.first_name, a.status::text AS status,
      lower(regexp_replace(coalesce(a.instagram_handle, ''), '^@', '')) AS h,
      (lower(coalesce(a.utm_source, '')) IN ('instagram','ig','sell4daddy')) AS by_link,
      (coalesce(a.instagram_handle, '') <> '' AND lower(regexp_replace(a.instagram_handle, '^@', '')) IN
         (SELECT lower(regexp_replace(m.sender_handle, '^@', '')) FROM inbox_messages m WHERE m.source = 'instagram' AND m.direction = 'inbound' AND m.sender_handle IS NOT NULL)) AS by_handle
    FROM applications a WHERE a.created_at >= now() - interval '180 days';

  CREATE TEMP TABLE _ie ON COMMIT DROP AS
    SELECT e.id, e.scheduled_at, e.created_at, e.invitee_name, e.invitee_phone, e.invitee_email, e.outcome, e.ended_at, e.event_type_name,
      lower(regexp_replace(coalesce(e.instagram_handle, ''), '^@', '')) AS h, fn_ig_phone10(e.invitee_phone) AS p10,
      (e.scheduled_at BETWEEN now() - interval '24 hours' AND now() + interval '48 hours') AS in_today
    FROM interview_events e WHERE e.match_method = 'instagram' AND e.canceled_at IS NULL AND e.created_at >= now() - interval '180 days';

  CREATE TEMP TABLE _thr ON COMMIT DROP AS
    SELECT t.ext, t.last_at, t.li AS last_inbound_at, t.lo AS last_delivered_at,
      (SELECT sender_handle FROM _ig WHERE ext = t.ext AND direction = 'inbound' AND sender_handle IS NOT NULL AND sender_handle !~ '^\d+$' ORDER BY received_at DESC LIMIT 1) AS handle,
      (SELECT sender_name FROM _ig WHERE ext = t.ext AND sender_name IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS name,
      (SELECT body FROM _ig WHERE ext = t.ext ORDER BY received_at DESC LIMIT 1) AS last_body,
      (SELECT direction FROM _ig WHERE ext = t.ext ORDER BY received_at DESC LIMIT 1) AS last_direction,
      (SELECT id FROM _ig WHERE ext = t.ext AND direction = 'inbound' ORDER BY received_at DESC LIMIT 1) AS last_inbound_id,
      (SELECT intent FROM _ig WHERE ext = t.ext AND direction = 'inbound' ORDER BY received_at DESC LIMIT 1) AS last_intent,
      (SELECT intent FROM _ig WHERE ext = t.ext AND direction = 'inbound' AND received_at >= v_since
         AND intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup') ORDER BY received_at DESC LIMIT 1) AS biz_intent,
      EXISTS (SELECT 1 FROM _ig WHERE ext = t.ext AND direction = 'inbound' AND intent IN ('licensed','licensed_team') AND received_at >= v_since) AS licensed,
      (SELECT phone10 FROM _ig WHERE ext = t.ext AND phone10 IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS dm_phone10,
      (SELECT email FROM _ig WHERE ext = t.ext AND email IS NOT NULL ORDER BY received_at DESC LIMIT 1) AS dm_email,
      EXISTS (SELECT 1 FROM _ig WHERE ext = t.ext AND intent IN ('sam_manual','sam_thread') AND received_at > now() - interval '14 days') AS human_lane,
      (t.li IS NOT NULL AND (t.lo IS NULL OR t.lo < t.li)) AS theirs_last,
      EXISTS (SELECT 1 FROM _ig WHERE ext = t.ext AND direction = 'outbound' AND delivered AND body ~* '^locked in' AND received_at >= now() - interval '60 days') AS told_locked_in
    FROM (SELECT ext, max(received_at) AS last_at, max(received_at) FILTER (WHERE direction = 'inbound') AS li,
                 max(received_at) FILTER (WHERE delivered) AS lo
          FROM _ig GROUP BY ext) t
    WHERE t.li IS NOT NULL;
  CREATE INDEX ON _thr (ext);

  CREATE TEMP TABLE _rows ON COMMIT DROP AS
    SELECT x.*,
      CASE x.status WHEN 'call' THEN 1 WHEN 'today' THEN 2 WHEN 'closing' THEN 3 WHEN 'reply' THEN 4 WHEN 'tag_it' THEN 5 WHEN 'closed' THEN 6
                    WHEN 'casual' THEN 7 WHEN 'open' THEN 8 WHEN 'snoozed' THEN 9 WHEN 'handled' THEN 10 WHEN 'booked' THEN 11 WHEN 'applied' THEN 12 ELSE 13 END AS rank
    FROM (
      SELECT y.*,
        CASE
          WHEN y.handled THEN 'handled'
          WHEN y.snoozed THEN 'snoozed'
          WHEN y.business AND y.phone10 IS NOT NULL AND NOT y.has_booking THEN 'call'
          WHEN y.business AND y.booked_event IS NOT NULL THEN 'today'
          WHEN y.business AND y.theirs_last AND y.age < interval '20 hours' THEN 'reply'
          WHEN y.business AND y.theirs_last AND y.age < interval '24 hours' THEN 'closing'
          WHEN y.business AND y.theirs_last AND y.age <= interval '7 days' AND y.tag_refused_at IS NULL AND v_hat THEN 'tag_it'
          WHEN y.business AND y.theirs_last THEN 'closed'
          WHEN y.theirs_last AND y.intent NOT IN ('spam','troll','not_interested') THEN 'casual'
          WHEN y.has_booking THEN 'booked'
          WHEN y.applied THEN 'applied'
          WHEN y.age < interval '24 hours' THEN 'open'
          ELSE 'closed' END AS status
      FROM (
        SELECT z.*,
          (z.intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup') OR z.has_booking) AND z.intent NOT IN ('spam','troll','not_interested') AS business,
          (z.vis_action = 'handled' AND z.vis_at > z.last_inbound_at) AS handled,
          (z.vis_action = 'snoozed' AND z.vis_until > now()) AS snoozed,
          (now() - z.last_inbound_at) AS age
        FROM (
          SELECT w.*,
            EXISTS (SELECT 1 FROM _ie e WHERE (w.handle_n <> '' AND e.h = w.handle_n) OR (w.phone10 IS NOT NULL AND e.p10 = w.phone10)) AS has_booking,
            (SELECT jsonb_build_object('id', e.id, 'scheduled_at', e.scheduled_at, 'invitee_phone', e.invitee_phone, 'invitee_name', e.invitee_name, 'outcome', e.outcome, 'event_type_name', e.event_type_name)
               FROM _ie e WHERE e.in_today AND ((w.handle_n <> '' AND e.h = w.handle_n) OR (w.phone10 IS NOT NULL AND e.p10 = w.phone10))
               ORDER BY abs(extract(epoch FROM (e.scheduled_at - now()))) LIMIT 1) AS booked_event,
            w.last_inbound_at + interval '24 hours' AS window_closes_at,
            round(extract(epoch FROM (now() - w.last_inbound_at)) / 60)::int AS age_min
          FROM (
            SELECT th.*, lower(regexp_replace(coalesce(th.handle, ''), '^@', '')) AS handle_n,
              coalesce(th.dm_phone10, ap.phone10) AS phone10, coalesce(th.dm_email, ap.email) AS email, ap.id AS application_id, (ap.id IS NOT NULL) AS applied,
              CASE WHEN th.last_intent IN ('spam','troll','not_interested') THEN th.last_intent
                   WHEN th.last_intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup') THEN th.last_intent
                   ELSE coalesce(th.biz_intent, th.last_intent, 'casual') END AS intent,
              ac.vis_action, ac.vis_at, ac.vis_until, ac.tag_refused_at, ac.note, (ac.mine_at IS NOT NULL OR th.human_lane) AS human_lane2
            FROM _thr th
            LEFT JOIN _act ac ON ac.ext = th.ext
            LEFT JOIN LATERAL (SELECT a.id, a.phone10, a.email FROM _app a
                                WHERE (lower(regexp_replace(coalesce(th.handle, ''), '^@', '')) <> '' AND a.h = lower(regexp_replace(coalesce(th.handle, ''), '^@', '')))
                                   OR (th.dm_phone10 IS NOT NULL AND a.phone10 = th.dm_phone10)
                                ORDER BY a.created_at DESC LIMIT 1) ap ON true
          ) w
        ) z
      ) y
    ) x;
  CREATE INDEX ON _rows (ext);

  -- The one row shape every surface renders.
  ALTER TABLE _rows ADD COLUMN j jsonb;
  UPDATE _rows r SET j = jsonb_build_object(
    'external_id', r.ext, 'handle', r.handle, 'name', r.name, 'status', r.status, 'rank', r.rank,
    'last_body', r.last_body, 'last_direction', r.last_direction, 'last_at', r.last_at, 'last_inbound_at', r.last_inbound_at, 'last_inbound_id', r.last_inbound_id,
    'age_min', r.age_min, 'window_closes_at', r.window_closes_at, 'phone', r.phone10, 'email', r.email, 'intent', r.intent, 'licensed', r.licensed,
    'human_lane', r.human_lane2, 'booked_event', r.booked_event, 'has_booking', r.has_booking, 'applied', r.applied, 'application_id', r.application_id,
    'tag_refused_at', r.tag_refused_at, 'handled_at', CASE WHEN r.handled THEN r.vis_at END, 'snoozed_until', CASE WHEN r.snoozed THEN r.vis_until END,
    'note', r.note, 'told_locked_in', r.told_locked_in);

  v_status := jsonb_build_object(
    'links_blocked', (v_links_at IS NOT NULL AND v_links_at > now() - interval '24 hours'),
    'links_blocked_at', v_links_at,
    'last_link_refusal_at', (SELECT max(received_at) FROM _ig WHERE direction = 'outbound' AND (raw_payload->>'send_failed_kind' = 'link_blocked' OR raw_payload->>'error' ILIKE 'Invalid message id%')),
    'links_proven_at', (SELECT max(received_at) FROM _ig WHERE proven AND body ~* 'https?://'),
    'token_ok', CASE WHEN v_health IS NULL THEN NULL ELSE NOT coalesce((v_health->'token'->>'dead')::boolean, false) END,
    'token_checked_at', v_health->>'ts',
    'ig_username', coalesce(v_health->'token'->>'username', 'sell4daddy'),
    'last_delivered_at', (SELECT max(received_at) FROM _ig WHERE proven),
    'last_bot_delivered_at', (SELECT max(received_at) FROM _ig WHERE delivered AND auto_replied),
    'last_inbound_at', (SELECT max(received_at) FROM _ig WHERE direction = 'inbound'),
    'nudge_cron_last_at', (SELECT max(d.start_time) FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE j.jobname = 'apex-instagram-dm-nudge'),
    'nudge_cron_last_status', (SELECT d.status FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE j.jobname = 'apex-instagram-dm-nudge' ORDER BY d.start_time DESC LIMIT 1),
    'human_agent_supported', v_hat,
    'window', p_window, 'since', v_since, 'prior_since', v_prior,
    'generated_at', now()
  );

  v_needs := coalesce((SELECT jsonb_agg(r.j ORDER BY r.rank,
      CASE WHEN r.status = 'call' THEN (NOT r.licensed)::int ELSE 0 END,
      CASE WHEN r.status = 'closing' THEN r.window_closes_at ELSE NULL END ASC NULLS LAST,
      CASE WHEN r.status = 'today' THEN (r.booked_event->>'scheduled_at')::timestamptz ELSE NULL END ASC NULLS LAST,
      r.last_inbound_at DESC)
    FROM _rows r WHERE r.business AND NOT r.handled AND NOT r.snoozed AND r.status IN ('call','today','closing','reply','tag_it','closed')
      AND (r.status IN ('today') OR (r.status = 'call' AND r.last_inbound_at >= v_since) OR r.last_inbound_at >= now() - interval '7 days')), '[]'::jsonb);
  v_everyone := coalesce((SELECT jsonb_agg(r.j ORDER BY r.last_inbound_at DESC) FROM _rows r WHERE r.status = 'casual' AND r.last_inbound_at >= now() - interval '7 days'), '[]'::jsonb);
  v_later := coalesce((SELECT jsonb_agg(r.j ORDER BY r.vis_until ASC) FROM _rows r WHERE r.status = 'snoozed'), '[]'::jsonb);

  -- Funnel stages, current and prior window, per person.
  CREATE TEMP TABLE _st ON COMMIT DROP AS
    SELECT w.w, i.ext,
      bool_or(i.intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup')) AS business,
      bool_or(i.intent IN ('licensed','licensed_team')) AS licensed,
      bool_or(i.phone10 IS NOT NULL) AS number_dm,
      max(i.received_at) AS last_in
    FROM (VALUES (0, v_since, now() + interval '1 day'), (1, v_prior, v_since)) AS w(w, s, e)
    JOIN _ig i ON i.direction = 'inbound' AND i.received_at >= w.s AND i.received_at < w.e AND coalesce(i.intent, '') NOT IN ('spam','troll')
    GROUP BY w.w, i.ext;
  ALTER TABLE _st ADD COLUMN number boolean, ADD COLUMN booked boolean;
  UPDATE _st s SET
    number = s.number_dm OR EXISTS (SELECT 1 FROM _rows r WHERE r.ext = s.ext AND r.applied AND r.phone10 IS NOT NULL),
    booked = EXISTS (SELECT 1 FROM _rows r JOIN _ie e ON ((r.handle_n <> '' AND e.h = r.handle_n) OR (r.phone10 IS NOT NULL AND e.p10 = r.phone10))
                     WHERE r.ext = s.ext AND e.created_at >= CASE s.w WHEN 0 THEN v_since ELSE v_prior END AND e.created_at < CASE s.w WHEN 0 THEN now() + interval '1 day' ELSE v_since END);

  SELECT count(*), count(*) FILTER (WHERE business), count(*) FILTER (WHERE licensed), count(*) FILTER (WHERE number), count(*) FILTER (WHERE business AND number)
    INTO c_in, c_business, c_licensed, c_number, v_biz_with_number FROM _st WHERE w = 0;
  SELECT count(*), count(*) FILTER (WHERE business), count(*) FILTER (WHERE licensed), count(*) FILTER (WHERE number)
    INTO p_in, p_business, p_licensed, p_number FROM _st WHERE w = 1;
  SELECT count(*), count(*) FILTER (WHERE outcome IN ('completed','hired','contracted','passed') OR ended_at IS NOT NULL),
         count(*) FILTER (WHERE outcome = 'no_show'), count(*) FILTER (WHERE outcome IS NULL AND scheduled_at < now())
    INTO c_booked, c_showed, c_noshow, c_notmarked FROM _ie WHERE created_at >= v_since;
  SELECT count(*), count(*) FILTER (WHERE outcome IN ('completed','hired','contracted','passed') OR ended_at IS NOT NULL)
    INTO p_booked, p_showed FROM _ie WHERE created_at >= v_prior AND created_at < v_since;
  SELECT count(*), count(*) FILTER (WHERE by_link), count(*) FILTER (WHERE by_handle AND NOT by_link)
    INTO c_applied, c_applied_link, c_applied_handle FROM _app WHERE created_at >= v_since AND (by_link OR by_handle);
  SELECT count(*) INTO p_applied FROM _app WHERE created_at >= v_prior AND created_at < v_since AND (by_link OR by_handle);
  SELECT count(*) INTO c_hired FROM agents a JOIN _app ap ON ap.id = a.source_application_id WHERE (ap.by_link OR ap.by_handle) AND a.status IN ('active','pending') AND a.created_at >= v_since;
  SELECT count(*) INTO p_hired FROM agents a JOIN _app ap ON ap.id = a.source_application_id WHERE (ap.by_link OR ap.by_handle) AND a.status IN ('active','pending') AND a.created_at >= v_prior AND a.created_at < v_since;
  SELECT count(*), count(*) FILTER (WHERE p.converted_at IS NOT NULL OR p.recovered_at IS NOT NULL OR EXISTS (SELECT 1 FROM applications a WHERE lower(a.email) = lower(p.email) AND a.created_at > p.recovery_email_sent_at))
    INTO c_rec_d, c_rec_n FROM partial_applications p WHERE p.recovery_email_sent_at >= v_since AND coalesce(p.step, '') <> 'inbound_dm';
  SELECT count(*), count(*) FILTER (WHERE p.converted_at IS NOT NULL OR p.recovered_at IS NOT NULL OR EXISTS (SELECT 1 FROM applications a WHERE lower(a.email) = lower(p.email) AND a.created_at > p.recovery_email_sent_at))
    INTO p_rec_d, p_rec_n FROM partial_applications p WHERE p.recovery_email_sent_at >= v_prior AND p.recovery_email_sent_at < v_since AND coalesce(p.step, '') <> 'inbound_dm';

  -- "locked in" promised by a delivered outbound in 60d, nothing on the calendar by handle or phone.
  SELECT count(*) INTO v_gap FROM _rows r WHERE r.told_locked_in AND NOT r.has_booking;
  v_bn := c_business - v_biz_with_number;
  SELECT count(*) INTO v_nb FROM _st s WHERE s.w = 0 AND s.number AND NOT s.booked;
  v_bs := c_booked - c_showed;

  IF v_gap >= 1 THEN
    v_lever_key := 'locked_in_gap';
    v_lever_sentence := format('%s %s told "locked in", nothing on the calendar. text a time.', v_gap, CASE WHEN v_gap = 1 THEN 'was' ELSE 'were' END);
    v_lever_button := format('text the %s', v_gap);
    v_lever_people := coalesce((SELECT jsonb_agg(r.j ORDER BY r.last_inbound_at DESC) FROM _rows r WHERE r.told_locked_in AND NOT r.has_booking), '[]'::jsonb);
  ELSE
    v_best := greatest(coalesce(v_bn, 0), coalesce(v_nb, 0), coalesce(v_bs, 0));
    IF v_best < 3 THEN
      v_lever_key := 'none'; v_lever_sentence := 'nothing''s leaking. go post.'; v_lever_button := NULL; v_lever_people := '[]'::jsonb;
    ELSIF v_bs = v_best THEN
      v_lever_key := 'booked_showed';
      v_lever_sentence := format('%s booked, %s showed. mark the rest.', c_booked, c_showed);
      v_lever_button := format('mark the %s', v_bs);
      v_lever_people := coalesce((SELECT jsonb_agg(coalesce(r.j, '{}'::jsonb) || jsonb_build_object('external_id', coalesce(r.ext, 'ie:' || e.id::text), 'handle', coalesce(r.handle, nullif(e.h, '')), 'name', coalesce(r.name, e.invitee_name), 'phone', coalesce(r.phone10, e.p10), 'email', coalesce(r.email, e.invitee_email), 'status', 'today', 'rank', 2,
          'booked_event', jsonb_build_object('id', e.id, 'scheduled_at', e.scheduled_at, 'invitee_phone', e.invitee_phone, 'invitee_name', e.invitee_name, 'outcome', e.outcome, 'event_type_name', e.event_type_name)) ORDER BY e.scheduled_at DESC)
        FROM _ie e LEFT JOIN LATERAL (SELECT * FROM _rows r WHERE (e.h <> '' AND r.handle_n = e.h) OR (e.p10 IS NOT NULL AND r.phone10 = e.p10) ORDER BY r.last_at DESC LIMIT 1) r ON true
        WHERE e.created_at >= v_since AND NOT (e.outcome IN ('completed','hired','contracted','passed') OR e.ended_at IS NOT NULL)), '[]'::jsonb);
    ELSIF v_nb = v_best THEN
      v_lever_key := 'number_booked';
      v_lever_sentence := format('%s gave a number, %s booked. text the %s.', c_number, c_number - v_nb, v_nb);
      v_lever_button := format('text the %s', v_nb);
      v_lever_people := coalesce((SELECT jsonb_agg(r.j ORDER BY r.last_inbound_at DESC) FROM _st s JOIN _rows r ON r.ext = s.ext WHERE s.w = 0 AND s.number AND NOT s.booked), '[]'::jsonb);
    ELSE
      v_lever_key := 'business_number';
      v_lever_sentence := format('%s talked business, %s gave a number. ask for the number sooner.', c_business, v_biz_with_number);
      v_lever_button := format('see the %s', v_bn);
      v_lever_people := coalesce((SELECT jsonb_agg(r.j ORDER BY r.last_inbound_at DESC) FROM (SELECT s.ext FROM _st s WHERE s.w = 0 AND s.business AND NOT s.number ORDER BY s.last_in DESC LIMIT 50) s JOIN _rows r ON r.ext = s.ext), '[]'::jsonb);
    END IF;
  END IF;
  v_lever := jsonb_build_object('key', v_lever_key, 'sentence', v_lever_sentence, 'button_label', v_lever_button, 'people', v_lever_people,
                                'lost', jsonb_build_object('business_number', v_bn, 'number_booked', v_nb, 'booked_showed', v_bs));

  v_funnel := jsonb_build_object(
    'since', v_since, 'prior_since', v_prior, 'locked_in_gap', v_gap,
    'locked_in_people', coalesce((SELECT jsonb_agg(r.j ORDER BY r.last_inbound_at DESC) FROM _rows r WHERE r.told_locked_in AND NOT r.has_booking), '[]'::jsonb),
    'stages', jsonb_build_array(
      jsonb_build_object('key', 'in', 'label', 'in', 'caption', 'by dm', 'count', c_in, 'prior_count', p_in, 'prev_key', NULL,
        'people', coalesce((SELECT jsonb_agg(r.j ORDER BY s.last_in DESC) FROM (SELECT ext, last_in FROM _st WHERE w = 0 ORDER BY last_in DESC LIMIT 50) s JOIN _rows r ON r.ext = s.ext), '[]'::jsonb)),
      jsonb_build_object('key', 'business', 'label', 'business', 'caption', 'said business', 'count', c_business, 'prior_count', p_business, 'prev_key', 'in',
        'people', coalesce((SELECT jsonb_agg(r.j ORDER BY s.last_in DESC) FROM (SELECT ext, last_in FROM _st WHERE w = 0 AND business ORDER BY last_in DESC LIMIT 50) s JOIN _rows r ON r.ext = s.ext), '[]'::jsonb)),
      jsonb_build_object('key', 'licensed', 'label', 'licensed', 'caption', 'said licensed', 'count', c_licensed, 'prior_count', p_licensed, 'prev_key', 'business',
        'people', coalesce((SELECT jsonb_agg(r.j ORDER BY s.last_in DESC) FROM (SELECT ext, last_in FROM _st WHERE w = 0 AND licensed ORDER BY last_in DESC LIMIT 50) s JOIN _rows r ON r.ext = s.ext), '[]'::jsonb)),
      jsonb_build_object('key', 'number', 'label', 'number', 'caption', 'gave a number', 'count', c_number, 'prior_count', p_number, 'prev_key', 'business',
        'or_email', (SELECT count(*) FROM _rows r JOIN _st s ON s.ext = r.ext AND s.w = 0 WHERE r.email IS NOT NULL AND r.phone10 IS NULL),
        'people', coalesce((SELECT jsonb_agg(r.j ORDER BY s.last_in DESC) FROM (SELECT ext, last_in FROM _st WHERE w = 0 AND number ORDER BY last_in DESC LIMIT 50) s JOIN _rows r ON r.ext = s.ext), '[]'::jsonb)),
      jsonb_build_object('key', 'booked', 'label', 'booked', 'caption', 'calendly', 'count', c_booked, 'prior_count', p_booked, 'prev_key', 'number',
        'people', coalesce((SELECT jsonb_agg(coalesce(r.j, '{}'::jsonb) || jsonb_build_object('external_id', coalesce(r.ext, 'ie:' || e.id::text), 'handle', coalesce(r.handle, nullif(e.h, '')), 'name', coalesce(r.name, e.invitee_name), 'phone', coalesce(r.phone10, e.p10), 'email', coalesce(r.email, e.invitee_email),
            'status', CASE WHEN e.outcome IS NULL THEN 'today' ELSE 'booked' END, 'rank', CASE WHEN e.outcome IS NULL THEN 2 ELSE 11 END,
            'booked_event', jsonb_build_object('id', e.id, 'scheduled_at', e.scheduled_at, 'invitee_phone', e.invitee_phone, 'invitee_name', e.invitee_name, 'outcome', e.outcome, 'event_type_name', e.event_type_name)) ORDER BY e.scheduled_at DESC)
          FROM (SELECT * FROM _ie WHERE created_at >= v_since ORDER BY created_at DESC LIMIT 50) e
          LEFT JOIN LATERAL (SELECT * FROM _rows r WHERE (e.h <> '' AND r.handle_n = e.h) OR (e.p10 IS NOT NULL AND r.phone10 = e.p10) ORDER BY r.last_at DESC LIMIT 1) r ON true), '[]'::jsonb)),
      jsonb_build_object('key', 'showed', 'label', 'showed', 'caption', 'outcome tapped', 'count', c_showed, 'prior_count', p_showed, 'prev_key', 'booked',
        'split', jsonb_build_object('no_show', c_noshow, 'not_marked', c_notmarked),
        'people', coalesce((SELECT jsonb_agg(coalesce(r.j, '{}'::jsonb) || jsonb_build_object('external_id', coalesce(r.ext, 'ie:' || e.id::text), 'handle', coalesce(r.handle, nullif(e.h, '')), 'name', coalesce(r.name, e.invitee_name), 'phone', coalesce(r.phone10, e.p10), 'email', coalesce(r.email, e.invitee_email), 'status', 'booked', 'rank', 11,
            'booked_event', jsonb_build_object('id', e.id, 'scheduled_at', e.scheduled_at, 'invitee_phone', e.invitee_phone, 'invitee_name', e.invitee_name, 'outcome', e.outcome, 'event_type_name', e.event_type_name)) ORDER BY e.scheduled_at DESC)
          FROM (SELECT * FROM _ie WHERE created_at >= v_since AND (outcome IN ('completed','hired','contracted','passed') OR ended_at IS NOT NULL) ORDER BY created_at DESC LIMIT 50) e
          LEFT JOIN LATERAL (SELECT * FROM _rows r WHERE (e.h <> '' AND r.handle_n = e.h) OR (e.p10 IS NOT NULL AND r.phone10 = e.p10) ORDER BY r.last_at DESC LIMIT 1) r ON true), '[]'::jsonb)),
      jsonb_build_object('key', 'applied', 'label', 'applied', 'caption', 'by link or handle', 'count', c_applied, 'prior_count', p_applied, 'prev_key', 'booked',
        'split', jsonb_build_object('by_link', c_applied_link, 'by_handle', c_applied_handle),
        'people', coalesce((SELECT jsonb_agg(coalesce(r.j, '{}'::jsonb) || jsonb_build_object('external_id', coalesce(r.ext, 'app:' || a.id::text), 'handle', coalesce(r.handle, nullif(a.h, '')), 'name', coalesce(r.name, a.first_name), 'phone', coalesce(r.phone10, a.phone10), 'email', coalesce(r.email, a.email),
            'status', 'applied', 'rank', 12, 'applied', true, 'application_id', a.id, 'applied_by', CASE WHEN a.by_link THEN 'link' ELSE 'handle' END, 'application_status', a.status, 'applied_at', a.created_at) ORDER BY a.created_at DESC)
          FROM (SELECT * FROM _app WHERE created_at >= v_since AND (by_link OR by_handle) ORDER BY created_at DESC LIMIT 50) a
          LEFT JOIN LATERAL (SELECT * FROM _rows r WHERE (a.h <> '' AND r.handle_n = a.h) OR (a.phone10 IS NOT NULL AND r.phone10 = a.phone10) ORDER BY r.last_at DESC LIMIT 1) r ON true), '[]'::jsonb)),
      jsonb_build_object('key', 'hired', 'label', 'hired', 'caption', 'agents table', 'count', c_hired, 'prior_count', p_hired, 'prev_key', 'applied',
        'people', coalesce((SELECT jsonb_agg(coalesce(r.j, '{}'::jsonb) || jsonb_build_object('external_id', coalesce(r.ext, 'agent:' || ag.id::text), 'handle', coalesce(r.handle, nullif(ap.h, '')), 'name', coalesce(r.name, ap.first_name), 'phone', coalesce(r.phone10, ap.phone10), 'email', coalesce(r.email, ap.email),
            'status', 'applied', 'rank', 12, 'applied', true, 'application_id', ap.id, 'agent_status', ag.status::text, 'hired_at', ag.created_at) ORDER BY ag.created_at DESC)
          FROM agents ag JOIN _app ap ON ap.id = ag.source_application_id
          LEFT JOIN LATERAL (SELECT * FROM _rows r WHERE (ap.h <> '' AND r.handle_n = ap.h) OR (ap.phone10 IS NOT NULL AND r.phone10 = ap.phone10) ORDER BY r.last_at DESC LIMIT 1) r ON true
          WHERE (ap.by_link OR ap.by_handle) AND ag.status IN ('active','pending') AND ag.created_at >= v_since), '[]'::jsonb)),
      jsonb_build_object('key', 'recovered', 'label', 'recovered', 'caption', 'recovery email', 'count', c_rec_n, 'prior_count', p_rec_n, 'prev_key', NULL,
        'split', jsonb_build_object('recovered', c_rec_n, 'emailed', c_rec_d, 'prior_emailed', p_rec_d),
        'people', coalesce((SELECT jsonb_agg(jsonb_build_object('external_id', 'partial:' || p.id::text, 'handle', NULL, 'name', coalesce(p.first_name, p.email), 'email', p.email, 'phone', fn_ig_phone10(p.phone), 'status', 'applied', 'rank', 12,
            'last_body', NULL, 'last_direction', NULL, 'last_at', p.recovery_email_sent_at, 'last_inbound_at', NULL, 'age_min', NULL, 'intent', NULL, 'licensed', false, 'human_lane', false, 'booked_event', NULL, 'has_booking', false, 'applied', true,
            'recovered', (p.converted_at IS NOT NULL OR p.recovered_at IS NOT NULL OR EXISTS (SELECT 1 FROM applications a WHERE lower(a.email) = lower(p.email) AND a.created_at > p.recovery_email_sent_at)), 'sent_at', p.recovery_email_sent_at) ORDER BY p.recovery_email_sent_at DESC)
          FROM partial_applications p WHERE p.recovery_email_sent_at >= v_since AND coalesce(p.step, '') <> 'inbound_dm'), '[]'::jsonb))
    )
  );

  -- what's working: reels by people who said they want in (first touch = the first inbound row in the window carrying a media_id)
  v_working := jsonb_build_object(
    'reels', coalesce((SELECT jsonb_agg(x ORDER BY x.want_in DESC, x.people_in DESC, x.views DESC NULLS LAST) FROM (
        SELECT cp.external_id, cp.title, cp.url, cp.views, cp.posted_at, count(ft.ext) AS people_in,
          count(ft.ext) FILTER (WHERE EXISTS (SELECT 1 FROM _st s WHERE s.w = 0 AND s.ext = ft.ext AND s.business)) AS want_in
        FROM (SELECT DISTINCT ON (ext) ext, raw_payload->>'media_id' AS media_id FROM _ig WHERE direction = 'inbound' AND received_at >= v_since AND raw_payload->>'media_id' IS NOT NULL ORDER BY ext, received_at ASC) ft
        JOIN (SELECT DISTINCT ON (external_id) external_id, title, url, views, posted_at FROM content_posts WHERE platform = 'instagram' ORDER BY external_id, stats_at DESC NULLS LAST) cp ON cp.external_id = ft.media_id
        GROUP BY cp.external_id, cp.title, cp.url, cp.views, cp.posted_at) x), '[]'::jsonb),
    'lines', coalesce((SELECT jsonb_agg(l ORDER BY l.reply_rate DESC, l.sends DESC) FROM (
        SELECT line, sends, replies, round(100.0 * replies / sends) AS reply_rate FROM (
          SELECT left(regexp_replace(o.body, 'https?://\S+', '<link>', 'g'), 90) AS line, count(*) AS sends,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _ig i WHERE i.ext = o.ext AND i.direction = 'inbound' AND i.received_at BETWEEN o.received_at AND o.received_at + interval '24 hours')) AS replies
          FROM _ig o WHERE o.delivered AND o.auto_replied AND o.received_at >= v_since AND length(o.body) > 6 GROUP BY 1) s
        WHERE sends >= 4 ORDER BY reply_rate DESC, sends DESC LIMIT 3) l), '[]'::jsonb),
    'sam_short_pct', (SELECT round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _ig i WHERE i.ext = o.ext AND i.direction = 'inbound' AND i.received_at BETWEEN o.received_at AND o.received_at + interval '24 hours')) / nullif(count(*), 0))
        FROM _ig o WHERE o.proven AND NOT o.auto_replied AND o.received_at >= v_since AND o.body !~* 'https?://' AND length(o.body) <= 80),
    'bot_long_pct', (SELECT round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM _ig i WHERE i.ext = o.ext AND i.direction = 'inbound' AND i.received_at BETWEEN o.received_at AND o.received_at + interval '24 hours')) / nullif(count(*), 0))
        FROM _ig o WHERE o.delivered AND o.auto_replied AND o.received_at >= v_since AND o.body ~* 'https?://' AND length(o.body) > 80),
    'intents', coalesce((SELECT jsonb_agg(i ORDER BY i.people DESC) FROM (
        SELECT intent, count(DISTINCT ext) AS people FROM _ig WHERE direction = 'inbound' AND received_at >= v_since
          AND intent IN ('opportunity','licensed','licensed_team','mentorship','fitness','rentals','partnership','followup') GROUP BY intent) i), '[]'::jsonb)
  );

  v_hlth := jsonb_build_object(
    'bot_handed', (SELECT count(*) FROM _ig WHERE auto_replied AND delivered AND NOT proven AND received_at >= v_since),
    'bot_receipts', (SELECT count(*) FROM _ig WHERE auto_replied AND proven AND received_at >= v_since),
    'you_delivered', (SELECT count(*) FROM _ig WHERE proven AND NOT auto_replied AND received_at >= v_since),
    'you_got_reply', (SELECT count(*) FROM _ig o WHERE o.proven AND NOT o.auto_replied AND o.received_at >= v_since
        AND EXISTS (SELECT 1 FROM _ig i WHERE i.ext = o.ext AND i.direction = 'inbound' AND i.received_at BETWEEN o.received_at AND o.received_at + interval '24 hours')),
    'replied_24h_n', (SELECT count(*) FROM _st s WHERE s.w = 0 AND EXISTS (SELECT 1 FROM _ig i JOIN _ig o ON o.ext = i.ext AND o.proven AND o.received_at BETWEEN i.received_at AND i.received_at + interval '24 hours'
        WHERE i.ext = s.ext AND i.direction = 'inbound' AND i.received_at >= v_since)),
    'replied_24h_of', c_in,
    'refused_30d', (SELECT count(*) FROM _ig WHERE direction = 'outbound' AND raw_payload->>'error' IS NOT NULL AND received_at >= v_since),
    'comment_refused_7d', (SELECT count(*) FROM _ig WHERE direction = 'outbound' AND raw_payload->>'error' IS NOT NULL AND raw_payload ? 'comment_id' AND received_at >= now() - interval '7 days'),
    'followups_sent_30d', (SELECT count(*) FROM _ig WHERE delivered AND raw_payload->>'tag' LIKE 'nudge%' AND received_at >= v_since),
    'followup_last_run_at', v_status->>'nudge_cron_last_at',
    'followup_last_status', v_status->>'nudge_cron_last_status',
    'nudged', coalesce((SELECT jsonb_agg(n ORDER BY n.at DESC) FROM (
        SELECT o.ext AS external_id, (SELECT handle FROM _thr WHERE ext = o.ext) AS handle, o.raw_payload->>'tag' AS tag, o.body, o.received_at AS at,
          o.proven AS delivered, (o.raw_payload->>'error' IS NOT NULL) AS refused, o.raw_payload->>'send_failed_kind' AS send_failed_kind,
          EXISTS (SELECT 1 FROM _ig i WHERE i.ext = o.ext AND i.direction = 'inbound' AND i.received_at > o.received_at) AS replied
        FROM _ig o WHERE o.direction = 'outbound' AND o.raw_payload->>'tag' LIKE 'nudge%' AND o.received_at >= now() - interval '48 hours') n), '[]'::jsonb),
    'recovery', coalesce((SELECT jsonb_agg(r ORDER BY r.sent_at DESC) FROM (
        SELECT p.id, p.email, p.first_name, p.recovery_email_sent_at AS sent_at,
          (p.converted_at IS NOT NULL OR p.recovered_at IS NOT NULL OR EXISTS (SELECT 1 FROM applications a WHERE lower(a.email) = lower(p.email) AND a.created_at > p.recovery_email_sent_at)) AS recovered
        FROM partial_applications p WHERE p.recovery_email_sent_at >= now() - interval '14 days' AND coalesce(p.step, '') <> 'inbound_dm') r), '[]'::jsonb)
  );

  v_people := coalesce((SELECT jsonb_agg(r.j ORDER BY r.last_at DESC) FROM (SELECT * FROM _rows WHERE last_at >= now() - interval '14 days' ORDER BY last_at DESC LIMIT 60) r), '[]'::jsonb);

  RETURN jsonb_build_object('status', v_status, 'needs', v_needs, 'everyone', v_everyone, 'later', v_later, 'lever', v_lever,
                            'funnel', v_funnel, 'working', v_working, 'health', v_hlth, 'people', v_people);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_ig_dashboard(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_ig_dashboard(text) TO authenticated, service_role;
