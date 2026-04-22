-- ============================================================
-- Discord v3 — 8 event types, Instagram tags, cron schedule
-- ============================================================

-- ─── 1. Leaderboard RPCs ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_daily_leaderboard(p_date date)
RETURNS TABLE(full_name text, instagram_handle text, aop numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.full_name,
    p.instagram_handle,
    COALESCE(SUM(dp.aop), 0)::numeric AS aop
  FROM agents a
  JOIN profiles p ON p.id = a.profile_id
  LEFT JOIN daily_production dp
    ON dp.agent_id = a.id AND dp.production_date = p_date
  WHERE COALESCE(a.is_deactivated, false) = false
    AND COALESCE(a.is_inactive, false)    = false
  GROUP BY p.full_name, p.instagram_handle
  HAVING COALESCE(SUM(dp.aop), 0) > 0
  ORDER BY aop DESC
  LIMIT 10;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_leaderboard(p_start date, p_end date)
RETURNS TABLE(full_name text, instagram_handle text, weekly_aop numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.full_name,
    p.instagram_handle,
    COALESCE(SUM(dp.aop), 0)::numeric AS weekly_aop
  FROM agents a
  JOIN profiles p ON p.id = a.profile_id
  LEFT JOIN daily_production dp
    ON dp.agent_id = a.id
   AND dp.production_date BETWEEN p_start AND p_end
  WHERE COALESCE(a.is_deactivated, false) = false
    AND COALESCE(a.is_inactive, false)    = false
  GROUP BY p.full_name, p.instagram_handle
  HAVING COALESCE(SUM(dp.aop), 0) > 0
  ORDER BY weekly_aop DESC
  LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_leaderboard(date)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(date, date) TO authenticated, service_role;

-- ─── 2. New Application Trigger (no PII, Instagram included) ─────────────────

CREATE OR REPLACE FUNCTION public.trg_fn_application_discord()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.run_automation_job(
    'new-application-discord',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'new_application',
      'details', jsonb_build_object(
        'first_name', NEW.first_name,
        'last_name',  NEW.last_name,
        'state',      COALESCE(NEW.state, ''),
        'instagram',  NEW.instagram_handle
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_discord ON public.applications;
CREATE TRIGGER trg_application_discord
  AFTER INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_application_discord();

-- ─── 3. Agent Activated Trigger ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_fn_agent_activated_discord()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_agent_name   text;
  v_instagram    text;
  v_manager_name text;
  v_referred_by  text;
BEGIN
  -- Only fire on initial activation (contracted_at going from NULL → value)
  IF OLD.contracted_at IS NOT NULL OR NEW.contracted_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name, p.instagram_handle
  INTO v_agent_name, v_instagram
  FROM profiles p WHERE p.id = NEW.profile_id;

  IF NEW.manager_id IS NOT NULL THEN
    SELECT COALESCE(p.full_name, 'Sam')
    INTO v_manager_name
    FROM agents a
    JOIN profiles p ON p.id = a.profile_id
    WHERE a.id = NEW.manager_id;
  END IF;

  IF NEW.invited_by_manager_id IS NOT NULL THEN
    SELECT COALESCE(p.full_name, '')
    INTO v_referred_by
    FROM agents a
    JOIN profiles p ON p.id = a.profile_id
    WHERE a.id = NEW.invited_by_manager_id;
  END IF;

  PERFORM public.run_automation_job(
    'agent-activated-discord',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'agent_activated',
      'details', jsonb_build_object(
        'agent_name',  COALESCE(v_agent_name, 'New Agent'),
        'hired_by',    COALESCE(v_manager_name, 'Sam'),
        'referred_by', v_referred_by,
        'start_date',  TO_CHAR(COALESCE(NEW.start_date, CURRENT_DATE), 'Mon DD, YYYY'),
        'instagram',   v_instagram
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_activated_discord ON public.agents;
CREATE TRIGGER trg_agent_activated_discord
  AFTER UPDATE OF contracted_at ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_agent_activated_discord();

-- ─── 4. Deal Closed Trigger (with Instagram + milestone data) ─────────────────

CREATE OR REPLACE FUNCTION public.trg_fn_deal_closed_discord()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_agent_name text;
  v_instagram  text;
  v_carrier    text;
BEGIN
  -- Resolve agent name + instagram
  SELECT p.full_name, p.instagram_handle
  INTO v_agent_name, v_instagram
  FROM agents a
  JOIN profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  -- Resolve carrier name (if carriers table exists)
  BEGIN
    SELECT name INTO v_carrier FROM carriers WHERE id = NEW.carrier_id;
  EXCEPTION WHEN undefined_table THEN
    v_carrier := '';
  END;

  PERFORM public.run_automation_job(
    'deal-closed-discord',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'deal_closed',
      'details', jsonb_build_object(
        'agent_name',   COALESCE(v_agent_name, 'Agent'),
        'agent_id',     NEW.agent_id,
        'aop',          COALESCE(NEW.annual_premium, 0),
        'product_type', COALESCE(NEW.product_sold, ''),
        'carrier',      COALESCE(v_carrier, ''),
        'instagram',    v_instagram
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_closed_discord ON public.deals;
CREATE TRIGGER trg_deal_closed_discord
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_deal_closed_discord();

-- ─── 5. Seven-Day Streak Checker (runs nightly, fires Discord on exactly day 7) ─

CREATE OR REPLACE FUNCTION public.trg_fn_streak_7day_discord()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_streak     integer;
  v_agent_name text;
  v_instagram  text;
BEGIN
  -- Count consecutive days ending today for this agent
  SELECT COUNT(*) INTO v_streak
  FROM (
    SELECT gs::date AS d
    FROM generate_series(
      CURRENT_DATE - INTERVAL '6 days',
      CURRENT_DATE,
      INTERVAL '1 day'
    ) gs
    WHERE EXISTS (
      SELECT 1 FROM public.daily_production dp
      WHERE dp.agent_id = NEW.agent_id
        AND dp.production_date = gs::date
        AND dp.aop > 0
    )
  ) consecutive;

  -- Fire exactly when streak reaches 7 (not 6 or 8)
  IF v_streak <> 7 THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name, p.instagram_handle
  INTO v_agent_name, v_instagram
  FROM agents a
  JOIN profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  PERFORM public.run_automation_job(
    'streak-7day-discord',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'streak_7day',
      'details', jsonb_build_object(
        'agent_name',   COALESCE(v_agent_name, 'Agent'),
        'streak_days',  7,
        'instagram',    v_instagram
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_streak_7day_discord ON public.daily_production;
CREATE TRIGGER trg_streak_7day_discord
  AFTER INSERT OR UPDATE ON public.daily_production
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_streak_7day_discord();

-- ─── 6. pg_cron Jobs — 9pm EST = 02:00 UTC ──────────────────────────────────
-- Requires pg_cron extension (pre-installed on Supabase Pro)

DO $outer$
BEGIN
  -- Daily leaderboard — every night 9pm EST
  -- Outer uses $outer$ to avoid $$ nesting conflict with cron.schedule bodies.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'discord-daily-leaderboard') THEN PERFORM cron.unschedule('discord-daily-leaderboard'); END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'discord-weekly-leaderboard') THEN PERFORM cron.unschedule('discord-weekly-leaderboard'); END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'discord-pipeline-leaderboard') THEN PERFORM cron.unschedule('discord-pipeline-leaderboard'); END IF;

    PERFORM cron.schedule(
      'discord-daily-leaderboard',
      '0 2 * * *',   -- 02:00 UTC = 9pm EST every day
      $$SELECT public.run_automation_job('discord-daily-lb','discord-leaderboards','{"type":"daily"}'::jsonb)$$
    );

    -- Weekly leaderboard — Sundays 9pm EST (fires Mon 02:00 UTC)
    PERFORM cron.schedule(
      'discord-weekly-leaderboard',
      '0 2 * * 1',   -- Monday 02:00 UTC = Sunday 9pm EST
      $$SELECT public.run_automation_job('discord-weekly-lb','discord-leaderboards','{"type":"weekly"}'::jsonb)$$
    );

    -- Pipeline leaderboard — every night 9pm EST
    PERFORM cron.schedule(
      'discord-pipeline-leaderboard',
      '5 2 * * *',   -- 02:05 UTC to stagger after daily
      $$SELECT public.run_automation_job('discord-pipeline-lb','discord-leaderboards','{"type":"pipeline"}'::jsonb)$$
    );
  END IF;
END;
$outer$;

-- ─── 7. Remove old over-broad triggers from previous migrations ───────────────
DROP TRIGGER IF EXISTS trg_applications_new_applicant_discord  ON public.applications;
DROP TRIGGER IF EXISTS trg_applications_stage_change_discord   ON public.applications;
DROP TRIGGER IF EXISTS trg_deals_discord_notify                ON public.deals;

-- ─── 8. Notify function updated in system_settings (idempotent) ──────────────
INSERT INTO public.system_settings (key, value)
VALUES ('discord_webhook_url',
        'https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T')
ON CONFLICT (key) DO UPDATE SET value = excluded.value
WHERE public.system_settings.value = '' OR public.system_settings.value IS NULL;
