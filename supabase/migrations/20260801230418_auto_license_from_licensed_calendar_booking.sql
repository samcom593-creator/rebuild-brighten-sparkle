-- Mirror of a migration applied to xrzweoneiieddzxogewk before repo-based
-- deploys were reliable (recovered verbatim from schema_migrations 2026-08-07).
-- Already applied live; every statement is idempotent. Present so db push stops
-- erroring "Remote migration versions not found in local migrations directory".

-- MP: licensed prospects who book the Licensed Call calendar were staying
-- 'unlicensed'/'pending' in the pipeline. Sam directive 2026-08-01:
-- "anyone who's on my calendar link under licensed should automatically be
--  put as licensed in the pipeline."
--
-- 1) fn_auto_license_from_licensed_booking + trigger on interview_events:
--    licensed-track booking matched to an application => license_status='licensed',
--    licensed_at stamped, receipt row in next_step_events.
--    Guard excludes event names containing 'unlicensed' (the "Unlicensed
--    Prospect Call " type contains the substring 'licensed' — same class of
--    bug fixed in the edge fns this same ship).
-- 2) Reclassify the 9 interview_events misfiled as call_track='licensed' by
--    that substring bug.
-- 3) Backfill: touch licensed-track bookings so the NEW trigger (the real code
--    path) flips the mismarked applications. Announcement triggers on
--    applications are muted during backfill only, so stale bookings don't
--    fire "just passed their exam" blasts; explicit receipts are written instead.
-- 4) v_licensed_booking_mismatch: invariant view — any row = the leak reopened.

-- ---------------------------------------------------------------- 1) trigger
create or replace function public.fn_auto_license_from_licensed_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prev text;
begin
  if new.call_track = 'licensed'
     and coalesce(new.event_type_name, '') not ilike '%unlicensed%'
     and new.application_id is not null
     and new.canceled_at is null
  then
    begin
      select license_status::text into v_prev
        from public.applications where id = new.application_id;

      if found and v_prev is distinct from 'licensed' then
        update public.applications
           set license_status = 'licensed',
               licensed_at    = coalesce(licensed_at, now())
         where id = new.application_id
           and license_status is distinct from 'licensed';

        insert into public.next_step_events
          (application_id, event_type, source, payload)
        values
          (new.application_id,
           'auto_licensed_from_booking',
           'calendly',
           jsonb_build_object(
             'interview_event_id',      new.id,
             'event_type_name',         new.event_type_name,
             'booking_scheduled_at',    new.scheduled_at,
             'previous_license_status', v_prev,
             'note', 'Booked the Licensed Call calendar link — auto-marked licensed'));
      end if;
    exception when others then
      -- A licensing side-effect failure must never lose the booking store.
      -- v_licensed_booking_mismatch below catches anything swallowed here.
      raise warning 'fn_auto_license_from_licensed_booking failed for interview_event %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_license_from_licensed_booking on public.interview_events;
create trigger trg_auto_license_from_licensed_booking
after insert or update of application_id, call_track, canceled_at
on public.interview_events
for each row execute function public.fn_auto_license_from_licensed_booking();

-- ------------------------------------------- 2) reclassify substring-bug rows
update public.interview_events
   set call_track = 'leader'
 where call_track = 'licensed'
   and event_type_name ilike '%unlicensed%';

-- ---------------------------------------------------------------- 3) backfill
alter table public.applications disable trigger trg_notify_hire_announcement;
alter table public.applications disable trigger trg_bot_alert_newly_licensed;

update public.interview_events ie
   set call_track = 'licensed'   -- no-op value change; fires the new trigger
 where ie.call_track = 'licensed'
   and ie.canceled_at is null
   and ie.application_id is not null
   and coalesce(ie.event_type_name, '') not ilike '%unlicensed%'
   and exists (select 1 from public.applications a
                where a.id = ie.application_id
                  and a.license_status is distinct from 'licensed');

alter table public.applications enable trigger trg_notify_hire_announcement;
alter table public.applications enable trigger trg_bot_alert_newly_licensed;

-- Receipt for Sam's alert inbox: one summary row, not seven blasts.
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

-- ---------------------------------------------------- 4) invariant watch view
create or replace view public.v_licensed_booking_mismatch as
select ie.id            as interview_event_id,
       ie.invitee_name,
       ie.event_type_name,
       ie.scheduled_at,
       ie.application_id,
       a.first_name, a.last_name,
       a.license_status::text as license_status
  from public.interview_events ie
  join public.applications a on a.id = ie.application_id
 where ie.call_track = 'licensed'
   and coalesce(ie.event_type_name, '') not ilike '%unlicensed%'
   and ie.canceled_at is null
   and a.license_status is distinct from 'licensed';

comment on view public.v_licensed_booking_mismatch is
  'Invariant: must be empty. Any row = a Licensed Call booking whose matched application is not licensed — the leak fixed on 2026-08-01 has reopened.';
