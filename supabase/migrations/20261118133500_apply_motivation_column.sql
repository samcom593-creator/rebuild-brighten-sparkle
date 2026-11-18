-- MP-WIB-APPLY-MOTIVATION (2026-11-18). The public /apply recruiting form collects a REQUIRED
-- step-4 answer — "What motivates you to join Galaxy?" (min 25 chars, hard-blocks the submit
-- button) — yet the field was never added to the submit-application invoke body, never read by
-- the edge function's Zod schema, and never written to a column. Every applicant typed >=25
-- characters of qualification signal and it was discarded the instant they submitted (the same
-- silent-data-loss class as the 2026-05-18 mobile-carrier drop, but worse: that field was
-- optional, this one is required, so it hit 100% of applicants — 916 lifetime / ~44 per month).
--
-- This column is nullable text: historic rows (pre-fix), the quick-qualify path, and any cached
-- older client bundle all legitimately have no motivation, so NULL is correct state, never a
-- defect. Already applied live via bot-sql 2026-11-18 before the edge-fn deploy so the write
-- target existed first; this migration is the version-controlled, idempotent record of that.
alter table public.applications add column if not exists motivation text;

comment on column public.applications.motivation is
  'Applicant free-text answer to the required Apply step-4 question: what motivates you to join. '
  'Captured 2026-11-18 (MP-WIB-APPLY-MOTIVATION) after it was collected+required in the form but '
  'silently dropped before persistence. NULL = historic/quick-qualify/older-client row, not a defect.';
