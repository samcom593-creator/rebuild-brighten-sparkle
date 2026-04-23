-- webhook_health_check — signal-based instead of hitting Discord directly
-- The prior version GET'd the Discord webhook URL through pg_net which
-- reliably timed out at the 6s poll budget. Discord accepts GET but its
-- response worker wasn't returning through pg_net in time for our
-- cron's 5-min interval.
-- Replacement: check public.discord_event_log for any successful route
-- in the last 4 hours. If we've posted recently, Discord is healthy.

CREATE OR REPLACE FUNCTION public.webhook_health_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_webhook text; v_last_post timestamptz; v_posts_24h int; v_job uuid;
BEGIN
  v_job := public.job_run_start('webhook_health_check');
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN
    PERFORM public.job_run_finish(v_job, 'error', NULL, 'discord_webhook_url not set');
    RETURN jsonb_build_object('discord','not_configured');
  END IF;

  SELECT MAX(posted_at), COUNT(*) FILTER (WHERE posted_at > now() - interval '24 hours')
    INTO v_last_post, v_posts_24h FROM public.discord_event_log WHERE http_status = 204;

  IF v_last_post IS NULL OR v_last_post < now() - interval '4 hours' THEN
    PERFORM public.job_run_finish(v_job, 'error', v_posts_24h,
      format('no successful Discord posts in last 4h (last: %s)', COALESCE(v_last_post::text,'never')));
    RETURN jsonb_build_object('discord','stale','last_post',v_last_post,'posts_24h',v_posts_24h);
  END IF;

  PERFORM public.job_run_finish(v_job, 'ok', v_posts_24h, NULL,
    jsonb_build_object('last_post', v_last_post, 'posts_24h', v_posts_24h));
  RETURN jsonb_build_object('discord','ok','last_post',v_last_post,'posts_24h',v_posts_24h);
EXCEPTION WHEN others THEN
  PERFORM public.job_run_finish(v_job, 'error', NULL, SQLERRM);
  RAISE;
END $fn$;
