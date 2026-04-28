-- APEX-OS LOCAL TRACKING DATABASE
-- SQLite schema for all sub-bot state, metrics, logs, and reporting
-- Initialized by apex_os.sh on startup

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ============================================================
-- SYSTEM META
-- ============================================================
CREATE TABLE IF NOT EXISTS apex_os_meta (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO apex_os_meta(key,value) VALUES
  ('version','1.0.0'),
  ('initialized_at', datetime('now')),
  ('last_full_audit', NULL),
  ('week_number', strftime('%W','now'));

-- ============================================================
-- AUTONOMOUS ACTION LOG (every action timestamped + reasoned)
-- ============================================================
CREATE TABLE IF NOT EXISTS action_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT DEFAULT (datetime('now')),
  sub_bot     TEXT NOT NULL,
  action      TEXT NOT NULL,
  reasoning   TEXT,
  result      TEXT,
  layer1_ok   INTEGER, -- executed cleanly (0/1)
  layer2_ok   INTEGER, -- moved target metric (0/1)
  layer3_note TEXT     -- tighter version if found
);

-- ============================================================
-- SUB-BOT REGISTRY + PERFORMANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS sub_bots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  domain          TEXT NOT NULL,
  status          TEXT DEFAULT 'active', -- active | rewriting | killed
  consecutive_underperform INTEGER DEFAULT 0,
  last_report_at  TEXT,
  week_score      REAL DEFAULT 0.0,
  prior_week_score REAL DEFAULT 0.0,
  created_at      TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO sub_bots(bot_id,name,domain) VALUES
  ('bot_1','Agent Activation Bot','agent_activation'),
  ('bot_2','Recruiting Call Optimizer','recruiting'),
  ('bot_3','Content Distribution Bot','content'),
  ('bot_4','Seminar Conversion Bot','seminar'),
  ('bot_5','Application Clearance Bot','applications'),
  ('bot_6','DM Response Bot','dm_queue'),
  ('bot_7','Stack Efficiency Bot','automation'),
  ('bot_8','Self-Healing Bot','system_health');

-- ============================================================
-- BOT 1 — AGENT ACTIVATION (Day 1-30 tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_contracts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name      TEXT NOT NULL,
  apex_agent_id   TEXT,
  contract_date   TEXT NOT NULL,
  day_in_cycle    INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active', -- active | dropped | completed
  last_activity   TEXT,
  first_deal_date TEXT,
  deals_30d       INTEGER DEFAULT 0,
  flag_dropoff    INTEGER DEFAULT 0,
  flag_reason     TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activation_checkpoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER REFERENCES agent_contracts(id),
  day         INTEGER NOT NULL, -- 1,3,7,14,21,30
  checkpoint  TEXT NOT NULL,
  met         INTEGER DEFAULT 0,
  met_at      TEXT,
  prompt_sent TEXT,
  ts          TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- BOT 2 — RECRUITING CALL OPTIMIZER
-- ============================================================
CREATE TABLE IF NOT EXISTS recruiting_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  call_date     TEXT NOT NULL,
  prospect_name TEXT,
  outcome       TEXT, -- booked | no_show | not_interested | closed | callback
  close_attempt INTEGER DEFAULT 0,
  objection     TEXT,
  script_version TEXT DEFAULT 'v1',
  duration_min  INTEGER,
  notes         TEXT,
  ts            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS closing_patterns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL,
  close_rate  REAL,
  sample_size INTEGER DEFAULT 0,
  script_mod  TEXT,
  active      INTEGER DEFAULT 1,
  identified_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_close_rates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week        TEXT NOT NULL,
  calls_total INTEGER DEFAULT 0,
  calls_closed INTEGER DEFAULT 0,
  close_rate  REAL DEFAULT 0.0,
  delta_pct   REAL DEFAULT 0.0,
  best_objection_handle TEXT,
  ts          TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- BOT 3 — CONTENT DISTRIBUTION
-- ============================================================
CREATE TABLE IF NOT EXISTS content_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  post_date     TEXT NOT NULL,
  platform      TEXT NOT NULL, -- youtube | instagram | tiktok | snapchat
  content_type  TEXT, -- hook | vsl | testimonial | edu | cta
  hook_text     TEXT,
  views         INTEGER DEFAULT 0,
  likes         INTEGER DEFAULT 0,
  comments      INTEGER DEFAULT 0,
  shares        INTEGER DEFAULT 0,
  dm_leads      INTEGER DEFAULT 0,
  engagement_rate REAL DEFAULT 0.0,
  resonance_score REAL DEFAULT 0.0,
  ts            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_cadence (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  platform  TEXT UNIQUE NOT NULL,
  posts_per_week INTEGER DEFAULT 3,
  best_time TEXT,
  last_adjusted TEXT,
  reason    TEXT
);

INSERT OR IGNORE INTO content_cadence(platform, posts_per_week, best_time) VALUES
  ('tiktok', 7, '7pm CT'),
  ('instagram', 5, '6pm CT'),
  ('youtube', 3, '12pm CT'),
  ('snapchat', 4, '8pm CT');

-- ============================================================
-- BOT 4 — SEMINAR CONVERSION
-- ============================================================
CREATE TABLE IF NOT EXISTS seminar_attendees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seminar_date  TEXT NOT NULL,
  seminar_type  TEXT DEFAULT 'vsl', -- vsl | live_qa
  day_of_week   TEXT, -- wednesday | friday | sunday
  attendee_name TEXT,
  email         TEXT,
  phone         TEXT,
  watched_pct   REAL DEFAULT 0.0, -- % of VSL watched
  attended_qa   INTEGER DEFAULT 0,
  applied       INTEGER DEFAULT 0,
  applied_at    TEXT,
  ica_signed    INTEGER DEFAULT 0,
  ica_signed_at TEXT,
  onboarded     INTEGER DEFAULT 0,
  drop_point    TEXT, -- where they fell off
  ts            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seminar_weekly_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  week            TEXT NOT NULL,
  attendees_total INTEGER DEFAULT 0,
  applied         INTEGER DEFAULT 0,
  ica_signed      INTEGER DEFAULT 0,
  onboarded       INTEGER DEFAULT 0,
  attend_to_ica   REAL DEFAULT 0.0,
  weak_modules    TEXT, -- JSON list of identified weak segments
  ts              TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- BOT 5 — APPLICATION CLEARANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  apex_app_id   TEXT,
  applicant_name TEXT NOT NULL,
  source        TEXT, -- tiktok | instagram | seminar | referral | other
  received_date TEXT NOT NULL,
  status        TEXT DEFAULT 'unworked', -- unworked | in_progress | stalled | cleared | rejected
  priority_score INTEGER DEFAULT 0,
  last_contact  TEXT,
  followup_count INTEGER DEFAULT 0,
  next_followup TEXT,
  cleared_at    TEXT,
  notes         TEXT,
  ts            TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clearance_velocity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date   TEXT NOT NULL,
  backlog_start INTEGER DEFAULT 0,
  cleared_today INTEGER DEFAULT 0,
  stalled_flagged INTEGER DEFAULT 0,
  backlog_end   INTEGER DEFAULT 0,
  velocity_per_day REAL DEFAULT 0.0,
  ts            TEXT DEFAULT (datetime('now'))
);

-- Seed the 200+ backlog marker
INSERT OR IGNORE INTO apex_os_meta(key,value) VALUES
  ('app_backlog_initial','200'),
  ('app_backlog_current','200');

-- ============================================================
-- BOT 6 — DM RESPONSE (TikTok queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS dm_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT DEFAULT 'tiktok',
  sender_handle TEXT NOT NULL,
  message_text  TEXT,
  received_at   TEXT,
  intent_signal TEXT, -- hot | warm | cold | spam | info
  intent_score  INTEGER DEFAULT 0, -- 0-100
  status        TEXT DEFAULT 'unactioned', -- unactioned | drafted | sent | escalated | ignored
  draft_response TEXT,
  sent_at       TEXT,
  escalated_to_sam INTEGER DEFAULT 0,
  escalation_reason TEXT,
  ts            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dm_weekly_metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  week          TEXT NOT NULL,
  queue_start   INTEGER DEFAULT 0,
  actioned      INTEGER DEFAULT 0,
  auto_sent     INTEGER DEFAULT 0,
  escalated     INTEGER DEFAULT 0,
  queue_end     INTEGER DEFAULT 0,
  hot_leads_converted INTEGER DEFAULT 0,
  ts            TEXT DEFAULT (datetime('now'))
);

-- Seed 1000+ backlog marker
INSERT OR IGNORE INTO apex_os_meta(key,value) VALUES
  ('dm_queue_initial','1000'),
  ('dm_queue_current','1000');

-- ============================================================
-- BOT 7 — STACK EFFICIENCY
-- ============================================================
CREATE TABLE IF NOT EXISTS manual_processes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  process_name  TEXT NOT NULL,
  frequency     TEXT, -- daily | weekly | per_event
  minutes_per_run REAL DEFAULT 0.0,
  runs_per_week REAL DEFAULT 0.0,
  hours_per_week REAL DEFAULT 0.0,
  automation_proposed TEXT,
  automation_status TEXT DEFAULT 'identified', -- identified | proposed | approved | implemented
  hours_saved_weekly REAL DEFAULT 0.0,
  ts            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS efficiency_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week        TEXT NOT NULL,
  total_manual_hours_before REAL DEFAULT 0.0,
  total_manual_hours_after  REAL DEFAULT 0.0,
  hours_eliminated REAL DEFAULT 0.0,
  automations_implemented INTEGER DEFAULT 0,
  ts          TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- BOT 8 — SELF-HEALING / SYSTEM HEALTH
-- ============================================================
CREATE TABLE IF NOT EXISTS system_health (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  check_ts    TEXT DEFAULT (datetime('now')),
  component   TEXT NOT NULL,
  status      TEXT DEFAULT 'ok', -- ok | degraded | broken | recovered
  error_msg   TEXT,
  auto_resolved INTEGER DEFAULT 0,
  resolution_note TEXT,
  escalate_to_sam INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS broken_automations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  automation  TEXT NOT NULL,
  detected_at TEXT DEFAULT (datetime('now')),
  error       TEXT,
  attempted_fix TEXT,
  fixed       INTEGER DEFAULT 0,
  fixed_at    TEXT,
  needs_sam   INTEGER DEFAULT 0
);

-- ============================================================
-- REPORTING / TASK LIST
-- ============================================================
CREATE TABLE IF NOT EXISTS task_list (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT DEFAULT (datetime('now')),
  priority    TEXT NOT NULL, -- urgent | strategic | informational
  category    TEXT,
  title       TEXT NOT NULL,
  what_improved TEXT,
  whats_bleeding TEXT,
  what_we_did TEXT,
  needs_sam   TEXT,
  status      TEXT DEFAULT 'open', -- open | in_progress | done | dismissed
  due_by      TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS weekly_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week        TEXT NOT NULL,
  generated_at TEXT DEFAULT (datetime('now')),
  bot_rankings TEXT, -- JSON
  metrics_json TEXT, -- JSON snapshot of all metrics
  improvements TEXT,
  bleeding     TEXT,
  actions_taken TEXT,
  sam_decisions TEXT
);

-- ============================================================
-- INACTIVE AGENT RECOVERY (27 priority agents)
-- ============================================================
CREATE TABLE IF NOT EXISTS inactive_agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name    TEXT NOT NULL,
  apex_agent_id TEXT,
  contracted_date TEXT,
  last_active   TEXT,
  days_inactive INTEGER DEFAULT 0,
  recovery_status TEXT DEFAULT 'not_started', -- not_started | outreach_sent | responded | recovered | churned
  outreach_count INTEGER DEFAULT 0,
  last_outreach TEXT,
  next_outreach TEXT,
  barrier       TEXT, -- identified barrier to reactivation
  priority_rank INTEGER,
  notes         TEXT,
  ts            TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO apex_os_meta(key,value) VALUES ('inactive_agent_count','27');

-- ============================================================
-- SCRIPT PERFORMANCE TRACKING
-- ============================================================
CREATE TABLE IF NOT EXISTS script_performance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  script_name   TEXT NOT NULL, -- IUL | Whole_Life | Mortgage_Protection | Ultimate_No_Choice
  version       TEXT NOT NULL,
  call_date     TEXT,
  outcome       TEXT, -- closed | objection | no_show | callback
  objection_type TEXT,
  close_time_min INTEGER,
  premium_amount REAL,
  agent_id      TEXT,
  notes         TEXT,
  ts            TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS script_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  script_name TEXT NOT NULL,
  version     TEXT NOT NULL,
  content     TEXT,
  change_reason TEXT,
  close_rate  REAL DEFAULT 0.0,
  active      INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO script_versions(script_name, version, content, active) VALUES
  ('IUL', 'v1', 'Initial IUL script baseline', 1),
  ('Whole_Life', 'v1', 'Initial Whole Life script baseline', 1),
  ('Mortgage_Protection', 'v1', 'Initial Mortgage Protection script baseline', 1),
  ('Ultimate_No_Choice', 'v1', 'Initial Ultimate No-Choice script baseline', 1);

-- ============================================================
-- EVAL CYCLE LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS eval_cycles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_ts    TEXT DEFAULT (datetime('now')),
  cycle_type  TEXT, -- daily | weekly | triggered
  bots_evaluated INTEGER DEFAULT 0,
  improvements_found INTEGER DEFAULT 0,
  bots_rewritten INTEGER DEFAULT 0,
  bots_killed  INTEGER DEFAULT 0,
  summary     TEXT
);
