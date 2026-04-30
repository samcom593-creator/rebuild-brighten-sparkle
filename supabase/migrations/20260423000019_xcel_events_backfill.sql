-- ════════════════════════════════════════════════════════════════════════
-- XCEL event tracker + 45-day backfill from Gmail
-- Each row captures one enrollment or course-completion email from XCEL.
-- Matches to public.applications by applicant email → updates progress.
-- Completions fire Discord #hiring-pipeline alert (state exam reminder).
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.xcel_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_thread_id  text UNIQUE NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('enrollment','completion')),
  student_name     text,
  student_email    text,
  state_line       text,
  event_at         timestamptz NOT NULL,
  applied_to_crm   boolean DEFAULT false,
  notified         boolean DEFAULT false,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xcel_events_email ON public.xcel_events(student_email);
CREATE INDEX IF NOT EXISTS idx_xcel_events_kind ON public.xcel_events(kind, event_at DESC);
ALTER TABLE public.xcel_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xe_admin ON public.xcel_events;
DROP POLICY IF EXISTS xe_svc   ON public.xcel_events;
CREATE POLICY xe_admin ON public.xcel_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY xe_svc   ON public.xcel_events FOR ALL    TO service_role USING (true);

-- Backfill from Gmail (threads pulled via MCP 2026-04-23)
INSERT INTO public.xcel_events (gmail_thread_id, kind, student_name, student_email, state_line, event_at) VALUES
('19db9b08cf0fe38a','enrollment','Aaliyah Perro','perroaaliyah@gmail.com','Texas Life','2026-04-19T15:06:19Z'),
('19d973deffdbf87f','completion','Allie Gray','allisongray09@gmail.com','Florida Life','2026-04-16T17:01:51Z'),
('19d92f56846efb9b','completion','Thomas Zor','thomaszor68@gmail.com','Texas Life','2026-04-15T21:04:09Z'),
('19d8745a53eb4e81','enrollment','Thomas Zor','thomaszor68@gmail.com','Texas Life','2026-04-13T14:36:21Z'),
('19d794519e6bd4ec','enrollment','jurvell pettigrew','jurvellop@yahoo.com','California Code and Ethics','2026-04-10T21:21:04Z'),
('19d755b283d475c2','completion','jefferson garcon','garconjefferson54@gmail.com','Florida Life','2026-04-10T03:06:41Z'),
('19d729a1cbe1b13d','enrollment','Rowan Blair','rnsb07@gmail.com','Wisconsin Life and Health','2026-04-09T14:16:35Z'),
('19d5422c9a2f55e9','enrollment','Derek Fortier','derekfortier@yahoo.com','Nevada Life','2026-04-03T16:17:39Z'),
('19d4a731387389ef','enrollment','Bachire Ceneus','bachireceneus123@gmail.com','Florida Life','2026-04-01T19:09:08Z'),
('19d4a7173e203e00','enrollment','jefferson garcon','garconjefferson54@gmail.com','Florida Life','2026-04-01T19:07:22Z'),
('19d47954f7f903af','enrollment','Nicholas Bryan','nickbry1106@gmail.com','Illinois Life','2026-04-01T05:47:40Z'),
('19d46296feee415b','enrollment','hanad osman','hanad06osman@gmail.com','Wisconsin Life','2026-03-31T23:10:13Z'),
('19d36ce886205020','enrollment','Isaiah Inman','isaiahinman1@outlook.com','Wisconsin Life','2026-03-28T23:36:37Z'),
('19d36aea2ac7ff83','completion','Dainel Anderson','dannyson89@gmail.com','Minnesota Health','2026-03-28T23:01:47Z'),
('19d273e0f165e61d','completion','Dainel Anderson','dannyson89@gmail.com','Minnesota Life','2026-03-25T23:04:31Z'),
('19d25b5961a1d2c3','enrollment','Dainel Anderson','dannyson89@gmail.com','Minnesota Health','2026-03-25T15:55:50Z'),
('19d21d8841879719','enrollment','Heather Romero','socialheavenn@gmail.com','Louisiana Life','2026-03-24T21:55:30Z'),
('19d20bb7522ac697','enrollment','Setariana Beadles','setariana1@gmail.com','Texas Life','2026-03-24T16:44:09Z'),
('19d1c20daa90bb3d','enrollment','Allie Gray','allisongray09@gmail.com','Florida Life','2026-03-23T19:16:48Z'),
('19d1c00468d3e5ad','enrollment','Isaac Wilson','inw5914@gmail.com','Mississippi Life','2026-03-23T18:41:13Z'),
('19d1baed92a93181','enrollment','Chris Davis','jagg2x@gmail.com','Mississippi Life','2026-03-23T17:12:16Z'),
('19d0ec7c6ad3c2e2','completion','Maximus Kennedy','maximusmkennedy53@yahoo.com','Wisconsin Life','2026-03-21T05:04:26Z'),
('19d0e8ec5e885be3','enrollment','Latrell Debrow','latrelldebrow2916@gmail.com','Wisconsin Life','2026-03-21T04:02:10Z'),
('19d09a0b45f7d0ef','completion','Breon Martin','bjmartin443@gmail.com','New Jersey Life and Health','2026-03-20T05:03:40Z'),
('19d034a5cde56c76','enrollment','Dainel Anderson','dannyson89@gmail.com','Minnesota Life','2026-03-18T23:31:38Z'),
('19d02ab9455c01e0','enrollment','Maximus Kennedy','maximusmkennedy53@yahoo.com','Wisconsin Life','2026-03-18T20:38:12Z'),
('19d02ab2e5e9c504','enrollment','Breon Martin','bjmartin443@gmail.com','New Jersey Life and Health','2026-03-18T20:37:46Z'),
('19cfb0784ef248da','completion','Danglo Walter','zynnayiaa@gmail.com','Mississippi Life','2026-03-17T09:01:39Z'),
('19cf8e76a708f771','completion','Landon Pederson','landon.p.pederson@gmail.com','Utah Life','2026-03-16T23:07:21Z'),
('19cf85b15e67f196','enrollment','Justin Gonzalez Gutierrez','liketomr.gingeyt@gmail.com','Wisconsin Life','2026-03-16T20:34:04Z'),
('19cf7d02c22cdf96','enrollment','Landon Pederson','landon.p.pederson@gmail.com','Utah Life','2026-03-16T18:02:20Z'),
('19cf4a3b79ff4739','completion','Brandon davidson','bjdavidson52604@gmail.com','Wisconsin Life','2026-03-16T03:14:55Z'),
('19cebe21923a1a63','enrollment','Peso Soko','tesoko14@gmail.com','Wisconsin Life','2026-03-14T10:26:28Z'),
('19ce21a5466209d0','enrollment','Paul Williams','williamsp2023@icloud.com','Wisconsin Life','2026-03-12T12:51:41Z'),
('19cdfa840d9ae946','completion','Ben Gillie','bengillie91@gmail.com','Pennsylvania Life','2026-03-12T01:27:51Z'),
('19cde6409868be0a','enrollment','Danglo Walter','zynnayiaa@gmail.com','Mississippi Life','2026-03-11T19:33:43Z'),
('19cdb124f591be5e','enrollment','Isaiah Nieves','isaiahnievez222@gmail.com','Wisconsin Life and Health','2026-03-11T04:05:35Z'),
('19cdae0a1c627525','enrollment','Jason Ballard','jayballson23@gmail.com','Maryland Life','2026-03-11T03:11:19Z'),
('19cdaaa860002626','enrollment','Caleb Watkins','calebwatkins1124@gmail.com','Wisconsin Life','2026-03-11T02:12:14Z'),
('19cda9cfcb76623e','enrollment','Brandon davidson','bjdavidson52604@gmail.com','Wisconsin Life','2026-03-11T01:57:27Z')
ON CONFLICT (gmail_thread_id) DO NOTHING;

-- Match to applications + update license_progress
UPDATE public.applications app
SET license_status = 'pending',
    notes = COALESCE(app.notes,'') || E'\n[xcel] enrolled in ' || e.state_line || ' — ' || to_char(e.event_at,'MM-DD') || ' via ' || e.student_email,
    updated_at = now()
FROM public.xcel_events e
WHERE LOWER(app.email) = LOWER(e.student_email)
  AND e.kind = 'enrollment'
  AND (app.notes IS NULL OR app.notes NOT LIKE '%[xcel] enrolled in ' || e.state_line || '%');

-- Completions: mark license_progress + fire Discord for each one not yet notified
UPDATE public.applications app
SET license_status = 'pending',
    notes = COALESCE(app.notes,'') || E'\n[xcel] COURSE COMPLETE · ' || e.state_line || ' · ' || to_char(e.event_at,'MM-DD') || ' — book state exam',
    updated_at = now()
FROM public.xcel_events e
WHERE LOWER(app.email) = LOWER(e.student_email)
  AND e.kind = 'completion'
  AND (app.notes IS NULL OR app.notes NOT LIKE '%[xcel] COURSE COMPLETE · ' || e.state_line || '%');

-- Fire ONE Discord post summarizing the backfill (avoid spamming 11 separate completion alerts)
SELECT public.discord_route(
  'xcel_backfill', to_char(now(),'YYYY-MM-DD'), 'hiring',
  jsonb_build_object('username','APEX · XCEL Sync',
    'content', format(
      E'📚 **XCEL backfill complete — last 45 days**\n\n' ||
      E'• **%s course completions** — these applicants can book their state exam now\n' ||
      E'• **%s enrollments** tracked → marked license_status=pending on their applications\n' ||
      E'• Hourly Gmail → CRM sync will keep this live going forward\n\n%s',
      (SELECT COUNT(*) FROM public.xcel_events WHERE kind='completion'),
      (SELECT COUNT(*) FROM public.xcel_events WHERE kind='enrollment'),
      COALESCE(
        (SELECT E'**Recent completions ready for state exam:**\n' ||
          string_agg('• ' || t.student_name || ' (' || t.state_line || ') — ' || t.student_email, E'\n')
         FROM (SELECT student_name, state_line, student_email FROM public.xcel_events
               WHERE kind='completion' ORDER BY event_at DESC LIMIT 8) t),
        ''))));

-- Mark all events as applied so we don't re-announce on next sync
UPDATE public.xcel_events SET applied_to_crm = true, notified = true;

SELECT
  (SELECT COUNT(*)::int FROM public.xcel_events) AS xcel_events_total,
  (SELECT COUNT(*)::int FROM public.xcel_events WHERE kind='completion') AS completions,
  (SELECT COUNT(*)::int FROM public.xcel_events WHERE kind='enrollment') AS enrollments,
  (SELECT COUNT(DISTINCT student_email)::int FROM public.xcel_events) AS distinct_students,
  (SELECT COUNT(*)::int FROM public.applications WHERE notes LIKE '%[xcel]%') AS applications_tagged;
