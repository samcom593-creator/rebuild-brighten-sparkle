-- ════════════════════════════════════════════════════════════════════════
-- Unlicensed-recruit ramp plan — all 4 levers in one migration.
--
-- LEVER 2: Day-2 + Day-4 XCEL-enrollment nudge crons.
-- LEVER 3: xcel_progress sync table + weekly progress email + stuck alert.
-- LEVER 4: XCEL completion → same-day SureLC handoff email + admin alert.
-- LEVER 1 (activation) ships via applicant-magic-link edge fn (separate).
-- ════════════════════════════════════════════════════════════════════════

-- ─── LEVER 3a: xcel_progress table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xcel_progress (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_email     text NOT NULL,
  student_name      text,
  total_courses     int NOT NULL DEFAULT 0,
  completed         int NOT NULL DEFAULT 0,
  in_progress       int NOT NULL DEFAULT 0,
  not_started       int NOT NULL DEFAULT 0,
  past_due          int NOT NULL DEFAULT 0,
  due_soon          int NOT NULL DEFAULT 0,
  last_login        timestamptz,
  applicant_id      uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_email)
);
CREATE INDEX IF NOT EXISTS idx_xprog_email    ON public.xcel_progress(student_email);
CREATE INDEX IF NOT EXISTS idx_xprog_applicant ON public.xcel_progress(applicant_id);
CREATE INDEX IF NOT EXISTS idx_xprog_stale    ON public.xcel_progress(last_login);

ALTER TABLE public.xcel_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xprog_admin ON public.xcel_progress;
DROP POLICY IF EXISTS xprog_svc   ON public.xcel_progress;
CREATE POLICY xprog_admin ON public.xcel_progress FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY xprog_svc ON public.xcel_progress FOR ALL TO service_role USING (true);

-- Auto-match to applications on insert/update
CREATE OR REPLACE FUNCTION public.trg_fn_match_xcel_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.applicant_id IS NULL THEN
    SELECT id INTO NEW.applicant_id FROM public.applications
     WHERE LOWER(email) = LOWER(NEW.student_email)
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS trg_match_xcel_progress ON public.xcel_progress;
CREATE TRIGGER trg_match_xcel_progress BEFORE INSERT OR UPDATE ON public.xcel_progress
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_match_xcel_progress();

-- ─── LEVER 3a: import the 40 rows from Sam's 2026-04-23 XCEL export ────
INSERT INTO public.xcel_progress (student_email, student_name, total_courses, completed, in_progress, not_started, past_due, due_soon, last_login)
VALUES
  ('dannyson89@gmail.com',           'Dainel Anderson',           8,2,3,3,0,0, '2026-03-30 16:02-05'::timestamptz),
  ('pierreauguste71@yahoo.com',      'pierre auguste',            7,1,5,1,0,0, '2026-03-11 14:47-05'::timestamptz),
  ('joshuaauguste1014j@gmail.com',   'Joshua Auguste',            0,0,0,0,3,0, '2026-03-11 14:50-05'::timestamptz),
  ('yosiahaugustine@icloud.com',     'Yosiah Augustine',          1,0,1,0,1,0, '2026-02-25 11:43-05'::timestamptz),
  ('jayballson23@gmail.com',         'Jason Ballard',             0,0,0,0,1,0, '2026-03-13 09:21-05'::timestamptz),
  ('setariana1@gmail.com',           'Setariana Beadles',         1,0,1,0,0,0, '2026-04-21 10:58-05'::timestamptz),
  ('rnsb07@gmail.com',               'Rowan Blair',               1,0,1,0,0,1, '2026-04-23 17:35-05'::timestamptz),
  ('nickbry1106@gmail.com',          'Nicholas Bryan',            0,0,0,0,0,1, '2026-04-06 12:03-05'::timestamptz),
  ('bachireceneus123@gmail.com',     'Bachire Ceneus',            1,0,1,0,0,1, '2026-04-06 22:50-05'::timestamptz),
  ('josecooper1413@gmail.com',       'JOSE COOPER',               1,0,1,0,1,0, '2026-03-09 03:15-05'::timestamptz),
  ('bjdavidson52604@gmail.com',      'Brandon davidson',          1,1,0,0,0,0, '2026-04-19 20:30-05'::timestamptz),
  ('jagg2x@gmail.com',               'Chris Davis',               0,0,0,0,1,0, '2026-04-19 08:53-05'::timestamptz),
  ('latrelldebrow2916@gmail.com',    'Latrell Debrow',            1,0,1,0,1,0, '2026-03-29 14:55-05'::timestamptz),
  ('derekfortier@yahoo.com',         'Derek Fortier',             0,0,0,0,0,1, '2026-04-23 14:37-05'::timestamptz),
  ('demetricfulton1@gmail.com',      'Demetric Fulton',           2,1,0,1,0,0, '2026-04-21 21:36-05'::timestamptz),
  ('garconjefferson54@gmail.com',    'jefferson garcon',          1,1,0,0,0,0, '2026-04-09 19:32-05'::timestamptz),
  ('bengillie91@gmail.com',          'Ben Gillie',                1,1,0,0,0,0, '2026-03-12 15:34-05'::timestamptz),
  ('liketomr.gingeyt@gmail.com',     'Justin Gonzalez Gutierrez', 1,0,1,0,1,0, '2026-03-24 19:13-05'::timestamptz),
  ('allisongray09@gmail.com',        'Allie Gray',                5,1,4,0,0,0, '2026-04-20 10:30-05'::timestamptz),
  ('isaiahinman1@outlook.com',       'Isaiah Inman',              0,0,0,0,0,1, '2026-03-31 15:02-05'::timestamptz),
  ('maximusmkennedy53@yahoo.com',    'Maximus Kennedy',           1,1,0,0,0,0, '2026-03-22 20:01-05'::timestamptz),
  ('bjmartin443@gmail.com',          'Breon Martin',              3,1,2,0,0,0, '2026-04-13 15:25-05'::timestamptz),
  ('mcclendonjordan8@gmail.com',     'jordan mcclendon',          2,1,0,1,0,0, '2026-03-27 00:47-05'::timestamptz),
  ('isaiahnievez222@gmail.com',      'Isaiah Nieves',             0,0,0,0,1,0, '2026-03-29 16:32-05'::timestamptz),
  ('hanad06osman@gmail.com',         'hanad osman',               1,0,1,0,0,1, '2026-04-13 18:10-05'::timestamptz),
  ('landon.p.pederson@gmail.com',    'Landon Pederson',           2,1,1,0,0,0, '2026-03-28 12:23-05'::timestamptz),
  ('perroaaliyah@gmail.com',         'Aaliyah Perro',             1,0,1,0,0,1, '2026-04-19 11:14-05'::timestamptz),
  ('jurvellop@yahoo.com',            'jurvell pettigrew',         0,0,0,0,0,1, '2026-04-11 00:11-05'::timestamptz),
  ('creese2015@gmail.com',           'Charles Reese',             6,1,5,0,0,0, '2026-03-14 10:58-05'::timestamptz),
  ('socialheavenn@gmail.com',        'Heather Romero',            1,0,0,1,0,0, '2026-03-29 14:31-05'::timestamptz),
  ('amsv701@gmail.com',              'andre sanabria',            2,1,0,1,0,0, '2026-04-19 18:13-05'::timestamptz),
  ('tesoko14@gmail.com',             'Peso Soko',                 1,0,1,0,1,0, '2026-03-28 00:11-05'::timestamptz),
  ('malikrtobias1@gmail.com',        'Malik Tobias',              1,1,0,0,0,0, '2026-02-23 14:05-05'::timestamptz),
  ('cooperubert@gmail.com',          'Cooper Ubert',              7,1,2,4,0,0, '2026-04-03 19:45-05'::timestamptz),
  ('zynnayiaa@gmail.com',            'Danglo Walter',             2,1,1,0,0,0, '2026-03-17 01:30-05'::timestamptz),
  ('calebwatkins1124@gmail.com',     'Caleb Watkins',             1,0,0,1,1,0, '2026-03-10 22:31-05'::timestamptz),
  ('williamsp2023@icloud.com',       'Paul Williams',             1,0,1,0,1,0, '2026-04-13 17:02-05'::timestamptz),
  ('inw5914@gmail.com',              'Isaac Wilson',              1,0,1,0,0,1, '2026-04-21 18:23-05'::timestamptz),
  ('thomaszor68@gmail.com',          'Thomas Zor',                2,1,1,0,0,0, '2026-04-23 09:03-05'::timestamptz)
ON CONFLICT (student_email) DO UPDATE SET
  student_name  = EXCLUDED.student_name,
  total_courses = EXCLUDED.total_courses,
  completed     = EXCLUDED.completed,
  in_progress   = EXCLUDED.in_progress,
  not_started   = EXCLUDED.not_started,
  past_due      = EXCLUDED.past_due,
  due_soon      = EXCLUDED.due_soon,
  last_login    = EXCLUDED.last_login,
  synced_at     = now();

-- ═══════════════════════════════════════════════════════════════════════
-- LEVER 2: Day-2 + Day-4 enrollment nudges
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.nudge_day2_not_enrolled()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'nudge_day2_xcel_enroll_2026_04_23';
  v_fired int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='supabase_anon_key';

  FOR v_row IN
    SELECT a.id, a.first_name, a.email
    FROM public.applications a
    LEFT JOIN public.xcel_progress xp ON LOWER(xp.student_email) = LOWER(a.email)
    WHERE a.created_at BETWEEN now() - interval '72 hours' AND now() - interval '36 hours'
      AND a.terminated_at IS NULL
      AND a.status IN ('new','no_pickup','reviewing')
      AND a.license_status <> 'licensed'
      AND a.email IS NOT NULL AND a.email <> ''
      AND xp.student_email IS NULL   -- never enrolled in XCEL
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(a.email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent')
  LOOP
    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object(
        'email', v_row.email,
        'title', 'Still thinking about getting licensed?',
        'message', format(
          $h$Hey %s,<br><br>
You applied to APEX a couple days ago but I don''t see you enrolled in the licensing course yet. That''s the one step that stands between you and your first paid week.<br><br>
<strong>One click. Apex covers the course.</strong><br><br>
<a href="https://partners.xcelsolutions.com/afe" style="display:inline-block;padding:14px 28px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px;font-size:16px">Enroll in XCEL now</a><br><br>
The state exam is simpler than you think. Most of our unlicensed hires pass on their first try and are writing deals inside 30 days.<br><br>
Stuck? Call me: <a href="tel:+14697676068">(469) 767-6068</a><br><br>
— Sam$h$, COALESCE(NULLIF(TRIM(v_row.first_name),''),'there'))),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.email, 'email', 'Still thinking about getting licensed?', 'day-2 nudge', 'sent',
      jsonb_build_object('campaign', v_campaign, 'applicationId', v_row.id));
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired);
END $fn$;

CREATE OR REPLACE FUNCTION public.nudge_day4_not_enrolled()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'nudge_day4_xcel_enroll_2026_04_23';
  v_fired int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='supabase_anon_key';

  FOR v_row IN
    SELECT a.id, a.first_name, a.email
    FROM public.applications a
    LEFT JOIN public.xcel_progress xp ON LOWER(xp.student_email) = LOWER(a.email)
    WHERE a.created_at BETWEEN now() - interval '120 hours' AND now() - interval '84 hours'
      AND a.terminated_at IS NULL
      AND a.status IN ('new','no_pickup','reviewing')
      AND a.license_status <> 'licensed'
      AND a.email IS NOT NULL AND a.email <> ''
      AND xp.student_email IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(a.email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent')
  LOOP
    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object(
        'email', v_row.email,
        'title', 'Last nudge before I call you',
        'message', format(
          $h$%s,<br><br>
Day 4. Still no XCEL enrollment. I''m going to call you tomorrow — this is heads-up so you''re not blindsided when my number (469-767-6068) shows up on your phone.<br><br>
Simpler path: beat me to it. Pick up the course link right now and I''ll switch the call from "where are you?" to "welcome in."<br><br>
<a href="https://partners.xcelsolutions.com/afe" style="display:inline-block;padding:14px 28px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">Enroll now</a><br><br>
— Sam$h$, COALESCE(NULLIF(TRIM(v_row.first_name),''),'Hey'))),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.email, 'email', 'Last nudge before I call you', 'day-4 nudge', 'sent',
      jsonb_build_object('campaign', v_campaign, 'applicationId', v_row.id));
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired);
END $fn$;

GRANT EXECUTE ON FUNCTION public.nudge_day2_not_enrolled() TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.nudge_day4_not_enrolled() TO service_role, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- LEVER 3b: Stuck-applicant alert — XCEL activity silent 5+ days
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.alert_stuck_xcel_students()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_count int := 0; v_body jsonb; v_names text;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  -- Who's stuck: enrolled (has a xcel_progress row), not completed, last_login 5+ days ago, still-active applicant
  SELECT COUNT(*)::int, string_agg(
    '• ' || COALESCE(xp.student_name, xp.student_email) ||
    ' — ' || xp.in_progress || ' in-progress, ' || xp.past_due || ' past due — last login ' ||
    to_char(xp.last_login, 'MM/DD'), E'\n' ORDER BY xp.last_login ASC)
  INTO v_count, v_names
  FROM public.xcel_progress xp
  LEFT JOIN public.applications app ON app.id = xp.applicant_id
  WHERE xp.last_login < now() - interval '5 days'
    AND xp.completed < xp.total_courses
    AND xp.total_courses > 0
    AND (app.status IS NULL OR app.status IN ('new','no_pickup','reviewing'));

  IF v_count = 0 THEN RETURN jsonb_build_object('stuck', 0); END IF;

  v_body := jsonb_build_object('username','APEX · Licensing Radar',
    'content', format(E'🕐 **%s XCEL students stuck** (5+ days silent, still mid-course)\n\n%s\n\nCall the oldest ones first.',
      v_count, v_names));
  PERFORM public.discord_route('xcel_stuck_students',
    to_char(CURRENT_DATE,'YYYY-MM-DD'), 'hiring', v_body);
  RETURN jsonb_build_object('stuck', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.alert_stuck_xcel_students() TO service_role, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- LEVER 3c: Weekly progress email to each active XCEL student
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.weekly_xcel_progress_emails()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'weekly_xcel_progress';
  v_pct int; v_msg text;
  v_fired int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='supabase_anon_key';

  FOR v_row IN
    SELECT xp.student_email, xp.student_name, xp.total_courses, xp.completed,
           xp.in_progress, xp.past_due, xp.due_soon
    FROM public.xcel_progress xp
    WHERE xp.total_courses > 0
      AND xp.completed < xp.total_courses
      -- Only one weekly send per student per 6 days
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(xp.student_email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent'
          AND nl.created_at > now() - interval '6 days')
  LOOP
    v_pct := (v_row.completed * 100) / GREATEST(v_row.total_courses, 1);
    v_msg := format(
      $h$Hey %s,<br><br>
Quick check-in on your XCEL progress:<br><br>
<table cellpadding="6" style="font-size:14px;border-collapse:collapse">
<tr><td><strong>Completion:</strong></td><td>%s%% (%s of %s courses)</td></tr>
<tr><td><strong>In progress:</strong></td><td>%s</td></tr>
<tr><td style="color:#dc2626"><strong>Past due:</strong></td><td style="color:#dc2626">%s</td></tr>
<tr><td style="color:#d97706"><strong>Due soon:</strong></td><td style="color:#d97706">%s</td></tr>
</table><br>
%s<br><br>
Keep going: <a href="https://partners.xcelsolutions.com/afe">continue the course</a><br>
Stuck? Call me: <a href="tel:+14697676068">(469) 767-6068</a><br><br>
— Sam$h$,
      COALESCE(NULLIF(TRIM(split_part(v_row.student_name,' ',1)),''),'there'),
      v_pct, v_row.completed, v_row.total_courses,
      v_row.in_progress, v_row.past_due, v_row.due_soon,
      CASE
        WHEN v_row.past_due > 0 THEN 'You''ve got past-due items. Knock one out today before you lose momentum.'
        WHEN v_pct >= 75       THEN 'You''re closer than most people get. Finish this week.'
        WHEN v_pct >= 50       THEN 'Halfway there. Don''t let it sit.'
        ELSE                         'Block 30 minutes today. Progress compounds.'
      END);

    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object('email', v_row.student_email, 'title', 'Your XCEL progress — week check-in', 'message', v_msg),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.student_email, 'email', 'Your XCEL progress — week check-in', 'weekly xcel progress', 'sent',
      jsonb_build_object('campaign', v_campaign, 'completion_pct', v_pct));
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired);
END $fn$;
GRANT EXECUTE ON FUNCTION public.weekly_xcel_progress_emails() TO service_role, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- LEVER 4: XCEL completion → same-day SureLC handoff + admin alert
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.send_completion_contracting_handoff()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'xcel_completion_contracting_handoff';
  v_fired int := 0; v_admin_names text := '';
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='supabase_anon_key';

  FOR v_row IN
    SELECT DISTINCT ON (e.student_email)
      e.student_email, e.student_name, e.state_line, e.event_at
    FROM public.xcel_events e
    LEFT JOIN public.applications app ON LOWER(app.email) = LOWER(e.student_email)
    WHERE e.kind = 'completion'
      AND e.event_at > now() - interval '24 hours'
      AND (app.status IS NULL OR app.status NOT IN ('contracting','rejected'))
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_log nl
        WHERE LOWER(nl.recipient_email) = LOWER(e.student_email)
          AND nl.metadata->>'campaign' = v_campaign
          AND nl.status = 'sent')
    ORDER BY e.student_email, e.event_at DESC
  LOOP
    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key,'apikey',v_key),
      body := jsonb_build_object(
        'email', v_row.student_email,
        'title', 'Course complete — let''s get you contracted',
        'message', format(
          $h$Hey %s,<br><br>
You just finished your %s course. Real respect — most don''t.<br><br>
<strong>What''s next, in order:</strong><br>
1. Book your state exam (if not done) — takes 15 min to schedule<br>
2. Sign your SureLC contracting paperwork — I''ll email you the packet today<br>
3. First deal within 30 days (you''ll be writing before the license hits your mailbox)<br><br>
<a href="tel:+14697676068" style="display:inline-block;padding:14px 28px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">📞 Call me to schedule the exam: (469) 767-6068</a><br><br>
Don''t let momentum die here.<br><br>
— Sam$h$,
          COALESCE(NULLIF(TRIM(split_part(v_row.student_name,' ',1)),''),'there'),
          COALESCE(v_row.state_line,'course'))),
      timeout_milliseconds := 15000);

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.student_email, 'email', 'Course complete — let''s get you contracted', 'completion handoff', 'sent',
      jsonb_build_object('campaign', v_campaign, 'state_line', v_row.state_line));

    v_admin_names := v_admin_names || '• ' || COALESCE(v_row.student_name, v_row.student_email) ||
                     ' · ' || COALESCE(v_row.state_line,'') || E'\n';
    v_fired := v_fired + 1;
    PERFORM pg_sleep(1.2);
  END LOOP;

  -- Admin alert to #hiring when there's someone to contract
  IF v_fired > 0 THEN
    PERFORM public.discord_route(
      'xcel_completion_handoff', to_char(CURRENT_DATE,'YYYY-MM-DD'), 'hiring',
      jsonb_build_object('username','APEX · Course Done',
        'content', format(E'🎓 **%s just finished their XCEL course** — contact them TODAY before momentum dies:\n\n%s\n\nSend the SureLC packet + schedule the state exam.', v_fired, v_admin_names)));
  END IF;

  RETURN jsonb_build_object('handed_off', v_fired);
END $fn$;
GRANT EXECUTE ON FUNCTION public.send_completion_contracting_handoff() TO service_role, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Cron schedules (America/Chicago offset — postgres runs in UTC, convert)
-- ═══════════════════════════════════════════════════════════════════════
DO $outer$ BEGIN
  -- Day-2 + Day-4 enrollment nudges: 10am + 3pm CT weekdays
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='nudge-day2-xcel-enroll') THEN
    PERFORM cron.unschedule('nudge-day2-xcel-enroll'); END IF;
  PERFORM cron.schedule('nudge-day2-xcel-enroll', '0 15 * * 1-5',      -- 10am CT
    $j$ SELECT public.nudge_day2_not_enrolled(); $j$);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='nudge-day4-xcel-enroll') THEN
    PERFORM cron.unschedule('nudge-day4-xcel-enroll'); END IF;
  PERFORM cron.schedule('nudge-day4-xcel-enroll', '0 20 * * 1-5',      -- 3pm CT
    $j$ SELECT public.nudge_day4_not_enrolled(); $j$);

  -- Stuck-student alert: 9am CT Mon/Wed/Fri
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='alert-stuck-xcel') THEN
    PERFORM cron.unschedule('alert-stuck-xcel'); END IF;
  PERFORM cron.schedule('alert-stuck-xcel', '0 14 * * 1,3,5',          -- 9am CT M/W/F
    $j$ SELECT public.alert_stuck_xcel_students(); $j$);

  -- Weekly XCEL progress email: Monday 8am CT
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='weekly-xcel-progress') THEN
    PERFORM cron.unschedule('weekly-xcel-progress'); END IF;
  PERFORM cron.schedule('weekly-xcel-progress', '0 13 * * 1',          -- Mon 8am CT
    $j$ SELECT public.weekly_xcel_progress_emails(); $j$);

  -- Completion handoff: every hour on the hour
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='xcel-completion-handoff') THEN
    PERFORM cron.unschedule('xcel-completion-handoff'); END IF;
  PERFORM cron.schedule('xcel-completion-handoff', '5 * * * *',
    $j$ SELECT public.send_completion_contracting_handoff(); $j$);
END $outer$;

SELECT 'unlicensed ramp plan — all 4 levers installed' AS r,
  (SELECT COUNT(*)::int FROM public.xcel_progress) AS xcel_rows_imported;
