-- Onboarding Course System Tables

-- Onboarding modules table
CREATE TABLE public.onboarding_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT NOT NULL,
  pass_threshold INTEGER DEFAULT 80,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Questions for each module
CREATE TABLE public.onboarding_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES public.onboarding_modules(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer INTEGER NOT NULL,
  explanation TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Agent progress tracking
CREATE TABLE public.onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  module_id UUID REFERENCES public.onboarding_modules(id) ON DELETE CASCADE NOT NULL,
  video_watched_percent INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  score INTEGER,
  attempts INTEGER DEFAULT 0,
  answers JSONB,
  passed BOOLEAN DEFAULT false,
  UNIQUE(agent_id, module_id)
);

-- Enable RLS
ALTER TABLE public.onboarding_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies for modules (public read for authenticated)
CREATE POLICY "Anyone can view active modules"
ON public.onboarding_modules FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage modules"
ON public.onboarding_modules FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for questions
CREATE POLICY "Anyone can view questions"
ON public.onboarding_questions FOR SELECT
USING (true);

CREATE POLICY "Admins can manage questions"
ON public.onboarding_questions FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for progress
CREATE POLICY "Agents can view own progress"
ON public.onboarding_progress FOR SELECT
USING (agent_id = current_agent_id());

CREATE POLICY "Agents can insert own progress"
ON public.onboarding_progress FOR INSERT
WITH CHECK (agent_id = current_agent_id());

CREATE POLICY "Agents can update own progress"
ON public.onboarding_progress FOR UPDATE
USING (agent_id = current_agent_id());

CREATE POLICY "Managers can view team progress"
ON public.onboarding_progress FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND agent_id IN (
    SELECT id FROM public.agents WHERE invited_by_manager_id = current_agent_id()
  )
);

CREATE POLICY "Admins can manage all progress"
ON public.onboarding_progress FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));