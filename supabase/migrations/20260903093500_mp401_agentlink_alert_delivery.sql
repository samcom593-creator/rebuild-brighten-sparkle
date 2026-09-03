-- MP-401 (2026-09-03): the AgentLink watchdog was a working detector with no sender.
--
-- MEASURED before changing anything: agentlink_alerts holds 6,164 rows since
-- 2026-08-04 and notified=false on EVERY one. Nothing has ever written that
-- column -- not agentlink_watchdog, not fn_prune_agentlink_alerts, not
-- trg_fn_deal_status_transition (the only three DB objects that reference the
-- table), and no edge function or script. Its sole surface was an "Open alerts"
-- COUNT on /admin/setup, which is a pull surface Sam has to navigate to.
--
-- It detected the 2026-09-03 outage MP-400 fixed perfectly and silently: 324
-- alerts, first at 01:00:00Z. A human noticed the missing numbers ~7h later.
--
-- WHY NOT JUST WIRE IT: 6,164 alerts / 30d = 205 pages a day. Episode length
-- (p50 75 min, p90 339, max 622; 48 episodes, 14.2% of all wall-clock minutes)
-- shows a >2h stale window is this instance's CHRONIC baseline. Paging every
-- episode is 1.6/day about a standing condition -- the same
-- true-but-misleading pager that has already cost this codebase five waves.
-- 7 of 48 episodes ran past 4h. That is the bar: ~1.6 pages/WEEK, and it would
-- have fired at 05:00Z on 2026-09-03, 3.3h before a human found it.
--
-- NO DOLLAR FIGURE. The 20-min agentlink-book-refresh job keeps agentlink_book
-- fresh independently, so the book leg stayed fresh throughout; what was blind
-- is the deals-table leg and the redundancy. Sam's missing $7K belongs to the
-- Vantage/Discord lane (MP-400), not here.

ALTER TABLE public.agentlink_alerts ADD COLUMN IF NOT EXISTS notify_request_id bigint;

CREATE OR REPLACE FUNCTION public.fn_agentlink_alert_page(
  p_alert_id uuid, p_title text, p_body text, p_priority text DEFAULT 'high')
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req_id bigint;
BEGIN
  -- MP-401. agentlink_watchdog has been a working detector with no delivery:
  -- 6,164 alerts since 2026-08-04, notified=false on every one, because no
  -- function, edge function or script has ever written that column. Its only
  -- surface was an "Open alerts" COUNT on /admin/setup, which Sam has to
  -- navigate to. This is the sender that was never built.
  --
  -- DE-STORM. One page per episode. The watchdog resolves every open alert on
  -- its healthy branch, so an unresolved row carrying notified=true means this
  -- outage has already paged. Without this, the measured rate is 6,164 pages
  -- per 30 days (205/day) -- the exact shape of the 36-false-pages/day and
  -- 39-true-but-misleading-pages/day failures this codebase has already paid
  -- for. With it, 7 pages per 30 days.
  IF EXISTS (SELECT 1 FROM public.agentlink_alerts
             WHERE resolved_at IS NULL AND notified AND id IS DISTINCT FROM p_alert_id) THEN
    RETURN false;
  END IF;

  -- ntfy's JSON publishing API, deliberately NOT a text/plain body built with
  -- to_jsonb(): net.http_post serialises a jsonb body as JSON, so to_jsonb(text)
  -- arrives with its literal double quotes still attached. That is the same
  -- storage-vs-wire confusion that made a live AgentLink cookie 401 for 7h on
  -- 2026-09-03 (MP-400); here the payload is a structured object, so the
  -- question cannot arise.
  SELECT net.http_post(
    url := 'https://ntfy.sh',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'topic', 'sams-agent-yrkv9kbqp9e987nb',
      'title', p_title,
      'message', p_body,
      'priority', CASE p_priority WHEN 'urgent' THEN 5 WHEN 'high' THEN 4 ELSE 3 END,
      'tags', jsonb_build_array('rotating_light')
    )
  ) INTO v_req_id;

  -- notified records DISPATCH, not delivery: pg_net queues the request and
  -- returns an id, so a receipt here cannot prove ntfy accepted it. The id is
  -- stored so net._http_response can settle that question afterwards -- the
  -- "log is the verdict" rule from MP-270/MP-290. Anything stronger written
  -- here would be the 465-row fake-success pattern in a new column.
  UPDATE public.agentlink_alerts
     SET notified = true, notify_request_id = v_req_id
   WHERE id = p_alert_id;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  -- The watchdog runs every minute and is the ONLY thing recording these
  -- alerts. A paging fault must never cost the detection: leave notified false
  -- so the next tick retries rather than silently swallowing the episode.
  RETURN false;
END $function$
;

CREATE OR REPLACE FUNCTION public.agentlink_watchdog()
 RETURNS TABLE(status text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_ok timestamptz; v_hours_stale numeric;
  v_recent_fails int; v_recent_ok int; v_cookie_set boolean;
  v_msg text; v_alert_id uuid;
  v_episode_min numeric; v_already_paged boolean; v_req_id bigint;
  -- MP-401: measured, not guessed. Over 2026-08-04..09-03 this watchdog raised
  -- 6,164 alerts across 48 episodes (14.2% of all wall-clock minutes). Episode
  -- length p50=75min, p90=339min, max=622min -- so a 2h-stale window is this
  -- instance's CHRONIC baseline, and paging every episode would be 1.6 pages a
  -- day about a standing condition: the "39 true-but-misleading pages/day"
  -- disease this codebase has now paid for five times. 7 of 48 episodes ran
  -- past 4h. Paging there is ~1.6 pages/WEEK and would have fired at 05:00Z on
  -- 2026-09-03, 3.3h before a human noticed the 436-min outage MP-400 fixed.
  c_page_after_min constant numeric := 240;
BEGIN
  SELECT MAX(started_at) INTO v_last_ok FROM public.agentlink_sync_log WHERE agentlink_sync_log.status='ok';
  v_hours_stale := ROUND((EXTRACT(EPOCH FROM (now() - COALESCE(v_last_ok, '2020-01-01'::timestamptz)))/3600.0)::numeric, 1);
  SELECT COUNT(*) INTO v_recent_fails FROM public.agentlink_sync_log
    WHERE started_at > now() - interval '1 hour' AND agentlink_sync_log.status='error';
  SELECT COUNT(*) INTO v_recent_ok FROM public.agentlink_sync_log
    WHERE started_at > now() - interval '1 hour' AND agentlink_sync_log.status='ok';
  SELECT EXISTS(SELECT 1 FROM public.system_settings WHERE key='agent_link_session_cookie' AND length(value) >= 20)
    INTO v_cookie_set;

  IF NOT v_cookie_set THEN
    v_msg := 'Agent Link cookie missing — live pull cannot run';
    INSERT INTO public.agentlink_alerts (severity, message, last_ok_at)
    VALUES ('critical', v_msg, v_last_ok) RETURNING id INTO v_alert_id;
    PERFORM public.fn_agentlink_alert_page(v_alert_id, 'APEX AgentLink cookie missing', v_msg, 'urgent');
    RETURN QUERY SELECT 'critical'::text, 'cookie missing'::text; RETURN;
  END IF;

  IF v_hours_stale > 2 THEN
    v_msg := 'No successful Agent Link sync for ' || v_hours_stale::text || 'h';
    INSERT INTO public.agentlink_alerts (severity, message, last_ok_at)
    VALUES ('warning', v_msg, v_last_ok) RETURNING id INTO v_alert_id;

    -- Episode = the run of unresolved alerts. The healthy branch below resolves
    -- every open row, so "unresolved" is exactly the current outage and the
    -- notified flag clears with it: one page per episode, self-rearming.
    SELECT EXTRACT(EPOCH FROM (now() - MIN(raised_at)))/60
      INTO v_episode_min FROM public.agentlink_alerts WHERE resolved_at IS NULL;

    IF COALESCE(v_episode_min, 0) > c_page_after_min THEN
      PERFORM public.fn_agentlink_alert_page(
        v_alert_id, 'APEX AgentLink sync stalled',
        v_msg || ' (' || ROUND(COALESCE(v_episode_min,0))::text
              || ' min into this outage). The deals leg is not importing; the book refresh is a separate job.',
        'high');
    END IF;
    RETURN QUERY SELECT 'stale'::text, v_hours_stale::text || 'h stale'; RETURN;
  END IF;

  -- Deliberately NOT paged: this branch fires while still under the 2h bar and
  -- converges into the stale branch within the hour if it is real. Paging both
  -- would double-page one outage.
  IF v_recent_fails > 3 AND v_recent_ok = 0 THEN
    INSERT INTO public.agentlink_alerts (severity, message, last_ok_at)
    VALUES ('warning', v_recent_fails::text || ' failed runs in last hour, 0 successful', v_last_ok);
    RETURN QUERY SELECT 'failing'::text, v_recent_fails::text || ' failures'; RETURN;
  END IF;

  UPDATE public.agentlink_alerts SET resolved_at = now() WHERE resolved_at IS NULL;
  RETURN QUERY SELECT 'healthy'::text, 'last ok ' || ROUND(v_hours_stale*60)::text || ' min ago';
END $function$
;
