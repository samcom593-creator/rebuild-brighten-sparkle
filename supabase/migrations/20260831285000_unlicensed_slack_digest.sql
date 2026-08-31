-- MP-347: the pre-licensed cohort gets its own Slack room and a daily digest.
--
-- Sam: "info is admin. For unlicensed, make them their own GC in Slack and
-- automate messages for that chat."
--
-- THE ROOM already existed — #general-unlicensed (C0BSUGBR62G) was registered
-- in messaging_destinations, disabled, and ARCHIVED in Slack. Enabled here;
-- slack-announce gained a one-shot unarchive/join repair in the same wave
-- because Slack answers HTTP 200 for is_archived and it is invisible to
-- status-code monitoring.
--
-- WHAT THE DIGEST SAYS, and why this shape. The pre-licensed pipeline is 618
-- people, and 557 of them (90%) have never moved past 'unlicensed'. A digest
-- that just prints that number every morning becomes wallpaper within a week —
-- the same permanently-red-guard failure this codebase keeps finding. So the
-- post leads with MOVEMENT (who advanced in the last day) and only then gives
-- the standing counts, and it says plainly when nothing moved instead of
-- dressing a flat day as progress.
--
-- It posts through slack-announce, which requires the bot token and refuses any
-- channel that is not registered AND enabled — so this cannot be pointed at an
-- arbitrary room by editing a cron argument.

begin;

create or replace function public.fn_unlicensed_slack_digest()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_moved integer;
  v_lines text := '';
  v_counts text := '';
  r record;
begin
  -- Movement first: stage changes recorded in the last 24h. applicant_stage_moves
  -- is written by set_applicant_stage (MP-343), so this reports real decisions a
  -- human made, not a derived guess.
  select count(*) into v_moved
  from public.applicant_stage_moves
  where moved_at >= now() - interval '24 hours';

  for r in
    select m.to_stage, count(*) as n
    from public.applicant_stage_moves m
    where m.moved_at >= now() - interval '24 hours'
    group by m.to_stage
    order by count(*) desc
    limit 6
  loop
    v_lines := v_lines || format('   • %s moved to *%s*%s', r.n, replace(r.to_stage, '_', ' '), chr(10));
  end loop;

  for r in
    select coalesce(a.license_progress::text, 'not started') as stage, count(*) as n
    from public.applications a
    where a.terminated_at is null
      and a.contracted_at is null
      and a.closed_at is null
      and coalesce(a.license_status::text, '') <> 'licensed'
    group by 1
    order by count(*) desc
  loop
    v_counts := v_counts || format('   • %s — %s%s', r.n, replace(r.stage, '_', ' '), chr(10));
  end loop;

  return format(
    '*Pre-licensing — %s*%s%s%s%sFull pipeline: https://apex-financial.org/dashboard/recruiting',
    to_char(v_today, 'Mon DD'),
    chr(10) || chr(10),
    case
      when v_moved = 0 then ':warning: *Nobody advanced a stage in the last 24 hours.*' || chr(10) || chr(10)
      else format(':chart_with_upwards_trend: *%s moved forward in the last 24 hours*%s%s%s',
                  v_moved, chr(10), v_lines, chr(10))
    end,
    '*Where everyone stands*' || chr(10) || v_counts,
    chr(10)
  );
end;
$function$;

comment on function public.fn_unlicensed_slack_digest() is
  'MP-347: body of the daily #general-unlicensed post. Leads with MOVEMENT in '
  'the last 24h and says so plainly when nothing moved — 90% of this cohort '
  'sits at ''unlicensed'', so a standing-count-only digest becomes wallpaper.';

-- 08:00 Phoenix = 15:00 UTC year-round (Arizona does not observe DST).
select cron.unschedule(jobid) from cron.job where jobname = 'apex-unlicensed-slack-digest';
select cron.schedule(
  'apex-unlicensed-slack-digest',
  '0 15 * * 1-5',
  $cron$
    select net.http_post(
      url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/slack-announce',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token' limit 1),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'channel', 'general-unlicensed',
        'text', public.fn_unlicensed_slack_digest()
      ),
      timeout_milliseconds := 30000
    );
  $cron$
);

commit;
