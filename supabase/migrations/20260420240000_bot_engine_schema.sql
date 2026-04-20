-- Autonomous optimization engine — storage layer.
-- Four tables capture everything the bot engine produces and consumes.

CREATE TABLE IF NOT EXISTS public.bot_audits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_bot       TEXT NOT NULL,                     -- 'agent_activation' | 'recruiting' | 'content' | 'seminar' | 'onboarding'
  audit_name    TEXT NOT NULL,                     -- e.g. 'stale_licensed_apps' | 'stuck_in_onboarding_over_14d'
  severity      TEXT NOT NULL DEFAULT 'info'       -- 'info' | 'warn' | 'critical'
                 CHECK (severity IN ('info','warn','critical')),
  finding_count INTEGER NOT NULL DEFAULT 0,
  summary       TEXT NOT NULL,
  detail        JSONB,
  action        TEXT,                              -- suggested fix or prompt
  action_link   TEXT,                              -- deep link back to APEX
  dispatched_at TIMESTAMPTZ,                       -- when an alert was fired for this finding
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_audits_subbot_recent ON public.bot_audits(sub_bot, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_audits_severity ON public.bot_audits(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_audits_unresolved ON public.bot_audits(created_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS public.bot_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,                     -- 'trigger' | 'audit' | 'manual'
  event_type    TEXT NOT NULL,                     -- 'agent_deactivated' | 'sync_error' | 'automation_failed' | 'low_aop_day' | 'big_deal' | ...
  severity      TEXT NOT NULL DEFAULT 'warn'
                 CHECK (severity IN ('info','warn','critical','celebrate')),
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  sms_body      TEXT,
  action_link   TEXT,
  channels      TEXT[] NOT NULL DEFAULT ARRAY['email','sms']::TEXT[],
  sent_at       TIMESTAMPTZ,
  sent_sms_id   TEXT,
  sent_email_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_alerts_unsent ON public.bot_alerts(created_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bot_alerts_event_type ON public.bot_alerts(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bot_priorities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  for_date    DATE NOT NULL,
  rank        INTEGER NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  action_link TEXT,
  sub_bot     TEXT,
  metric_key  TEXT,
  metric_value NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (for_date, rank)
);

CREATE TABLE IF NOT EXISTS public.bot_metrics_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date  DATE NOT NULL,
  metric_key     TEXT NOT NULL,
  metric_value   NUMERIC NOT NULL,
  sub_bot        TEXT,
  details        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, metric_key)
);
CREATE INDEX IF NOT EXISTS idx_bot_metrics_key_date ON public.bot_metrics_snapshots(metric_key, snapshot_date DESC);

ALTER TABLE public.bot_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_metrics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Admins see audits" ON public.bot_audits FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY IF NOT EXISTS "Admins see alerts" ON public.bot_alerts FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY IF NOT EXISTS "Admins see priorities" ON public.bot_priorities FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY IF NOT EXISTS "Admins see snapshots" ON public.bot_metrics_snapshots FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
