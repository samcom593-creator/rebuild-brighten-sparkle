-- Nightly: nudge agents whose XCEL course is complete >48h but no contracting yet
CREATE OR REPLACE FUNCTION public.nudge_xcel_completions_to_contract()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE v_count int := 0; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  WITH stale AS (
    SELECT e.student_name, e.student_email, e.state_line, e.event_at
    FROM public.xcel_events e
    WHERE e.kind = 'completion'
      AND e.event_at < now() - interval '48 hours'
      AND e.event_at > now() - interval '14 days'
      -- only if applicant still in a non-contracting status
      AND EXISTS (
        SELECT 1 FROM public.applications app
        WHERE LOWER(app.email) = LOWER(e.student_email)
          AND app.status NOT IN ('contracting','rejected')))
  SELECT COUNT(*)::int INTO v_count FROM stale;

  IF v_count = 0 THEN RETURN jsonb_build_object('no_nudges', true); END IF;

  v_body := jsonb_build_object('username','APEX · Licensing Follow-up',
    'content', format(
      E'📚 **%s XCEL completions waiting to contract** (course done >48h, not yet in contracting)\n\n%s\n\nCall them. Close the loop.',
      v_count,
      (SELECT string_agg('• ' || t.student_name || ' — ' || t.state_line || ' — ' || t.student_email, E'\n')
       FROM (SELECT student_name, state_line, student_email FROM public.xcel_events e
             WHERE e.kind='completion' AND e.event_at < now() - interval '48 hours'
               AND e.event_at > now() - interval '14 days'
               AND EXISTS (SELECT 1 FROM public.applications app WHERE LOWER(app.email) = LOWER(e.student_email) AND app.status NOT IN ('contracting','rejected'))
             ORDER BY e.event_at DESC LIMIT 15) t)));

  PERFORM public.discord_route('xcel_stuck_completion',
    to_char(CURRENT_DATE,'YYYY-MM-DD'), 'hiring', v_body);
  RETURN jsonb_build_object('nudged', v_count);
END $fn$;
GRANT EXECUTE ON FUNCTION public.nudge_xcel_completions_to_contract() TO service_role, authenticated;

DO $outer$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='nudge-xcel-completions') THEN
    PERFORM cron.unschedule('nudge-xcel-completions'); END IF;
  PERFORM cron.schedule('nudge-xcel-completions', '0 14 * * 1-6',  -- 9 AM CST
    $j$ SELECT public.nudge_xcel_completions_to_contract(); $j$);
END $outer$;

SELECT 'xcel completion nudge cron scheduled' AS r;
