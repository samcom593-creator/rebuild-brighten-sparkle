-- PL-WIB-APPLICANT-LOGIN-COPY (2026-10-26)
--
-- applicant_login_send (pg_cron 'applicant-login-tick', */15) mails every new
-- applicant their one-click dashboard login. It still carried the 2026-04-23
-- backfill campaign copy, and three things were wrong with it:
--
-- 1. The apostrophes were doubled in the delivered mail. The body is a
--    dollar-quoted literal (tag h), where '' is NOT an escape, so every
--    applicant read "you''re in the next wave" and "Once you''re in, we''ll
--    walk you through". Verified in notification_log.message of the 10-22
--    sends (provider ids 01a16558..., 01a164b7...). 150 sends lifetime, 47 in
--    the last 30 days.
-- 2. The copy told someone who applied minutes earlier that "doors are open
--    again and you're in the next wave" (the April re-open), signed
--    "APEX Financial" while send-notification sends it from Galaxy Financial.
-- 3. It wrote applicant_login_queue.status='sent' and its own
--    notification_log row with status='sent' unconditionally, right after an
--    async net.http_post nobody read. send-notification already logs the real
--    outcome (sent with provider_message_id, or failed with the provider's
--    error), so every login email was counted twice, and a refusal would have
--    been recorded as delivered. Measured: 47 of 47 cron rows in 30d have a
--    matching send-notification 'sent' row, so no failure was hidden yet. The
--    path is reachable since the suppression gate (396b7fce): the 10-22 send
--    went to an address that had bounced 21 minutes earlier.
--
-- Now: new copy in the current brand, no duplicate log row, and the queue
-- status comes from send-notification's own receipt on the next tick:
--   send_dispatched -> sent         (receipt status 'sent')
--   send_dispatched -> send_failed  (receipt status anything else; error kept)
--   send_dispatched -> send_unknown (no receipt within 1 hour; never 'sent')
-- Legacy 'sent' rows are history and are left as written.

CREATE OR REPLACE FUNCTION public.applicant_login_send(p_limit integer DEFAULT 999)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  -- send-notification logs this exact string as notification_log.title, which
  -- is how the receipt is found. Change it here and nowhere else.
  v_title constant text := 'Your Galaxy Financial dashboard is ready';
  v_base text; v_key text; v_row record;
  v_first text; v_html text;
  v_rstatus text; v_rerr text;
  v_dispatched int := 0; v_ok int := 0; v_failed int := 0; v_unknown int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  -- 1. Settle earlier dispatches from send-notification's own receipt.
  FOR v_row IN
    SELECT id, email, processed_at FROM public.applicant_login_queue
    WHERE status = 'send_dispatched'
    ORDER BY processed_at ASC LIMIT 500
  LOOP
    v_rstatus := NULL; v_rerr := NULL;
    SELECT n.status, n.error_message INTO v_rstatus, v_rerr
    FROM public.notification_log n
    WHERE lower(n.recipient_email) = lower(v_row.email)
      AND n.channel = 'email'
      AND n.title = v_title
      AND n.metadata->>'trigger' = 'send-notification'
      AND n.created_at >= v_row.processed_at
      AND n.created_at <  v_row.processed_at + interval '2 hours'
    ORDER BY n.created_at ASC LIMIT 1;

    IF v_rstatus = 'sent' THEN
      UPDATE public.applicant_login_queue SET status = 'sent' WHERE id = v_row.id;
      v_ok := v_ok + 1;
    ELSIF v_rstatus IS NOT NULL THEN
      UPDATE public.applicant_login_queue
         SET status = 'send_failed',
             error_msg = LEFT(v_rstatus || ': ' || COALESCE(v_rerr, ''), 300)
       WHERE id = v_row.id;
      v_failed := v_failed + 1;
    ELSIF v_row.processed_at < now() - interval '1 hour' THEN
      UPDATE public.applicant_login_queue
         SET status = 'send_unknown',
             error_msg = 'no send-notification receipt within 1 hour of dispatch'
       WHERE id = v_row.id;
      v_unknown := v_unknown + 1;
    END IF;
  END LOOP;

  -- 2. Dispatch new logins.
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';

  FOR v_row IN
    SELECT id, application_id, email, first_name, action_link
    FROM public.applicant_login_queue
    WHERE status = 'link_ready'
    ORDER BY created_at ASC LIMIT p_limit
  LOOP
    v_first := COALESCE(NULLIF(TRIM(v_row.first_name),''),'there');

    v_html := format(
      $h$Hey %s,<br><br>
Your application is in, and your Galaxy Financial dashboard is ready.<br><br>
Log in with one click. No password needed:<br><br>
<a href="%s" style="display:inline-block;padding:14px 28px;background:#0A0A0A;color:#C9A961;font-weight:700;text-decoration:none;border-radius:8px;font-size:16px">Log in to your dashboard</a><br><br>
This link works for 1 hour. If it expires, reply to this email and we will send you a new one.<br><br>
Once you are in, we will walk you through your next step on a call. Questions before then? Call <a href="tel:+14697676068">(469) 767-6068</a>.<br><br>
Sam James<br>Galaxy Financial$h$,
      v_first, v_row.action_link);

    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object(
        'email', v_row.email,
        'title', v_title,
        'message', v_html),
      timeout_milliseconds := 20000);

    -- Not 'sent': nothing has been delivered yet. Step 1 settles it.
    UPDATE public.applicant_login_queue
       SET status='send_dispatched', processed_at=now()
     WHERE id = v_row.id;

    v_dispatched := v_dispatched + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;

  RETURN jsonb_build_object(
    'dispatched', v_dispatched,
    'settled', jsonb_build_object('sent', v_ok, 'failed', v_failed, 'unknown', v_unknown));
END $function$;
