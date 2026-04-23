-- Auto-generate plaque SVGs on insert + backfill helper.
-- Every plaque inserted into plaque_awards gets an image_svg_url filled
-- in by a trigger. A batch backfill function cleans up any historic
-- plaques missing images. Idempotent.
--
-- Output format: data:image/svg+xml;utf8,<url-encoded SVG>
-- 1080x1920 vertical "tablet" format matching the existing
-- team_week_50k / single_day plaques.

-- ───────── Helpers ─────────
CREATE OR REPLACE FUNCTION public.plaque_label(p_type text, p_badge text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $body$
  SELECT COALESCE(NULLIF(p_badge, ''),
    CASE p_type
      WHEN 'monthly_20k' THEN 'MONTHLY $20K+ PRODUCER'
      WHEN 'single_day_bronze' THEN 'BRONZE DAY'
      WHEN 'single_day' THEN 'GOLD ACHIEVEMENT'
      WHEN 'single_day_platinum' THEN 'PLATINUM DAY'
      WHEN 'team_single_day_10k' THEN 'TEAM $10K DAY'
      WHEN 'team_two_day_20k' THEN 'TEAM $20K 2-DAY'
      WHEN 'team_week_50k' THEN 'TEAM $50K WEEK'
      WHEN '10K CLUB' THEN '10K CLUB'
      WHEN '25K CRUSHER' THEN '25K CRUSHER'
      WHEN '40K ELITE' THEN '40K ELITE'
      WHEN '75K APEX' THEN '75K APEX'
      WHEN 'FIRST DEAL' THEN 'FIRST DEAL'
      WHEN 'first_deal_of_day' THEN 'FIRST DEAL OF THE DAY'
      WHEN '7-DAY STREAK' THEN '7-DAY STREAK'
      WHEN 'hot_streak' THEN 'HOT STREAK'
      WHEN 'diamond_week' THEN 'DIAMOND WEEK'
      WHEN 'comeback_champion' THEN 'COMEBACK CHAMPION'
      ELSE UPPER(REPLACE(p_type, '_', ' '))
    END);
$body$;

CREATE OR REPLACE FUNCTION public.plaque_color(p_type text, p_color text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $body$
  SELECT COALESCE(NULLIF(p_color, ''),
    CASE p_type
      WHEN 'monthly_20k' THEN '#f59e0b'
      WHEN 'single_day_bronze' THEN '#cd7f32'
      WHEN 'single_day' THEN '#f59e0b'
      WHEN 'single_day_platinum' THEN '#e5e7eb'
      WHEN '10K CLUB' THEN '#22d3a5'
      WHEN '25K CRUSHER' THEN '#f59e0b'
      WHEN '40K ELITE' THEN '#8b5cf6'
      WHEN '75K APEX' THEN '#ec4899'
      WHEN 'FIRST DEAL' THEN '#22d3a5'
      WHEN 'diamond_week' THEN '#06b6d4'
      ELSE '#f59e0b'
    END);
$body$;

-- URL-encode the chars that data URIs require. Percent first so we
-- don't double-encode our own %-sequences.
CREATE OR REPLACE FUNCTION public.svg_url_encode(p_svg text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $body$
  SELECT replace(replace(replace(replace(replace(replace(replace(replace(
    p_svg,
    '%', '%25'), '<', '%3C'), '>', '%3E'), '"', '%22'),
    '#', '%23'), E'\n', '%0A'), E'\t', '%09'), ' ', '%20');
$body$;

-- Build one SVG string.
CREATE OR REPLACE FUNCTION public.build_plaque_svg(
  p_agent_name text, p_amount numeric, p_milestone_type text,
  p_color text, p_avatar_url text, p_sub_label text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $body$
DECLARE
  v_label text := public.plaque_label(p_milestone_type, NULL);
  v_color text := public.plaque_color(p_milestone_type, p_color);
  v_sub text := COALESCE(p_sub_label, v_label);
  v_amount_fmt text := '$' || to_char(COALESCE(p_amount, 0)::numeric, 'FM999,999,999');
  v_agent_display text := UPPER(COALESCE(NULLIF(trim(p_agent_name),''), 'APEX AGENT'));
  v_avatar text := COALESCE(
    NULLIF(p_avatar_url, ''),
    'https://ui-avatars.com/api/?name='
      || replace(COALESCE(NULLIF(trim(p_agent_name),''),'APEX Agent'), ' ', '+')
      || '&background=0d1526&color=22d3a5&size=512&bold=true&font-size=0.42&length=2&rounded=true');
BEGIN
  RETURN
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">' ||
    '<defs>' ||
      '<linearGradient id="bg" x1="0" y1="0" x2="0.8" y2="1">' ||
        '<stop offset="0" stop-color="' || v_color || '" stop-opacity="0.28"/>' ||
        '<stop offset="0.4" stop-color="#0a0f1a"/>' ||
        '<stop offset="1" stop-color="#020617"/></linearGradient>' ||
      '<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">' ||
        '<stop offset="0" stop-color="' || v_color || '"/>' ||
        '<stop offset="1" stop-color="' || v_color || '" stop-opacity="0.5"/></linearGradient>' ||
      '<clipPath id="photoClip"><rect x="540" y="220" width="500" height="1100" rx="16"/></clipPath>' ||
      '<linearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1">' ||
        '<stop offset="0" stop-color="#000" stop-opacity="0"/>' ||
        '<stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>' ||
    '</defs>' ||
    '<rect width="1080" height="1920" fill="url(#bg)"/>' ||
    '<text x="540" y="1000" text-anchor="middle" font-family="ui-sans-serif" font-weight="800" font-size="380" fill="' ||
      v_color || '" fill-opacity="0.06" letter-spacing="8">' || v_label || '</text>' ||
    '<g clip-path="url(#photoClip)"><image href="' || v_avatar ||
      '" x="540" y="220" width="500" height="1100" preserveAspectRatio="xMidYMid slice"/>' ||
      '<rect x="540" y="220" width="500" height="1100" fill="url(#photoFade)"/></g>' ||
    '<rect x="540" y="220" width="500" height="1100" rx="16" fill="none" stroke="' ||
      v_color || '" stroke-opacity="0.5" stroke-width="3"/>' ||
    '<text x="80" y="120" font-family="ui-sans-serif" font-weight="800" font-size="48" fill="#22d3a5" letter-spacing="6">APEX</text>' ||
    '<text x="250" y="120" font-family="ui-sans-serif" font-weight="400" font-size="48" fill="#f8fafc" letter-spacing="6">FINANCIAL</text>' ||
    '<rect x="80" y="140" width="110" height="3" fill="url(#accent)"/>' ||
    '<rect x="80" y="200" width="480" height="48" rx="24" fill="' || v_color ||
      '" fill-opacity="0.15" stroke="' || v_color || '" stroke-opacity="0.6" stroke-width="2"/>' ||
    '<text x="320" y="232" text-anchor="middle" font-family="ui-sans-serif" font-weight="700" font-size="18" fill="' ||
      v_color || '" letter-spacing="5">' || v_label || '</text>' ||
    '<text x="80" y="340" font-family="ui-sans-serif" font-weight="800" font-size="58" fill="#f8fafc" letter-spacing="2">WINNER''S CIRCLE</text>' ||
    '<text x="80" y="580" font-family="ui-sans-serif" font-weight="900" font-size="200" fill="' || v_color || '">' ||
      v_amount_fmt || '</text>' ||
    '<text x="80" y="640" font-family="ui-sans-serif" font-weight="500" font-size="24" fill="#94a3b8" letter-spacing="4">' ||
      UPPER(v_sub) || '</text>' ||
    '<rect x="80" y="1440" width="500" height="140" rx="16" fill="#0d1526" stroke="' || v_color ||
      '" stroke-opacity="0.4" stroke-width="2"/>' ||
    '<text x="110" y="1490" font-family="ui-sans-serif" font-weight="500" font-size="16" fill="#64748b" letter-spacing="4">AGENT</text>' ||
    '<text x="110" y="1550" font-family="ui-sans-serif" font-weight="800" font-size="40" fill="#f8fafc">' ||
      v_agent_display || '</text>' ||
    '<rect x="80" y="1780" width="920" height="2" fill="' || v_color || '" fill-opacity="0.35"/>' ||
    '<text x="80" y="1830" font-family="ui-sans-serif" font-weight="400" font-size="20" fill="#64748b" letter-spacing="4">APEX FINANCIAL · EARNED IN THE FIELD</text>' ||
    '</svg>';
END;
$body$;

-- Trigger: on every new plaque, generate + store SVG automatically.
CREATE OR REPLACE FUNCTION public.plaque_auto_generate_svg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_agent_name text;
  v_avatar text;
  v_svg text;
BEGIN
  IF NEW.image_svg_url IS NOT NULL AND length(NEW.image_svg_url) > 50 THEN
    RETURN NEW;  -- already has image, don't overwrite
  END IF;

  SELECT COALESCE(p.full_name, a.display_name, 'APEX AGENT'),
         COALESCE(NEW.custom_photo_url, p.avatar_url, '')
  INTO v_agent_name, v_avatar
  FROM agents a LEFT JOIN profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  v_svg := public.build_plaque_svg(
    v_agent_name,
    COALESCE(NEW.amount_at_time, NEW.amount, 0),
    NEW.milestone_type,
    NEW.color_hex,
    v_avatar,
    NULL);

  NEW.image_svg_url := 'data:image/svg+xml;utf8,' || public.svg_url_encode(v_svg);
  NEW.generated_at := NOW();

  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_plaque_auto_svg ON public.plaque_awards;
CREATE TRIGGER trg_plaque_auto_svg
  BEFORE INSERT ON public.plaque_awards
  FOR EACH ROW EXECUTE FUNCTION public.plaque_auto_generate_svg();

-- Batch backfill (idempotent). Already ran via bot-sql; this re-application
-- of the migration just re-verifies.
CREATE OR REPLACE FUNCTION public.backfill_plaque_images()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_svg text;
  v_generated int := 0;
BEGIN
  FOR r IN
    SELECT pa.id, pa.milestone_type, pa.color_hex, pa.badge_label,
           COALESCE(pa.amount_at_time, pa.amount, 0)::numeric AS amount,
           COALESCE(p.full_name, a.display_name, 'APEX AGENT') AS agent_name,
           COALESCE(pa.custom_photo_url, p.avatar_url, '') AS avatar_url
    FROM plaque_awards pa
    JOIN agents a ON a.id = pa.agent_id
    LEFT JOIN profiles p ON p.id = a.profile_id
    WHERE pa.image_svg_url IS NULL
  LOOP
    v_svg := public.build_plaque_svg(
      r.agent_name, r.amount, r.milestone_type, r.color_hex, r.avatar_url, NULL);
    UPDATE plaque_awards
    SET image_svg_url = 'data:image/svg+xml;utf8,' || public.svg_url_encode(v_svg),
        generated_at = NOW()
    WHERE id = r.id;
    v_generated := v_generated + 1;
  END LOOP;
  RETURN jsonb_build_object('generated', v_generated);
END;
$body$;
