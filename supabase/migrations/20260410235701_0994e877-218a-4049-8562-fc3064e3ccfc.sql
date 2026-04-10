
-- Create content_library table
CREATE TABLE public.content_library (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  storage_path TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'image',
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.content_library ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Authenticated users can view content"
ON public.content_library FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage all content"
ON public.content_library FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage content"
ON public.content_library FOR ALL
USING (has_role(auth.uid(), 'manager'::app_role));

-- Timestamp trigger
CREATE TRIGGER update_content_library_updated_at
BEFORE UPDATE ON public.content_library
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create content-library storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('content-library', 'content-library', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Anyone can view content library files"
ON storage.objects FOR SELECT
USING (bucket_id = 'content-library');

CREATE POLICY "Admins can upload content library files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'content-library' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can upload content library files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'content-library' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Admins can delete content library files"
ON storage.objects FOR DELETE
USING (bucket_id = 'content-library' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can delete content library files"
ON storage.objects FOR DELETE
USING (bucket_id = 'content-library' AND has_role(auth.uid(), 'manager'::app_role));
