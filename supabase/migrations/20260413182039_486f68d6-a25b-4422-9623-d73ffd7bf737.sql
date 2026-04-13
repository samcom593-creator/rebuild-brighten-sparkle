
-- Add licensing milestone timestamps to applications
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS referral_manager_id UUID;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS referral_source_detail TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS course_purchased_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS exam_scheduled_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS exam_passed_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS fingerprints_submitted_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS license_approved_at TIMESTAMPTZ;

-- Pipeline velocity tracking
CREATE TABLE public.pipeline_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL,
  stage TEXT NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all pipeline metrics"
  ON public.pipeline_metrics FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can view pipeline metrics"
  ON public.pipeline_metrics FOR SELECT
  USING (has_role(auth.uid(), 'manager'::app_role));

CREATE INDEX idx_pipeline_metrics_app ON public.pipeline_metrics(application_id);
CREATE INDEX idx_pipeline_metrics_stage ON public.pipeline_metrics(stage);

-- Licensing nudge tracking
CREATE TABLE public.licensing_nudges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL,
  nudge_type TEXT NOT NULL,
  day_number INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(application_id, nudge_type, day_number, channel)
);

ALTER TABLE public.licensing_nudges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all nudges"
  ON public.licensing_nudges FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_licensing_nudges_app ON public.licensing_nudges(application_id);
