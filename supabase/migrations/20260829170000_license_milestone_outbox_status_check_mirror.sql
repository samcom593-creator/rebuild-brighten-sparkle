-- MP-341b — mirror the live status CHECK on license_milestone_outbox.
--
-- The table was created by hand through bot-sql and never round-tripped, so
-- the only copy of its status contract lived in pg_constraint. On 2026-08-29
-- license-milestone-sms-drain wrote status='skipped_no_carrier', the UPDATE
-- was refused by this constraint, the error went unread, and the cron tick
-- reported processed:3 with zero rows changed. The repo now carries the
-- contract so src/tests/functions/licenseMilestoneSmsDrainContract.test.ts
-- can read it instead of hardcoding a mirror that rots.
--
-- Idempotent and semantically a no-op against prod: the list below is the
-- constraint proven live (pg_get_constraintdef, 2026-08-29 16:4x Phoenix).
alter table public.license_milestone_outbox
  drop constraint if exists license_milestone_outbox_status_check;
alter table public.license_milestone_outbox
  add constraint license_milestone_outbox_status_check
  check (status in ('pending','sent','failed','skipped'));
