-- PL-SEMINAR-FUNNEL: wire Apply submission → confirmation email + Zoom + .ics calendar + Telegram
--
-- THE PAIN: when a candidate submits the Apply form, the existing flow stamps
-- a seminar_date (date only) IF they later pay for the pre-license course
-- (PL-057). For the welcome-Zoom funnel Sam's manager runs, applicants need
-- to be slotted IMMEDIATELY on submission with a real timestamptz so the
-- email + .ics can carry an exact start time.
--
-- THE FIX (this migration):
--   1) Add the four seminar_* columns the edge fn writes.
--   2) Seed system_settings with seminar config (zoom url, passcode, host).
--   3) Add fn_next_seminar_slot() returning the next Wed/Fri/Sun @ 19:00 CT
--      timestamptz (≥6h lead time). Does NOT replace fn_next_seminar_date(),
--      which the PL-057 course-paid path keeps using for its Wed/Sat rotation.
--   4) Add v_seminar_next_slots view (next 6 upcoming slots).
--
-- Idempotent (re-runnable). Non-destructive.

-- ============================================================================
-- 1) applications columns (skip if already present)
-- ============================================================================
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS seminar_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS seminar_slot_at    timestamptz,
  ADD COLUMN IF NOT EXISTS seminar_zoom_link  text,
  ADD COLUMN IF NOT EXISTS seminar_ics_uid    text;

COMMENT ON COLUMN public.applications.seminar_invited_at IS
  'When the welcome-Zoom seminar invite email was sent. Set by seminar-confirmation edge fn.';
COMMENT ON COLUMN public.applications.seminar_slot_at IS
  'The Wed/Fri/Sun 7pm CT timestamp the applicant was slotted into on submission. Source of truth for the .ics + reminder cadence.';
COMMENT ON COLUMN public.applications.seminar_zoom_link IS
  'Snapshot of the live Zoom URL at the moment the invite was sent so swapping the URL later does not break old invitations.';
COMMENT ON COLUMN public.applications.seminar_ics_uid IS
  'Stable RFC5545 UID of the .ics attachment. Re-using this UID + later DTSTAMP lets us issue updates/cancels.';

-- ============================================================================
-- 2) system_settings seeds (UPSERT, never overwrite an existing live value)
-- ============================================================================
INSERT INTO public.system_settings (key, value)
VALUES
  ('seminar_zoom_url',         'https://zoom.us/j/0000000000'),
  ('seminar_zoom_meeting_id',  '0000000000'),
  ('seminar_passcode',         'apex2026'),
  ('seminar_schedule_cron',    'Wed,Fri,Sun @ 19:00 America/Chicago'),
  ('seminar_host_name',        'Sam James''s Apex team'),
  ('seminar_from_email',       'seminar@apex-financial.org')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3) fn_next_seminar_slot() — next Wed/Fri/Sun 19:00 CT with ≥6h lead time
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_next_seminar_slot(p_from timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_today_ct   timestamptz;
  v_today_date date;
  v_dow        int;
  v_wed_ts     timestamptz;
  v_fri_ts     timestamptz;
  v_sun_ts     timestamptz;
  v_pick       timestamptz;
BEGIN
  v_today_ct   := p_from AT TIME ZONE 'America/Chicago';
  v_today_date := v_today_ct::date;
  v_dow        := EXTRACT(dow FROM v_today_ct);  -- Sun=0..Sat=6

  -- Offsets to next Wed (3), Fri (5), Sun (0)
  v_wed_ts := ((v_today_date + MOD(3 - v_dow + 7, 7))::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago';
  v_fri_ts := ((v_today_date + MOD(5 - v_dow + 7, 7))::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago';
  v_sun_ts := ((v_today_date + MOD(0 - v_dow + 7, 7))::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago';

  -- Bump any that are within the ≥6h lead window
  IF v_wed_ts < p_from + interval '6 hours' THEN v_wed_ts := v_wed_ts + interval '7 days'; END IF;
  IF v_fri_ts < p_from + interval '6 hours' THEN v_fri_ts := v_fri_ts + interval '7 days'; END IF;
  IF v_sun_ts < p_from + interval '6 hours' THEN v_sun_ts := v_sun_ts + interval '7 days'; END IF;

  v_pick := LEAST(v_wed_ts, v_fri_ts, v_sun_ts);
  RETURN v_pick;
END $$;

COMMENT ON FUNCTION public.fn_next_seminar_slot IS
  'PL-SEMINAR-FUNNEL: returns the next Wed/Fri/Sun 19:00 America/Chicago timestamptz with ≥6h lead time. Used by seminar-confirmation edge fn on Apply submission.';

GRANT EXECUTE ON FUNCTION public.fn_next_seminar_slot(timestamptz) TO anon, authenticated, service_role;

-- ============================================================================
-- 4) v_seminar_next_slots — next 6 upcoming Wed/Fri/Sun 19:00 CT slots
-- ============================================================================
CREATE OR REPLACE VIEW public.v_seminar_next_slots AS
WITH days AS (
  SELECT (CURRENT_DATE + g)::date AS d
  FROM generate_series(0, 21) AS g  -- 3 weeks of candidate days is plenty for 6 slots
),
slots AS (
  SELECT
    ((d::timestamp + interval '19 hours') AT TIME ZONE 'America/Chicago') AS slot_at,
    to_char(d, 'Dy') AS dow
  FROM days
)
SELECT slot_at, dow
FROM slots
WHERE dow IN ('Wed','Fri','Sun')
  AND slot_at >= now() + interval '6 hours'
ORDER BY slot_at ASC
LIMIT 6;

COMMENT ON VIEW public.v_seminar_next_slots IS
  'PL-SEMINAR-FUNNEL: next 6 upcoming Wed/Fri/Sun 19:00 CT slots. Read by admin pages / sanity checks.';

GRANT SELECT ON public.v_seminar_next_slots TO anon, authenticated, service_role;

-- ============================================================================
-- 5) get_application_seminar_invite(p_application_id uuid) RPC
-- ============================================================================
-- Returns the seminar invite snapshot the Apply success pages render. Safe
-- to call anonymously with a known application_id (the same trust model
-- get_application_status / public /status/:id already use).
CREATE OR REPLACE FUNCTION public.get_application_seminar_invite(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app        RECORD;
  v_tg_dm_url  text;
  v_tg_user    text;
  v_zoom_url   text;
  v_passcode   text;
  v_meeting_id text;
  v_schedule   text;
  v_tg_link    text;
BEGIN
  SELECT id, seminar_slot_at, seminar_zoom_link, seminar_invited_at, seminar_ics_uid
    INTO v_app
    FROM public.applications
   WHERE id = p_application_id;

  IF v_app.id IS NULL THEN
    RETURN jsonb_build_object('error', 'application_not_found');
  END IF;

  SELECT value INTO v_tg_dm_url   FROM public.system_settings WHERE key = 'telegram_bot_dm_url'   LIMIT 1;
  SELECT value INTO v_tg_user     FROM public.system_settings WHERE key = 'telegram_bot_username' LIMIT 1;
  SELECT value INTO v_zoom_url    FROM public.system_settings WHERE key = 'seminar_zoom_url'      LIMIT 1;
  SELECT value INTO v_passcode    FROM public.system_settings WHERE key = 'seminar_passcode'      LIMIT 1;
  SELECT value INTO v_meeting_id  FROM public.system_settings WHERE key = 'seminar_zoom_meeting_id' LIMIT 1;
  SELECT value INTO v_schedule    FROM public.system_settings WHERE key = 'seminar_schedule_cron' LIMIT 1;

  IF v_tg_dm_url IS NOT NULL THEN
    v_tg_link := v_tg_dm_url || '?start=apply_' || p_application_id::text;
  ELSIF v_tg_user IS NOT NULL THEN
    v_tg_link := 'https://t.me/' || v_tg_user || '?start=apply_' || p_application_id::text;
  ELSE
    v_tg_link := NULL;
  END IF;

  RETURN jsonb_build_object(
    'application_id',  v_app.id,
    'slot_at',         COALESCE(v_app.seminar_slot_at, public.fn_next_seminar_slot()),
    'invited_at',      v_app.seminar_invited_at,
    'zoom_url',        COALESCE(v_app.seminar_zoom_link, v_zoom_url),
    'zoom_meeting_id', v_meeting_id,
    'passcode',        v_passcode,
    'schedule_label',  v_schedule,
    'telegram_dm_url', v_tg_link,
    'ics_uid',         v_app.seminar_ics_uid
  );
END $$;

COMMENT ON FUNCTION public.get_application_seminar_invite IS
  'PL-SEMINAR-FUNNEL: snapshot of the seminar invite (slot, zoom, passcode, telegram deep-link) rendered on /apply/success and /status/:id.';

GRANT EXECUTE ON FUNCTION public.get_application_seminar_invite(uuid) TO anon, authenticated, service_role;
