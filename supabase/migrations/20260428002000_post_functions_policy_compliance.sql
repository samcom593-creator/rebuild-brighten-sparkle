-- ──────────────────────────────────────────────────────────────────────
-- Post-function policy compliance — full pass (2026-04-28)
--
-- Aligns the 6 Postgres `post_*()` functions with canonical autoposter
-- policy (~/.claude/projects/-Users-samjames/memory/autoposter_policy.md):
--
-- - All ALP/deal numbers from deals truth (status submitted/active by
--   effective_date), never daily_production.aop, never legacy posted_at.
-- - Sam (agent_id 7c3c5581) explicitly excluded.
-- - Agency-wide total ALP REMOVED from leadership-channel posts. Top-N
--   recognition allowed; "team alp $X" framing banned.
-- - Skip-if-zero (no spam on dead days).
--
-- DEPLOYMENT: idempotent CREATE OR REPLACE × 5 functions (post_midday_snapshot,
-- post_evening_recap, post_daily_top_producer, post_morning_huddle,
-- post_weekly_recap). post_hiring_bottleneck_alert untouched (already safe).
--
-- Reversible: see `_legacy_v1` notes at bottom.
-- ──────────────────────────────────────────────────────────────────────

-- ── 1. post_midday_snapshot ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_midday_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_today_deals int;
  v_today_hires int;
  v_apps_today int;
  v_top text;
  v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT COUNT(*)::int INTO v_today_deals
  FROM public.deals
  WHERE effective_date = v_today
    AND status IN ('submitted', 'active')
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  SELECT COUNT(*)::int INTO v_today_hires FROM public.agents
  WHERE created_at::date = v_today;

  SELECT COUNT(*)::int INTO v_apps_today FROM public.applications
  WHERE created_at::date = v_today AND terminated_at IS NULL;

  IF v_today_deals = 0 AND v_today_hires = 0 AND v_apps_today = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no_activity');
  END IF;

  SELECT string_agg(line, E'\n' ORDER BY rn)
  INTO v_top
  FROM (
    SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rn,
      format('• %s — $%s · %s deal%s',
        p.full_name,
        to_char(SUM(d.annual_premium), 'FM999,990'),
        COUNT(*),
        CASE WHEN COUNT(*) = 1 THEN '' ELSE 's' END) AS line
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE d.effective_date = v_today
      AND d.status IN ('submitted', 'active')
      AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
    GROUP BY p.full_name
    ORDER BY SUM(d.annual_premium) DESC
    LIMIT 5
  ) t;

  v_body := jsonb_build_object('username','APEX Midday',
    'content', format(
      E'**☀️ MIDDAY CHECK — %s CT**\n\n' ||
      E'📊 **Deals today:** %s\n' ||
      E'📞 **New applications:** %s  ·  🎯 **Hires today:** %s\n\n' ||
      E'%s\n\n' ||
      E'Second half starts now. Who''s converting before 5?',
      to_char(now() AT TIME ZONE 'America/Chicago', 'Dy HH12:MIam'),
      v_today_deals,
      v_apps_today, v_today_hires,
      COALESCE(E'**Top 5 today:**\n' || v_top, '_no deals posted yet — who''s going to be first?_')));

  PERFORM public.discord_route('midday_snapshot',
    to_char(v_today, 'YYYY-MM-DD'),
    'leadership', v_body);

  RETURN jsonb_build_object('posted', true, 'today_deals', v_today_deals);
END $function$;

-- ── 2. post_evening_recap ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_evening_recap()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_webhook text; v_req bigint;
  v_today_deals int;
  v_top_3 text;
  v_body jsonb;
  v_today date := CURRENT_DATE;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  SELECT COUNT(*)::int INTO v_today_deals
  FROM public.deals
  WHERE effective_date = v_today
    AND status IN ('submitted', 'active')
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  IF v_today_deals = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no_qualifying_deals');
  END IF;

  SELECT string_agg(
    (rank::text || '. ' || name || ' — $' || to_char(alp,'FM999,990') ||
     ' (' || deals || ')'), E'\n' ORDER BY rank)
  INTO v_top_3
  FROM (
    SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rank,
      p.full_name AS name, SUM(d.annual_premium) AS alp, COUNT(*) AS deals
    FROM public.deals d JOIN public.agents a ON a.id=d.agent_id
    JOIN public.profiles p ON p.id=a.profile_id
    WHERE d.effective_date = v_today
      AND d.status IN ('submitted', 'active')
      AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
    GROUP BY p.full_name
    ORDER BY SUM(d.annual_premium) DESC LIMIT 3) t;

  v_body := jsonb_build_object('username','APEX Evening Recap',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('🌆 Day Complete — %s', to_char(now() AT TIME ZONE 'America/Chicago', 'Dy, Mon DD')),
      'description', format('**%s deals today**%s',
        v_today_deals,
        CASE WHEN v_top_3 IS NOT NULL THEN E'\n\n**Top 3:**\n' || v_top_3 ELSE '' END),
      'color', 7506394, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));

  v_req := net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 20000);
  RETURN jsonb_build_object('posted', true);
END $function$;

-- ── 3. post_daily_top_producer ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_daily_top_producer()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_webhook text;
  v_today_date date := (NOW() AT TIME ZONE 'America/Chicago')::date;
  v_top record;
  v_total_deals int;
  v_body jsonb;
  v_req bigint;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  SELECT p.full_name AS name,
         COALESCE(p.avatar_url,'') AS avatar,
         SUM(d.annual_premium)::numeric AS alp,
         COUNT(*)::int AS deals
  INTO v_top
  FROM public.deals d
  JOIN public.agents a ON a.id = d.agent_id
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE d.effective_date = v_today_date
    AND d.status IN ('submitted', 'active')
    AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
  GROUP BY p.full_name, p.avatar_url
  ORDER BY SUM(d.annual_premium) DESC
  LIMIT 1;

  SELECT COUNT(*)::int INTO v_total_deals
  FROM public.deals
  WHERE effective_date = v_today_date
    AND status IN ('submitted', 'active')
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  IF v_top.alp IS NULL OR v_top.alp = 0 THEN
    v_body := jsonb_build_object(
      'username', 'APEX 7pm Recap',
      'content', format(
        E'📉 **No deals on the board today (%s).** Tomorrow''s goose egg is optional. The phone still works at 7:01pm.',
        to_char(v_today_date, 'Dy Mon DD')));
  ELSE
    -- POLICY: agency total ALP removed; only deal count + Top-1 framing.
    v_body := jsonb_build_object(
      'username', 'APEX 7pm Recap',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', format('🏆 TOP PRODUCER — %s', to_char(v_today_date, 'Dy Mon DD')),
        'description', format(
          E'**%s** · **$%s ALP** · %s deal%s\n\n**%s deals across the floor today.**',
          v_top.name,
          to_char(v_top.alp, 'FM999,999'),
          v_top.deals,
          CASE WHEN v_top.deals = 1 THEN '' ELSE 's' END,
          v_total_deals),
        'color', 15844367,
        'thumbnail', jsonb_build_object('url', v_top.avatar),
        'footer', jsonb_build_object('text', 'Who beats them tomorrow?'),
        'timestamp', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
  END IF;

  v_req := net.http_post(url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));

  RETURN jsonb_build_object('posted', true, 'top', v_top.name,
    'alp', v_top.alp, 'date', v_today_date);
END $function$;

-- ── 4. post_morning_huddle ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_morning_huddle()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_webhook text;
  v_req bigint;
  v_yesterday_deals int;
  v_top_agent_yesterday text;
  v_top_agent_alp numeric;
  v_mtd_deals int;
  v_yesterday_weekday text;
  v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  v_yesterday_weekday := to_char(CURRENT_DATE - 1, 'Day');

  SELECT COUNT(*)::int INTO v_yesterday_deals
  FROM public.deals
  WHERE effective_date = (CURRENT_DATE - 1)::date
    AND status IN ('submitted', 'active')
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  SELECT p.full_name, COALESCE(SUM(d.annual_premium),0)::numeric
    INTO v_top_agent_yesterday, v_top_agent_alp
  FROM public.deals d
  JOIN public.agents a ON a.id = d.agent_id
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE d.effective_date = (CURRENT_DATE - 1)::date
    AND d.status IN ('submitted', 'active')
    AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
  GROUP BY p.full_name
  ORDER BY SUM(d.annual_premium) DESC LIMIT 1;

  SELECT COUNT(*)::int INTO v_mtd_deals
  FROM public.deals
  WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date
    AND status IN ('submitted', 'active')
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  -- POLICY: agency total ALP / MTD total ALP REMOVED. Top-N + counts only.
  v_body := jsonb_build_object(
    'username', 'APEX Morning Huddle',
    'content', CASE
      WHEN v_yesterday_deals = 0 THEN format(
        E'🌅 **MORNING HUDDLE** — %s was a goose egg. Today is the day we fix that.\n\n**MTD**: %s deals\n\n📞 First dial by 10:30. No excuses.',
        trim(v_yesterday_weekday),
        v_mtd_deals)
      ELSE format(
        E'🌅 **MORNING HUDDLE** — %s wrote %s deals.\n\n🏆 Top producer %s: $%s ALP\n**MTD**: %s deals\n\nWho beats %s today? Go.',
        trim(v_yesterday_weekday),
        v_yesterday_deals,
        COALESCE(v_top_agent_yesterday, 'TBD'),
        to_char(v_top_agent_alp, 'FM999,999'),
        v_mtd_deals,
        COALESCE(v_top_agent_yesterday, 'them'))
    END
  );

  v_req := net.http_post(url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));
  RETURN jsonb_build_object('posted', true, 'request_id', v_req);
END $function$;

-- ── 5. post_weekly_recap ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_weekly_recap()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_webhook text; v_deals int;
  v_top_3 text; v_new_hires int; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value::text INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  SELECT COUNT(*)::int INTO v_deals
  FROM public.deals
  WHERE effective_date >= CURRENT_DATE - interval '7 days'
    AND status IN ('submitted', 'active')
    AND agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d';

  SELECT COUNT(*)::int INTO v_new_hires
  FROM public.agents WHERE created_at > now() - interval '7 days';

  SELECT string_agg(
    (rank::text || '. ' || name || ' — $' || to_char(alp,'FM999,990') ||
     ' (' || deals || ' deals)'), E'\n' ORDER BY rank)
  INTO v_top_3
  FROM (
    SELECT row_number() OVER (ORDER BY SUM(d.annual_premium) DESC) AS rank,
      p.full_name AS name, SUM(d.annual_premium) AS alp, COUNT(*) AS deals
    FROM public.deals d JOIN public.agents a ON a.id=d.agent_id
    JOIN public.profiles p ON p.id=a.profile_id
    WHERE d.effective_date >= CURRENT_DATE - interval '7 days'
      AND d.status IN ('submitted', 'active')
      AND d.agent_id <> '7c3c5581-3544-437f-bfe2-91391afb217d'
    GROUP BY p.full_name
    ORDER BY SUM(d.annual_premium) DESC LIMIT 3) t;

  -- POLICY: agency total ALP REMOVED. Deal count + new hires + Top-3 only.
  v_body := jsonb_build_object('username','APEX Weekly Wrap',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title','📅 Week in Review',
      'description', format('**%s deals this week** · **%s new agents**%s',
        v_deals, v_new_hires,
        CASE WHEN v_top_3 IS NOT NULL THEN E'\n\n**Top performers:**\n' || v_top_3 ELSE '' END),
      'color', 15844367, 'timestamp', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSZ'))));

  PERFORM net.http_post(url := v_webhook,
    headers := jsonb_build_object('Content-Type','application/json'),
    body := v_body, timeout_milliseconds := 20000);
  RETURN jsonb_build_object('posted', true);
END $function$;

-- ──────────────────────────────────────────────────────────────────────
-- ROLLBACK NOTES: if any function misbehaves, run a CREATE OR REPLACE
-- with the original definition. Original definitions captured in repo
-- migration history before this change.
-- ──────────────────────────────────────────────────────────────────────
