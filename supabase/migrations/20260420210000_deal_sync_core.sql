-- ============================================================
-- Deal sync core — minimal retry of 20260420190000
-- Previous migration did not apply; this trims it to the essentials
-- and avoids anything that could trip Lovable's migration runner.
-- Everything is idempotent (IF NOT EXISTS / DROP ... IF EXISTS).
-- ============================================================

-- Source + pipeline_stage + external id on deals
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS source text DEFAULT 'apex';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'submitted';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS external_deal_id text;

CREATE INDEX IF NOT EXISTS idx_deals_source          ON public.deals(source);
CREATE INDEX IF NOT EXISTS idx_deals_external        ON public.deals(external_deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage  ON public.deals(pipeline_stage);

-- Deal sync queue
CREATE TABLE IF NOT EXISTS public.deal_sync_queue (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id     uuid NOT NULL,
  direction   text DEFAULT 'outbound',
  status      text DEFAULT 'pending',
  attempts    int DEFAULT 0,
  last_error  text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  synced_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dsq_pending ON public.deal_sync_queue(created_at) WHERE status = 'pending';
ALTER TABLE public.deal_sync_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_manage_deal_sync_queue" ON public.deal_sync_queue;
CREATE POLICY "admins_manage_deal_sync_queue"
  ON public.deal_sync_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Deal sync log (audit)
CREATE TABLE IF NOT EXISTS public.deal_sync_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id      uuid,
  event_type   text,
  direction    text,
  payload      jsonb,
  response     jsonb,
  error        text,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dsl_deal ON public.deal_sync_log(deal_id, created_at DESC);
ALTER TABLE public.deal_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_read_deal_sync_log" ON public.deal_sync_log;
CREATE POLICY "admins_read_deal_sync_log"
  ON public.deal_sync_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ID mapping columns (idempotent — may already exist from earlier migration)
ALTER TABLE public.agents   ADD COLUMN IF NOT EXISTS insuracloud_user_id    int;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS insuracloud_carrier_id int;

-- Broadcast trigger: fires notify-deal-submitted on every non-draft deal insert.
-- Also queues outbound sync for APEX-origin deals.
-- Replaces the old single-channel Discord trigger to avoid duplicates.
DROP TRIGGER  IF EXISTS trg_deals_discord_notify ON public.deals;
DROP FUNCTION IF EXISTS public.deals_trigger_discord_notify();
DROP TRIGGER  IF EXISTS trg_deal_broadcast       ON public.deals;
DROP FUNCTION IF EXISTS public.trg_fn_deal_broadcast();

CREATE OR REPLACE FUNCTION public.trg_fn_deal_broadcast()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.source IS NULL OR NEW.source = 'apex' THEN
    INSERT INTO public.deal_sync_queue (deal_id, direction, status)
    VALUES (NEW.id, 'outbound', 'pending');
  END IF;

  PERFORM public.run_automation_job(
    'deal-broadcast',
    'notify-deal-submitted',
    jsonb_build_object('deal_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_deal_broadcast
  AFTER INSERT ON public.deals
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM 'draft')
  EXECUTE FUNCTION public.trg_fn_deal_broadcast();
