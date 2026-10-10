-- A new kind of attendance row: a scheduled WORKDAY (2026-10-09).
-- Kept in its own migration because a new enum value cannot be used in the transaction that adds it. The tracker
-- migration that follows (20261009200000) reads and writes it from function bodies.
alter type public.attendance_type add value if not exists 'workday';
