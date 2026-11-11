-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) DATA 1/2: void the WP1 placeholders that were never history.
--
-- WHAT: fn_course_lane_clear_wrong_xcel_suppressions (20261112000300) lists WP1 'suppressed:'
-- placeholder rows whose milestone happened after the Xcel cutoff instant, then voids their dedupe key
-- (the row stays; failed_at stays set, so nothing ever sends from it; the old key is kept in
-- metadata.voided_dedupe_key).
-- Dry run on 2026-11-11 against production: exactly 3 rows, all Cooper (application 307a0955):
--   b0f5ce4e finished_prelicense:hour24, b633c895 finished_prelicense:hour48,
--   c2ac67c8 finished_prelicense:hour72  (completion 11-10, first in the 11-11 report).
-- Troy, Joseph and Alusine also hold WP1 placeholders; their milestones are weeks before the cutoff,
-- so theirs stay.
-- EFFECT ON SENDS: none by itself. finished_prelicense no longer has a stage cadence
-- (20261112000320); Cooper's exam message comes from fn_course_lane_exam_sweep (key <id>:exam_push).
-- GUARD: refuses (raises) if more than 10 rows match, so a changed world cannot turn this into a sweep.
-- ROLLBACK: update public.next_step_messages set dedupe_key = metadata->>'voided_dedupe_key'
--           where metadata->>'voided_by' = 'pkg3_cutoff_instant';

do $$
declare
  v_res jsonb;
begin
  v_res := public.fn_course_lane_clear_wrong_xcel_suppressions(false, 10);
  raise notice 'MP-ONBOARD-ANCHOR-PKG3 wrong Xcel placeholders: %', v_res;
end $$;
