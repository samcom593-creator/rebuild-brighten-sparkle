-- MP-264 — replace guessed availability blocks with evidence-derived ones
-- 2026-07-24
--
-- The first seed invented gym and lunch windows. Inventing Sam's schedule and
-- then enforcing it against his live booking link is exactly the kind of
-- confident-but-fabricated behaviour this codebase already has scar tissue
-- about, so it is replaced here with blocks derived from what 162 real
-- bookings actually show.
--
-- MEASURED over every captured booking (America/Chicago):
--   By hour   9am:9  10:9  11:18  12:12  1pm:15  2pm:14  3pm:9  4pm:12
--             5pm:16  6pm:7  7pm:14  8pm:15  9pm:7  10pm:3  11pm:2
--   By day    Sun 2 · Mon 22 · Tue 27 · Wed 39 · Thu 27 · Fri 25 · Sat 20
--
--   Only 5 of 162 bookings (3%) ran past 10pm. Sunday is effectively unused.
--   Wednesday carries a 26% cancellation rate (10 of 39) — the worst day by a
--   wide margin and worth Sam's attention on its own.
--
-- Meanwhile Calendly is currently OFFERING 290 slots over 6 days: 9:00am to
-- 11:30pm, seven days a week. That gap between 15 bookable hours a day and a
-- real 9-to-10 working window is why the calendar filled faster than it could
-- be worked.

-- Clear the invented seed. Only the seeded rows (no owner) are removed —
-- anything Sam or a manager adds later carries an owner_user_id and survives.
delete from public.availability_blocks
 where owner_user_id is null
   and kind in ('gym', 'lunch', 'sleep');

insert into public.availability_blocks (kind, label, weekday, start_time, end_time, is_hard_block)
values
  -- Sleep / off-hours: 10:30pm -> 9:00am, every day. Crosses midnight, which
  -- interview_conflicts() handles explicitly.
  ('sleep','Off hours (10:30pm-9am)', 0, time '22:30', time '09:00', true),
  ('sleep','Off hours (10:30pm-9am)', 1, time '22:30', time '09:00', true),
  ('sleep','Off hours (10:30pm-9am)', 2, time '22:30', time '09:00', true),
  ('sleep','Off hours (10:30pm-9am)', 3, time '22:30', time '09:00', true),
  ('sleep','Off hours (10:30pm-9am)', 4, time '22:30', time '09:00', true),
  ('sleep','Off hours (10:30pm-9am)', 5, time '22:30', time '09:00', true),
  ('sleep','Off hours (10:30pm-9am)', 6, time '22:30', time '09:00', true),
  -- Sunday: 2 bookings out of 162. Soft, not hard — flagged, still allowed,
  -- because this is an observed pattern rather than a stated rule.
  ('personal','Sunday (rarely booked)', 0, time '09:00', time '22:30', false);

comment on table public.availability_blocks is
  'MP-264: hours Sam is not bookable. Seeded rows are EVIDENCE-DERIVED from 162 '
  'captured bookings, not assumed. Recurring rows use America/Chicago wall-clock.';
