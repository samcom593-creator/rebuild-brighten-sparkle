-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) DATA 2/2: records for the 8 Xcel students that match nothing.
--
-- WHAT: fn_course_lane_create_xcel_roster_records (20261112000340) for the explicit list from the
-- 2026-11-11 dry run (first name, Xcel student row id, course state, progress):
--   Obi      e9611567  WI  100% (finished 10-25)
--   Jakara   6569717f  NC  100% (finished 11-03)
--   Analynn  96866828  AZ  100% (finished 11-06)
--   Clyde    16eada6c  AR   96%
--   Isaac    055c1c5a  WI    0% (enrolled 10-28)
--   Kaleb    a22b8de3  WI    0% (enrolled 11-10)
--   Leslie   2d82c144  WI    0% (enrolled 11-10)
--   Michael  64e8d6a6  WI    0% (enrolled 11-10)
-- Each gets an applications row (source xcel_roster, excluded from funnel counts), the recruit-roster
-- owner (falls back to Sam while no roster member can sign in), silent course stamps, a next-step row
-- and one owner inbox task. Any id of the identity's report rows selects it, so a newer daily report
-- does not break the list; a student who matched a record in the meantime is skipped, not duplicated.
-- SENDS: none from this migration (the insert runs with session_replication_role = replica; inbox
-- tasks are in-app). Isaac and Clyde entered their stage from history, so their remaining
-- started_prelicense check-ins are pre-suppressed; Kaleb, Leslie and Michael enrolled after the cutoff
-- instant and keep the normal day 3/7/14/21 check-ins from the shared ladder. Obi, Jakara and Analynn
-- get nothing automatic: they are the one-time catch-up's (fn_catchup_course_finishers).
-- GUARD: p_max 12.
-- ROLLBACK: see 20261112000340 (delete the rows tagged 'pkg3' with source 'xcel_roster', unlink the
--           Xcel rows whose match_method = 'roster_record').

do $$
declare
  v_res jsonb;
begin
  v_res := public.fn_course_lane_create_xcel_roster_records(
    false,
    array['e9611567-20ed-4b48-b43b-fe8d55961676',
          '6569717f-48ed-4454-ba2d-804cf838c62a',
          '96866828-ed1a-49df-b637-38ba61d54d19',
          '16eada6c-ced9-43ab-b7a4-65b4a0a52c28',
          '055c1c5a-a15e-4d7d-8404-85b5ef41c0bd',
          'a22b8de3-b43f-40f8-9fd2-747935f87c79',
          '2d82c144-8d3e-45e9-beee-ceed7f993826',
          '64e8d6a6-3533-4470-957d-b9c7bac0a2ea']::uuid[],
    12);
  raise notice 'MP-ONBOARD-ANCHOR-PKG3 Xcel roster records: %', v_res;
end $$;
