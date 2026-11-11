-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 9/9: schedule the two course-lane sweeps (the repo mirrors
-- production; DECISIONS: every applied change lives in supabase/migrations).
--
-- WHAT: pg_cron
--   pkg3-course-lane-exam-sweep    '17 * * * *'  fn_course_lane_exam_sweep(p_dry_run => false, p_limit => 25)
--   pkg3-hired-unlicensed-sweep    '47 * * * *'  fn_course_lane_hired_unlicensed_sweep(p_dry_run => false, p_limit => 50)
-- Hourly is enough: both senders work on whole elapsed days / a 14-day freshness window and hold a
-- step outside 08:00-21:00 recipient time until the next tick. cron.schedule upserts by job name
-- (pg_cron 1.6), so re-applying this file changes nothing.
--
-- ORDER (why this file can refuse): PKG3 sends only through next-step-dispatch. The dispatcher deployed
-- before PKG1 counts a Telegram queue row or a carrier-gateway SMS as "sent" and then never sends the
-- email (message_map F1/F2), and nothing re-checks suspensions at send time. PKG1's
-- fn_next_step_send_gate / fn_next_step_claim (20261112000120) and its redeployed next-step-dispatch
-- close both. So this file raises, and schedules nothing, unless PKG1's gate and claim exist. In a
-- normal push PKG1's versions (0100-0199) are applied before this one. The edge-function deploy cannot
-- be seen from SQL: live_apply_steps orders it (deploy PKG1's next-step-dispatch, boot-probe it, then
-- apply this file).
--
-- ROLLBACK: select cron.unschedule('pkg3-course-lane-exam-sweep');
--           select cron.unschedule('pkg3-hired-unlicensed-sweep');

do $mig$
begin
  -- by name, not signature: PKG1's gate gained a third argument (reserve) during its fix pass
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_next_step_send_gate')
     or not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_next_step_claim') then
    raise exception 'MP-ONBOARD-ANCHOR-PKG3: course-lane sweeps NOT scheduled: PKG1''s fn_next_step_send_gate / fn_next_step_claim (20261112000120) are missing. Apply PKG1 and deploy its next-step-dispatch first, then apply this file.';
  end if;

  perform cron.schedule(
    'pkg3-course-lane-exam-sweep',
    '17 * * * *',
    $cron$ select public.fn_course_lane_exam_sweep(p_dry_run => false, p_limit => 25); $cron$
  );
  perform cron.schedule(
    'pkg3-hired-unlicensed-sweep',
    '47 * * * *',
    $cron$ select public.fn_course_lane_hired_unlicensed_sweep(p_dry_run => false, p_limit => 50); $cron$
  );
end
$mig$;
