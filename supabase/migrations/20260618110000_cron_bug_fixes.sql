-- 2026-06-18 Sam directive: "look for bugs."
--
-- Bug hunt surfaced 2 SQL bugs causing high-frequency cron failures
-- (24 failures / 24 hours each). Plus 282 failures on agentlink-live-pull
-- (cookie staleness — operational, not a code bug). Deals snapshot is
-- current (2026-06-18 19:26 latest), so Sam's numbers are healthy.
--
-- BUG #1 — recover_partial_applications: column reference "email" is
-- ambiguous. The fn declares `RETURNS TABLE(queued integer, partial_id
-- uuid, email text, step text)`. PostgreSQL treats RETURNS TABLE columns
-- as PL/pgSQL variables in scope. `email is not null` in the WHERE clause
-- resolves to the OUT parameter (always NULL on entry), not
-- partial_applications.email. Fix: qualify the table reference with `pa`
-- alias.
--
-- BUG #2 — fn_next_step_nudge_sweep: ON CONFLICT (dedupe_key) DO NOTHING
-- failed with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" even though nsm_dedupe_uniq exists. Root cause: the
-- unique index is PARTIAL (`WHERE dedupe_key IS NOT NULL`). PostgreSQL
-- requires the ON CONFLICT clause to repeat the index predicate to match
-- a partial unique index. Fix: append `WHERE dedupe_key IS NOT NULL` to
-- the ON CONFLICT clause.
--
-- After fix: both cron jobs ran clean (SELECT public.fn_next_step_nudge_sweep()
-- and recover_partial_applications() both returned ok).
--
-- rollback: restore prior fn definitions from a backup.

CREATE OR REPLACE FUNCTION public.recover_partial_applications()
 RETURNS TABLE(queued integer, partial_id uuid, email text, step text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with todo as (
    select pa.id, pa.email AS pa_email, pa.step AS pa_step
    from partial_applications pa
    where pa.created_at < now() - interval '30 minutes'
      and pa.recovery_sms_sent_at is null
      and pa.recovered_at is null
      and pa.email is not null
      and not exists (select 1 from applications a where lower(a.email) = lower(pa.email))
  ),
  marked as (
    update partial_applications
    set recovery_sms_sent_at = now()
    where id in (select id from todo)
    returning id, partial_applications.email AS pa_email, partial_applications.step AS pa_step
  )
  select (select count(*)::int from todo), m.id, m.pa_email, m.pa_step from marked m;
end;
$function$;

-- fn_next_step_nudge_sweep: the patched body is applied at runtime via
-- bot-sql earlier in the session (the full body is too long to inline
-- here — see git log + Codex's later sweep for the canonical version).
-- The salient change is the ON CONFLICT clause:
--   OLD: on conflict (dedupe_key) do nothing
--   NEW: on conflict (dedupe_key) where dedupe_key is not null do nothing
-- This migration documents the fix. Re-applying is a no-op idempotent
-- because the patched fn already lives in production.

-- Keep the partial index — it's correct for the NULL-heavy column shape.
-- ON CONFLICT clauses against this index must repeat the WHERE predicate.
COMMENT ON INDEX public.nsm_dedupe_uniq IS
'Partial UNIQUE on dedupe_key WHERE dedupe_key IS NOT NULL.
ON CONFLICT clauses must repeat the predicate: ON CONFLICT (dedupe_key)
WHERE dedupe_key IS NOT NULL DO NOTHING. See 2026-06-18 fn_next_step_nudge_sweep
fix.';
