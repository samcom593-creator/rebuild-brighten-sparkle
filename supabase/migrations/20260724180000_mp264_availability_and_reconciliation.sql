-- MP-264 follow-on — Availability Protection + Capture Reconciliation
-- 2026-07-24
--
-- WHY:
--   (1) Sam's VAs book interviews into hours he cannot take. Detection after
--       the fact does not help — the booking already happened — so the queue
--       needs to flag conflicts the moment they land, and the availability
--       schedule needs to stop offering those slots at the source.
--   (2) The Calendly capture outage that lost 105 bookings was silent for
--       ~6 weeks. A webhook that stops firing looks identical to a quiet week.
--       Staleness has to be measurable, not inferred.

-- ---------------------------------------------------------------------------
-- 1. availability_blocks — the hours Sam is not bookable
-- ---------------------------------------------------------------------------
create table if not exists public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in
        ('travel','focus','meeting','gym','lunch','sleep','buffer','driving','personal')),
  label text,

  -- one-off window
  starts_at timestamptz,
  ends_at   timestamptz,

  -- OR a weekly recurring window, stored in America/Chicago wall-clock
  weekday   smallint check (weekday between 0 and 6),   -- 0 = Sunday
  start_time time,
  end_time   time,

  -- a hard block is never bookable; a soft block warns but allows
  is_hard_block boolean not null default true,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint availability_blocks_window_ck check (
    (starts_at is not null and ends_at is not null and ends_at > starts_at)
    or (weekday is not null and start_time is not null and end_time is not null)
  )
);

comment on table public.availability_blocks is
  'MP-264: hours Sam is not bookable. Recurring rows use America/Chicago '
  'wall-clock (weekday + start_time/end_time); one-off rows use starts_at/ends_at.';

create index if not exists availability_blocks_owner_idx on public.availability_blocks (owner_user_id) where active;
create index if not exists availability_blocks_window_idx on public.availability_blocks (starts_at, ends_at) where active;

alter table public.availability_blocks enable row level security;

drop policy if exists availability_blocks_staff on public.availability_blocks;
create policy availability_blocks_staff on public.availability_blocks
  for all to authenticated
  using (exists (select 1 from public.user_roles ur
                  where ur.user_id = auth.uid()
                    and ur.role::text in ('admin','manager','va_manager','va')))
  with check (exists (select 1 from public.user_roles ur
                  where ur.user_id = auth.uid()
                    and ur.role::text in ('admin','manager','va_manager')));

drop policy if exists availability_blocks_service on public.availability_blocks;
create policy availability_blocks_service on public.availability_blocks
  for all to service_role using (true) with check (true);

create or replace function public.tg_availability_blocks_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists availability_blocks_touch on public.availability_blocks;
create trigger availability_blocks_touch before update on public.availability_blocks
  for each row execute function public.tg_availability_blocks_touch();

-- Seed the blocks Sam actually keeps. All America/Chicago wall-clock.
-- Recruiting calls are 15 minutes, so buffers are deliberately tight.
insert into public.availability_blocks (kind, label, weekday, start_time, end_time, is_hard_block)
select * from (values
  ('sleep','Sleep',      0, time '23:30', time '07:30', true),
  ('sleep','Sleep',      1, time '23:30', time '07:30', true),
  ('sleep','Sleep',      2, time '23:30', time '07:30', true),
  ('sleep','Sleep',      3, time '23:30', time '07:30', true),
  ('sleep','Sleep',      4, time '23:30', time '07:30', true),
  ('sleep','Sleep',      5, time '23:30', time '07:30', true),
  ('sleep','Sleep',      6, time '23:30', time '07:30', true),
  ('gym','Gym',          1, time '06:00', time '07:30', false),
  ('gym','Gym',          3, time '06:00', time '07:30', false),
  ('gym','Gym',          5, time '06:00', time '07:30', false),
  ('lunch','Lunch',      1, time '12:00', time '12:45', false),
  ('lunch','Lunch',      2, time '12:00', time '12:45', false),
  ('lunch','Lunch',      3, time '12:00', time '12:45', false),
  ('lunch','Lunch',      4, time '12:00', time '12:45', false),
  ('lunch','Lunch',      5, time '12:00', time '12:45', false)
) as v(kind,label,weekday,start_time,end_time,is_hard_block)
where not exists (select 1 from public.availability_blocks);

-- ---------------------------------------------------------------------------
-- 2. Conflict detection — does a given instant fall inside a block?
--    Handles windows that cross midnight (sleep 23:30 -> 07:30).
-- ---------------------------------------------------------------------------
create or replace function public.interview_conflicts(p_at timestamptz)
returns table (block_id uuid, kind text, label text, is_hard_block boolean)
language sql stable security definer set search_path = public
as $$
  with chi as (
    select (p_at at time zone 'America/Chicago') as local_ts
  )
  -- one-off windows
  select b.id, b.kind, b.label, b.is_hard_block
    from public.availability_blocks b
   where b.active and b.starts_at is not null
     and p_at >= b.starts_at and p_at < b.ends_at
  union all
  -- recurring weekly windows, incl. those crossing midnight
  select b.id, b.kind, b.label, b.is_hard_block
    from public.availability_blocks b, chi
   where b.active and b.weekday is not null
     and (
       case
         when b.end_time > b.start_time then
           extract(dow from chi.local_ts)::int = b.weekday
           and chi.local_ts::time >= b.start_time
           and chi.local_ts::time <  b.end_time
         else -- crosses midnight: evening part on `weekday`, morning part on the next day
           (extract(dow from chi.local_ts)::int = b.weekday and chi.local_ts::time >= b.start_time)
           or (extract(dow from chi.local_ts)::int = (b.weekday + 1) % 7 and chi.local_ts::time < b.end_time)
       end
     );
$$;

grant execute on function public.interview_conflicts(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. v_interview_conflicts — every booking that landed in a blocked hour.
--    This is what proves the VAs are booking into unavailable time.
-- ---------------------------------------------------------------------------
create or replace view public.v_interview_conflicts as
select
  ie.id as interview_id,
  ie.scheduled_at,
  (ie.scheduled_at at time zone 'America/Chicago') as scheduled_at_chicago,
  ie.invitee_name,
  ie.invitee_phone,
  ie.call_track,
  ie.outcome,
  c.kind    as blocked_by,
  c.label   as block_label,
  c.is_hard_block
from public.interview_events ie
cross join lateral public.interview_conflicts(ie.scheduled_at) c
where ie.canceled_at is null;

comment on view public.v_interview_conflicts is
  'MP-264: bookings that landed inside an availability block. A hard-block row '
  'means a VA booked an hour Sam cannot take.';

-- ---------------------------------------------------------------------------
-- 4. Capture reconciliation health — makes a silent outage measurable.
--    The 105-booking loss went unnoticed for ~6 weeks because "no rows" and
--    "quiet week" look identical. Compare recent capture against the trailing
--    booking rate instead of against zero.
-- ---------------------------------------------------------------------------
create or replace view public.v_interview_capture_reconciliation as
with windows as (
  select
    count(*) filter (where created_at > now() - interval '24 hours')                   as captured_24h,
    count(*) filter (where created_at > now() - interval '7 days')                     as captured_7d,
    count(*) filter (where created_at > now() - interval '28 days')                    as captured_28d,
    max(created_at)                                                                     as last_capture_at
  from public.interview_events
  where source = 'calendly'
)
select
  w.captured_24h,
  w.captured_7d,
  w.captured_28d,
  w.last_capture_at,
  round(w.captured_28d / 28.0, 2)                                    as avg_per_day_28d,
  extract(epoch from (now() - w.last_capture_at)) / 3600.0           as hours_since_last_capture,
  -- Fire when we have an established booking rate and have gone materially
  -- longer than that rate without a capture. Two full days of silence against
  -- a >=1/day baseline is the signal the original outage never produced.
  (w.captured_28d >= 14 and (now() - w.last_capture_at) > interval '48 hours') as capture_stalled,
  (select count(*) from public.interview_events
    where outcome is null and canceled_at is null and scheduled_at < now())    as undispositioned_backlog,
  (select count(*) from public.v_interview_conflicts where is_hard_block
     and scheduled_at > now())                                                  as future_hard_conflicts
from windows w;

comment on view public.v_interview_capture_reconciliation is
  'MP-264 watchdog. capture_stalled=true means Calendly bookings stopped '
  'arriving while the trailing 28-day rate says they should still be. That is '
  'the exact condition that hid the 105-booking loss for six weeks.';
