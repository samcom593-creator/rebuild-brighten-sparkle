-- APEX Telegram Bot — Schema
-- Target: xrzweoneiieddzxogewk (apex-financial.org Supabase project)
-- Built: 2026-05-19
-- Idempotent. Safe to re-run.

-- ============================================================================
-- 1) Core tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS telegram_users (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT UNIQUE NOT NULL,
  telegram_user_id BIGINT,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT DEFAULT 'en',
  phone TEXT,
  email TEXT,
  applicant_id UUID,
  agent_id UUID,
  stage TEXT NOT NULL DEFAULT 'lobby',
  flow_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  opt_out_nudges BOOLEAN NOT NULL DEFAULT false,
  opt_out_all BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  last_nudge_at TIMESTAMPTZ,
  inactivity_nudge_sent_at TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  escalated_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_users_applicant_fk') THEN
    ALTER TABLE telegram_users ADD CONSTRAINT telegram_users_applicant_fk
      FOREIGN KEY (applicant_id) REFERENCES applications(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'telegram_users_agent_fk') THEN
    ALTER TABLE telegram_users ADD CONSTRAINT telegram_users_agent_fk
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_telegram_users_stage ON telegram_users(stage);
CREATE INDEX IF NOT EXISTS idx_telegram_users_last_active ON telegram_users(last_active_at);
CREATE INDEX IF NOT EXISTS idx_telegram_users_applicant ON telegram_users(applicant_id);
CREATE INDEX IF NOT EXISTS idx_telegram_users_agent ON telegram_users(agent_id);
CREATE INDEX IF NOT EXISTS idx_telegram_users_phone ON telegram_users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_users_email ON telegram_users(email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_groups (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('lobby','licensing','seminar','onboarding','training','wins','ai_dm','manager_alerts')),
  invite_link TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  rules TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  telegram_user_id BIGINT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  message_type TEXT,
  text TEXT,
  command TEXT,
  template_key TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_answered BOOLEAN NOT NULL DEFAULT false,
  escalated BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat ON telegram_messages(chat_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_direction ON telegram_messages(direction, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_command ON telegram_messages(command) WHERE command IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_templates (
  key TEXT PRIMARY KEY,
  description TEXT,
  body TEXT NOT NULL,
  parse_mode TEXT NOT NULL DEFAULT 'HTML',
  buttons JSONB,
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  voice_check_passed BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_scheduled_messages (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  template_key TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped','failed','cancelled')),
  reason TEXT,
  dedupe_key TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tg_sched_pending ON telegram_scheduled_messages(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tg_sched_chat ON telegram_scheduled_messages(chat_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_sched_dedupe ON telegram_scheduled_messages(chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending';

CREATE TABLE IF NOT EXISTS telegram_escalations (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  trigger_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  manager_id UUID,
  manager_handle TEXT,
  notes TEXT,
  reping_count INT NOT NULL DEFAULT 0,
  last_reping_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_escalations_open ON telegram_escalations(created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_escalations_chat ON telegram_escalations(chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_faq (
  id BIGSERIAL PRIMARY KEY,
  question_pattern TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('licensing','application','seminar','money','contract','training','tech','general')),
  answer_body TEXT NOT NULL,
  match_keywords TEXT[] NOT NULL DEFAULT '{}',
  use_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_faq_keywords ON telegram_faq USING GIN(match_keywords);
CREATE INDEX IF NOT EXISTS idx_telegram_faq_category ON telegram_faq(category) WHERE active;

-- ============================================================================
-- 2) Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION telegram_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_telegram_users_updated_at ON telegram_users;
CREATE TRIGGER trg_telegram_users_updated_at BEFORE UPDATE ON telegram_users
  FOR EACH ROW EXECUTE FUNCTION telegram_set_updated_at();

DROP TRIGGER IF EXISTS trg_telegram_groups_updated_at ON telegram_groups;
CREATE TRIGGER trg_telegram_groups_updated_at BEFORE UPDATE ON telegram_groups
  FOR EACH ROW EXECUTE FUNCTION telegram_set_updated_at();

DROP TRIGGER IF EXISTS trg_telegram_templates_updated_at ON telegram_templates;
CREATE TRIGGER trg_telegram_templates_updated_at BEFORE UPDATE ON telegram_templates
  FOR EACH ROW EXECUTE FUNCTION telegram_set_updated_at();

-- ============================================================================
-- 3) Views
-- ============================================================================

-- Note: COUNT(*) is bigint; bot-sql JSON serializer doesn't handle bigint, so we cast to int.
DROP VIEW IF EXISTS v_telegram_dashboard CASCADE;
CREATE VIEW v_telegram_dashboard AS
SELECT
  (SELECT COUNT(*)::int FROM telegram_users WHERE NOT opt_out_all) AS total_users,
  (SELECT COUNT(*)::int FROM telegram_users WHERE NOT opt_out_all AND last_active_at > now() - interval '24 hours') AS dau,
  (SELECT COUNT(*)::int FROM telegram_users WHERE NOT opt_out_all AND last_active_at > now() - interval '7 days') AS wau,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'lobby' AND NOT opt_out_all) AS lobby,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'applied_unpaid' AND NOT opt_out_all) AS applied_unpaid,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'applied_paid' AND NOT opt_out_all) AS applied_paid,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'manager_call_scheduled' AND NOT opt_out_all) AS call_scheduled,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'seminar_attended' AND NOT opt_out_all) AS post_seminar,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'pre_license_studying' AND NOT opt_out_all) AS studying,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'exam_scheduled' AND NOT opt_out_all) AS exam_scheduled,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'licensed' AND NOT opt_out_all) AS licensed_unhired,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'hired' AND NOT opt_out_all) AS hired,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage LIKE 'onboarding%' AND NOT opt_out_all) AS onboarding,
  (SELECT COUNT(*)::int FROM telegram_users WHERE stage = 'active_agent' AND NOT opt_out_all) AS active_agents,
  (SELECT COUNT(*)::int FROM telegram_users WHERE last_active_at < now() - interval '7 days' AND stage NOT IN ('active_agent','opt_out') AND NOT opt_out_all) AS stale_7d,
  (SELECT COUNT(*)::int FROM telegram_escalations WHERE resolved_at IS NULL) AS open_escalations,
  (SELECT COUNT(*)::int FROM telegram_scheduled_messages WHERE status='pending' AND scheduled_at <= now() + interval '24 hours') AS upcoming_nudges_24h,
  (SELECT COUNT(*)::int FROM telegram_messages WHERE direction='inbound' AND sent_at > now() - interval '24 hours') AS inbound_24h,
  (SELECT COUNT(*)::int FROM telegram_messages WHERE direction='outbound' AND sent_at > now() - interval '24 hours') AS outbound_24h;

DROP VIEW IF EXISTS v_telegram_funnel CASCADE;
CREATE VIEW v_telegram_funnel AS
WITH base AS (
  SELECT stage, COUNT(*)::int AS c
  FROM telegram_users
  WHERE NOT opt_out_all
  GROUP BY stage
)
SELECT
  stage,
  c AS count,
  ROUND(100.0 * c / NULLIF((SELECT SUM(c) FROM base), 0), 1) AS pct
FROM base
ORDER BY c DESC;

CREATE OR REPLACE VIEW v_telegram_stuck_users AS
SELECT
  tu.chat_id,
  tu.first_name,
  tu.username,
  tu.stage,
  tu.last_active_at,
  ROUND(EXTRACT(epoch FROM now() - tu.last_active_at) / 86400.0, 1) AS days_stale,
  tu.applicant_id,
  tu.agent_id,
  tu.escalated_at IS NOT NULL AS already_escalated
FROM telegram_users tu
WHERE NOT tu.opt_out_all
  AND tu.last_active_at < now() - interval '3 days'
  AND tu.stage NOT IN ('active_agent','opt_out')
ORDER BY tu.last_active_at ASC;

-- ============================================================================
-- 4) RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION telegram_due_nudges(now_ts TIMESTAMPTZ DEFAULT now(), limit_n INT DEFAULT 50)
RETURNS TABLE (
  id BIGINT, chat_id BIGINT, template_key TEXT, context JSONB, reason TEXT
) LANGUAGE sql STABLE AS $$
  SELECT id, chat_id, template_key, context, reason
  FROM telegram_scheduled_messages
  WHERE status = 'pending' AND scheduled_at <= now_ts
  ORDER BY scheduled_at ASC
  LIMIT limit_n;
$$;

-- Match a telegram_users row to an applications row by phone or email.
-- Returns the resolved applications row info if a match is found.
CREATE OR REPLACE FUNCTION telegram_link_application(p_chat_id BIGINT, p_phone TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL)
RETURNS TABLE (
  applicant_id UUID,
  new_stage TEXT,
  ica_paid_at TIMESTAMPTZ
) LANGUAGE plpgsql AS $$
DECLARE
  v_app applications%ROWTYPE;
  v_stage TEXT;
BEGIN
  IF p_phone IS NOT NULL THEN
    SELECT * INTO v_app FROM applications WHERE phone = p_phone ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_app.id IS NULL AND p_email IS NOT NULL THEN
    SELECT * INTO v_app FROM applications WHERE email = p_email ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_app.id IS NULL THEN
    RETURN;
  END IF;

  v_stage := CASE
    WHEN v_app.ica_paid_at IS NOT NULL THEN 'applied_paid'
    ELSE 'applied_unpaid'
  END;

  UPDATE telegram_users
     SET applicant_id = v_app.id,
         stage = v_stage,
         phone = COALESCE(telegram_users.phone, p_phone),
         email = COALESCE(telegram_users.email, p_email),
         updated_at = now()
   WHERE chat_id = p_chat_id;

  RETURN QUERY SELECT v_app.id, v_stage, v_app.ica_paid_at;
END $$;

-- Stage-sync sweep: looks at every telegram_users row, compares to current
-- applications/agents state, advances the stage and queues a transition nudge.
CREATE OR REPLACE FUNCTION telegram_sync_stages()
RETURNS TABLE (chat_id BIGINT, old_stage TEXT, new_stage TEXT, nudge_template TEXT) LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
  v_new_stage TEXT;
  v_template TEXT;
BEGIN
  FOR r IN
    SELECT tu.chat_id, tu.stage AS old_stage, tu.applicant_id, tu.agent_id, tu.last_active_at,
           a.ica_paid_at, ag.id AS agent_row_id, ag.created_at AS hired_at
    FROM telegram_users tu
    LEFT JOIN applications a ON a.id = tu.applicant_id
    LEFT JOIN agents ag ON ag.id = tu.agent_id
    WHERE NOT tu.opt_out_all
      AND tu.stage NOT IN ('active_agent','opt_out')
  LOOP
    v_new_stage := r.old_stage;
    v_template := NULL;

    IF r.agent_row_id IS NOT NULL AND r.old_stage NOT IN ('hired','onboarding_d1','onboarding_d3','onboarding_d7','onboarding_d14','active_agent') THEN
      v_new_stage := 'hired';
      v_template := 'stage.hired';
    ELSIF r.old_stage = 'applied_unpaid' AND r.ica_paid_at IS NOT NULL THEN
      v_new_stage := 'applied_paid';
      v_template := 'stage.applied_paid';
    ELSIF r.old_stage = 'hired' AND r.hired_at IS NOT NULL AND r.hired_at < now() - interval '1 day' THEN
      v_new_stage := 'onboarding_d1';
      v_template := 'nudge.onboarding_d1';
    ELSIF r.old_stage = 'onboarding_d1' AND r.hired_at IS NOT NULL AND r.hired_at < now() - interval '3 days' THEN
      v_new_stage := 'onboarding_d3';
      v_template := 'nudge.onboarding_d3';
    ELSIF r.old_stage = 'onboarding_d3' AND r.hired_at IS NOT NULL AND r.hired_at < now() - interval '7 days' THEN
      v_new_stage := 'onboarding_d7';
      v_template := 'nudge.onboarding_d7';
    ELSIF r.old_stage = 'onboarding_d7' AND r.hired_at IS NOT NULL AND r.hired_at < now() - interval '14 days' THEN
      v_new_stage := 'onboarding_d14';
      v_template := 'nudge.onboarding_d14';
    END IF;

    IF v_new_stage <> r.old_stage THEN
      UPDATE telegram_users SET stage = v_new_stage, updated_at = now() WHERE chat_id = r.chat_id;

      IF v_template IS NOT NULL THEN
        INSERT INTO telegram_scheduled_messages(chat_id, template_key, scheduled_at, reason, dedupe_key)
        VALUES (r.chat_id, v_template, now(), 'stage_transition_' || v_new_stage, 'transition_' || v_new_stage || '_' || r.chat_id)
        ON CONFLICT (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      END IF;

      RETURN QUERY SELECT r.chat_id, r.old_stage, v_new_stage, v_template;
    END IF;
  END LOOP;
  RETURN;
END $$;

-- ============================================================================
-- 5) RLS — service-role only
-- ============================================================================

ALTER TABLE telegram_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_faq ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'telegram_users_service_all') THEN
    CREATE POLICY telegram_users_service_all ON telegram_users FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'telegram_groups_service_all') THEN
    CREATE POLICY telegram_groups_service_all ON telegram_groups FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'telegram_messages_service_all') THEN
    CREATE POLICY telegram_messages_service_all ON telegram_messages FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'telegram_templates_service_all') THEN
    CREATE POLICY telegram_templates_service_all ON telegram_templates FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'telegram_sched_service_all') THEN
    CREATE POLICY telegram_sched_service_all ON telegram_scheduled_messages FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'telegram_esc_service_all') THEN
    CREATE POLICY telegram_esc_service_all ON telegram_escalations FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'telegram_faq_service_all') THEN
    CREATE POLICY telegram_faq_service_all ON telegram_faq FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Done.
