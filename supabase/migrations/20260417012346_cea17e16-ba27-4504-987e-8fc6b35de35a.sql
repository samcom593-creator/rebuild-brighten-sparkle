-- 1) Add ref_slug to agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS ref_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_ref_slug ON public.agents(ref_slug) WHERE ref_slug IS NOT NULL;

-- 2) Add recruiter_id (separate from assigned_agent_id which is the manager) to applications
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS recruiter_id UUID REFERENCES public.agents(id);
CREATE INDEX IF NOT EXISTS idx_applications_recruiter_id ON public.applications(recruiter_id);

-- 3) Generate ref_slugs for existing agents that don't have one
UPDATE public.agents a
SET ref_slug = LOWER(REGEXP_REPLACE(
  COALESCE(
    (SELECT p.full_name FROM public.profiles p WHERE p.id = a.profile_id LIMIT 1),
    a.display_name,
    'agent'
  ),
  '[^a-zA-Z0-9]+', '-', 'g'
)) || '-' || SUBSTRING(a.id::text, 1, 6)
WHERE a.ref_slug IS NULL;

-- 4) Create duplicate_agent_flags table for admin review
CREATE TABLE IF NOT EXISTS public.duplicate_agent_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_ids UUID[] NOT NULL,
  email TEXT,
  phone TEXT,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);

ALTER TABLE public.duplicate_agent_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage duplicate flags"
  ON public.duplicate_agent_flags
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 5) Resolve Xaviar Watts duplicates: keep the most recent agent (709be2cb), deactivate the older two
UPDATE public.agents
SET is_deactivated = true,
    status = 'inactive',
    updated_at = now()
WHERE id IN (
  '19e7f9d8-0277-43f9-a90c-3e326cca4403',
  'f9b16654-281c-4353-b400-b4e3d21db37f'
)
AND id != '709be2cb-5344-4516-affb-598ba2702b12';

-- Flag for admin review
INSERT INTO public.duplicate_agent_flags (agent_ids, email, reason)
VALUES (
  ARRAY['19e7f9d8-0277-43f9-a90c-3e326cca4403'::uuid, 'f9b16654-281c-4353-b400-b4e3d21db37f'::uuid, '709be2cb-5344-4516-affb-598ba2702b12'::uuid],
  'xaviarwatts123@gmail.com',
  'Xaviar Watts had 3 duplicate agent records — kept most recent active (709be2cb), deactivated the other two.'
);