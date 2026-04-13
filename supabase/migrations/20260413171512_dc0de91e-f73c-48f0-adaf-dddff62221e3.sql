ALTER TABLE public.content_library
  ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sensitive_flags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sensitive_reason TEXT,
  ADD COLUMN IF NOT EXISTS sensitive_checked BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_content_library_sensitive ON public.content_library(is_sensitive) WHERE is_sensitive = true;