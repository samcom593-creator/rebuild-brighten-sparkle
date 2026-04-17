-- Phase 0: Foundation tables for audit, observability, rate limiting, idempotency, analytics

-- 1. AUDIT LOG
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_data JSONB,
  after_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON public.audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit log"
ON public.audit_log FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert audit log"
ON public.audit_log FOR INSERT
WITH CHECK (true);

-- 2. FUNCTION ERRORS
CREATE TABLE IF NOT EXISTS public.function_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  request_payload JSONB,
  user_id UUID,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_function_errors_fn ON public.function_errors(function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_errors_created ON public.function_errors(created_at DESC);

ALTER TABLE public.function_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view function errors"
ON public.function_errors FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert function errors"
ON public.function_errors FOR INSERT
WITH CHECK (true);

-- 3. ANALYTICS EVENTS (web vitals + product analytics)
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  event_category TEXT,
  user_id UUID,
  session_id TEXT,
  properties JSONB,
  url TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON public.analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON public.analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON public.analytics_events(created_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view analytics"
ON public.analytics_events FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can insert analytics events"
ON public.analytics_events FOR INSERT
WITH CHECK (true);

-- 4. RATE LIMITS (in-DB rate limiting since Upstash not available)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_bucket_window ON public.rate_limits(bucket_key, window_start);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits(window_start);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view rate limits"
ON public.rate_limits FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can manage rate limits"
ON public.rate_limits FOR ALL
USING (true) WITH CHECK (true);

-- 5. IDEMPOTENCY KEYS (prevent duplicate request side effects)
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  function_name TEXT NOT NULL,
  user_id UUID,
  response_payload JSONB,
  status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_idem_expires ON public.idempotency_keys(expires_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view idempotency keys"
ON public.idempotency_keys FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can manage idempotency keys"
ON public.idempotency_keys FOR ALL
USING (true) WITH CHECK (true);

-- 6. Rate limit RPC (atomic increment)
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _bucket_key TEXT,
  _max_requests INTEGER,
  _window_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _window_start TIMESTAMPTZ;
  _current_count INTEGER;
BEGIN
  _window_start := date_trunc('second', now()) - ((extract(epoch from now())::bigint % _window_seconds) || ' seconds')::interval;

  INSERT INTO public.rate_limits (bucket_key, window_start, request_count)
  VALUES (_bucket_key, _window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO _current_count;

  -- Cleanup old windows (best effort)
  DELETE FROM public.rate_limits WHERE window_start < (now() - interval '1 hour');

  RETURN _current_count <= _max_requests;
END;
$$;

-- 7. Cleanup expired idempotency keys
CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.idempotency_keys WHERE expires_at < now();
$$;