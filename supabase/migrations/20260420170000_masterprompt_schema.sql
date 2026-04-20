-- ============================================================
-- Master Prompt Schema — tables required by Phases 14, 18, 22, 23, 25
-- Idempotent: safe to re-apply.
-- ============================================================

-- ─── Phase 14: Lead purchase requests (Stripe-driven) ──────────────────────
CREATE TABLE IF NOT EXISTS public.lead_purchase_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  package_type text CHECK (package_type IN ('standard','premium')),
  amount_paid numeric(10,2),
  stripe_payment_intent_id text UNIQUE,
  stripe_checkout_session_id text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','paid','confirmed','expired','refunded')),
  requested_at timestamptz DEFAULT now(),
  confirmed_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_lpr_agent ON public.lead_purchase_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_lpr_status ON public.lead_purchase_requests(status) WHERE status != 'confirmed';
ALTER TABLE public.lead_purchase_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage lead purchases" ON public.lead_purchase_requests;
CREATE POLICY "Admins manage lead purchases" ON public.lead_purchase_requests
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Agents see own lead purchases" ON public.lead_purchase_requests;
CREATE POLICY "Agents see own lead purchases" ON public.lead_purchase_requests
  FOR SELECT USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

-- ─── Phase 18: Production unlock + scheduled task queue ────────────────────
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS has_production_access boolean DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS production_unlocked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.scheduled_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_type text NOT NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  application_id uuid,
  scheduled_for timestamptz NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
  attempts integer DEFAULT 0,
  last_error text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_st_due ON public.scheduled_tasks(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_st_agent ON public.scheduled_tasks(agent_id);
ALTER TABLE public.scheduled_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage scheduled tasks" ON public.scheduled_tasks;
CREATE POLICY "Admins manage scheduled tasks" ON public.scheduled_tasks
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── Phase 22: Licensing delegates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.licensing_delegates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  delegate_agent_id uuid REFERENCES public.agents(id) ON DELETE CASCADE,
  can_view_prelicensing boolean DEFAULT true,
  can_call_prelicensing boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(manager_id, delegate_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_ld_delegate ON public.licensing_delegates(delegate_agent_id);
ALTER TABLE public.licensing_delegates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage delegates" ON public.licensing_delegates;
CREATE POLICY "Admins manage delegates" ON public.licensing_delegates
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Delegates see own entry" ON public.licensing_delegates;
CREATE POLICY "Delegates see own entry" ON public.licensing_delegates
  FOR SELECT USING (
    delegate_agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
    OR manager_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  );

-- ─── Phase 23: System health logs + automation runs ────────────────────────
CREATE TABLE IF NOT EXISTS public.system_health_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  checked_at timestamptz DEFAULT now(),
  overall_status text CHECK (overall_status IN ('healthy','degraded','critical')),
  critical_count integer DEFAULT 0,
  warning_count integer DEFAULT 0,
  auto_fixed text[] DEFAULT '{}',
  results jsonb
);
CREATE INDEX IF NOT EXISTS idx_shl_checked ON public.system_health_logs(checked_at DESC);
ALTER TABLE public.system_health_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read health" ON public.system_health_logs;
CREATE POLICY "Admins read health" ON public.system_health_logs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  automation_name text NOT NULL,
  ran_at timestamptz DEFAULT now(),
  status text DEFAULT 'success' CHECK (status IN ('success','error','skipped','running')),
  agents_affected integer DEFAULT 0,
  error_message text,
  duration_ms integer,
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ar_name_ran ON public.automation_runs(automation_name, ran_at DESC);
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read automation_runs" ON public.automation_runs;
CREATE POLICY "Admins read automation_runs" ON public.automation_runs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── Phase 25: Duplicate agent flagging ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duplicate_agent_flags (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_ids uuid[] NOT NULL,
  email text,
  phone text,
  flagged_at timestamptz DEFAULT now(),
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_daf_unresolved ON public.duplicate_agent_flags(flagged_at DESC) WHERE resolved = false;
ALTER TABLE public.duplicate_agent_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage duplicates" ON public.duplicate_agent_flags;
CREATE POLICY "Admins manage duplicates" ON public.duplicate_agent_flags
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ─── Phase 24: Guarantee ref_slug exists on every agent ────────────────────
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS ref_slug text;
-- Backfill (lowercase + dash, suffix with id prefix for uniqueness)
UPDATE public.agents a
SET ref_slug = LOWER(REGEXP_REPLACE(
  COALESCE(
    (SELECT full_name FROM public.profiles p WHERE p.id = a.profile_id LIMIT 1),
    a.display_name,
    'agent'
  ),
  '[^a-zA-Z0-9]+', '-', 'g'
)) || '-' || SUBSTRING(a.id::text, 1, 6)
WHERE a.ref_slug IS NULL OR a.ref_slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_ref_slug ON public.agents(ref_slug) WHERE ref_slug IS NOT NULL;

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS recruiter_id uuid;

-- ─── iCloud photo album system_setting row (Phase 13) ──────────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('icloud_photos_link', '')
ON CONFLICT (key) DO NOTHING;

-- ─── Sam override rate used by dashboard earnings (Phase 5) ────────────────
INSERT INTO public.system_settings (key, value)
VALUES ('sam_override_rate', '0.03')
ON CONFLICT (key) DO NOTHING;
