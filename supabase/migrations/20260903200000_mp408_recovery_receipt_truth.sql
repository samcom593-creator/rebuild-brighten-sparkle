-- MP-408 (2026-09-03): recovery_sms_sent_at has never once represented a sent SMS.
--
-- WHAT WAS MEASURED, NOT ASSUMED:
--   * recover_partial_applications() is 847 chars and contains NO dispatch
--     mechanism -- no net.http_post, no net.http_get, no pg_notify, no
--     functions/v1 invoke. It UPDATEs a marker and RETURNs rows.
--   * cron job 31 (recover_partial_applications_hourly, 1,435 successful fires)
--     runs `select public.recover_partial_applications();` and DISCARDS the
--     returned rows. Nothing else in src/ or supabase/functions calls it.
--   * All 6 real abandoned humans carrying the "sent" marker have ZERO
--     notification_log rows on any phone or email, on any channel, ever.
--     (The 9 rows that do exist for +14697676068 / +16015550270 are unrelated
--     sms-auto alert traffic -- Sam's own alert number and the MP-270 test row
--     -- and are mostly status='skipped' or 'failed'.)
--
-- SO THE COLUMN IS A QUEUE MARK WEARING A DELIVERY RECEIPT'S NAME. Same disease
-- as the 465 fake-success InsuraCloud rows and MP-273's sent_sms=true-on-
-- round-trip-completion, on the highest-$ surface this site owns: the list of
-- applicants who typed their email and phone and then walked away.
--
-- IT DID NOT ONLY LIE, IT BURNED THE LEAD. The function's own eligibility
-- clause is `recovery_sms_sent_at is null`. Stamping it permanently disqualifies
-- that row, so the day a real sender IS wired up it would skip exactly the 17
-- people it should have contacted first.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO: it does not wire a sender.
-- Sending SMS to applicants is unsolicited outbound to recipients Sam has not
-- named per-message (Operating Contract hard limit #2), so arming that is his
-- call, not this migration's. This closes the lie and restores eligibility;
-- the queue is now honest and full rather than dishonest and empty.
--
-- THE 17 EXISTING MARKS ARE RELOCATED, NOT REWRITTEN. Moving a value into the
-- column that describes what actually happened is not the 465-row backfill
-- disease -- that disease is inventing a receipt nobody earned. Reversible
-- pre-image (all 17 rows, exact timestamps) at
-- website-integrity-bot/snapshots/mp408-recovery-sms-preimage.sql.

alter table public.partial_applications
  add column if not exists recovery_queued_at timestamptz;

comment on column public.partial_applications.recovery_queued_at is
  'MP-408: when recover_partial_applications() selected this row for recovery outreach. A QUEUE mark, not a delivery receipt -- nothing has been sent. recovery_sms_sent_at stays NULL until a real sender writes a real receipt into it.';

comment on column public.partial_applications.recovery_sms_sent_at is
  'MP-408: reserved for a PROVEN SMS delivery receipt. As of 2026-09-03 no send path exists, so this column is NULL on every row by construction. Do not stamp it from a function that cannot dispatch -- apex-doctor Check #57 and scripts/check-unsent-receipt-marker.mjs both grade that.';

-- Relocate the 17 queue marks off the receipt column.
update public.partial_applications
   set recovery_queued_at   = coalesce(recovery_queued_at, recovery_sms_sent_at),
       recovery_sms_sent_at = null
 where recovery_sms_sent_at is not null;

-- The abandoned view must expose the new column or the function below reads a
-- column that does not exist on it. Caught by running the function, not by
-- reading the diff: `pa.recovery_queued_at` resolves against the VIEW, not the
-- table. Column list otherwise byte-identical to the pre-MP-408 definition.
create or replace view public.v_partial_applications_abandoned as
 SELECT id, session_id, email, phone, first_name, last_name, city, state,
    step_completed, form_data, user_agent, ip_address, created_at, updated_at,
    converted_at, admin_notified_at, step, abandoned_at, recovery_sms_sent_at,
    recovery_email_sent_at, recovered_at, recovery_queued_at
   FROM partial_applications pa
  WHERE converted_at IS NULL AND NOT (EXISTS ( SELECT 1
           FROM applications a
          WHERE pa.email IS NOT NULL AND lower(a.email) = lower(pa.email)));

-- The function now stamps the queue column and says what it is. Eligibility is
-- unchanged in shape (one pass per row) but no longer claims a delivery.
create or replace function public.recover_partial_applications()
 returns table(queued integer, partial_id uuid, email text, step text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- MP-408: stamps recovery_queued_at, NEVER recovery_sms_sent_at. This
  -- function has no dispatch mechanism; a caller that actually delivers must
  -- write the receipt itself, from the provider's response.
  return query
  with todo as (
    select pa.id, pa.email AS pa_email, pa.step AS pa_step
    from v_partial_applications_abandoned pa
    where pa.created_at < now() - interval '30 minutes'
      and pa.recovery_queued_at is null
      and pa.recovered_at is null
      and pa.email is not null
  ),
  marked as (
    update partial_applications
    set recovery_queued_at = now()
    where id in (select id from todo)
    returning id, partial_applications.email AS pa_email, partial_applications.step AS pa_step
  )
  select (select count(*)::int from todo), m.id, m.pa_email, m.pa_step from marked m;
end;
$function$;
