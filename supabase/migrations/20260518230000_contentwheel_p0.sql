-- ═══════════════════════════════════════════════════════════════════════════
-- ContentWheel P0 — Schema + RLS + Seeds + Triggers + Views (2026-05-18)
--
-- Admin-only personal-brand + recruiting content operating system.
-- Spec: ~/Downloads/CONTENTWHEEL_Build_Spec_Samuel_James.pdf (handed in chat)
-- Persisted to: ~/business-ops/contentwheel/
--
-- "Hold the Standard. Average is the disease." — @SamuelJamesHQ
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE cw_demand_source AS ENUM ('own_outlier','competitor_outlier','comment_mine','reddit_faq','ai_observable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_audience AS ENUM ('icp','nurture');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_idea_status AS ENUM ('backlog','queued','scripted','shot','sequenced','testing','posted','iterating','vault','killed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_production_status AS ENUM ('idea','scripted','shot','sequenced','testing','posted','iterating','vault');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_platform AS ENUM ('tiktok','instagram','youtube','snapchat','twitter','linkedin','facebook');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_variant_axis AS ENUM ('hook','narrative','length','format');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_mine_source AS ENUM ('comments','reddit','faq','community');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_contact_status AS ENUM ('to_contact','contacted','responded','booked','contracted','dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cw_contact_audience AS ENUM ('now','nurture');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Helper: updated_at trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cw_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ─── 1. cw_pillars (SEED) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_pillars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  monetization_tie text,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. cw_dogmas (SEED — 15 rows) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_dogmas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int NOT NULL UNIQUE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. cw_ideas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text,
  demand_source cw_demand_source NOT NULL,
  demand_evidence text,
  audience cw_audience NOT NULL DEFAULT 'nurture',
  pillar_id uuid NOT NULL REFERENCES cw_pillars(id),
  dogma_id uuid REFERENCES cw_dogmas(id),
  status cw_idea_status NOT NULL DEFAULT 'backlog',
  score int NOT NULL DEFAULT 0,
  notes text,
  source_competitor_obs uuid,
  source_demand_mine uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_ideas_status ON cw_ideas(status);
CREATE INDEX IF NOT EXISTS idx_cw_ideas_score ON cw_ideas(score DESC);
CREATE INDEX IF NOT EXISTS idx_cw_ideas_audience ON cw_ideas(audience);
DROP TRIGGER IF EXISTS trg_cw_ideas_updated ON cw_ideas;
CREATE TRIGGER trg_cw_ideas_updated BEFORE UPDATE ON cw_ideas
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 4. cw_hooks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_hooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES cw_ideas(id) ON DELETE CASCADE,
  variant_label text NOT NULL,
  text text NOT NULL,
  keyword_a text,
  keyword_b text,
  is_agenda boolean NOT NULL DEFAULT false,
  context_ok boolean NOT NULL DEFAULT false,
  contrarian_ok boolean NOT NULL DEFAULT false,
  openloop_ok boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_hooks_idea ON cw_hooks(idea_id);
DROP TRIGGER IF EXISTS trg_cw_hooks_updated ON cw_hooks;
CREATE TRIGGER trg_cw_hooks_updated BEFORE UPDATE ON cw_hooks
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 5. cw_formats (max 3 active enforced by trigger) ──────────────────────
CREATE TABLE IF NOT EXISTS cw_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION cw_enforce_3_formats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_active_count int;
BEGIN
  IF NEW.active IS TRUE THEN
    SELECT count(*) INTO v_active_count FROM cw_formats
      WHERE active IS TRUE
        AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND name <> NEW.name;  -- also exclude the row by name so ON CONFLICT path doesn't false-positive
    IF v_active_count >= 3 THEN
      RAISE EXCEPTION 'cw_formats: cannot have more than 3 active formats. Archive one first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cw_enforce_3_formats ON cw_formats;
CREATE TRIGGER trg_cw_enforce_3_formats BEFORE INSERT OR UPDATE ON cw_formats
  FOR EACH ROW EXECUTE FUNCTION cw_enforce_3_formats();

DROP TRIGGER IF EXISTS trg_cw_formats_updated ON cw_formats;
CREATE TRIGGER trg_cw_formats_updated BEFORE UPDATE ON cw_formats
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 6. cw_productions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_productions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id uuid NOT NULL REFERENCES cw_ideas(id) ON DELETE CASCADE,
  status cw_production_status NOT NULL DEFAULT 'idea',
  format_ids uuid[] NOT NULL DEFAULT '{}',
  script text,
  shot_at timestamptz,
  posted_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_productions_idea ON cw_productions(idea_id);
CREATE INDEX IF NOT EXISTS idx_cw_productions_status ON cw_productions(status);
DROP TRIGGER IF EXISTS trg_cw_productions_updated ON cw_productions;
CREATE TRIGGER trg_cw_productions_updated BEFORE UPDATE ON cw_productions
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- Block advancing to 'shot' until ≥2 hooks exist (LAW 07)
CREATE OR REPLACE FUNCTION cw_enforce_hooks_before_shot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_hooks int;
BEGIN
  IF NEW.status IN ('shot','sequenced','testing','posted','iterating','vault')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('shot','sequenced','testing','posted','iterating','vault')) THEN
    SELECT count(*) INTO v_hooks FROM cw_hooks WHERE idea_id = NEW.idea_id;
    IF v_hooks < 2 THEN
      RAISE EXCEPTION 'cw_productions: idea % needs at least 2 hooks before advancing to %', NEW.idea_id, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cw_enforce_hooks_before_shot ON cw_productions;
CREATE TRIGGER trg_cw_enforce_hooks_before_shot BEFORE INSERT OR UPDATE ON cw_productions
  FOR EACH ROW EXECUTE FUNCTION cw_enforce_hooks_before_shot();

-- ─── 7. cw_posts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid REFERENCES cw_productions(id) ON DELETE SET NULL,
  platform cw_platform NOT NULL,
  url text,
  posted_at timestamptz NOT NULL DEFAULT now(),
  views int NOT NULL DEFAULT 0,
  followers_gained int NOT NULL DEFAULT 0,
  is_winner boolean NOT NULL DEFAULT false,
  variant_axis cw_variant_axis,
  hook_id uuid REFERENCES cw_hooks(id),
  caption text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_posts_production ON cw_posts(production_id);
CREATE INDEX IF NOT EXISTS idx_cw_posts_platform ON cw_posts(platform);
CREATE INDEX IF NOT EXISTS idx_cw_posts_posted_at ON cw_posts(posted_at DESC);
DROP TRIGGER IF EXISTS trg_cw_posts_updated ON cw_posts;
CREATE TRIGGER trg_cw_posts_updated BEFORE UPDATE ON cw_posts
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 8. cw_split_tests ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_split_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  post_ids uuid[] NOT NULL DEFAULT '{}',
  platform cw_platform NOT NULL DEFAULT 'tiktok',
  variant_axis cw_variant_axis NOT NULL DEFAULT 'hook',
  started_at timestamptz NOT NULL DEFAULT now(),
  winner_post_id uuid REFERENCES cw_posts(id),
  ig_followup_due_at timestamptz,
  ig_followup_done boolean NOT NULL DEFAULT false,
  ig_followup_post_id uuid REFERENCES cw_posts(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_cw_split_tests_updated ON cw_split_tests;
CREATE TRIGGER trg_cw_split_tests_updated BEFORE UPDATE ON cw_split_tests
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- On winner flagged → auto-create IG follow-up due +24h (LAW 08)
CREATE OR REPLACE FUNCTION cw_winner_schedule_ig()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.winner_post_id IS NOT NULL
     AND (OLD.winner_post_id IS NULL OR OLD.winner_post_id <> NEW.winner_post_id)
     AND NEW.ig_followup_due_at IS NULL THEN
    NEW.ig_followup_due_at := now() + interval '24 hours';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cw_winner_schedule_ig ON cw_split_tests;
CREATE TRIGGER trg_cw_winner_schedule_ig BEFORE UPDATE ON cw_split_tests
  FOR EACH ROW EXECUTE FUNCTION cw_winner_schedule_ig();

-- ─── 9. cw_outliers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_outliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL UNIQUE REFERENCES cw_posts(id) ON DELETE CASCADE,
  baseline_avg int NOT NULL,
  multiple numeric NOT NULL,
  vein_open boolean NOT NULL DEFAULT true,
  iterations_logged int NOT NULL DEFAULT 0,
  followers_from_vein int NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_outliers_vein_open ON cw_outliers(vein_open);
DROP TRIGGER IF EXISTS trg_cw_outliers_updated ON cw_outliers;
CREATE TRIGGER trg_cw_outliers_updated BEFORE UPDATE ON cw_outliers
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- Block closing vein until 5+ iterations OR justification (LAW 09/10)
CREATE OR REPLACE FUNCTION cw_enforce_vein_close()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.vein_open IS TRUE AND NEW.vein_open IS FALSE
     AND NEW.iterations_logged < 5
     AND (NEW.notes IS NULL OR length(trim(NEW.notes)) < 10) THEN
    RAISE EXCEPTION 'cw_outliers: vein needs ≥5 iterations OR a justification note (>=10 chars) before closing'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cw_enforce_vein_close ON cw_outliers;
CREATE TRIGGER trg_cw_enforce_vein_close BEFORE UPDATE ON cw_outliers
  FOR EACH ROW EXECUTE FUNCTION cw_enforce_vein_close();

-- Auto-detect outliers: when cw_posts.views ≥ 5× trailing-20 avg → insert outlier
CREATE OR REPLACE FUNCTION cw_auto_open_vein()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_avg numeric;
  v_count int;
  v_mult numeric;
BEGIN
  IF NEW.views IS NULL OR NEW.views <= 0 THEN RETURN NEW; END IF;
  SELECT count(*), avg(views)::numeric
    INTO v_count, v_avg
    FROM (
      SELECT views FROM cw_posts
        WHERE platform = NEW.platform
          AND id <> NEW.id
          AND views > 0
        ORDER BY posted_at DESC
        LIMIT 20
    ) tr;
  IF v_count < 5 OR v_avg IS NULL OR v_avg = 0 THEN RETURN NEW; END IF;
  v_mult := NEW.views::numeric / v_avg;
  IF v_mult >= 5 THEN
    INSERT INTO cw_outliers (post_id, baseline_avg, multiple, vein_open)
      VALUES (NEW.id, round(v_avg)::int, round(v_mult, 2), true)
      ON CONFLICT (post_id) DO UPDATE
        SET baseline_avg = EXCLUDED.baseline_avg,
            multiple = EXCLUDED.multiple,
            vein_open = true,
            updated_at = now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cw_auto_open_vein ON cw_posts;
CREATE TRIGGER trg_cw_auto_open_vein AFTER INSERT OR UPDATE OF views ON cw_posts
  FOR EACH ROW EXECUTE FUNCTION cw_auto_open_vein();

-- ─── 10. cw_competitors ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text NOT NULL,
  platform cw_platform NOT NULL,
  niche text,
  tracked boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (handle, platform)
);
DROP TRIGGER IF EXISTS trg_cw_competitors_updated ON cw_competitors;
CREATE TRIGGER trg_cw_competitors_updated BEFORE UPDATE ON cw_competitors
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 11. cw_competitor_obs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_competitor_obs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id uuid NOT NULL REFERENCES cw_competitors(id) ON DELETE CASCADE,
  observed_topic text NOT NULL,
  demand_variable text NOT NULL,
  est_views int,
  source_url text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  idea_id uuid REFERENCES cw_ideas(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_competitor_obs_competitor ON cw_competitor_obs(competitor_id);
DROP TRIGGER IF EXISTS trg_cw_competitor_obs_updated ON cw_competitor_obs;
CREATE TRIGGER trg_cw_competitor_obs_updated BEFORE UPDATE ON cw_competitor_obs
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 12. cw_demand_mines ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_demand_mines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source cw_mine_source NOT NULL,
  raw_text text NOT NULL,
  topic text,
  source_url text,
  idea_id uuid REFERENCES cw_ideas(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_demand_mines_source ON cw_demand_mines(source);

-- ─── 13. cw_challenges ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal text NOT NULL,
  deadline date NOT NULL,
  declared_publicly_at timestamptz,
  declared_post_id uuid REFERENCES cw_posts(id),
  active boolean NOT NULL DEFAULT true,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_cw_challenges_updated ON cw_challenges;
CREATE TRIGGER trg_cw_challenges_updated BEFORE UPDATE ON cw_challenges
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 14. cw_challenge_logs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_challenge_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES cw_challenges(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  content_post_id uuid REFERENCES cw_posts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_challenge_logs_challenge ON cw_challenge_logs(challenge_id);

-- ─── 15. cw_recruiting_contacts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_recruiting_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source text,
  handle text,
  phone text,
  email text,
  status cw_contact_status NOT NULL DEFAULT 'to_contact',
  last_touch_at timestamptz,
  notes text,
  audience cw_contact_audience NOT NULL DEFAULT 'now',
  attribution_post_id uuid REFERENCES cw_posts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_recruiting_contacts_status ON cw_recruiting_contacts(status);
CREATE INDEX IF NOT EXISTS idx_cw_recruiting_contacts_audience ON cw_recruiting_contacts(audience);
DROP TRIGGER IF EXISTS trg_cw_recruiting_contacts_updated ON cw_recruiting_contacts;
CREATE TRIGGER trg_cw_recruiting_contacts_updated BEFORE UPDATE ON cw_recruiting_contacts
  FOR EACH ROW EXECUTE FUNCTION cw_set_updated_at();

-- ─── 16. cw_outreach_log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_outreach_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES cw_recruiting_contacts(id) ON DELETE CASCADE,
  channel text NOT NULL,
  message_ref text,
  message_body text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  response text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_outreach_log_contact ON cw_outreach_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_cw_outreach_log_sent_at ON cw_outreach_log(sent_at DESC);

-- ─── 17. cw_weekly_reviews ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL UNIQUE,
  total_views int NOT NULL DEFAULT 0,
  followers_added int NOT NULL DEFAULT 0,
  vf_conversion numeric NOT NULL DEFAULT 0,
  posts_count int NOT NULL DEFAULT 0,
  kill_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  iterate_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  deal_cycle_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 18. cw_kpi_snapshots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cw_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  views_7d int NOT NULL DEFAULT 0,
  followers_7d int NOT NULL DEFAULT 0,
  vf_pct numeric NOT NULL DEFAULT 0,
  posts_7d int NOT NULL DEFAULT 0,
  outliers_active int NOT NULL DEFAULT 0,
  pipeline_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cw_kpi_snapshots_date ON cw_kpi_snapshots(snapshot_date DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED: cw_pillars (6 rows) — APEX Standard Brand Bible
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO cw_pillars (code, name, description, monetization_tie, display_order) VALUES
  ('P1','Money & Sales Mastery','Selling, recruiting, commission, financial dominance','Sales Academy, Agency recruiting',1),
  ('P2','AI & Automation for Operators','Force-multiplier tools, agents, workflows','1:1, future AI course',2),
  ('P3','Physique & Athletic Performance','Body, training, discipline','APEX Fit',3),
  ('P4','Mindset & Mental Dominance','Belief, identity, faith, discipline','Top of funnel — all offers',4),
  ('P5','Modern Masculinity & Relationships','Standards, frame, dating, leadership','Inner Circle, authority',5),
  ('P6','Lifestyle & The APEX Standard','Proof, environment, taste, vision','Proof pillar',6)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      monetization_tie = EXCLUDED.monetization_tie,
      display_order = EXCLUDED.display_order,
      updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED: cw_dogmas (15 rows) — content spine
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO cw_dogmas (number, text) VALUES
  (1, 'The less you chase it, the more it comes to you.'),
  (2, 'As a man, you only have your back.'),
  (3, 'God puts you through everything to become who you''re meant to be.'),
  (4, 'Every adversity is just God showing you a new path.'),
  (5, 'Softness, low testosterone, no goals are the disease of modern men.'),
  (6, 'Procrastination dressed up as ''research'' is still procrastination.'),
  (7, 'Build value first. Don''t lock in until you''re worth locking into.'),
  (8, 'Quality women are rare. Lock her down. Don''t chase the rest.'),
  (9, 'Most people overcomplicate everything. Dominance and joy coexist.'),
  (10,'If you''re not #1 every week, you''re failing yourself.'),
  (11,'Don''t idolize anyone. Build your own dominance.'),
  (12,'Faith over comfort. God over feelings.'),
  (13,'Your real circle calls to ask the truth, not repeat the gossip.'),
  (14,'Nobody is coming to save you.'),
  (15,'The standard is everything. Average is the disease.')
ON CONFLICT (number) DO UPDATE SET text = EXCLUDED.text;

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED: cw_formats — 3 active starter formats
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO cw_formats (name, active, notes) VALUES
  ('Talking-Head-with-Credibility', true, 'Direct-to-camera with credibility stack (commissions, hires, story).'),
  ('Demonstration',                 true, 'Screen-record a real recruiting DM close / funnel walkthrough / commission screenshot.'),
  ('FaceTime/Snap-style',           true, 'Raw, vertical, direct, "why I left X" / "what nobody tells you" — recruiting DMs.')
ON CONFLICT (name) DO UPDATE SET notes = EXCLUDED.notes;

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEWS — dashboard sources
-- ═══════════════════════════════════════════════════════════════════════════

-- v_cw_posts_today: count of posts shipped today (any platform) — for quota gauge
DROP VIEW IF EXISTS v_cw_posts_today CASCADE;
CREATE VIEW v_cw_posts_today AS
SELECT count(*)::int AS posts_today,
       2 AS quota,
       (count(*) >= 2) AS quota_met
FROM cw_posts
WHERE posted_at::date = CURRENT_DATE;
GRANT SELECT ON v_cw_posts_today TO authenticated;

-- v_cw_quota_streak: last 30 days of post counts for heatmap
DROP VIEW IF EXISTS v_cw_quota_streak CASCADE;
CREATE VIEW v_cw_quota_streak AS
WITH d AS (
  SELECT generate_series(CURRENT_DATE - 29, CURRENT_DATE, '1 day')::date AS day
)
SELECT d.day,
       COALESCE(count(p.id), 0)::int AS posts,
       COALESCE(count(p.id), 0) >= 2 AS hit_quota
FROM d
LEFT JOIN cw_posts p ON p.posted_at::date = d.day
GROUP BY d.day
ORDER BY d.day;
GRANT SELECT ON v_cw_quota_streak TO authenticated;

-- v_cw_kpi_7d: 7-day rolling KPIs — top of dashboard
DROP VIEW IF EXISTS v_cw_kpi_7d CASCADE;
CREATE VIEW v_cw_kpi_7d AS
SELECT
  COALESCE(sum(views), 0)::int AS views_7d,
  COALESCE(sum(followers_gained), 0)::int AS followers_7d,
  CASE WHEN COALESCE(sum(views),0) > 0
       THEN round((COALESCE(sum(followers_gained),0)::numeric / sum(views) * 100), 3)
       ELSE 0 END AS vf_pct,
  count(*)::int AS posts_7d
FROM cw_posts
WHERE posted_at >= now() - interval '7 days';
GRANT SELECT ON v_cw_kpi_7d TO authenticated;

-- v_cw_active_outliers: open iteration veins with post context
DROP VIEW IF EXISTS v_cw_active_outliers CASCADE;
CREATE VIEW v_cw_active_outliers AS
SELECT
  o.id,
  o.post_id,
  o.baseline_avg,
  o.multiple,
  o.iterations_logged,
  o.followers_from_vein,
  o.opened_at,
  p.platform,
  p.url AS post_url,
  p.views,
  p.posted_at,
  pr.idea_id,
  i.title AS idea_title
FROM cw_outliers o
JOIN cw_posts p ON p.id = o.post_id
LEFT JOIN cw_productions pr ON pr.id = p.production_id
LEFT JOIN cw_ideas i ON i.id = pr.idea_id
WHERE o.vein_open IS TRUE
ORDER BY o.multiple DESC, o.opened_at DESC;
GRANT SELECT ON v_cw_active_outliers TO authenticated;

-- v_cw_recruiting_pipeline: funnel counts by status
DROP VIEW IF EXISTS v_cw_recruiting_pipeline CASCADE;
CREATE VIEW v_cw_recruiting_pipeline AS
SELECT
  count(*) FILTER (WHERE status='to_contact')::int AS to_contact,
  count(*) FILTER (WHERE status='contacted')::int AS contacted,
  count(*) FILTER (WHERE status='responded')::int AS responded,
  count(*) FILTER (WHERE status='booked')::int AS booked,
  count(*) FILTER (WHERE status='contracted')::int AS contracted,
  count(*) FILTER (WHERE status='dead')::int AS dead,
  count(*)::int AS total
FROM cw_recruiting_contacts;
GRANT SELECT ON v_cw_recruiting_pipeline TO authenticated;

-- v_cw_shot_vs_posted: ratio meter for Production Queue
DROP VIEW IF EXISTS v_cw_shot_vs_posted CASCADE;
CREATE VIEW v_cw_shot_vs_posted AS
WITH s AS (
  SELECT count(*) FILTER (WHERE status IN ('shot','sequenced','testing'))::int AS shot_pool,
         count(*) FILTER (WHERE status IN ('posted','iterating','vault'))::int AS posted_pool
  FROM cw_productions
  WHERE created_at >= now() - interval '14 days'
)
SELECT shot_pool, posted_pool,
       CASE WHEN shot_pool > 0 THEN round(posted_pool::numeric / shot_pool, 3) ELSE 0 END AS ratio,
       (shot_pool > 0 AND (posted_pool::numeric / shot_pool) >= 0.5) AS bottom_of_barrel_warning
FROM s;
GRANT SELECT ON v_cw_shot_vs_posted TO authenticated;

-- v_cw_audience_split: ICP / nurture ratio across active ideas
DROP VIEW IF EXISTS v_cw_audience_split CASCADE;
CREATE VIEW v_cw_audience_split AS
SELECT
  count(*) FILTER (WHERE audience='icp')::int AS icp_count,
  count(*) FILTER (WHERE audience='nurture')::int AS nurture_count,
  count(*)::int AS total,
  CASE WHEN count(*) > 0
       THEN round(count(*) FILTER (WHERE audience='icp')::numeric / count(*) * 100, 1)
       ELSE 0 END AS icp_pct
FROM cw_ideas
WHERE status NOT IN ('killed','vault');
GRANT SELECT ON v_cw_audience_split TO authenticated;

-- v_cw_active_challenge: current public challenge + progress
DROP VIEW IF EXISTS v_cw_active_challenge CASCADE;
CREATE VIEW v_cw_active_challenge AS
SELECT
  c.id, c.goal, c.deadline, c.declared_publicly_at,
  count(l.id)::int AS logs_count,
  (c.deadline - CURRENT_DATE)::int AS days_left
FROM cw_challenges c
LEFT JOIN cw_challenge_logs l ON l.challenge_id = c.id
WHERE c.active IS TRUE
GROUP BY c.id;
GRANT SELECT ON v_cw_active_challenge TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: cw_dashboard_payload — single round-trip for the Dashboard module
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cw_dashboard_payload()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT jsonb_build_object(
    'posts_today',       (SELECT row_to_json(v) FROM v_cw_posts_today v),
    'kpi_7d',            (SELECT row_to_json(v) FROM v_cw_kpi_7d v),
    'streak',            (SELECT COALESCE(jsonb_agg(row_to_json(v) ORDER BY v.day), '[]'::jsonb) FROM v_cw_quota_streak v),
    'outliers',          (SELECT COALESCE(jsonb_agg(row_to_json(v) ORDER BY v.multiple DESC), '[]'::jsonb) FROM v_cw_active_outliers v),
    'pipeline',          (SELECT row_to_json(v) FROM v_cw_recruiting_pipeline v),
    'shot_vs_posted',    (SELECT row_to_json(v) FROM v_cw_shot_vs_posted v),
    'audience_split',    (SELECT row_to_json(v) FROM v_cw_audience_split v),
    'active_challenge',  (SELECT row_to_json(v) FROM v_cw_active_challenge v LIMIT 1),
    'generated_at',      now()
  ) INTO v_payload;
  RETURN v_payload;
END $$;

REVOKE ALL ON FUNCTION cw_dashboard_payload() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cw_dashboard_payload() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC: cw_record_kpi_snapshot — write today's KPI snapshot for trend lines
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION cw_record_kpi_snapshot()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_pipeline jsonb;
  v_kpi record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT * INTO v_kpi FROM v_cw_kpi_7d;
  SELECT row_to_json(v)::jsonb INTO v_pipeline FROM v_cw_recruiting_pipeline v;
  INSERT INTO cw_kpi_snapshots (snapshot_date, views_7d, followers_7d, vf_pct, posts_7d, outliers_active, pipeline_json)
  VALUES (
    CURRENT_DATE,
    v_kpi.views_7d, v_kpi.followers_7d, v_kpi.vf_pct, v_kpi.posts_7d,
    (SELECT count(*)::int FROM cw_outliers WHERE vein_open IS TRUE),
    v_pipeline
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION cw_record_kpi_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cw_record_kpi_snapshot() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — admin-only on every cw_ table
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'cw\_%' ESCAPE '\'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_all', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        FOR ALL
        USING (public.has_role(auth.uid(), 'admin'::app_role))
        WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role))
    $p$, t || '_admin_all', t);
  END LOOP;
END $$;

-- Explicitly REVOKE everything from anon (defense in depth)
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'cw\_%' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    EXECUTE format('GRANT  ALL ON %I TO authenticated', t);
  END LOOP;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ContentWheel P0 — done. Next: P1 (nav + dashboard shell).
-- "Hold the Standard. Average is the disease."
-- ═══════════════════════════════════════════════════════════════════════════
