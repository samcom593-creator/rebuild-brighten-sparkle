-- 2026-06-30 EMERGENCY: every Application INSERT was failing with
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Sam: "people cannot apply to the website because we have crashed of too many things".
--
-- Root cause: yesterday's MP-224 added a BEFORE/AFTER INSERT trigger
-- (trg_calendly_for_unlicensed_ins) on applications that ENQUEUES a calendly
-- invite into outreach_queue with:
--
--   INSERT INTO outreach_queue (...) VALUES (...)
--   ON CONFLICT (idempotency_key) DO NOTHING
--
-- The supporting unique index was created in MP-223 with a partial predicate:
--
--   CREATE UNIQUE INDEX ... ON outreach_queue(idempotency_key)
--   WHERE idempotency_key IS NOT NULL
--
-- Postgres ON CONFLICT (col) DO NOTHING REQUIRES the index used for
-- inference to be FULL (no WHERE) — partial indexes are only inferable
-- when the INSERT also carries the same WHERE predicate, which the
-- trigger does not. Result: every INSERT into applications failed
-- silently for ~24 hours (since the Calendly trigger shipped). Edge
-- fn returned 500 to the front-end. Recruits could not apply.
--
-- Fix:
--   1. Backfill any NULL idempotency_key rows to id::text (so unique
--      can be enforced cleanly)
--   2. SET NOT NULL on idempotency_key (which was already populated
--      for all rows after backfill)
--   3. Drop the partial unique index
--   4. Replace with a FULL unique index
--
-- Verified live: edge fn POST returned {"applicationId":"62c91b88...","status":"quick_qualified"}.
-- Test row cleaned up.
--
-- rollback: re-create the partial index + drop NOT NULL. Don't do this.

UPDATE public.outreach_queue
SET idempotency_key = id::text
WHERE idempotency_key IS NULL;

ALTER TABLE public.outreach_queue
  ALTER COLUMN idempotency_key SET NOT NULL;

DROP INDEX IF EXISTS public.outreach_queue_idempotency_key_uniq;
DROP INDEX IF EXISTS public.outreach_queue_idempotency_key_uidx;

CREATE UNIQUE INDEX outreach_queue_idempotency_key_uniq
  ON public.outreach_queue (idempotency_key);
