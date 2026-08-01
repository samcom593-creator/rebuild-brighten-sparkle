-- Applied to prod 2026-08-01 via MCP (two migrations:
-- auto_license_from_licensed_calendar_booking + auto_license_booking_event_type_allowed).
-- Sam directive: "anyone who's on my calendar link under licensed should
-- automatically be put as licensed in the pipeline."
--
-- Licensed prospects who booked the Licensed Call calendar were staying
-- 'unlicensed'/'pending' in applications: the Calendly webhook matched the
-- booking to the application but nothing ever flipped license_status. On top,
-- classifyEvent()'s substring bug ("unlicensed" contains "licensed") misfiled
-- 9 Unlicensed Prospect Call bookings as licensed-track (edge fns patched in
-- the same commit; those 9 rows reclassified to 'leader' here).
--
-- Ships: trigger auto-licensing matched licensed-track bookings + receipt rows
-- in next_step_events (new event_type 'auto_licensed_from_booking', new source
-- 'calendly' admitted to the CHECK constraints) + invariant view that must stay
-- empty. Backfill flipped 6 people (7 bookings) on 2026-08-01.

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

update public.interview_events
   set call_track = 'leader'
 where call_track = 'licensed'
   and event_type_name ilike '%unlicensed%';

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
