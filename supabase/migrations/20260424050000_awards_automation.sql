-- ============================================================
-- Awards automation infrastructure (2026-04-24)
--
--   1. `awards` Storage bucket (public, 10MB cap) for generated PNGs
--   2. RLS policies allowing anon read + service-role write
--   3. Monthly cron: 1st of every month at 14:00 UTC (09:00 CST)
--      → invokes generate-monthly-awards for the previous month
--   4. Adds `march_2026_top6`, `monthly_top6`, `team_total`,
--      `lifetime_100k` to recognized milestone_type set (no enum
--      change — milestone_type is text — but seeds a hint comment).
-- ============================================================

-- 1. Bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('awards', 'awards', true, 10485760)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Policies (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'awards_public_read') THEN
    EXECUTE 'CREATE POLICY awards_public_read ON storage.objects
             FOR SELECT USING (bucket_id = ''awards'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'awards_anon_write') THEN
    EXECUTE 'CREATE POLICY awards_anon_write ON storage.objects
             FOR INSERT WITH CHECK (bucket_id = ''awards'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'awards_anon_update') THEN
    EXECUTE 'CREATE POLICY awards_anon_update ON storage.objects
             FOR UPDATE USING (bucket_id = ''awards'') WITH CHECK (bucket_id = ''awards'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'awards_anon_delete') THEN
    EXECUTE 'CREATE POLICY awards_anon_delete ON storage.objects
             FOR DELETE USING (bucket_id = ''awards'')';
  END IF;
END $$;

-- 3. Monthly cron — runs at 09:00 CST on the 1st.
--    Uses pg_cron + pg_net to invoke the edge function.
--    The function defaults to "previous month" when no body is provided.
SELECT cron.unschedule('apex-monthly-awards-generate')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-monthly-awards-generate');

SELECT cron.schedule(
  'apex-monthly-awards-generate',
  '0 14 1 * *',  -- 14:00 UTC = 09:00 CST on day-of-month 1
  $cron$
    SELECT net.http_post(
      url := (SELECT 'https://' || split_part(value, '//', 2) || '/functions/v1/generate-monthly-awards'
              FROM system_settings WHERE key='supabase_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM system_settings WHERE key='apex_bot_token')
      ),
      body := jsonb_build_object('target_admin_email', true)
    ) AS request_id;
  $cron$
);

-- 4. execute_sql RPC for service-role JSON SQL execution.
--    Used by bot-sql + generate-monthly-awards to run aggregate queries
--    without writing each one as a PostgREST chain.
CREATE OR REPLACE FUNCTION public.execute_sql(q text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', q)
  INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_sql(text) TO service_role;

-- 5. Comment on plaque_awards.milestone_type for documentation
COMMENT ON COLUMN public.plaque_awards.milestone_type IS
  'Tier: single_day_platinum | single_day | single_day_bronze | weekly | monthly |
   monthly_20k | monthly_top6 | march_2026_top6 | team_total |
   lifetime_100k | hot_streak | streak_5 | first_deal_of_day | diamond_week |
   team_week_50k | team_two_day_20k | team_single_day_10k';
