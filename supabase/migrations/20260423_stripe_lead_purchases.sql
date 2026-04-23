-- ════════════════════════════════════════════════════════════════════════
-- Stripe lead-purchases — tracks every charge + ties to agent_id
-- Wired to the stripe-sync edge function. Populates on demand + via cron.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lead_purchases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_charge_id  text UNIQUE NOT NULL,
  amount_cents      int NOT NULL,
  currency          text NOT NULL DEFAULT 'usd',
  customer_id       text,
  customer_email    text,
  customer_name     text,
  description       text,
  agent_id_ref      text,                  -- metadata.agent_id from Stripe (if present)
  agent_id          uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  charged_at        timestamptz NOT NULL,
  metadata          jsonb DEFAULT '{}'::jsonb,
  synced_at         timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lp_charged   ON public.lead_purchases(charged_at DESC);
CREATE INDEX IF NOT EXISTS idx_lp_email     ON public.lead_purchases(customer_email);
CREATE INDEX IF NOT EXISTS idx_lp_agent     ON public.lead_purchases(agent_id);

ALTER TABLE public.lead_purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lp_own   ON public.lead_purchases;
DROP POLICY IF EXISTS lp_admin ON public.lead_purchases;
DROP POLICY IF EXISTS lp_svc   ON public.lead_purchases;
CREATE POLICY lp_own   ON public.lead_purchases FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE profile_id = auth.uid()));
CREATE POLICY lp_admin ON public.lead_purchases FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY lp_svc   ON public.lead_purchases FOR ALL    TO service_role USING (true);

-- Auto-match lead_purchases to agents when the Stripe metadata.agent_id is a UUID
-- or the customer_email matches a profile.email
CREATE OR REPLACE FUNCTION public.trg_fn_match_lead_purchase()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.agent_id IS NOT NULL THEN RETURN NEW; END IF;
  -- 1. Try metadata UUID
  BEGIN
    NEW.agent_id := (NEW.agent_id_ref)::uuid;
    IF EXISTS (SELECT 1 FROM public.agents WHERE id = NEW.agent_id) THEN RETURN NEW; END IF;
    NEW.agent_id := NULL;
  EXCEPTION WHEN others THEN NEW.agent_id := NULL;
  END;
  -- 2. Try email → profiles → agents
  IF NEW.customer_email IS NOT NULL THEN
    SELECT a.id INTO NEW.agent_id FROM public.agents a
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE LOWER(p.email) = LOWER(NEW.customer_email) LIMIT 1;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_match_lead_purchase ON public.lead_purchases;
CREATE TRIGGER trg_match_lead_purchase BEFORE INSERT OR UPDATE ON public.lead_purchases
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_match_lead_purchase();

-- Cron: sync Stripe charges hourly
CREATE OR REPLACE FUNCTION public.trigger_stripe_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_req bigint;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  v_req := net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/stripe-sync',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
  RETURN jsonb_build_object('fired', true, 'req', v_req);
END $fn$;
GRANT EXECUTE ON FUNCTION public.trigger_stripe_sync() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='stripe-sync-hourly') THEN
    PERFORM cron.unschedule('stripe-sync-hourly'); END IF;
  PERFORM cron.schedule('stripe-sync-hourly', '23 * * * *',
    $j$ SELECT public.trigger_stripe_sync(); $j$);
END $outer$;

-- Register stripe-sync in config.toml via a stanza append (migration tag only — actual file appended separately)
