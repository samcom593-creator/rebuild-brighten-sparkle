-- 2026-05-14 — Make deals.posted_at the unconditional canonical deal date
--
-- Phase 1 follow-up to the live-agent truth shift.
--
-- Background: posted_at was added as the canonical CT-day timestamp for
-- deals, but 7 of 742 historical rows had it NULL. The launch UX was
-- starting to grow .or() fallbacks across every widget to also look at
-- created_at — exactly what Sam asked us NOT to do ("backfill posted_at
-- instead of switching widgets randomly").
--
-- This migration:
--   1. Backfills NULL posted_at using effective_date if available, else
--      created_at, else NOW(). All 7 rows had effective_date set.
--   2. Adds a trigger that, on INSERT/UPDATE, auto-populates posted_at
--      from effective_date or created_at when it would otherwise be NULL.
--      This guarantees the column stays populated going forward without
--      breaking inserts that don't include posted_at explicitly.
--
-- Idempotent.

BEGIN;

UPDATE public.deals
SET posted_at = COALESCE(effective_date::timestamptz, created_at, NOW()),
    updated_at = NOW()
WHERE posted_at IS NULL;

CREATE OR REPLACE FUNCTION public.deals_ensure_posted_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.posted_at IS NULL THEN
    NEW.posted_at := COALESCE(NEW.effective_date::timestamptz, NEW.created_at, NOW());
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_deals_ensure_posted_at ON public.deals;
CREATE TRIGGER trg_deals_ensure_posted_at
BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.deals_ensure_posted_at();

COMMIT;
