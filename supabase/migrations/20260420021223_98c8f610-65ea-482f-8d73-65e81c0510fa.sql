-- ─── 1. RECURSIVE DOWNLINE RESOLVER ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_downline_agent_ids(p_root_agent_id uuid)
RETURNS TABLE(agent_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE downline AS (
    SELECT id FROM public.agents WHERE id = p_root_agent_id
    UNION
    SELECT a.id FROM public.agents a
    INNER JOIN downline d ON a.invited_by_manager_id = d.id
    WHERE a.is_deactivated = false
  )
  SELECT id FROM downline;
$$;

GRANT EXECUTE ON FUNCTION public.get_downline_agent_ids(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_downline_agent_ids()
RETURNS TABLE(agent_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  SELECT id INTO v_agent_id FROM public.agents WHERE user_id = auth.uid() LIMIT 1;
  IF v_agent_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.get_downline_agent_ids(v_agent_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_downline_agent_ids() TO authenticated;

-- ─── 2. COMP TIERS ──────────────────────────────────────────────
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS contract_percentage numeric DEFAULT 120,
  ADD COLUMN IF NOT EXISTS override_rate numeric DEFAULT 0;

UPDATE public.agents SET override_rate = 0
  WHERE override_rate IS NULL;

UPDATE public.agents SET override_rate = 0.50
  WHERE user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'admin');

UPDATE public.agents SET override_rate = 0.35
  WHERE override_rate = 0
    AND user_id IN (SELECT user_id FROM public.user_roles WHERE role = 'manager');

COMMENT ON COLUMN public.agents.contract_percentage IS 'Personal comp rate, e.g. 120 = 120% contract on their own production';
COMMENT ON COLUMN public.agents.override_rate IS 'Override % on downline ALP. 0.35 = 35%. Paid on 9-month advance.';

-- ─── 3. REAL REVENUE ESTIMATE VIEW ──────────────────────────────
CREATE OR REPLACE VIEW public.agent_revenue_estimate AS
WITH agent_hierarchy AS (
  SELECT
    a.id AS root_agent_id,
    a.contract_percentage,
    a.override_rate,
    dl.agent_id AS downline_agent_id
  FROM public.agents a
  CROSS JOIN LATERAL public.get_downline_agent_ids(a.id) dl
  WHERE a.is_deactivated = false
),
month_prod AS (
  SELECT
    agent_id,
    SUM(aop)::numeric AS monthly_alp
  FROM public.daily_production
  WHERE production_date >= date_trunc('month', CURRENT_DATE)
  GROUP BY agent_id
),
agent_totals AS (
  SELECT
    h.root_agent_id,
    MAX(h.contract_percentage) AS contract_pct,
    MAX(h.override_rate) AS override_rate,
    SUM(CASE WHEN h.downline_agent_id = h.root_agent_id THEN mp.monthly_alp ELSE 0 END) AS personal_monthly_alp,
    SUM(CASE WHEN h.downline_agent_id <> h.root_agent_id THEN mp.monthly_alp ELSE 0 END) AS downline_monthly_alp
  FROM agent_hierarchy h
  LEFT JOIN month_prod mp ON mp.agent_id = h.downline_agent_id
  GROUP BY h.root_agent_id
),
insuracloud_current AS (
  SELECT DISTINCT ON (agent_id)
    agent_id,
    mtd_earnings,
    direct_commissions,
    override_commissions,
    snapshot_time
  FROM public.insuracloud_snapshots
  WHERE snapshot_date >= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY agent_id, snapshot_date DESC
)
SELECT
  t.root_agent_id AS agent_id,
  t.contract_pct,
  t.override_rate,
  COALESCE(t.personal_monthly_alp, 0)   AS personal_monthly_alp,
  COALESCE(t.downline_monthly_alp, 0)   AS downline_monthly_alp,
  ROUND((COALESCE(t.personal_monthly_alp, 0) * (t.contract_pct / 100.0) * 0.75 * 0.75)::numeric, 2) AS personal_monthly_estimate,
  ROUND((COALESCE(t.downline_monthly_alp, 0) * COALESCE(t.override_rate, 0)    * 0.75 * 0.75)::numeric, 2) AS override_monthly_estimate,
  ic.mtd_earnings AS insuracloud_mtd,
  ic.direct_commissions AS insuracloud_direct,
  ic.override_commissions AS insuracloud_override,
  ic.snapshot_time AS insuracloud_last_sync
FROM agent_totals t
LEFT JOIN insuracloud_current ic ON ic.agent_id = t.root_agent_id;

GRANT SELECT ON public.agent_revenue_estimate TO authenticated;

COMMENT ON VIEW public.agent_revenue_estimate IS
'Per-agent revenue estimate blending real Insuracloud data with projection from daily_production. Projection uses 9-month advance × 75% persistency.';

-- ─── 4. INSURACLOUD USER ID ─────────────────────────────────────
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS insuracloud_user_id integer;

CREATE INDEX IF NOT EXISTS idx_agents_insuracloud_user_id ON public.agents(insuracloud_user_id) WHERE insuracloud_user_id IS NOT NULL;

COMMENT ON COLUMN public.agents.insuracloud_user_id IS 'InsuraCloud agent user id. Required for pushing deals upstream.';

-- ─── 5. CARRIERS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  insuracloud_carrier_id integer UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.carriers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carriers_read_all_auth" ON public.carriers;
CREATE POLICY "carriers_read_all_auth" ON public.carriers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "carriers_admin_manage" ON public.carriers;
CREATE POLICY "carriers_admin_manage" ON public.carriers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.carriers (name) VALUES
  ('Americo'),
  ('Royal Neighbors'),
  ('American Amicable'),
  ('Newbridge'),
  ('Mutual of Omaha'),
  ('Transamerica'),
  ('Guarantee Trust Life'),
  ('SBLI'),
  ('Foresters'),
  ('Baltimore Life')
ON CONFLICT (name) DO NOTHING;

-- ─── 6. DEALS TABLE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES public.carriers(id),
  client_first_name text NOT NULL,
  client_last_name text NOT NULL,
  client_phone text NOT NULL,
  client_dob date NOT NULL,
  product_sold text NOT NULL,
  policy_number text NOT NULL,
  monthly_premium numeric(10,2) NOT NULL CHECK (monthly_premium >= 0),
  annual_premium numeric(10,2) NOT NULL CHECK (annual_premium >= 0),
  face_amount numeric(12,2) NOT NULL CHECK (face_amount >= 0),
  effective_date date NOT NULL,
  policy_expiration_date date,
  policy_term_months integer,
  notes text,
  status text DEFAULT 'submitted' CHECK (status IN ('draft','submitted','active','lapsed','charged_back','cancelled')),
  synced_to_insuracloud_at timestamptz,
  insuracloud_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (annual_premium = ROUND(monthly_premium * 12, 2))
);

CREATE INDEX IF NOT EXISTS idx_deals_agent ON public.deals(agent_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_deals_policy_number ON public.deals(policy_number);
CREATE INDEX IF NOT EXISTS idx_deals_unsynced ON public.deals(created_at) WHERE synced_to_insuracloud_at IS NULL;

CREATE OR REPLACE FUNCTION public.deals_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_deals_updated_at ON public.deals;
CREATE TRIGGER trg_deals_updated_at
  BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_touch_updated_at();

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_own_read" ON public.deals;
CREATE POLICY "deals_own_read" ON public.deals FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "deals_own_insert" ON public.deals;
CREATE POLICY "deals_own_insert" ON public.deals FOR INSERT TO authenticated
  WITH CHECK (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "deals_own_update" ON public.deals;
CREATE POLICY "deals_own_update" ON public.deals FOR UPDATE TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()) AND status IN ('draft','submitted'))
  WITH CHECK (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "deals_manager_read_downline" ON public.deals;
CREATE POLICY "deals_manager_read_downline" ON public.deals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND agent_id IN (SELECT agent_id FROM public.my_downline_agent_ids())
  );

DROP POLICY IF EXISTS "deals_admin_all" ON public.deals;
CREATE POLICY "deals_admin_all" ON public.deals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ─── 7. DEPRECATE 3% HARDCODE ───────────────────────────────────
DELETE FROM public.system_settings WHERE key = 'sam_override_rate';

INSERT INTO public.system_settings (key, value) VALUES ('override_rate_deprecated', 'true')
ON CONFLICT (key) DO NOTHING;

-- ─── 8. ROLL DEALS INTO daily_production ────────────────────────
CREATE OR REPLACE FUNCTION public.deals_rollup_to_daily_production()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.daily_production (agent_id, production_date, aop, deals_closed, presentations, hours_called, closing_rate)
    VALUES (NEW.agent_id, NEW.effective_date, NEW.annual_premium, 1, 0, 0, 0)
    ON CONFLICT (agent_id, production_date) DO UPDATE
      SET aop = daily_production.aop + EXCLUDED.aop,
          deals_closed = daily_production.deals_closed + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_rollup ON public.deals;
CREATE TRIGGER trg_deals_rollup
  AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_rollup_to_daily_production();