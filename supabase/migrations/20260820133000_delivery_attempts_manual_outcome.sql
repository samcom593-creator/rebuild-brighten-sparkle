-- MP-313: the per-attempt audit log had no vocabulary for the outcome its own
-- parent supports, so it was FORCED to lie.
--
-- apex-outbox-dispatcher writes outbox_events.status honestly -- MP-312 gave it
-- a `manual_action_required` branch for a refused InsuraCloud deal -- and then,
-- 40 lines later, stamped the child delivery_attempts row `delivered`
-- unconditionally, in the same try block, for the same event. One event, two
-- tables, two contradicting sentences.
--
-- It was not merely a careless unconditional write. delivery_attempts.status
-- carried a CHECK of ('started','delivered','retryable_failure',
-- 'permanent_failure') while outbox_events.status carries
-- ('pending','processing','delivered','manual_action_required','failed',
-- 'dead_letter'). The child's vocabulary is a strict SUBSET of the parent's,
-- missing exactly the one term MP-312 taught the dispatcher to produce.
-- Proven live before this migration, with a control, on the real table:
--   status='manual_action_required' -> REJECTED_BY_CHECK
--   status='delivered'              -> ACCEPTED_would_have_written
-- The audit row could not have told the truth if it wanted to.
--
-- WHY THE CODE FIX ALONE WOULD HAVE BEEN WORSE THAN THE BUG. Writing the honest
-- word without widening this CHECK makes the UPDATE fail; the dispatcher does
-- `if (attemptUpdateError) throw attemptUpdateError` inside its try, so the
-- catch would then overwrite a CORRECT terminal `manual_action_required` event
-- with status='failed' and an available_at retry -- putting a refused
-- PLACEHOLDER-<uuid> policy back on the retry ladder forever. That is the
-- 1,221-undelivered-alert storm this bot has already closed twice. The
-- migration goes first, deliberately.
--
-- ADDITIVE AND REVERSIBLE. Widening a CHECK cannot invalidate an existing row;
-- every current row still satisfies the new predicate. Revert by restoring the
-- 4-value list.
--
-- NO BACKFILL, DELIBERATELY. delivery_attempts holds exactly ONE row lifetime
-- (destination='review', the MP-310 ZZTEST deal) and its `delivered` is HONEST
-- -- the review destination is a genuine no-op delivery. There are zero false
-- receipts to correct. Rewriting history to look consistent is the 465
-- fake-success InsuraCloud rows; this migration changes what CAN be written,
-- never what WAS.

alter table public.delivery_attempts
  drop constraint if exists delivery_attempts_status_check;

alter table public.delivery_attempts
  add constraint delivery_attempts_status_check
  check (status in (
    'started',
    'delivered',
    'manual_action_required',
    'retryable_failure',
    'permanent_failure'
  ));
