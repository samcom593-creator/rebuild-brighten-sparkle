-- ════════════════════════════════════════════════════════════════════════
-- Applicant magic login v2: delegate to applicant-magic-link edge function
-- (which has service-role access). Still 2-phase (fire/drain) because pg_net
-- response rows aren't visible in the same transaction.
-- ════════════════════════════════════════════════════════════════════════

-- Ensure queue table exists (idempotent from v1)
CREATE TABLE IF NOT EXISTS public.applicant_login_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  email            text NOT NULL,
  first_name       text,
  create_user_req  bigint,
  magic_link_req   bigint,
  action_link      text,
  status           text NOT NULL DEFAULT 'queued',
  error_msg        text,
  created_at       timestamptz DEFAULT now(),
  processed_at     timestamptz
);

-- Reset any failed rows from v1 so they can be retried via v2
UPDATE public.applicant_login_queue
   SET status='queued', error_msg=NULL, create_user_req=NULL, magic_link_req=NULL, action_link=NULL
 WHERE status = 'error';

CREATE OR REPLACE FUNCTION public.applicant_login_fire(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record; v_req bigint; v_fired int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='supabase_anon_key';  -- anon is fine for fn dispatch
  IF v_base IS NULL OR v_key IS NULL THEN
    RETURN jsonb_build_object('error','supabase_url or supabase_anon_key missing');
  END IF;

  -- Queue any warm applicant in last 30d that isn't already tracked
  INSERT INTO public.applicant_login_queue (application_id, email, first_name, status)
  SELECT a.id, a.email, a.first_name, 'queued'
  FROM public.applications a
  LEFT JOIN auth.users u ON LOWER(u.email) = LOWER(a.email)
  WHERE a.created_at >= now() - interval '30 days'
    AND a.terminated_at IS NULL
    AND a.status IN ('new','no_pickup','reviewing','interview')
    AND a.email IS NOT NULL AND a.email <> ''
    AND u.id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.applicant_login_queue q WHERE q.application_id = a.id)
  ON CONFLICT DO NOTHING;

  -- Fire applicant-magic-link for each queued row
  FOR v_row IN
    SELECT id, application_id, email FROM public.applicant_login_queue
    WHERE status = 'queued' ORDER BY created_at ASC LIMIT p_limit
  LOOP
    v_req := net.http_post(
      url := v_base || '/functions/v1/applicant-magic-link',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object('applicationId', v_row.application_id),
      timeout_milliseconds := 20000);

    UPDATE public.applicant_login_queue
       SET magic_link_req = v_req, status = 'user_created'
     WHERE id = v_row.id;
    v_fired := v_fired + 1;
    PERFORM pg_sleep(0.4);
  END LOOP;

  RETURN jsonb_build_object('fired', v_fired);
END $fn$;

CREATE OR REPLACE FUNCTION public.applicant_login_drain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_row record; v_status int; v_body text; v_link text;
  v_ready int := 0; v_err int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  FOR v_row IN
    SELECT id, magic_link_req FROM public.applicant_login_queue
    WHERE status = 'user_created' AND magic_link_req IS NOT NULL
    ORDER BY created_at ASC LIMIT 200
  LOOP
    SELECT status_code, content::text INTO v_status, v_body
    FROM net._http_response WHERE id = v_row.magic_link_req;
    IF v_status IS NULL THEN CONTINUE; END IF;

    IF v_status = 200 THEN
      v_link := (v_body::jsonb)->>'action_link';
      IF v_link IS NULL OR v_link = '' THEN
        UPDATE public.applicant_login_queue
           SET status='error', error_msg='no action_link: '||LEFT(v_body,200)
         WHERE id = v_row.id; v_err := v_err + 1;
      ELSE
        UPDATE public.applicant_login_queue
           SET status='link_ready', action_link=v_link
         WHERE id = v_row.id; v_ready := v_ready + 1;
      END IF;
    ELSE
      UPDATE public.applicant_login_queue
         SET status='error', error_msg=format('%s: %s', v_status, LEFT(COALESCE(v_body,''),200))
       WHERE id = v_row.id; v_err := v_err + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ready', v_ready, 'errored', v_err);
END $fn$;

-- applicant_login_send() kept as-is from v1 — it only needs link_ready rows
-- and fires send-notification via anon key (already works).

SELECT 'applicant_magic_login v2 installed' AS r;
