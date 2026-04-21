-- ══════════════════════════════════════════════════════════════════════════
-- APEX FINANCIAL — MASTER ACTIVATION SQL
-- Paste this entire file into the Supabase SQL Editor, run once.
-- Everything is idempotent — safe to re-run any time.
-- ══════════════════════════════════════════════════════════════════════════

-- 1. Discord webhook
INSERT INTO public.system_settings (key, value)
VALUES ('discord_webhook_url',
  'https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2. Service role key — paste yours (Project Settings → API → service_role)
-- ALTER DATABASE postgres SET "app.settings.service_role_key" = 'YOUR_SERVICE_ROLE_KEY';

-- 3. Realtime tables
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;      EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;             EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.plaque_awards;     EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_production; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_log; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 4. Deal-sync schema
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS source text DEFAULT 'apex';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'submitted';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS external_deal_id text;
CREATE INDEX IF NOT EXISTS idx_deals_source         ON public.deals(source);
CREATE INDEX IF NOT EXISTS idx_deals_external       ON public.deals(external_deal_id);
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON public.deals(pipeline_stage);

CREATE TABLE IF NOT EXISTS public.deal_sync_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid NOT NULL, direction text DEFAULT 'outbound',
  status text DEFAULT 'pending', attempts int DEFAULT 0, last_error text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), synced_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.deal_sync_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid, event_type text, direction text,
  payload jsonb, response jsonb, error text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.deal_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_sync_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents   ADD COLUMN IF NOT EXISTS insuracloud_user_id    int;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS insuracloud_carrier_id int;

-- 5. Plaque custom photo + created_at + public storage bucket
ALTER TABLE public.plaque_awards ADD COLUMN IF NOT EXISTS custom_photo_url text;
ALTER TABLE public.plaque_awards ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
UPDATE public.plaque_awards SET created_at = COALESCE(awarded_at, generated_at, now()) WHERE created_at IS NULL;

INSERT INTO storage.buckets (id, name, public) VALUES ('public', 'public', true)
  ON CONFLICT (id) DO UPDATE SET public = true;
DROP POLICY IF EXISTS "authenticated_upload_plaque_photos" ON storage.objects;
CREATE POLICY "authenticated_upload_plaque_photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'public' AND (storage.foldername(name))[1] = 'plaque-photos');
DROP POLICY IF EXISTS "public_read_plaque_photos" ON storage.objects;
CREATE POLICY "public_read_plaque_photos" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'public');

-- 6. Auto-populate avatars for profiles missing one
UPDATE public.profiles p
SET avatar_url = 'https://ui-avatars.com/api/?name=' || REPLACE(COALESCE(p.full_name, 'Agent'), ' ', '+') ||
  '&background=' || CASE (ABS(HASHTEXT(p.id::text)) % 5)
     WHEN 0 THEN '0a0f1a' WHEN 1 THEN '0d1526' WHEN 2 THEN '1a1035'
     WHEN 3 THEN '0d2925' ELSE '1a1a2e' END ||
  '&color=' || CASE (ABS(HASHTEXT(p.id::text)) % 4)
     WHEN 0 THEN '22d3a5' WHEN 1 THEN 'f59e0b'
     WHEN 2 THEN '8b5cf6' ELSE '06b6d4' END ||
  '&size=512&bold=true&font-size=0.42&length=2&rounded=true'
WHERE (p.avatar_url IS NULL OR p.avatar_url = '')
  AND p.full_name IS NOT NULL AND LENGTH(p.full_name) > 0;

-- 7. Plaque SVG renderer
CREATE OR REPLACE FUNCTION public.apex_render_plaque(
  p_name text, p_tier text, p_amount numeric, p_date date, p_photo_url text DEFAULT NULL
) RETURNS text LANGUAGE sql IMMUTABLE AS $svg$
  SELECT 'data:image/svg+xml;utf8,' || replace(replace(replace(format(
$S$<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920"><defs><linearGradient id="bg" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="%1$s" stop-opacity="0.28"/><stop offset="0.4" stop-color="#0a0f1a"/><stop offset="1" stop-color="#020617"/></linearGradient><clipPath id="photoClip"><rect x="540" y="220" width="500" height="1100" rx="16"/></clipPath><linearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient></defs><rect width="1080" height="1920" fill="url(#bg)"/>%7$s<text x="80" y="120" font-family="ui-sans-serif" font-weight="800" font-size="48" fill="#22d3a5" letter-spacing="6">APEX</text><text x="250" y="120" font-family="ui-sans-serif" font-weight="400" font-size="48" fill="#f8fafc" letter-spacing="6">FINANCIAL</text><rect x="80" y="140" width="110" height="3" fill="%1$s"/><rect x="80" y="200" width="380" height="48" rx="24" fill="%1$s" fill-opacity="0.15" stroke="%1$s" stroke-opacity="0.6" stroke-width="2"/><text x="270" y="232" text-anchor="middle" font-family="ui-sans-serif" font-weight="700" font-size="18" fill="%1$s" letter-spacing="5">%2$s</text><text x="80" y="340" font-family="ui-sans-serif" font-weight="800" font-size="58" fill="#f8fafc" letter-spacing="2">%8$s</text><text x="80" y="580" font-family="ui-sans-serif" font-weight="900" font-size="200" fill="%1$s">$%5$s</text><text x="80" y="640" font-family="ui-sans-serif" font-weight="500" font-size="24" fill="#94a3b8" letter-spacing="4">SINGLE-DAY PRODUCTION</text><rect x="80" y="1440" width="500" height="140" rx="16" fill="#0d1526" stroke="%1$s" stroke-opacity="0.4" stroke-width="2"/><text x="110" y="1490" font-family="ui-sans-serif" font-weight="500" font-size="16" fill="#64748b" letter-spacing="4">AGENT</text><text x="110" y="1550" font-family="ui-sans-serif" font-weight="800" font-size="40" fill="#f8fafc">%4$s</text><rect x="80" y="1780" width="920" height="2" fill="%1$s" fill-opacity="0.35"/><text x="80" y="1830" font-family="ui-sans-serif" font-weight="600" font-size="20" fill="#94a3b8" letter-spacing="3">%6$s</text><text x="1000" y="1830" text-anchor="end" font-family="ui-sans-serif" font-weight="700" font-size="20" fill="%1$s" letter-spacing="4">@APEX.FINANCIAL</text></svg>$S$,
  CASE p_tier WHEN 'single_day_platinum' THEN '#e5e4e2' WHEN 'single_day' THEN '#f59e0b' WHEN 'single_day_bronze' THEN '#cd7f32' WHEN 'weekly' THEN '#06b6d4' WHEN 'monthly' THEN '#8b5cf6' ELSE '#22d3a5' END,
  CASE p_tier WHEN 'single_day_platinum' THEN 'PLATINUM' WHEN 'single_day' THEN 'GOLD' WHEN 'single_day_bronze' THEN 'BRONZE' WHEN 'weekly' THEN 'WEEKLY' WHEN 'monthly' THEN 'MONTHLY' ELSE UPPER(REPLACE(p_tier,'_',' ')) END,
  UPPER(LEFT(COALESCE(split_part(p_name,' ',1),'?'),1) || LEFT(COALESCE(split_part(p_name,' ',2),''),1)),
  UPPER(p_name), TO_CHAR(p_amount,'FM999,999,990'), TO_CHAR(p_date,'Mon DD, YYYY'),
  CASE WHEN p_photo_url IS NOT NULL AND LENGTH(p_photo_url) > 0
    THEN '<g clip-path="url(#photoClip)"><image href="' || p_photo_url || '" x="540" y="220" width="500" height="1100" preserveAspectRatio="xMidYMid slice"/><rect x="540" y="220" width="500" height="1100" fill="url(#photoFade)"/></g>'
    ELSE '<circle cx="790" cy="770" r="180" fill="' || CASE p_tier WHEN 'single_day_platinum' THEN '#e5e4e2' WHEN 'single_day' THEN '#f59e0b' WHEN 'single_day_bronze' THEN '#cd7f32' ELSE '#22d3a5' END || '" fill-opacity="0.15"/><text x="790" y="820" text-anchor="middle" font-family="ui-sans-serif" font-weight="800" font-size="200" fill="#ffffff">' || UPPER(LEFT(COALESCE(split_part(p_name,' ',1),'?'),1) || LEFT(COALESCE(split_part(p_name,' ',2),''),1)) || '</text>' END,
  CASE p_tier WHEN 'single_day_platinum' THEN 'ELITE TERRITORY' WHEN 'single_day' THEN 'WINNER''S CIRCLE' WHEN 'single_day_bronze' THEN 'THE CLIMB' WHEN 'weekly' THEN 'DIAMOND WEEK' WHEN 'monthly' THEN 'ELITE PRODUCER' ELSE 'APEX' END
  ), '#','%23'), ' ','%20'), '"','%22')
$svg$;

-- 8. Re-render all plaques with avatars
UPDATE public.plaque_awards pa
SET image_svg_url = public.apex_render_plaque(
  COALESCE((SELECT pf.full_name FROM public.profiles pf JOIN public.agents a ON a.profile_id = pf.id WHERE a.id = pa.agent_id), 'Agent'),
  pa.milestone_type, pa.amount, pa.milestone_date,
  COALESCE(pa.custom_photo_url, (SELECT pf.avatar_url FROM public.profiles pf JOIN public.agents a ON a.profile_id = pf.id WHERE a.id = pa.agent_id))
), generated_at = NOW();

-- 9. Meta app review tables
CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL, reason text, status text DEFAULT 'pending',
  requested_at timestamptz DEFAULT now(), completed_at timestamptz,
  handled_by uuid, notes text
);
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_insert_deletion_requests ON public.data_deletion_requests;
CREATE POLICY public_insert_deletion_requests ON public.data_deletion_requests
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.instagram_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL, instagram_user_id text NOT NULL,
  instagram_username text, access_token text NOT NULL,
  token_expires_at timestamptz, scopes text[] DEFAULT '{}',
  connected_at timestamptz DEFAULT now(), last_used_at timestamptz,
  UNIQUE(user_id, instagram_user_id)
);
ALTER TABLE public.instagram_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_own_instagram ON public.instagram_connections;
CREATE POLICY user_own_instagram ON public.instagram_connections FOR ALL TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.instagram_dm_threads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL, ig_user_id text NOT NULL,
  conversation_id text, username text, display_name text,
  profile_pic_url text, last_msg_at timestamptz,
  last_sender text, last_msg_preview text, messages_count int DEFAULT 0,
  bucket text DEFAULT 'stale', stage text DEFAULT 'new',
  notes text, outreach_status text DEFAULT 'pending',
  last_sent_at timestamptz, updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, ig_user_id)
);
ALTER TABLE public.instagram_dm_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_ig_threads ON public.instagram_dm_threads;
CREATE POLICY own_ig_threads ON public.instagram_dm_threads FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- 10. Agent × Carrier comp grid + 11 seeded carriers
CREATE TABLE IF NOT EXISTS public.agent_carrier_comp (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE CASCADE,
  carrier_name text NOT NULL, contract_code text,
  contract_pct numeric(5,2), effective_pct numeric(5,2),
  override_pct numeric(5,2) DEFAULT 0, notes text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(agent_id, carrier_name)
);
ALTER TABLE public.agent_carrier_comp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admins_manage_acc ON public.agent_carrier_comp;
CREATE POLICY admins_manage_acc ON public.agent_carrier_comp FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.carriers (name, is_active)
SELECT v.name, true FROM (VALUES
  ('American Amicable'),('American Home Life'),('Baltimore Life'),
  ('Foresters'),('Guarantee Trust Life'),('Mutual of Omaha'),
  ('Newbridge'),('Prudential'),('Royal Neighbors'),('SBLI'),('Transamerica')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM public.carriers c WHERE LOWER(c.name) = LOWER(v.name));

INSERT INTO public.agent_carrier_comp (agent_id, carrier_id, carrier_name, contract_pct, effective_pct, override_pct)
SELECT a.id, c.id, c.name,
  COALESCE(a.contract_percentage, 50)::numeric(5,2),
  COALESCE(a.contract_percentage, 50)::numeric(5,2),
  COALESCE(a.override_rate, 0)::numeric(5,2)
FROM public.agents a CROSS JOIN public.carriers c
WHERE a.is_deactivated = false AND a.is_inactive = false AND c.is_active = true
ON CONFLICT (agent_id, carrier_name) DO NOTHING;

-- 11. Kill email-spam crons + schedule overseer bot
DO $$ DECLARE jn text; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  FOR jn IN SELECT jobname FROM cron.job WHERE jobname IN (
    'apex-abandoned-applications','apex-ghosted-applicants','apex-dropped-leads',
    'onboarding-nudge-sweep','send-aged-lead-email-cron',
    'send-followup-emails-cron','send-course-hurry-emails-cron'
  ) LOOP PERFORM cron.unschedule(jn); END LOOP;
  PERFORM cron.unschedule('overseer-bot') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overseer-bot');
  PERFORM cron.schedule('overseer-bot', '0 * * * *',
    $c$SELECT public.run_automation_job('overseer-bot','overseer-bot','{}'::jsonb)$c$);
END $$;

-- 12. Done
SELECT
  'APEX ACTIVATED ✅' AS status,
  (SELECT count(*)::int FROM public.plaque_awards WHERE image_svg_url IS NOT NULL) AS plaques_rendered,
  (SELECT count(*)::int FROM public.profiles WHERE avatar_url IS NOT NULL)          AS profiles_with_avatar,
  (SELECT count(*)::int FROM public.agent_carrier_comp)                             AS comp_grid_rows,
  (SELECT count(*)::int FROM public.carriers WHERE is_active)                       AS active_carriers;
