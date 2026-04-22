-- ============================================================
-- Instagram DM inbox — threads, templates, audit
-- ============================================================

CREATE TABLE IF NOT EXISTS public.instagram_dm_threads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  ig_user_id text NOT NULL,
  conversation_id text,
  username text,
  display_name text,
  profile_pic_url text,
  last_msg_at timestamptz,
  last_sender text CHECK (last_sender IN ('me','them')),
  last_msg_preview text,
  messages_count int DEFAULT 0,
  bucket text CHECK (bucket IN ('fresh','recent','stale')) DEFAULT 'stale',
  stage text DEFAULT 'new',
  notes text,
  outreach_status text DEFAULT 'pending',
  last_sent_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, ig_user_id)
);
CREATE INDEX IF NOT EXISTS idx_igdm_user_bucket ON public.instagram_dm_threads(user_id, bucket, last_msg_at DESC);
CREATE INDEX IF NOT EXISTS idx_igdm_outreach  ON public.instagram_dm_threads(user_id, outreach_status);

ALTER TABLE public.instagram_dm_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_ig_threads ON public.instagram_dm_threads;
CREATE POLICY own_ig_threads ON public.instagram_dm_threads FOR ALL TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS admins_read_ig_threads ON public.instagram_dm_threads;
CREATE POLICY admins_read_ig_threads ON public.instagram_dm_threads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ── Reply templates ──
CREATE TABLE IF NOT EXISTS public.instagram_dm_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  body text NOT NULL,
  category text,
  use_count int DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_igtmpl_user ON public.instagram_dm_templates(user_id, updated_at DESC);
ALTER TABLE public.instagram_dm_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_ig_templates ON public.instagram_dm_templates;
CREATE POLICY own_ig_templates ON public.instagram_dm_templates FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- ── Seed default templates — only when run under an authenticated session ──
-- (Skipped when migration runs via service_role because auth.uid() is NULL.)
DO $seed$ BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO public.instagram_dm_templates (user_id, name, body, category)
    SELECT auth.uid(), 'Qualifier',
      'Hey! Still interested in building a financial career with APEX? Takes 2 mins to see if you qualify: https://apex-financial.org/apply',
      'qualifier'
    WHERE NOT EXISTS (SELECT 1 FROM public.instagram_dm_templates WHERE user_id = auth.uid() AND name = 'Qualifier');
  END IF;
END $seed$;

-- Helper to bucket a thread by its last-message age
CREATE OR REPLACE FUNCTION public.ig_bucket(last_msg_at timestamptz, last_sender text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN last_msg_at IS NULL THEN 'stale'
    WHEN last_sender = 'them' AND last_msg_at > NOW() - INTERVAL '24 hours' THEN 'fresh'
    WHEN last_msg_at > NOW() - INTERVAL '7 days' THEN 'recent'
    ELSE 'stale'
  END;
$$;
