-- 2026-05-16 — Auto-generate agents.ref_slug so every agent has a sharable
-- /apply?ref=<slug> URL on their dashboard.
--
-- Before tonight, 31 of 144 agents had NULL ref_slug — they literally
-- couldn't share a personal referral link (the URL would resolve to nothing
-- and applicants couldn't credit them). The card on AgentCommandDashboard
-- depends on this column being populated.

BEGIN;

-- One-time backfill: slugify display_name + 6-char id suffix.
UPDATE public.agents a
SET ref_slug = slug
FROM (
  SELECT
    id,
    lower(regexp_replace(
      coalesce(nullif(display_name,''), 'agent'),
      '[^a-zA-Z0-9]+', '-', 'g'
    )) || '-' || substring(id::text from 1 for 6) AS slug
  FROM public.agents
  WHERE ref_slug IS NULL
) s
WHERE a.id = s.id AND a.ref_slug IS NULL;

-- Tidy any malformed slugs (double hyphens, leading/trailing hyphens).
UPDATE public.agents
SET ref_slug = regexp_replace(
  trim(both '-' from regexp_replace(ref_slug, '-+', '-', 'g')),
  '-+$', '', 'g'
)
WHERE ref_slug ~ '(-{2,}|^-|-$)';

-- BEFORE INSERT trigger: every new agent gets a ref_slug if the caller
-- didn't provide one. Matches the same slug format the card auto-generates
-- on the client side as a fallback, so the values stay consistent.
CREATE OR REPLACE FUNCTION public.agents_autogen_ref_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ref_slug IS NULL OR NEW.ref_slug = '' THEN
    NEW.ref_slug := lower(regexp_replace(
      coalesce(nullif(NEW.display_name,''), 'agent'),
      '[^a-zA-Z0-9]+', '-', 'g'
    )) || '-' || substring(NEW.id::text from 1 for 6);
    NEW.ref_slug := regexp_replace(
      trim(both '-' from regexp_replace(NEW.ref_slug, '-+', '-', 'g')),
      '-+$', '', 'g'
    );
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_agents_autogen_ref_slug ON public.agents;
CREATE TRIGGER trg_agents_autogen_ref_slug
BEFORE INSERT ON public.agents
FOR EACH ROW EXECUTE FUNCTION public.agents_autogen_ref_slug();

COMMIT;
