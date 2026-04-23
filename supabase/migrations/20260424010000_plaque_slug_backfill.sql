-- Backfill share_slug for every plaque_awards row that's NULL, and
-- upgrade plaque_auto_generate_svg trigger to also populate share_slug
-- on every insert going forward. Slug format:
--   lowercased + hyphenated: {agent_name}-{milestone_type}-{YYYY-MM-DD}
--   non-alnum chars collapsed to '-', duplicates deduped with -N suffix
--
-- Live effect after applying: /plaque/:slug routes resolve for ALL
-- plaques (previously 55+ were NULL and their share links 404'd).

-- Backfill pass — idempotent, skips rows that already have a slug
DO $$
DECLARE
  r record;
  v_slug text;
  v_suffix int;
BEGIN
  FOR r IN
    SELECT pa.id AS plaque_id,
           pa.milestone_type AS mtype,
           pa.milestone_date AS mdate,
           prof.full_name AS agent_name
    FROM plaque_awards pa
    JOIN agents ag ON ag.id = pa.agent_id
    JOIN profiles prof ON prof.id = ag.profile_id
    WHERE pa.share_slug IS NULL
  LOOP
    v_slug := lower(regexp_replace(
      COALESCE(r.agent_name,'agent') || '-' ||
      COALESCE(r.mtype,'award') || '-' ||
      to_char(COALESCE(r.mdate, CURRENT_DATE), 'YYYY-MM-DD'),
      '[^a-zA-Z0-9-]+', '-', 'g'));
    v_slug := trim(both '-' from regexp_replace(v_slug, '-+', '-', 'g'));
    v_suffix := 0;
    WHILE EXISTS (
      SELECT 1 FROM plaque_awards
      WHERE share_slug = v_slug || CASE WHEN v_suffix > 0 THEN '-' || v_suffix ELSE '' END
    ) LOOP
      v_suffix := v_suffix + 1;
    END LOOP;
    IF v_suffix > 0 THEN v_slug := v_slug || '-' || v_suffix; END IF;
    UPDATE plaque_awards SET share_slug = v_slug WHERE id = r.plaque_id;
  END LOOP;
END $$;

-- Extend the BEFORE-INSERT auto-gen trigger to also populate share_slug
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
  v_slug text;
  v_suffix int;
BEGIN
  SELECT COALESCE(prof.full_name, ag.display_name, 'APEX AGENT'),
         COALESCE(NEW.custom_photo_url, prof.avatar_url, '')
  INTO v_agent_name, v_avatar
  FROM agents ag
  LEFT JOIN profiles prof ON prof.id = ag.profile_id
  WHERE ag.id = NEW.agent_id;

  IF NEW.image_svg_url IS NULL OR length(NEW.image_svg_url) < 50 THEN
    v_svg := public.build_plaque_svg(
      v_agent_name,
      COALESCE(NEW.amount_at_time, NEW.amount, 0),
      NEW.milestone_type,
      NEW.color_hex,
      v_avatar,
      NULL);
    NEW.image_svg_url := 'data:image/svg+xml;utf8,' || public.svg_url_encode(v_svg);
    NEW.generated_at := NOW();
  END IF;

  IF NEW.share_slug IS NULL OR NEW.share_slug = '' THEN
    v_slug := lower(regexp_replace(
      COALESCE(v_agent_name,'agent') || '-' ||
      COALESCE(NEW.milestone_type,'award') || '-' ||
      to_char(COALESCE(NEW.milestone_date, CURRENT_DATE), 'YYYY-MM-DD'),
      '[^a-zA-Z0-9-]+', '-', 'g'));
    v_slug := trim(both '-' from regexp_replace(v_slug, '-+', '-', 'g'));
    v_suffix := 0;
    WHILE EXISTS (
      SELECT 1 FROM plaque_awards
      WHERE share_slug = v_slug || CASE WHEN v_suffix > 0 THEN '-' || v_suffix ELSE '' END
    ) LOOP
      v_suffix := v_suffix + 1;
    END LOOP;
    IF v_suffix > 0 THEN v_slug := v_slug || '-' || v_suffix; END IF;
    NEW.share_slug := v_slug;
  END IF;

  RETURN NEW;
END;
$body$;
