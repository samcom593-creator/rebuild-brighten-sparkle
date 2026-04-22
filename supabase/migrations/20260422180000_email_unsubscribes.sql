-- Email unsubscribes table + RLS + index.
-- One row per opt-out email; checked by _shared/email.ts#isUnsubscribed()
-- before every bulk send. Deliverability-critical: Gmail/Yahoo both
-- penalize senders who don't honor one-click unsubscribe.

CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  reason        TEXT,                 -- 'one_click' | 'manual' | 'complaint' | 'bounce'
  source        TEXT,                 -- e.g. 'list-unsubscribe-header', 'preferences-page'
  user_id       UUID,                 -- if we can resolve it
  unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_email ON public.email_unsubscribes(email);

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role writes unsubscribes" ON public.email_unsubscribes;
CREATE POLICY "Service role writes unsubscribes"
  ON public.email_unsubscribes
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins see unsubscribes" ON public.email_unsubscribes;
CREATE POLICY "Admins see unsubscribes"
  ON public.email_unsubscribes
  FOR SELECT TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Public writable for one-click via edge function: the edge function uses
-- service_role so this policy is defensive only.
