-- Phase 5: Table partitioning (retry with explicit column lists)

-- ============= AUDIT_LOG =============
ALTER TABLE public.audit_log RENAME TO audit_log_legacy;

CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  actor_role TEXT,
  actor_user_id UUID,
  after_data JSONB,
  before_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id TEXT,
  entity_type TEXT,
  ip_address TEXT,
  request_id TEXT,
  user_agent TEXT,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
  m_start DATE; m_end DATE; part_name TEXT; i INT;
BEGIN
  FOR i IN -2..3 LOOP
    m_start := date_trunc('month', now() + make_interval(months => i))::date;
    m_end := (m_start + interval '1 month')::date;
    part_name := 'audit_log_' || to_char(m_start, 'YYYY_MM');
    EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.audit_log FOR VALUES FROM (%L) TO (%L)',
      part_name, m_start, m_end);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.audit_log_default PARTITION OF public.audit_log DEFAULT;

INSERT INTO public.audit_log (
  id, action, actor_role, actor_user_id, after_data, before_data,
  created_at, entity_id, entity_type, ip_address, request_id, user_agent
)
SELECT
  id, action, actor_role,
  actor_user_id::uuid,
  after_data, before_data, created_at,
  entity_id::text, entity_type, ip_address::text, request_id, user_agent
FROM public.audit_log_legacy;

DROP TABLE public.audit_log_legacy;

CREATE INDEX idx_audit_log_created_at ON public.audit_log (created_at DESC);
CREATE INDEX idx_audit_log_entity ON public.audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_actor ON public.audit_log (actor_user_id);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all audit logs" ON public.audit_log
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "System can insert audit logs" ON public.audit_log
  FOR INSERT WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;

-- ============= ANALYTICS_EVENTS =============
ALTER TABLE public.analytics_events RENAME TO analytics_events_legacy;

CREATE TABLE public.analytics_events (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_category TEXT,
  event_name TEXT NOT NULL,
  properties JSONB,
  session_id TEXT,
  url TEXT,
  user_agent TEXT,
  user_id UUID,
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

DO $$
DECLARE
  m_start DATE; m_end DATE; part_name TEXT; i INT;
BEGIN
  FOR i IN -2..3 LOOP
    m_start := date_trunc('month', now() + make_interval(months => i))::date;
    m_end := (m_start + interval '1 month')::date;
    part_name := 'analytics_events_' || to_char(m_start, 'YYYY_MM');
    EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.analytics_events FOR VALUES FROM (%L) TO (%L)',
      part_name, m_start, m_end);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.analytics_events_default PARTITION OF public.analytics_events DEFAULT;

INSERT INTO public.analytics_events (
  id, created_at, event_category, event_name, properties, session_id, url, user_agent, user_id
)
SELECT
  id, created_at, event_category, event_name, properties, session_id, url, user_agent, user_id::uuid
FROM public.analytics_events_legacy;

DROP TABLE public.analytics_events_legacy;

CREATE INDEX idx_analytics_events_created_at ON public.analytics_events (created_at DESC);
CREATE INDEX idx_analytics_events_event_name ON public.analytics_events (event_name);
CREATE INDEX idx_analytics_events_user_id ON public.analytics_events (user_id);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all analytics" ON public.analytics_events
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Anyone can insert analytics events" ON public.analytics_events
  FOR INSERT WITH CHECK (true);

-- ============= AUTO-PARTITION HELPER =============
CREATE OR REPLACE FUNCTION public.ensure_next_month_partitions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m_start DATE; m_end DATE;
  parents TEXT[] := ARRAY['audit_log', 'analytics_events'];
  parent TEXT; part_name TEXT;
BEGIN
  m_start := date_trunc('month', now() + interval '2 months')::date;
  m_end := (m_start + interval '1 month')::date;
  FOREACH parent IN ARRAY parents LOOP
    part_name := parent || '_' || to_char(m_start, 'YYYY_MM');
    EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
      part_name, parent, m_start, m_end);
  END LOOP;
END;
$$;