-- ════════════════════════════════════════════════════════════════════════
-- Applicant magic-link login: create auth user + native Supabase magic link,
-- then email the applicant. Uses Supabase Auth Admin REST API via pg_net.
-- Separate from the agent magic_login_tokens system (that requires agent_id).
-- ════════════════════════════════════════════════════════════════════════

-- Phase 1: fire — creates auth user (idempotent) + requests magic link,
-- stores the two pg_net request ids on a cursor row per applicant.
CREATE TABLE IF NOT EXISTS public.applicant_login_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  email            text NOT NULL,
  first_name       text,
  create_user_req  bigint,       -- pg_net req id for POST /auth/v1/admin/users
  magic_link_req   bigint,       -- pg_net req id for POST /auth/v1/admin/generate_link
  action_link      text,         -- parsed result (the URL to email them)
  status           text NOT NULL DEFAULT 'queued',   -- queued | user_created | link_ready | sent | error
  error_msg        text,
  created_at       timestamptz DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_alq_status ON public.applicant_login_queue(status);

-- Auth Admin API: create user (idempotent — if exists, returns 422 which we tolerate)
CREATE OR REPLACE FUNCTION public.applicant_login_fire(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base   text; v_key text; v_row record;
  v_create bigint; v_link bigint;
  v_fired  int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';

  -- Pick warm applicants in last 30d with no auth.users row and not yet queued
  FOR v_row IN
    SELECT a.id, a.email, a.first_name
    FROM public.applications a
    LEFT JOIN auth.users u ON LOWER(u.email) = LOWER(a.email)
    WHERE a.created_at >= now() - interval '30 days'
      AND a.terminated_at IS NULL
      AND a.status IN ('new','no_pickup','reviewing','interview')
      AND a.email IS NOT NULL AND a.email <> ''
      AND u.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.applicant_login_queue q
        WHERE q.application_id = a.id AND q.status IN ('queued','user_created','link_ready','sent'))
    ORDER BY a.created_at DESC
    LIMIT p_limit
  LOOP
    -- Queue the create-user call first
    v_create := net.http_post(
      url := v_base || '/auth/v1/admin/users',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object(
        'email', LOWER(TRIM(v_row.email)),
        'email_confirm', true,
        'user_metadata', jsonb_build_object('source','applicant_backfill','application_id', v_row.id)),
      timeout_milliseconds := 15000);

    INSERT INTO public.applicant_login_queue (application_id, email, first_name, create_user_req, status)
    VALUES (v_row.id, v_row.email, v_row.first_name, v_create, 'queued');
    v_fired := v_fired + 1;

    PERFORM pg_sleep(0.3);  -- kind to Supabase Auth
  END LOOP;

  RETURN jsonb_build_object('fired', v_fired);
END $fn$;
GRANT EXECUTE ON FUNCTION public.applicant_login_fire(int) TO service_role, authenticated;

-- Phase 2: drain — for each queued row whose create-user response is ready,
-- fire the magic-link request. For each with magic-link ready, parse and
-- mark link_ready. Called repeatedly until queue drains.
CREATE OR REPLACE FUNCTION public.applicant_login_drain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_status int; v_body text; v_link_req bigint;
  v_advanced int := 0; v_ready int := 0; v_errored int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';

  -- Advance: queued → user_created → request magic link
  FOR v_row IN
    SELECT id, application_id, email, first_name, create_user_req FROM public.applicant_login_queue
    WHERE status = 'queued'
    ORDER BY created_at ASC LIMIT 100
  LOOP
    SELECT status_code, content::text INTO v_status, v_body
    FROM net._http_response WHERE id = v_row.create_user_req;
    IF v_status IS NULL THEN CONTINUE; END IF;  -- not ready yet

    -- 200 = created, 422 = already exists (email taken) — both OK
    IF v_status IN (200, 422) THEN
      v_link_req := net.http_post(
        url := v_base || '/auth/v1/admin/generate_link',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||v_key,
          'apikey', v_key),
        body := jsonb_build_object(
          'type','magiclink',
          'email', LOWER(TRIM(v_row.email)),
          'redirect_to','https://apex-financial.org/dashboard'),
        timeout_milliseconds := 15000);
      UPDATE public.applicant_login_queue
         SET status='user_created', magic_link_req=v_link_req
       WHERE id = v_row.id;
      v_advanced := v_advanced + 1;
    ELSE
      UPDATE public.applicant_login_queue
         SET status='error', error_msg=format('create-user %s: %s', v_status, LEFT(COALESCE(v_body,''),200))
       WHERE id = v_row.id;
      v_errored := v_errored + 1;
    END IF;
  END LOOP;

  -- Advance: user_created → link_ready (parse action_link from generate_link response)
  FOR v_row IN
    SELECT id, application_id, email, first_name, magic_link_req FROM public.applicant_login_queue
    WHERE status = 'user_created'
    ORDER BY created_at ASC LIMIT 100
  LOOP
    SELECT status_code, content::text INTO v_status, v_body
    FROM net._http_response WHERE id = v_row.magic_link_req;
    IF v_status IS NULL THEN CONTINUE; END IF;

    IF v_status = 200 THEN
      DECLARE v_link text;
      BEGIN
        v_link := (v_body::jsonb)->'properties'->>'action_link';
        IF v_link IS NULL THEN v_link := (v_body::jsonb)->>'action_link'; END IF;
        IF v_link IS NULL THEN
          UPDATE public.applicant_login_queue
             SET status='error', error_msg='no action_link in response: '||LEFT(v_body, 200)
           WHERE id = v_row.id;
          v_errored := v_errored + 1;
        ELSE
          UPDATE public.applicant_login_queue
             SET status='link_ready', action_link=v_link
           WHERE id = v_row.id;
          v_ready := v_ready + 1;
        END IF;
      END;
    ELSE
      UPDATE public.applicant_login_queue
         SET status='error', error_msg=format('gen-link %s: %s', v_status, LEFT(COALESCE(v_body,''),200))
       WHERE id = v_row.id;
      v_errored := v_errored + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('advanced', v_advanced, 'ready', v_ready, 'errored', v_errored);
END $fn$;
GRANT EXECUTE ON FUNCTION public.applicant_login_drain() TO service_role, authenticated;

-- Phase 3: send — for each link_ready row, email the applicant their magic
-- link via send-notification (deployed Resend path). Throttled 1.2s/send.
CREATE OR REPLACE FUNCTION public.applicant_login_send(p_limit int DEFAULT 999)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_first text; v_html text;
  v_sent int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
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
Good news — <strong>doors are open again and you''re in the next wave</strong>. Your APEX dashboard is ready.<br><br>
One click to log in (no password needed):<br><br>
<a href="%s" style="display:inline-block;padding:14px 28px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px;font-size:16px">🔓 Log in to your APEX dashboard</a><br><br>
This link is good for 1 hour. If you need a fresh one, reply to this email.<br><br>
Once you''re in, we''ll walk you through the next step on a call — <a href="tel:+14697676068">(469) 767-6068</a>.<br><br>
— Sam<br>APEX Financial$h$,
      v_first, v_row.action_link);

    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object(
        'email', v_row.email,
        'title', 'Your APEX dashboard — one-click login',
        'message', v_html),
      timeout_milliseconds := 20000);

    UPDATE public.applicant_login_queue
       SET status='sent', processed_at=now()
     WHERE id = v_row.id;

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.email, 'email', 'APEX dashboard magic login', 'applicant login provisioned', 'sent',
      jsonb_build_object('campaign', 'applicant_login_backfill_2026_04_23',
                         'applicationId', v_row.application_id));

    v_sent := v_sent + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;

  RETURN jsonb_build_object('sent', v_sent);
END $fn$;
GRANT EXECUTE ON FUNCTION public.applicant_login_send(int) TO service_role, authenticated;

SELECT 'applicant_magic_login installed' AS r;
