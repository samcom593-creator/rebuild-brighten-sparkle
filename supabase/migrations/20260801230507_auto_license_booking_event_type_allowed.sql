-- Mirror of a migration applied to xrzweoneiieddzxogewk before repo-based
-- deploys were reliable (recovered verbatim from schema_migrations 2026-08-07).
-- Already applied live; every statement is idempotent. Present so db push stops
-- erroring "Remote migration versions not found in local migrations directory".

-- Follow-up to auto_license_from_licensed_calendar_booking: the receipt insert
-- violated next_step_events' event_type/source CHECK constraints, so the
-- swallow-guard rolled back every backfill flip (v_licensed_booking_mismatch
-- stayed at 7). Admit the new event type + calendly source, then re-run the
-- backfill through the same trigger path.

alter table public.next_step_events
  drop constraint next_step_events_event_type_check;
alter table public.next_step_events
  add constraint next_step_events_event_type_check
  check (event_type = any (array[
    'advance','stall','unstall','reassign','nudge','message_sent',
    'message_failed','manual_override','closed_lost','reopened',
    'recompute','seed','auto_licensed_from_booking']));

alter table public.next_step_events
  drop constraint next_step_events_source_check;
alter table public.next_step_events
  add constraint next_step_events_source_check
  check (source = any (array[
    'trigger','manual','cron','webhook','self','seed','recompute','calendly']));

-- re-run backfill via the trigger (announcement triggers muted, as before)
alter table public.applications disable trigger trg_notify_hire_announcement;
alter table public.applications disable trigger trg_bot_alert_newly_licensed;

update public.interview_events ie
   set call_track = 'licensed'
 where ie.call_track = 'licensed'
   and ie.canceled_at is null
   and ie.application_id is not null
   and coalesce(ie.event_type_name, '') not ilike '%unlicensed%'
   and exists (select 1 from public.applications a
                where a.id = ie.application_id
                  and a.license_status is distinct from 'licensed');

alter table public.applications enable trigger trg_notify_hire_announcement;
alter table public.applications enable trigger trg_bot_alert_newly_licensed;

insert into public.manager_alerts (kind, payload)
select 'licensed_backfill_from_bookings',
       jsonb_build_object(
         'count', count(*),
         'people', jsonb_agg(jsonb_build_object(
           'application_id', e.application_id,
           'previous_status', e.payload->>'previous_license_status')),
         'note', 'Applicants auto-marked licensed because they booked the Licensed Call calendar link')
  from public.next_step_events e
 where e.event_type = 'auto_licensed_from_booking'
   and e.created_at > now() - interval '5 minutes'
having count(*) > 0;
