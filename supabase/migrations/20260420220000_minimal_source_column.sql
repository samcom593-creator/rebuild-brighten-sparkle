-- Minimal migration to diagnose Lovable pipeline.
-- Just adds one column. If even this doesn't apply, Lovable is ignoring my files.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS source text DEFAULT 'apex';
