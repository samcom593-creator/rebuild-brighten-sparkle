-- Seed today's XCEL report from the email screenshot Sam shared 2026-05-17.
-- Once the automated ingest is wired, this manual seed gets superseded.

BEGIN;

WITH report AS (
  INSERT INTO xcel_pre_licensing_reports (
    report_date, enrolled_last_30d, enrolled_last_7d, active_last_10d,
    active_pipeline, pct_completed, raw_payload
  ) VALUES (
    '2026-05-17', 10, 1, 8, 13, 50,
    jsonb_build_object('source','manual_seed_from_email_screenshot','seeded_by','dashboard-rebuild')
  )
  ON CONFLICT (report_date) DO UPDATE SET
    enrolled_last_30d = EXCLUDED.enrolled_last_30d,
    enrolled_last_7d  = EXCLUDED.enrolled_last_7d,
    active_last_10d   = EXCLUDED.active_last_10d,
    active_pipeline   = EXCLUDED.active_pipeline,
    pct_completed     = EXCLUDED.pct_completed,
    raw_payload       = EXCLUDED.raw_payload,
    received_at       = now()
  RETURNING id
)
INSERT INTO xcel_pre_licensing_students (
  report_id, course_section, first_name, last_name, email, phone,
  date_enrolled, last_log_in, time_spent_minutes, pct_complete,
  date_completed, course_name, hiring_manager_name
)
SELECT r.id, v.course_section, v.first_name, v.last_name, v.email, v.phone,
       v.date_enrolled::date, v.last_log_in::date, v.time_spent_minutes, v.pct_complete,
       v.date_completed, v.course_name, v.hiring_manager_name
FROM (
  VALUES
  -- ─── Code and Ethics ───
  ('code_and_ethics','jurvell','pettigrew','jurvellop@yahoo.com','4422943661','2026-04-10','2026-05-03',57,48,NULL::date,'California Code and Ethics Pre-licensing','samuel james'),
  -- ─── Life Only ───
  ('life_only','Spencer','Millet','spencerairlines@gmail.com','9418791458','2026-05-10','2026-05-17',213,100,'2026-05-12','Florida Pre-licensing',NULL),
  ('life_only','Camren','Gerry','camrengerry727@gmail.com','9207653854','2026-05-04','2026-05-07',138,48,NULL,'Wisconsin Pre-licensing',NULL),
  ('life_only','Alexander','Villarreal','alexnadervilla974@gmail.com','6084696084','2026-05-04','2026-05-04',1,6,NULL,'Wisconsin Pre-licensing',NULL),
  ('life_only','Finnian','Sardar','finnian.sardar@gmail.com','7734497440','2026-05-02','2026-05-07',69,100,'2026-05-03','Wisconsin Pre-licensing',NULL),
  ('life_only','Jacarius','Harmon','jacarius01@gmail.com','6015966260','2026-04-30','2026-05-15',90,96,NULL,'Mississippi Pre-licensing',NULL),
  ('life_only','Geovonnie','Williams','itzgeowilliams@gmail.com','4144086570','2026-04-30','2026-05-05',2681,48,NULL,'Wisconsin Pre-licensing',NULL),
  ('life_only','weldon','mitchell','weldonmitchell2@gmail.com','9419207831','2026-04-29','2026-04-30',329,6,NULL,'Florida Pre-licensing',NULL),
  ('life_only','Charles','Brezinski','charles.2006.mb@gmail.com','6089991410','2026-04-29','2026-05-14',10576,25,NULL,'Wisconsin Pre-licensing',NULL),
  ('life_only','Armonte','Williams','nlemonte24@gmail.com','6082136573','2026-04-29','2026-04-29',0,0,NULL,'Wisconsin Pre-licensing',NULL),
  ('life_only','Thomas','Zor','thomaszor68@gmail.com','8562658556','2026-04-13','2026-05-07',216,100,'2026-04-15','Texas Pre-licensing',NULL),
  ('life_only','Derek','Fortier','derekfortier@yahoo.com','9498424646','2026-04-03','2026-05-16',7850,100,'2026-04-27','Nevada Pre-licensing',NULL),
  ('life_only','hanad','osman','hanad06osman@gmail.com','9206159751','2026-03-31','2026-05-04',123,12,NULL,'Wisconsin Pre-licensing',NULL),
  ('life_only','Isaiah','Inman','isaiahinman1@outlook.com','6084052247','2026-03-28','2026-05-03',0,3,NULL,'Wisconsin Pre-licensing',NULL),
  ('life_only','Setariana','Beadles','setariana1@gmail.com','2629029866','2026-03-24','2026-05-01',8,3,NULL,'Texas Pre-licensing',NULL),
  ('life_only','Chris','Davis','jagg2x@gmail.com','6019404739','2026-03-23','2026-05-11',133,35,NULL,'Mississippi Pre-licensing',NULL),
  ('life_only','Isaac','Wilson','inw5914@gmail.com','7692751066','2026-03-23','2026-05-03',15627,17,NULL,'Mississippi Pre-licensing',NULL),
  -- ─── Life and Health (Disability) ───
  ('life_and_health','Breon','Martin','bjmartin443@gmail.com','9083976399','2026-03-18','2026-04-29',189,100,'2026-03-20','New Jersey Life and Health Pre-licensing','Richard Ackourey the third')
) AS v(course_section, first_name, last_name, email, phone, date_enrolled, last_log_in, time_spent_minutes, pct_complete, date_completed, course_name, hiring_manager_name)
CROSS JOIN report r;

-- Match the seeded students to applications by email
SELECT fn_match_xcel_students();

COMMIT;
