-- 2026-06-10 — Inbound client lead intake
--
-- Fast protected intake for callers who need a solution immediately. This is
-- separate from recruiting applications and separate from AgentLink-imported
-- policy/book rows. A caller can later become a deal/client, but the call note
-- itself should stay as its own operational record.

BEGIN;

CREATE TABLE IF NOT EXISTS public.inbound_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  owner_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  client_first_name text DEFAULT '',
  client_last_name text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  state text DEFAULT '',
  city text DEFAULT '',
  problem_type text NOT NULL DEFAULT 'Other',
  urgency text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('hot', 'warm', 'normal')),
  current_coverage text DEFAULT '',
  desired_solution text DEFAULT '',
  budget text DEFAULT '',
  household text DEFAULT '',
  notes text DEFAULT '',
  transcript text DEFAULT '',
  stage text NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'diagnosing', 'quoted', 'follow_up', 'won', 'lost')),
  next_action_at timestamptz,
  source text NOT NULL DEFAULT 'manual_inbound_call',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_leads_owner_stage
  ON public.inbound_leads(owner_agent_id, stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbound_leads_created_by
  ON public.inbound_leads(created_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbound_leads_next_action
  ON public.inbound_leads(next_action_at)
  WHERE next_action_at IS NOT NULL AND stage NOT IN ('won', 'lost');

CREATE OR REPLACE FUNCTION public.touch_inbound_leads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inbound_leads_updated_at ON public.inbound_leads;
CREATE TRIGGER trg_inbound_leads_updated_at
  BEFORE UPDATE ON public.inbound_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_inbound_leads_updated_at();

ALTER TABLE public.inbound_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_leads_insert_own" ON public.inbound_leads;
CREATE POLICY "inbound_leads_insert_own"
ON public.inbound_leads
FOR INSERT
TO authenticated
WITH CHECK (
  created_by_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

DROP POLICY IF EXISTS "inbound_leads_read_scope" ON public.inbound_leads;
CREATE POLICY "inbound_leads_read_scope"
ON public.inbound_leads
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR created_by_user_id = auth.uid()
  OR owner_agent_id = public.get_agent_id(auth.uid())
  OR (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND owner_agent_id IN (SELECT agent_id FROM public.my_downline_agent_ids())
  )
);

DROP POLICY IF EXISTS "inbound_leads_update_scope" ON public.inbound_leads;
CREATE POLICY "inbound_leads_update_scope"
ON public.inbound_leads
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR created_by_user_id = auth.uid()
  OR owner_agent_id = public.get_agent_id(auth.uid())
  OR (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND owner_agent_id IN (SELECT agent_id FROM public.my_downline_agent_ids())
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR created_by_user_id = auth.uid()
  OR owner_agent_id = public.get_agent_id(auth.uid())
  OR (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND owner_agent_id IN (SELECT agent_id FROM public.my_downline_agent_ids())
  )
);

DROP POLICY IF EXISTS "inbound_leads_delete_scope" ON public.inbound_leads;
CREATE POLICY "inbound_leads_delete_scope"
ON public.inbound_leads
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR created_by_user_id = auth.uid()
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.inbound_leads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

COMMIT;
