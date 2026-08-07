-- Mirror of a migration applied to xrzweoneiieddzxogewk before repo-based
-- deploys were reliable (recovered verbatim from schema_migrations 2026-08-07).
-- Already applied live; every statement is idempotent. Present so db push stops
-- erroring "Remote migration versions not found in local migrations directory".


-- Paid-click attribution. Without gclid there is no Google Ads offline conversion
-- import, so ad spend can never be tied to a licensed/producing agent.
-- Additive only: new nullable columns, no data touched.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS gclid            text,
  ADD COLUMN IF NOT EXISTS gbraid           text,
  ADD COLUMN IF NOT EXISTS wbraid           text,
  ADD COLUMN IF NOT EXISTS fbclid           text,
  ADD COLUMN IF NOT EXISTS ttclid           text,
  ADD COLUMN IF NOT EXISTS msclkid          text,
  ADD COLUMN IF NOT EXISTS first_touch_at   timestamptz,
  ADD COLUMN IF NOT EXISTS first_landing_url text,
  ADD COLUMN IF NOT EXISTS first_referrer   text,
  ADD COLUMN IF NOT EXISTS attribution_json jsonb;

COMMENT ON COLUMN public.applications.gclid IS 'Google Ads click id, first-touch persisted. Required for offline conversion import.';
COMMENT ON COLUMN public.applications.attribution_json IS 'Full first-touch + last-touch attribution payload captured client-side.';

CREATE INDEX IF NOT EXISTS idx_applications_gclid ON public.applications (gclid) WHERE gclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_utm_source ON public.applications (utm_source) WHERE utm_source IS NOT NULL;

