-- ============================================================
-- Plaque custom photo support + public storage bucket
-- ============================================================

ALTER TABLE public.plaque_awards
  ADD COLUMN IF NOT EXISTS custom_photo_url text;

-- Public bucket for plaque photos (and anything else user-uploaded).
-- Idempotent: skipped if the bucket already exists.
INSERT INTO storage.buckets (id, name, public)
VALUES ('public', 'public', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Anyone authenticated can upload to plaque-photos/ path
DROP POLICY IF EXISTS "authenticated_upload_plaque_photos" ON storage.objects;
CREATE POLICY "authenticated_upload_plaque_photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'public' AND (storage.foldername(name))[1] = 'plaque-photos');

DROP POLICY IF EXISTS "public_read_plaque_photos" ON storage.objects;
CREATE POLICY "public_read_plaque_photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'public');

DROP POLICY IF EXISTS "admins_manage_plaque_photos" ON storage.objects;
CREATE POLICY "admins_manage_plaque_photos"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'public' AND public.has_role(auth.uid(), 'admin'::public.app_role));
