-- ============================================================
-- Schema applied directly via bot-sql endpoint on 2026-04-20.
-- This file is for git/audit record — the objects already exist
-- in the live DB. Every statement is idempotent (IF NOT EXISTS /
-- DROP IF EXISTS) so re-applying is safe.
-- ============================================================

-- ─── plaque_awards: missing created_at column that backfill-plaque-images expected ──
ALTER TABLE public.plaque_awards
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
UPDATE public.plaque_awards
  SET created_at = COALESCE(awarded_at, generated_at, now())
WHERE created_at IS NULL;

-- ─── Deal sync schema (was stuck in Lovable queue for 45+ min) ──
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS source text DEFAULT 'apex';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'submitted';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS external_deal_id text;
CREATE INDEX IF NOT EXISTS idx_deals_source         ON public.deals(source);
CREATE INDEX IF NOT EXISTS idx_deals_external       ON public.deals(external_deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON public.deals(pipeline_stage);

CREATE TABLE IF NOT EXISTS public.deal_sync_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid NOT NULL, direction text DEFAULT 'outbound',
  status text DEFAULT 'pending', attempts int DEFAULT 0, last_error text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), synced_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_dsq_pending ON public.deal_sync_queue(created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.deal_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid, event_type text, direction text,
  payload jsonb, response jsonb, error text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dsl_deal ON public.deal_sync_log(deal_id, created_at DESC);

ALTER TABLE public.deal_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_sync_log   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_manage_deal_sync_queue ON public.deal_sync_queue;
CREATE POLICY admins_manage_deal_sync_queue ON public.deal_sync_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS admins_read_deal_sync_log ON public.deal_sync_log;
CREATE POLICY admins_read_deal_sync_log ON public.deal_sync_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── InsuraCloud mapping columns ──
ALTER TABLE public.agents   ADD COLUMN IF NOT EXISTS insuracloud_user_id    int;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS insuracloud_carrier_id int;

-- ─── Broadcast trigger replaces old single-channel Discord trigger ──
DROP TRIGGER  IF EXISTS trg_deals_discord_notify ON public.deals;
DROP FUNCTION IF EXISTS public.deals_trigger_discord_notify();
DROP TRIGGER  IF EXISTS trg_deal_broadcast       ON public.deals;
DROP FUNCTION IF EXISTS public.trg_fn_deal_broadcast();

CREATE OR REPLACE FUNCTION public.trg_fn_deal_broadcast()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $body$
BEGIN
  IF NEW.source IS NULL OR NEW.source = 'apex' THEN
    INSERT INTO public.deal_sync_queue (deal_id, direction, status)
    VALUES (NEW.id, 'outbound', 'pending');
  END IF;
  PERFORM public.run_automation_job(
    'deal-broadcast', 'notify-deal-submitted',
    jsonb_build_object('deal_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END;
$body$;

CREATE TRIGGER trg_deal_broadcast
  AFTER INSERT ON public.deals
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM 'draft')
  EXECUTE FUNCTION public.trg_fn_deal_broadcast();

-- ─── Per-agent-per-carrier commission grid (replaces flat contract_percentage) ──
CREATE TABLE IF NOT EXISTS public.agent_carrier_comp (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE CASCADE,
  carrier_name text NOT NULL,
  contract_code text,
  contract_pct numeric(5,2),
  effective_pct numeric(5,2),
  override_pct numeric(5,2) DEFAULT 0,
  notes text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, carrier_name)
);
CREATE INDEX IF NOT EXISTS idx_acc_agent   ON public.agent_carrier_comp(agent_id);
CREATE INDEX IF NOT EXISTS idx_acc_carrier ON public.agent_carrier_comp(carrier_id);
ALTER TABLE public.agent_carrier_comp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_manage_acc ON public.agent_carrier_comp;
CREATE POLICY admins_manage_acc ON public.agent_carrier_comp FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS agent_reads_own_acc ON public.agent_carrier_comp;
CREATE POLICY agent_reads_own_acc ON public.agent_carrier_comp FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

-- ─── Seed the 11 canonical carriers if missing ──
INSERT INTO public.carriers (name, is_active)
SELECT v.name, true
FROM (VALUES
  ('American Amicable'), ('American Home Life'), ('Baltimore Life'),
  ('Foresters'), ('Guarantee Trust Life'), ('Mutual of Omaha'),
  ('Newbridge'), ('Prudential'), ('Royal Neighbors'),
  ('SBLI'), ('Transamerica')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.carriers c WHERE LOWER(c.name) = LOWER(v.name)
);

-- ─── Plaque backfill: 192 rows inserted for last 45 days worth of
-- single-day production ≥ $1K. Type names normalized to canonical
-- single_day_bronze / single_day / single_day_platinum. ──
-- (Data inserts already executed via bot-sql; not re-running here to
-- avoid duplicates.)
