-- ============================================================
-- Bidirectional deal sync: source tracking, queue, log, mapping
-- ============================================================

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS source varchar(50) DEFAULT 'apex',
  ADD COLUMN IF NOT EXISTS pipeline_stage varchar(50) DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS external_deal_id varchar(255);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_source_check') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_source_check CHECK (source IN ('apex','agent_link'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_pipeline_stage_check') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_pipeline_stage_check
      CHECK (pipeline_stage IN ('submitted','approved','paid','lapsed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deals_source ON public.deals(source);
CREATE INDEX IF NOT EXISTS idx_deals_external ON public.deals(external_deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON public.deals(pipeline_stage);

-- ─── Deal sync queue ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_sync_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  direction varchar(20) DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  status varchar(50) DEFAULT 'pending' CHECK (status IN ('pending','synced','failed','skipped')),
  attempts int DEFAULT 0,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  synced_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dsq_pending ON public.deal_sync_queue(created_at) WHERE status = 'pending';
ALTER TABLE public.deal_sync_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view queue" ON public.deal_sync_queue;
CREATE POLICY "Admins view queue" ON public.deal_sync_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── Deal sync log (audit trail) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid,
  event_type varchar(50),
  direction varchar(20),
  payload jsonb,
  response jsonb,
  error text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dsl_deal ON public.deal_sync_log(deal_id, created_at DESC);
ALTER TABLE public.deal_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins view log" ON public.deal_sync_log;
CREATE POLICY "Admins view log" ON public.deal_sync_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── ID mapping columns ───────────────────────────────────
ALTER TABLE public.agents   ADD COLUMN IF NOT EXISTS insuracloud_user_id    int;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS insuracloud_carrier_id int;

-- ─── Broadcast trigger: fire notify-deal-submitted on every new deal ─────
CREATE OR REPLACE FUNCTION public.trg_fn_deal_broadcast()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  -- Queue outbound sync ONLY for APEX-originated deals
  IF NEW.source = 'apex' OR NEW.source IS NULL THEN
    INSERT INTO public.deal_sync_queue (deal_id, direction, status)
    VALUES (NEW.id, 'outbound', 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Fire broadcast notification (Discord + email-all + SMS-all + plaque)
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

DROP TRIGGER IF EXISTS trg_deal_broadcast ON public.deals;
CREATE TRIGGER trg_deal_broadcast
  AFTER INSERT ON public.deals
  FOR EACH ROW
  WHEN (NEW.status <> 'draft')
  EXECUTE FUNCTION public.trg_fn_deal_broadcast();

-- ─── Cron: push/pull every N minutes ──────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;

  PERFORM cron.unschedule('apex-push-deals')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-push-deals');
  PERFORM cron.schedule(
    'apex-push-deals', '*/2 * * * *',
    $c$SELECT public.run_automation_job('apex-push-deals','insuracloud-outbox','{"sweep":true}'::jsonb)$c$
  );

  PERFORM cron.unschedule('apex-pull-deals')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-pull-deals');
  PERFORM cron.schedule(
    'apex-pull-deals', '*/5 * * * *',
    $c$SELECT public.run_automation_job('apex-pull-deals','insuracloud-sync','{"full":false}'::jsonb)$c$
  );
END $$;
