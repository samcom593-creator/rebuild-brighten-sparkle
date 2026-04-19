-- Add image columns to plaque_awards
ALTER TABLE public.plaque_awards
  ADD COLUMN IF NOT EXISTS image_png_url text,
  ADD COLUMN IF NOT EXISTS image_svg_url text,
  ADD COLUMN IF NOT EXISTS share_slug text,
  ADD COLUMN IF NOT EXISTS email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_delivery_status text,
  ADD COLUMN IF NOT EXISTS email_error text,
  ADD COLUMN IF NOT EXISTS amount_at_time numeric,
  ADD COLUMN IF NOT EXISTS color_hex text,
  ADD COLUMN IF NOT EXISTS badge_label text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_plaque_awards_share_slug
  ON public.plaque_awards(share_slug)
  WHERE share_slug IS NOT NULL;

-- Public storage bucket for plaque images
INSERT INTO storage.buckets (id, name, public)
VALUES ('plaque-images', 'plaque-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "plaque_images_public_read" ON storage.objects;
CREATE POLICY "plaque_images_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'plaque-images');

DROP POLICY IF EXISTS "plaque_images_admin_write" ON storage.objects;
CREATE POLICY "plaque_images_admin_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plaque-images' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "plaque_images_admin_update" ON storage.objects;
CREATE POLICY "plaque_images_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'plaque-images' AND public.has_role(auth.uid(), 'admin'::app_role));

-- Email delivery audit table
CREATE TABLE IF NOT EXISTS public.email_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template text NOT NULL,
  recipient_email text NOT NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  subject text,
  provider text DEFAULT 'resend',
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  retries integer DEFAULT 0,
  related_record_id uuid,
  related_record_type text,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_status
  ON public.email_delivery_log(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_delivery_log_agent
  ON public.email_delivery_log(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_delivery_log_template
  ON public.email_delivery_log(template, created_at DESC);

ALTER TABLE public.email_delivery_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_log_admins_all" ON public.email_delivery_log;
CREATE POLICY "email_log_admins_all" ON public.email_delivery_log
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "email_log_managers_read" ON public.email_delivery_log;
CREATE POLICY "email_log_managers_read" ON public.email_delivery_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS update_email_delivery_log_updated_at ON public.email_delivery_log;
CREATE TRIGGER update_email_delivery_log_updated_at
  BEFORE UPDATE ON public.email_delivery_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill share slugs for existing plaques
UPDATE public.plaque_awards
SET share_slug = substring(md5(id::text) from 1 for 10)
WHERE share_slug IS NULL;