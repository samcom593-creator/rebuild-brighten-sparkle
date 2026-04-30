-- ════════════════════════════════════════════════════════════════════════
-- Siri command backend — calendar + intent storage + bearer token
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  source        text NOT NULL DEFAULT 'apex',   -- 'siri' | 'calendly' | 'apex' | 'manual'
  raw_command   text,
  external_id   text,                            -- Calendly event id if synced
  status        text NOT NULL DEFAULT 'scheduled', -- scheduled | reminder | cancelled | done
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  metadata      jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cal_starts ON public.calendar_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_cal_user_starts ON public.calendar_events(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_cal_source ON public.calendar_events(source);
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cal_own   ON public.calendar_events;
DROP POLICY IF EXISTS cal_admin ON public.calendar_events;
DROP POLICY IF EXISTS cal_svc   ON public.calendar_events;
CREATE POLICY cal_own   ON public.calendar_events FOR ALL    TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);
CREATE POLICY cal_admin ON public.calendar_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY cal_svc   ON public.calendar_events FOR ALL    TO service_role USING (true);

-- Ensure pgcrypto for gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Generate the Siri bearer token if not present (single-tenant — only Sam needs one)
INSERT INTO public.system_settings (key, value)
SELECT 'siri_shortcut_token',
  encode(extensions.gen_random_bytes(24), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'siri_shortcut_token');

-- Trigger: when a calendar_event lands with source='siri', also drop a notification
CREATE OR REPLACE FUNCTION public.trg_fn_siri_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.source <> 'siri' THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, title, body, type, priority, metadata)
  SELECT u.id,
    format('📆 %s', NEW.title),
    format('%s CT — via Siri', to_char(NEW.starts_at AT TIME ZONE 'America/Chicago', 'Dy, Mon DD HH24:MI')),
    'calendar', 'normal',
    jsonb_build_object('event_id', NEW.id, 'raw_command', NEW.raw_command)
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE EXISTS (SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id AND ur.role = 'admin');
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_siri_notify ON public.calendar_events;
CREATE TRIGGER trg_siri_notify AFTER INSERT ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_siri_notify();
