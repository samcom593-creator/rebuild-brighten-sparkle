-- ═══════════════════════════════════════════════════════════════
-- STEP 14: HIRING MANAGER ROUTING + GETTING STARTED + INACTIVE RECOVERY
-- ═══════════════════════════════════════════════════════════════

-- 1. HIRING SCOPE ENUM
DO $$ BEGIN
  CREATE TYPE public.hiring_scope AS ENUM (
    'unlicensed',
    'licensed',
    'transfer',
    'post_started',
    'all'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. HIRING MANAGER ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.hiring_manager_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manager_display_name text NOT NULL,
  scope public.hiring_scope NOT NULL,
  priority integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(manager_user_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_hiring_manager_scope
  ON public.hiring_manager_assignments(scope, priority) WHERE is_active = true;

ALTER TABLE public.hiring_manager_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_manage_hiring_assignments" ON public.hiring_manager_assignments;
CREATE POLICY "admins_manage_hiring_assignments" ON public.hiring_manager_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "everyone_view_hiring_assignments" ON public.hiring_manager_assignments;
CREATE POLICY "everyone_view_hiring_assignments" ON public.hiring_manager_assignments
  FOR SELECT TO authenticated USING (true);

-- 3. ADD COLUMNS TO applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS hiring_manager_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hiring_scope_at_intake public.hiring_scope,
  ADD COLUMN IF NOT EXISTS is_transfer boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_applications_hiring_manager
  ON public.applications(hiring_manager_user_id) WHERE hiring_manager_user_id IS NOT NULL;

-- 4. AUTO-ROUTE FUNCTIONS
CREATE OR REPLACE FUNCTION public.resolve_hiring_manager_for_scope(p_scope public.hiring_scope)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT manager_user_id INTO v_user_id
  FROM public.hiring_manager_assignments
  WHERE scope = p_scope AND is_active = true
  ORDER BY priority ASC
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN RETURN v_user_id; END IF;

  SELECT manager_user_id INTO v_user_id
  FROM public.hiring_manager_assignments
  WHERE scope = 'all' AND is_active = true
  ORDER BY priority ASC
  LIMIT 1;

  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.applications_auto_route_hiring_manager()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scope public.hiring_scope;
BEGIN
  IF NEW.hiring_manager_user_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.license_status = 'licensed' OR NEW.license_progress::text = 'licensed' THEN
    v_scope := 'licensed';
  ELSIF NEW.is_transfer = true THEN
    v_scope := 'transfer';
  ELSE
    v_scope := 'unlicensed';
  END IF;

  NEW.hiring_scope_at_intake := v_scope;
  NEW.hiring_manager_user_id := public.resolve_hiring_manager_for_scope(v_scope);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_auto_route ON public.applications;
CREATE TRIGGER trg_applications_auto_route
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_auto_route_hiring_manager();

-- 5. GETTING STARTED PROGRESS
CREATE TABLE IF NOT EXISTS public.getting_started_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  watched_welcome_video timestamptz,
  completed_profile timestamptz,
  joined_discord timestamptz,
  joined_whatsapp timestamptz,
  added_phone_number timestamptz,
  uploaded_id timestamptz,
  signed_ica timestamptz,
  scheduled_license_test timestamptz,
  submitted_fingerprints timestamptz,
  passed_license_test timestamptz,
  received_license timestamptz,
  contracted_with_carriers timestamptz,
  completed_first_training timestamptz,
  made_first_prospect_call timestamptz,
  ran_first_appointment timestamptz,
  closed_first_deal timestamptz,
  current_stage text NOT NULL DEFAULT 'signed_up',
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  stalled_alert_sent_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id)
);

CREATE INDEX IF NOT EXISTS idx_getting_started_stage
  ON public.getting_started_progress(current_stage, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_getting_started_agent
  ON public.getting_started_progress(agent_id);

ALTER TABLE public.getting_started_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_managers_view_all_getting_started" ON public.getting_started_progress;
CREATE POLICY "admins_managers_view_all_getting_started" ON public.getting_started_progress
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role));

DROP POLICY IF EXISTS "agents_view_own_getting_started" ON public.getting_started_progress;
CREATE POLICY "agents_view_own_getting_started" ON public.getting_started_progress
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "agents_update_own_getting_started" ON public.getting_started_progress;
CREATE POLICY "agents_update_own_getting_started" ON public.getting_started_progress
  FOR UPDATE TO authenticated
  USING (agent_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid()));

-- 6. INACTIVE AGENT QUEUE
CREATE TABLE IF NOT EXISTS public.inactive_agent_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  days_inactive integer NOT NULL DEFAULT 0,
  last_production_date date,
  last_login_at timestamptz,
  last_contact_attempt_at timestamptz,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  assigned_recovery_manager uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recovery_attempts integer DEFAULT 0,
  last_recovery_attempt_at timestamptz,
  recovery_notes text,
  status text NOT NULL DEFAULT 'open',
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, status)
);

CREATE INDEX IF NOT EXISTS idx_inactive_queue_status
  ON public.inactive_agent_queue(status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_inactive_queue_manager
  ON public.inactive_agent_queue(assigned_recovery_manager) WHERE status = 'open';

ALTER TABLE public.inactive_agent_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_managers_all_inactive_queue" ON public.inactive_agent_queue;
CREATE POLICY "admins_managers_all_inactive_queue" ON public.inactive_agent_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'manager'::app_role));

-- 7. BACKFILL existing agents (skip on fresh project where agents.onboarding_stage doesn't exist)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agents' AND column_name = 'onboarding_stage'
  ) THEN
    INSERT INTO public.getting_started_progress (agent_id, current_stage)
    SELECT id,
      CASE
        WHEN onboarding_stage::text = 'active' THEN 'producing'
        WHEN onboarding_stage::text = 'inactive' THEN 'inactive'
        WHEN onboarding_stage::text IN ('pre_licensed', 'applied') THEN 'onboarding'
        WHEN onboarding_stage::text = 'in_field_training' THEN 'field_training'
        ELSE 'signed_up'
      END
    FROM public.agents
    WHERE COALESCE(is_deactivated, false) = false
      AND NOT EXISTS (SELECT 1 FROM public.getting_started_progress gsp WHERE gsp.agent_id = agents.id)
    ON CONFLICT (agent_id) DO NOTHING;
  END IF;
END $$;

-- 8. AUTO-CREATE on new agent
CREATE OR REPLACE FUNCTION public.auto_create_getting_started()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.getting_started_progress (agent_id, current_stage)
  VALUES (NEW.id, 'signed_up')
  ON CONFLICT (agent_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_create_getting_started ON public.agents;
CREATE TRIGGER trg_agents_create_getting_started
  AFTER INSERT ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_getting_started();

-- 9. TOUCH trigger
CREATE OR REPLACE FUNCTION public.touch_getting_started()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.last_activity_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gs_touch ON public.getting_started_progress;
CREATE TRIGGER trg_gs_touch
  BEFORE UPDATE ON public.getting_started_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_getting_started();