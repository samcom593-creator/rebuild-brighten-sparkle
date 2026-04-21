-- ============================================================
-- Auto-populate agent avatars + upgrade plaque SVG to embed photos.
-- Every agent without an uploaded photo gets a branded APEX-themed
-- initials avatar (ui-avatars.com) so plaques always have a visual.
-- Real uploads via AvatarUpload always take precedence.
-- ============================================================

-- ── 1. Backfill profiles.avatar_url with a branded avatar for anyone missing one ──
-- Colour-seeded per-agent so each agent gets a unique emerald/violet/amber tone.
UPDATE public.profiles p
SET avatar_url =
  'https://ui-avatars.com/api/?' ||
  'name=' || REPLACE(COALESCE(p.full_name, 'Agent'), ' ', '+') ||
  '&background=' || CASE (ABS(HASHTEXT(p.id::text)) % 5)
     WHEN 0 THEN '0a0f1a'
     WHEN 1 THEN '0d1526'
     WHEN 2 THEN '1a1035'
     WHEN 3 THEN '0d2925'
     ELSE        '1a1a2e' END ||
  '&color=' || CASE (ABS(HASHTEXT(p.id::text)) % 4)
     WHEN 0 THEN '22d3a5'  -- APEX emerald
     WHEN 1 THEN 'f59e0b'  -- gold
     WHEN 2 THEN '8b5cf6'  -- violet
     ELSE        '06b6d4'  -- cyan
  END ||
  '&size=512&bold=true&font-size=0.42&length=2&rounded=true'
WHERE (p.avatar_url IS NULL OR p.avatar_url = '')
  AND p.full_name IS NOT NULL
  AND LENGTH(p.full_name) > 0;

-- ── 2. Upgrade the SQL plaque renderer to embed the agent's photo ──
-- Uses profiles.avatar_url (custom upload OR auto-generated fallback from step 1).
CREATE OR REPLACE FUNCTION public.apex_render_plaque(
  p_name text,
  p_tier text,
  p_amount numeric,
  p_date date,
  p_photo_url text DEFAULT NULL
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $svg$
SELECT 'data:image/svg+xml;utf8,' ||
  replace(replace(replace(format(
$S$<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="%1$s" stop-opacity="0.28"/><stop offset="0.4" stop-color="#0a0f1a"/><stop offset="1" stop-color="#020617"/></linearGradient>
<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="%1$s"/><stop offset="1" stop-color="%1$s" stop-opacity="0.5"/></linearGradient>
<clipPath id="photoClip"><rect x="540" y="220" width="500" height="1100" rx="16"/></clipPath>
<linearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>
</defs>
<rect width="1080" height="1920" fill="url(#bg)"/>
<text x="540" y="1000" text-anchor="middle" font-family="ui-sans-serif" font-weight="800" font-size="380" fill="%1$s" fill-opacity="0.06" letter-spacing="8">%2$s</text>
%7$s
<text x="80" y="120" font-family="ui-sans-serif" font-weight="800" font-size="48" fill="#22d3a5" letter-spacing="6">APEX</text>
<text x="250" y="120" font-family="ui-sans-serif" font-weight="400" font-size="48" fill="#f8fafc" letter-spacing="6">FINANCIAL</text>
<rect x="80" y="140" width="110" height="3" fill="url(#accent)"/>
<rect x="80" y="200" width="380" height="48" rx="24" fill="%1$s" fill-opacity="0.15" stroke="%1$s" stroke-opacity="0.6" stroke-width="2"/>
<text x="270" y="232" text-anchor="middle" font-family="ui-sans-serif" font-weight="700" font-size="18" fill="%1$s" letter-spacing="5">%2$s</text>
<text x="80" y="340" font-family="ui-sans-serif" font-weight="800" font-size="58" fill="#f8fafc" letter-spacing="2">%8$s</text>
<text x="80" y="580" font-family="ui-sans-serif" font-weight="900" font-size="200" fill="%1$s">$%5$s</text>
<text x="80" y="640" font-family="ui-sans-serif" font-weight="500" font-size="24" fill="#94a3b8" letter-spacing="4">SINGLE-DAY PRODUCTION</text>
<rect x="80" y="1440" width="500" height="140" rx="16" fill="#0d1526" stroke="%1$s" stroke-opacity="0.4" stroke-width="2"/>
<text x="110" y="1490" font-family="ui-sans-serif" font-weight="500" font-size="16" fill="#64748b" letter-spacing="4">AGENT</text>
<text x="110" y="1550" font-family="ui-sans-serif" font-weight="800" font-size="40" fill="#f8fafc">%4$s</text>
<rect x="80" y="1780" width="920" height="2" fill="%1$s" fill-opacity="0.35"/>
<text x="80" y="1830" font-family="ui-sans-serif" font-weight="600" font-size="20" fill="#94a3b8" letter-spacing="3">%6$s</text>
<text x="1000" y="1830" text-anchor="end" font-family="ui-sans-serif" font-weight="700" font-size="20" fill="%1$s" letter-spacing="4">@APEX.FINANCIAL</text>
</svg>$S$,
  CASE p_tier WHEN 'single_day_platinum' THEN '#e5e4e2'
              WHEN 'single_day'           THEN '#f59e0b'
              WHEN 'single_day_bronze'    THEN '#cd7f32'
              WHEN 'weekly'               THEN '#06b6d4'
              WHEN 'monthly'              THEN '#8b5cf6'
              WHEN 'hot_streak'           THEN '#fb923c'
              ELSE                            '#22d3a5' END,                          -- %1$s  accent
  CASE p_tier WHEN 'single_day_platinum' THEN 'PLATINUM ACHIEVEMENT'
              WHEN 'single_day'           THEN 'GOLD ACHIEVEMENT'
              WHEN 'single_day_bronze'    THEN 'BRONZE ACHIEVEMENT'
              WHEN 'weekly'               THEN 'WEEKLY DIAMOND'
              WHEN 'monthly'              THEN 'ELITE PRODUCER'
              ELSE                            UPPER(REPLACE(p_tier,'_',' ')) END,     -- %2$s  badge
  UPPER(LEFT(COALESCE(split_part(p_name,' ',1),'?'),1) ||
        LEFT(COALESCE(split_part(p_name,' ',2),''),1)),                               -- %3$s  initials
  UPPER(p_name),                                                                       -- %4$s  name
  TO_CHAR(p_amount, 'FM999,999,990'),                                                  -- %5$s  amount
  TO_CHAR(p_date, 'Mon DD, YYYY'),                                                     -- %6$s  date
  -- %7$s: photo block or initials fallback
  CASE WHEN p_photo_url IS NOT NULL AND LENGTH(p_photo_url) > 0 THEN
    '<g clip-path="url(#photoClip)"><image href="' || p_photo_url || '" x="540" y="220" width="500" height="1100" preserveAspectRatio="xMidYMid slice"/><rect x="540" y="220" width="500" height="1100" fill="url(#photoFade)"/></g><rect x="540" y="220" width="500" height="1100" rx="16" fill="none" stroke="' ||
    CASE p_tier WHEN 'single_day_platinum' THEN '#e5e4e2'
                WHEN 'single_day' THEN '#f59e0b'
                WHEN 'single_day_bronze' THEN '#cd7f32'
                WHEN 'weekly' THEN '#06b6d4'
                WHEN 'monthly' THEN '#8b5cf6'
                ELSE '#22d3a5' END ||
    '" stroke-opacity="0.5" stroke-width="3"/>'
  ELSE
    '<rect x="540" y="220" width="500" height="1100" rx="16" fill="' ||
    CASE p_tier WHEN 'single_day_platinum' THEN '#e5e4e2'
                WHEN 'single_day' THEN '#f59e0b'
                WHEN 'single_day_bronze' THEN '#cd7f32'
                WHEN 'weekly' THEN '#06b6d4'
                WHEN 'monthly' THEN '#8b5cf6'
                ELSE '#22d3a5' END ||
    '" fill-opacity="0.10" stroke-dasharray="12 10" stroke-width="3" stroke="' ||
    CASE p_tier WHEN 'single_day_platinum' THEN '#e5e4e2'
                WHEN 'single_day' THEN '#f59e0b'
                WHEN 'single_day_bronze' THEN '#cd7f32'
                WHEN 'weekly' THEN '#06b6d4'
                WHEN 'monthly' THEN '#8b5cf6'
                ELSE '#22d3a5' END ||
    '" stroke-opacity="0.35"/><circle cx="790" cy="770" r="180" fill="' ||
    CASE p_tier WHEN 'single_day_platinum' THEN '#e5e4e2'
                WHEN 'single_day' THEN '#f59e0b'
                WHEN 'single_day_bronze' THEN '#cd7f32'
                WHEN 'weekly' THEN '#06b6d4'
                WHEN 'monthly' THEN '#8b5cf6'
                ELSE '#22d3a5' END ||
    '" fill-opacity="0.15"/><text x="790" y="820" text-anchor="middle" font-family="ui-sans-serif" font-weight="800" font-size="200" fill="#ffffff">' ||
    UPPER(LEFT(COALESCE(split_part(p_name,' ',1),'?'),1) || LEFT(COALESCE(split_part(p_name,' ',2),''),1)) ||
    '</text>'
  END,
  -- %8$s: tagline
  CASE p_tier WHEN 'single_day_platinum' THEN 'ELITE TERRITORY'
              WHEN 'single_day'           THEN 'WINNER''S CIRCLE'
              WHEN 'single_day_bronze'    THEN 'THE CLIMB'
              WHEN 'weekly'               THEN 'DIAMOND WEEK'
              WHEN 'monthly'              THEN 'ELITE PRODUCER'
              WHEN 'hot_streak'           THEN 'UNSTOPPABLE'
              ELSE                            'APEX' END
  ), '#','%23'), ' ','%20'), '"','%22')
$svg$;

-- ── 3. Re-render every plaque with the new photo-embedding function ──
UPDATE public.plaque_awards pa
SET image_svg_url = public.apex_render_plaque(
      COALESCE(
        (SELECT p.full_name FROM public.profiles p
         JOIN public.agents a ON a.profile_id = p.id
         WHERE a.id = pa.agent_id),
        'Agent'
      ),
      pa.milestone_type,
      pa.amount,
      pa.milestone_date,
      COALESCE(
        pa.custom_photo_url,
        (SELECT p.avatar_url FROM public.profiles p
         JOIN public.agents a ON a.profile_id = p.id
         WHERE a.id = pa.agent_id)
      )
    ),
    generated_at = NOW();

SELECT
  'Photos backfilled' AS status,
  (SELECT count(*)::int FROM public.profiles WHERE avatar_url IS NOT NULL) AS profiles_with_photo,
  (SELECT count(*)::int FROM public.plaque_awards WHERE image_svg_url IS NOT NULL) AS plaques_rendered;
