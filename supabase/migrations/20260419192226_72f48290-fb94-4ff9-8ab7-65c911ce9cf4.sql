-- InsuraCloud Integration: Real-time financial data from agentlink.insuracloud.ai
-- Stores snapshots + detailed records pulled from Insuracloud API

-- ════════════════════════════════════════════════════════════
-- Snapshot table: latest totals from /business-analytics
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insuracloud_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  snapshot_time timestamptz NOT NULL DEFAULT now(),
  today_earnings numeric(12,2) DEFAULT 0,
  forecast_90_day numeric(12,2) DEFAULT 0,
  mtd_earnings numeric(12,2) DEFAULT 0,
  ytd_earnings numeric(12,2) DEFAULT 0,
  direct_commissions numeric(12,2) DEFAULT 0,
  override_commissions numeric(12,2) DEFAULT 0,
  source text DEFAULT 'insuracloud_api',
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_insuracloud_snapshots_agent ON public.insuracloud_snapshots(agent_id, snapshot_date DESC);

-- ════════════════════════════════════════════════════════════
-- Policy-level detail: from /book-of-business
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insuracloud_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  policy_number text,
  carrier text,
  product text,
  policy_type text,
  premium numeric(12,2) DEFAULT 0,
  commission numeric(12,2) DEFAULT 0,
  commission_type text,
  policy_status text,
  effective_date date,
  issued_date date,
  downline_agent_name text,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, policy_number)
);

CREATE INDEX IF NOT EXISTS idx_insuracloud_policies_agent ON public.insuracloud_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_insuracloud_policies_carrier ON public.insuracloud_policies(agent_id, carrier);
CREATE INDEX IF NOT EXISTS idx_insuracloud_policies_type ON public.insuracloud_policies(agent_id, policy_type);

-- ════════════════════════════════════════════════════════════
-- Payout schedule: daily expected payments
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insuracloud_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  payout_date date NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  policy_count integer DEFAULT 0,
  is_today boolean DEFAULT false,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, payout_date)
);

CREATE INDEX IF NOT EXISTS idx_insuracloud_payouts_agent_date ON public.insuracloud_payouts(agent_id, payout_date);

-- ════════════════════════════════════════════════════════════
-- Downline performers: from /team-analytics
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insuracloud_downline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  downline_name text NOT NULL,
  downline_external_id text,
  total_commission numeric(12,2) DEFAULT 0,
  policy_count integer DEFAULT 0,
  rank integer,
  period_start date,
  period_end date,
  raw_payload jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, downline_name, period_start)
);

CREATE INDEX IF NOT EXISTS idx_insuracloud_downline_agent ON public.insuracloud_downline(agent_id, synced_at DESC);

-- ════════════════════════════════════════════════════════════
-- Sync log: audit trail
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insuracloud_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  sync_started_at timestamptz NOT NULL DEFAULT now(),
  sync_completed_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  error_message text,
  endpoints_hit jsonb,
  records_synced jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insuracloud_sync_log_agent ON public.insuracloud_sync_log(agent_id, sync_started_at DESC);

-- Optional per-agent token column
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS insuracloud_api_token text;

-- ════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════
ALTER TABLE public.insuracloud_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insuracloud_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insuracloud_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insuracloud_downline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insuracloud_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_all_insuracloud_snapshots" ON public.insuracloud_snapshots
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','manager'))
  );

CREATE POLICY "own_agent_insuracloud_snapshots" ON public.insuracloud_snapshots
  FOR SELECT TO authenticated USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

CREATE POLICY "admins_all_insuracloud_policies" ON public.insuracloud_policies
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','manager'))
  );

CREATE POLICY "own_agent_insuracloud_policies" ON public.insuracloud_policies
  FOR SELECT TO authenticated USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

CREATE POLICY "admins_all_insuracloud_payouts" ON public.insuracloud_payouts
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','manager'))
  );

CREATE POLICY "own_agent_insuracloud_payouts" ON public.insuracloud_payouts
  FOR SELECT TO authenticated USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

CREATE POLICY "admins_all_insuracloud_downline" ON public.insuracloud_downline
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','manager'))
  );

CREATE POLICY "own_agent_insuracloud_downline" ON public.insuracloud_downline
  FOR SELECT TO authenticated USING (
    agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

CREATE POLICY "admins_all_insuracloud_sync_log" ON public.insuracloud_sync_log
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin','manager'))
  );