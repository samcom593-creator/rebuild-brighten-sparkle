
ALTER TABLE public.award_batches ADD COLUMN award_type text NOT NULL DEFAULT 'top_producer';

CREATE TABLE public.agent_award_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL UNIQUE REFERENCES public.agents(id) ON DELETE CASCADE,
  photo_url text,
  instagram_handle text,
  display_name_override text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_award_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage award profiles" ON public.agent_award_profiles FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Managers can manage award profiles" ON public.agent_award_profiles FOR ALL USING (public.has_role(auth.uid(), 'manager'::app_role));
