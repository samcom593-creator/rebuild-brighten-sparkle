-- ──────────────────────────────────────────────────────────────────────
-- Policy-number placeholder guard (2026-04-28)
--
-- Existing protection: deals_unique_real_sale already blocks
--   (agent_id, policy_number, effective_date, monthly_premium) duplicates
--   for non-NULL policy_number rows.
--
-- Gap this migration closes: the unique index permits 20+ deals using
-- the SAME placeholder policy_number (e.g. "NXTWHXDXVJ-00-PL", "0000000",
-- "1111111115") so long as another field varies. That distorts dedupe,
-- audit trails, and downstream carrier sync.
--
-- This migration adds a CHECK constraint that rejects future inserts /
-- updates whose policy_number matches a known placeholder pattern.
-- Existing rows are NOT modified (NOT VALID). To validate retroactively,
-- run `ALTER TABLE deals VALIDATE CONSTRAINT deals_policy_no_placeholder;`
-- after backfilling.
--
-- Reversible: `ALTER TABLE deals DROP CONSTRAINT deals_policy_no_placeholder;`
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.deals
  ADD CONSTRAINT deals_policy_no_placeholder
  CHECK (
    policy_number IS NULL
    OR (
      -- Must be at least 4 chars
      length(policy_number) >= 4
      -- Reject all-zero or all-one placeholders
      AND policy_number !~ '^0+$'
      AND policy_number !~ '^1+$'
      AND policy_number !~ '^9+$'
      -- Reject specific known-bad placeholders
      AND policy_number NOT IN (
        'UNKNOWN', 'PENDING', 'TBD', 'TODO',
        'NXTWHXDXVJ-00-PL'
      )
      -- Reject obvious test patterns (>=5 of same digit)
      AND policy_number !~ '^(.)\1{4,}$'
    )
  )
  NOT VALID;

COMMENT ON CONSTRAINT deals_policy_no_placeholder ON public.deals IS
'Blocks future inserts with placeholder policy_numbers. Pre-existing rows kept (NOT VALID); run VALIDATE CONSTRAINT after backfill to enforce historically.';

-- ──────────────────────────────────────────────────────────────────────
-- Optional companion: a view that surfaces the rows currently violating
-- the constraint so Sam can backfill them with real policy numbers.
-- ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_deals_needing_real_policy AS
SELECT
  id,
  agent_id,
  policy_number,
  client_first_name,
  client_last_name,
  effective_date,
  annual_premium,
  carrier_id,
  created_at
FROM public.deals
WHERE
  policy_number IS NOT NULL AND (
    length(policy_number) < 4
    OR policy_number ~ '^0+$'
    OR policy_number ~ '^1+$'
    OR policy_number ~ '^9+$'
    OR policy_number IN ('UNKNOWN','PENDING','TBD','TODO','NXTWHXDXVJ-00-PL')
    OR policy_number ~ '^(.)\1{4,}$'
  )
ORDER BY created_at DESC;

COMMENT ON VIEW public.v_deals_needing_real_policy IS
'Rows with placeholder policy_numbers. Backfill these, then run VALIDATE CONSTRAINT deals_policy_no_placeholder.';
