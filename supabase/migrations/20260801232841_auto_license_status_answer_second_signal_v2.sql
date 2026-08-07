-- Mirror of a migration applied to xrzweoneiieddzxogewk before repo-based
-- deploys were reliable (recovered verbatim from schema_migrations 2026-08-07).
-- Already applied live; every statement is idempotent. Present so db push stops
-- erroring "Remote migration versions not found in local migrations directory".

-- Second signal for auto-licensing (Sam: "do all 3", 2026-08-01): the booking
-- form's Status answer ("Just Licensed", "Licensed Leader with a team") now
-- also flips license_status, independent of call_track. One shared predicate
-- so the trigger and the invariant view cannot drift.

create or replace function public.fn_status_answer_indicates_licensed(p_status text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, '') ilike '%licensed%'
     and p_status not ilike '%unlicensed%'
     and p_status not ilike '%not licensed%'
     and p_status not ilike '%getting licensed%'
     and p_status not ilike '%pre-licens%'
$$;

create or replace function public.fn_auto_license_from_licensed_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prev text;
  v_signal text;
begin
  if new.application_id is not null
     and new.canceled_at is null
     and (
       (new.call_track = 'licensed'
        and coalesce(new.event_type_name, '') not ilike '%unlicensed%')
       or public.fn_status_answer_indicates_licensed(new.invitee_status)
     )
  then
    v_signal := case
      when new.call_track = 'licensed'
           and coalesce(new.event_type_name, '') not ilike '%unlicensed%'
        then 'licensed_calendar_link'
      else 'status_answer'
    end;
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
             'signal',                  v_signal,
             'invitee_status',          new.invitee_status,
             'note', 'Booked as licensed (' || v_signal || ') — auto-marked licensed'));
      end if;
    exception when others then
      raise warning 'fn_auto_license_from_licensed_booking failed for interview_event %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_license_from_licensed_booking on public.interview_events;
create trigger trg_auto_license_from_licensed_booking
after insert or update of application_id, call_track, canceled_at, invitee_status
on public.interview_events
for each row execute function public.fn_auto_license_from_licensed_booking();

drop view if exists public.v_licensed_booking_mismatch;
create view public.v_licensed_booking_mismatch as
select ie.id            as interview_event_id,
       ie.invitee_name,
       ie.event_type_name,
       ie.invitee_status,
       ie.scheduled_at,
       ie.application_id,
       a.first_name, a.last_name,
       a.license_status::text as license_status
  from public.interview_events ie
  join public.applications a on a.id = ie.application_id
 where ie.canceled_at is null
   and (
     (ie.call_track = 'licensed'
      and coalesce(ie.event_type_name, '') not ilike '%unlicensed%')
     or public.fn_status_answer_indicates_licensed(ie.invitee_status)
   )
   and a.license_status is distinct from 'licensed';

comment on view public.v_licensed_booking_mismatch is
  'Invariant: must be empty. Any row = a booking with a licensed signal (Licensed Call link OR licensed Status answer) whose matched application is not licensed. Doctor check 12c watches this.';

alter table public.applications disable trigger trg_notify_hire_announcement;
alter table public.applications disable trigger trg_bot_alert_newly_licensed;

update public.interview_events ie
   set invitee_status = invitee_status
 where public.fn_status_answer_indicates_licensed(ie.invitee_status)
   and ie.canceled_at is null
   and ie.application_id is not null
   and exists (select 1 from public.applications a
                where a.id = ie.application_id
                  and a.license_status is distinct from 'licensed');

alter table public.applications enable trigger trg_notify_hire_announcement;
alter table public.applications enable trigger trg_bot_alert_newly_licensed;
