-- APEX Telegram Bot — auto-broadcasts + auto-link triggers + system_settings seed.
-- Built: 2026-05-19. Idempotent.
--
-- Notes about the apex DB shape:
--   - agents.first_name/state/last_name don't exist directly.
--     Name flows from agents.display_name OR a joined profiles row via profile_id.
--     State flows from agents.license_states (text[]) first element.
--   - agents already has telegram_chat_id (bigint) + telegram_opt_out (boolean)
--     columns — Sam pre-staged the schema for this. The trigger uses them when present.
--   - system_settings only has (key, value, updated_at, created_at) — no description column.

-- ============================================================================
-- 1) AGENTS INSERT → wins.new_hire broadcast
-- ============================================================================

CREATE OR REPLACE FUNCTION telegram_broadcast_new_hire()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_wins_chat BIGINT;
  v_first TEXT;
  v_last_initial TEXT;
  v_state TEXT;
  v_profile_first TEXT;
  v_profile_last TEXT;
BEGIN
  SELECT chat_id INTO v_wins_chat
    FROM telegram_groups
   WHERE type = 'wins' AND is_active = true
   LIMIT 1;

  IF v_wins_chat IS NULL THEN
    RETURN NEW;
  END IF;

  -- Try to enrich name from profiles (fallback to display_name)
  IF NEW.profile_id IS NOT NULL THEN
    BEGIN
      SELECT first_name, last_name INTO v_profile_first, v_profile_last
        FROM profiles WHERE id = NEW.profile_id LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_profile_first := NULL;
      v_profile_last := NULL;
    END;
  END IF;

  v_first := COALESCE(v_profile_first, NEW.display_name, '?');
  v_last_initial := COALESCE(LEFT(NULLIF(v_profile_last, ''), 1) || '.', '');
  v_state := CASE
    WHEN NEW.license_states IS NOT NULL AND array_length(NEW.license_states, 1) >= 1 THEN NEW.license_states[1]
    ELSE '—'
  END;

  INSERT INTO telegram_scheduled_messages(chat_id, template_key, context, scheduled_at, reason, dedupe_key)
  VALUES (
    v_wins_chat,
    'wins.new_hire',
    jsonb_build_object('first_name', v_first, 'last_name_initial', v_last_initial, 'state', v_state),
    now(),
    'auto_broadcast_new_hire',
    'wins_new_hire_' || NEW.id::text
  )
  ON CONFLICT (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_telegram_broadcast_new_hire ON agents;
CREATE TRIGGER trg_telegram_broadcast_new_hire
AFTER INSERT ON agents
FOR EACH ROW EXECUTE FUNCTION telegram_broadcast_new_hire();

-- ============================================================================
-- 2) APPLICATIONS ica_paid_at flips → stage.applied_paid DM
-- ============================================================================

CREATE OR REPLACE FUNCTION telegram_broadcast_ica_paid()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_chat BIGINT;
  v_first TEXT;
BEGIN
  IF NEW.ica_paid_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.ica_paid_at IS NOT NULL THEN RETURN NEW; END IF;

  SELECT tu.chat_id, COALESCE(tu.first_name, NEW.first_name, 'Friend')
    INTO v_chat, v_first
    FROM telegram_users tu
   WHERE tu.applicant_id = NEW.id
      OR (NEW.phone IS NOT NULL AND tu.phone = REGEXP_REPLACE(NEW.phone, '\D', '', 'g'))
      OR (NEW.email IS NOT NULL AND LOWER(tu.email) = LOWER(NEW.email))
   ORDER BY (tu.applicant_id = NEW.id) DESC NULLS LAST, tu.last_active_at DESC
   LIMIT 1;

  IF v_chat IS NULL THEN RETURN NEW; END IF;

  UPDATE telegram_users
     SET stage = 'applied_paid',
         applicant_id = NEW.id,
         updated_at = now()
   WHERE chat_id = v_chat;

  INSERT INTO telegram_scheduled_messages(chat_id, template_key, context, scheduled_at, reason, dedupe_key)
  VALUES (
    v_chat,
    'stage.applied_paid',
    jsonb_build_object('first_name', v_first, 'ica_paid_at_short', to_char(NEW.ica_paid_at, 'YYYY-MM-DD')),
    now(),
    'auto_broadcast_ica_paid',
    'stage_applied_paid_' || v_chat::text
  )
  ON CONFLICT (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_telegram_broadcast_ica_paid ON applications;
CREATE TRIGGER trg_telegram_broadcast_ica_paid
AFTER UPDATE OF ica_paid_at ON applications
FOR EACH ROW EXECUTE FUNCTION telegram_broadcast_ica_paid();

-- ============================================================================
-- 3) APPLICATIONS INSERT → auto-link to existing telegram_users (DM-first)
-- ============================================================================

CREATE OR REPLACE FUNCTION telegram_autolink_application()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_chat BIGINT;
  v_new_stage TEXT;
BEGIN
  SELECT tu.chat_id INTO v_chat
    FROM telegram_users tu
   WHERE tu.applicant_id IS NULL
     AND (
       (NEW.phone IS NOT NULL AND tu.phone = REGEXP_REPLACE(NEW.phone, '\D', '', 'g'))
       OR (NEW.email IS NOT NULL AND LOWER(tu.email) = LOWER(NEW.email))
     )
   ORDER BY tu.last_active_at DESC
   LIMIT 1;

  IF v_chat IS NULL THEN RETURN NEW; END IF;

  v_new_stage := CASE
    WHEN NEW.ica_paid_at IS NOT NULL THEN 'applied_paid'
    ELSE 'applied_unpaid'
  END;

  UPDATE telegram_users
     SET applicant_id = NEW.id,
         stage = v_new_stage,
         updated_at = now()
   WHERE chat_id = v_chat;

  INSERT INTO telegram_scheduled_messages(chat_id, template_key, context, scheduled_at, reason, dedupe_key)
  VALUES (
    v_chat,
    CASE WHEN v_new_stage = 'applied_paid' THEN 'welcome.matched_paid' ELSE 'welcome.matched_unpaid' END,
    jsonb_build_object(
      'first_name', COALESCE(NEW.first_name, 'Friend'),
      'ica_paid_at_short', COALESCE(to_char(NEW.ica_paid_at, 'YYYY-MM-DD'), ''),
      'manager_call_status', 'not booked yet',
      'ica_amount', '$125',
      'ica_link', 'https://apex-financial.org/pay-ica'
    ),
    now(),
    'auto_link_application',
    'autolink_' || NEW.id::text
  )
  ON CONFLICT (chat_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_telegram_autolink_application ON applications;
CREATE TRIGGER trg_telegram_autolink_application
AFTER INSERT ON applications
FOR EACH ROW EXECUTE FUNCTION telegram_autolink_application();

-- ============================================================================
-- 4) Seed system_settings (telegram_invite_url + bot_username + bot_dm_url)
-- ============================================================================

INSERT INTO system_settings(key, value)
VALUES
  ('telegram_invite_url', 'https://t.me/+8jZjxbN9YzU0NjYx'),
  ('telegram_bot_username', 'ApexFinancialBot'),
  ('telegram_bot_dm_url', 'https://t.me/ApexFinancialBot')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 5) Telegram-aware lookup view (cross-reference)
-- ============================================================================

DROP VIEW IF EXISTS v_telegram_application_link CASCADE;
CREATE VIEW v_telegram_application_link AS
SELECT
  tu.chat_id,
  tu.first_name,
  tu.username,
  tu.stage AS telegram_stage,
  tu.last_active_at,
  a.id AS application_id,
  a.first_name AS app_first_name,
  a.email AS app_email,
  a.phone AS app_phone,
  a.ica_paid_at,
  a.status AS application_status,
  a.created_at AS application_created_at
FROM telegram_users tu
LEFT JOIN applications a ON a.id = tu.applicant_id
WHERE NOT tu.opt_out_all;

COMMENT ON VIEW v_telegram_application_link IS 'Cross-reference telegram_users ↔ applications. Apex admin dashboard.';
