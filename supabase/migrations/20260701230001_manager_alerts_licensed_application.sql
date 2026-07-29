-- 2026-07-01 — Immediate-alert for LICENSED applications
-- Sam's spec: on applications INSERT where license_status='licensed',
--   1) enqueue into manager_alerts (parallel to bot_alerts, name Sam asked for)
--   2) fire ntfy push to sams-agent-yrkv9kbqp9e987nb with "Tap to call" (tel:) link
--
-- Ledger:
--   status: done
--   what: manager_alerts table + trg_manager_alerts_licensed_application + ntfy pg_net push
--   next: verify test row triggers ntfy
--
-- Persisted to:
--   - public.manager_alerts (new table)
--   - public.trg_manager_alerts_licensed_application (new trigger)
--   - public.fn_manager_alerts_licensed_application (trigger fn)
--   - Sam's phone ntfy topic sams-agent-yrkv9kbqp9e987nb (live push)

CREATE TABLE IF NOT EXISTS public.manager_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  application_id uuid REFERENCES public.applications(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manager_alerts_unseen
  ON public.manager_alerts (created_at DESC)
  WHERE seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_manager_alerts_kind
  ON public.manager_alerts (kind, created_at DESC);

ALTER TABLE public.manager_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manager_alerts_service_role_all ON public.manager_alerts;
CREATE POLICY manager_alerts_service_role_all ON public.manager_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS manager_alerts_authenticated_read ON public.manager_alerts;
CREATE POLICY manager_alerts_authenticated_read ON public.manager_alerts
  FOR SELECT TO authenticated USING (true);

-- Trigger fn: enqueue + fire ntfy
CREATE OR REPLACE FUNCTION public.fn_manager_alerts_licensed_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
  v_phone text;
  v_tel text;
  v_email text;
  v_payload jsonb;
  v_body text;
BEGIN
  IF NEW.license_status IS DISTINCT FROM 'licensed' THEN
    RETURN NEW;
  END IF;

  v_name  := trim(both ' ' FROM concat_ws(' ', NEW.first_name, NEW.last_name));
  v_phone := COALESCE(NEW.phone, '');
  v_email := COALESCE(NEW.email, '');
  v_tel   := 'tel:' || regexp_replace(v_phone, '\D', '', 'g');

  v_payload := jsonb_build_object(
    'name', v_name,
    'phone', v_phone,
    'email', v_email,
    'tel_link', v_tel
  );

  INSERT INTO public.manager_alerts (kind, application_id, payload, created_at)
  VALUES ('licensed_application', NEW.id, v_payload, now());

  -- Fire ntfy push via ntfy JSON body format (pg_net's http_post only accepts jsonb bodies).
  -- Non-blocking via pg_net worker; failures swallowed by outer EXCEPTION.
  v_body := format('%s · %s · Tap to call', NULLIF(v_name, ''), NULLIF(v_phone, ''));
  v_body := COALESCE(NULLIF(v_body, ' ·  · Tap to call'), 'New licensed applicant');

  BEGIN
    PERFORM net.http_post(
      url := 'https://ntfy.sh/',
      body := jsonb_build_object(
        'topic',    'sams-agent-yrkv9kbqp9e987nb',
        'title',    '🎯 Licensed applicant applied',
        'message',  v_body,
        'priority', 5,
        'tags',     ARRAY['dart','phone'],
        'click',    v_tel,
        'actions',  jsonb_build_array(
                      jsonb_build_object(
                        'action', 'view',
                        'label',  'Call',
                        'url',    v_tel,
                        'clear',  true
                      )
                    )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block the INSERT on push failure
    NULL;
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the INSERT on any downstream failure
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_alerts_licensed_application ON public.applications;
CREATE TRIGGER trg_manager_alerts_licensed_application
  AFTER INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_manager_alerts_licensed_application();

COMMENT ON TABLE public.manager_alerts IS
  'Sam-facing alert inbox. Parallel to bot_alerts; kept intentionally simple (kind + payload jsonb) for Sam''s manager surfaces. Populated by triggers like fn_manager_alerts_licensed_application.';
COMMENT ON TRIGGER trg_manager_alerts_licensed_application ON public.applications IS
  'Immediate alert for LICENSED applications. Enqueues manager_alerts row + fires ntfy push to Sam''s phone with tel: click action.';
