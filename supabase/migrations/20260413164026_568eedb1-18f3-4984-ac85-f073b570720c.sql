-- Extend content_library with AI and storage management fields
ALTER TABLE public.content_library
  ADD COLUMN IF NOT EXISTS original_name TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS public_url TEXT,
  ADD COLUMN IF NOT EXISTS content_type TEXT,
  ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS ai_analyzed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_description TEXT,
  ADD COLUMN IF NOT EXISTS duplicate_flagged BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS possible_duplicate_of UUID REFERENCES public.content_library(id),
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create function to update search vector
CREATE OR REPLACE FUNCTION public.content_library_search_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.ai_description, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.ai_tags, ' '), '')
  );
  RETURN NEW;
END;
$$;

-- Create trigger
CREATE TRIGGER content_library_search_trigger
  BEFORE INSERT OR UPDATE ON public.content_library
  FOR EACH ROW
  EXECUTE FUNCTION public.content_library_search_update();

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_content_library_tags ON public.content_library USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_content_library_ai_tags ON public.content_library USING gin(ai_tags);
CREATE INDEX IF NOT EXISTS idx_content_library_search ON public.content_library USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_content_library_file_type ON public.content_library(file_type);
CREATE INDEX IF NOT EXISTS idx_content_library_duplicates ON public.content_library(duplicate_flagged) WHERE duplicate_flagged = true;
CREATE INDEX IF NOT EXISTS idx_content_library_created ON public.content_library(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_library_private ON public.content_library(is_private);