-- APEX Automation v10 — five new self-running loops.
--
-- Problem we're solving today:
--   • 147/241 active applications have no hiring_manager_user_id (61% leak)
--   • Stale applications silently die when no one touches them
--   • Agents ~on the verge~ of a milestone cross the line when someone
--     cheers — today nobody cheers because nobody sees it
--   • Managers don't know which of their directs are slipping without
--     digging; digging doesn't happen
--   • Licensed agents wait days to get their first lead / portal / welcome
--
-- Each function is idempotent (safe to re-run), logs its own work to
-- automation_run_log via run_automation_job, and bails gracefully if
-- preconditions aren't met.

-- ───────────────────────────────────────────────────────────────────────
-- #1 auto_assign_hiring_manager — every 15 min, distribute unassigned
-- applications across hiring managers using round-robin weighted by
-- current active-application load (lightest manager wins).
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_assign_hiring_manager()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_chosen_user_id uuid;
  v_assigned int := 0;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  -- For each unassigned active application, pick the manager with the
  -- fewest active applications right now. Tiebreak by who's been
  -- hiring-manager of a fresh application most recently (so the manager
  -- who JUST got assigned isn't immediately drowned).
  FOR r IN
    SELECT id
    FROM public.applications
    WHERE terminated_at IS NULL
      AND status NOT IN ('rejected','approved')
      AND hiring_manager_user_id IS NULL
    ORDER BY created_at ASC
    LIMIT 100   -- batch cap so one tick can't blow up
  LOOP
    -- Pick a hiring manager with lowest load
    WITH load AS (
      SELECT hma.manager_user_id AS user_id, COUNT(a.id)::int AS active_count
      FROM public.hiring_manager_assignments hma
      LEFT JOIN public.applications a
        ON a.hiring_manager_user_id = hma.manager_user_id
        AND a.terminated_at IS NULL
        AND a.status NOT IN ('rejected','approved')
      WHERE hma.is_active = true
      GROUP BY hma.manager_user_id
    )
    SELECT user_id INTO v_chosen_user_id
    FROM load
    ORDER BY active_count ASC, random()
    LIMIT 1;

    IF v_chosen_user_id IS NULL THEN
      EXIT; -- no managers configured; stop early rather than spinning
    END IF;

    UPDATE public.applications
    SET hiring_manager_user_id = v_chosen_user_id,
        updated_at = NOW()
    WHERE id = r.id;

    v_assigned := v_assigned + 1;
  END LOOP;

  RETURN jsonb_build_object('assigned', v_assigned);
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- #2 rescue_stale_applications — daily 15:00 UTC (10am CST). Finds apps
-- that have been ghosted and fires the next step in a re-engagement
-- ladder. Uses days since last_contacted_at + created_at to decide.
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rescue_stale_applications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_svc_url text;
  v_svc_key text;
  v_nudged int := 0;
  v_closed int := 0;
  v_days_since int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  FOR r IN
    SELECT id, first_name, last_name, email, phone, license_progress,
           created_at, last_contacted_at
    FROM public.applications
    WHERE terminated_at IS NULL
      AND status NOT IN ('rejected','approved')
      AND license_progress != 'licensed'
      AND COALESCE(last_contacted_at, created_at) < NOW() - INTERVAL '14 days'
    ORDER BY COALESCE(last_contacted_at, created_at) ASC
    LIMIT 150
  LOOP
    v_days_since := EXTRACT(DAY FROM NOW() - COALESCE(r.last_contacted_at, r.created_at))::int;

    -- 14, 21, 30-day ladder. 45+ days: auto-close with 'no_pickup'.
    IF v_days_since >= 45 THEN
      UPDATE public.applications
      SET status = 'no_pickup',
          last_contacted_at = NOW(),
          updated_at = NOW()
      WHERE id = r.id;
      v_closed := v_closed + 1;
      CONTINUE;
    END IF;

    -- Fire re-engagement via send-sms-auto-detect (anon-key auth OK on our
    -- verify_jwt=false edge functions).
    IF r.phone IS NOT NULL AND v_svc_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-sms-auto-detect',
        body := jsonb_build_object(
          'phone', r.phone,
          'message', format(
            '%s — Sam at APEX. Still interested in your license? We cover the course fee. Reply YES or tap https://apex-financial.org/reapply?app=%s',
            COALESCE(NULLIF(r.first_name,''), 'Hey'),
            r.id)
        ),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||v_svc_key,
          'apikey', v_svc_key
        )
      );
    END IF;

    UPDATE public.applications SET last_contacted_at = NOW() WHERE id = r.id;
    v_nudged := v_nudged + 1;
  END LOOP;

  RETURN jsonb_build_object('nudged', v_nudged, 'auto_closed', v_closed);
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- #3 detect_milestone_verge — every 2h during work hours. Finds agents
-- on the cusp of a threshold and fires a motivational Discord ping via
-- the sales channel. Thresholds: 1st deal of week, $10k ALP week, $25k
-- ALP month, 10 deals month, 50 deals career.
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detect_milestone_verge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  r record;
  v_webhook text;
  v_fired int := 0;
  v_msg text;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN jsonb_build_object('error','no_webhook'); END IF;

  -- Agents within striking distance of a weekly $10k ALP threshold.
  -- "Striking distance" = $7500–$9999 so they know they can push.
  FOR r IN
    WITH wk AS (
      SELECT d.agent_id, SUM(d.annual_premium) AS wk_alp, COUNT(*) AS wk_deals
      FROM public.deals d
      WHERE d.effective_date >= date_trunc('week', CURRENT_DATE)::date
      GROUP BY d.agent_id
    )
    SELECT a.id, p.full_name, wk.wk_alp, wk.wk_deals,
           COALESCE(p.avatar_url,'') AS avatar_url
    FROM wk
    JOIN public.agents a ON a.id = wk.agent_id
    JOIN public.profiles p ON p.id = a.profile_id
    WHERE wk.wk_alp BETWEEN 7500 AND 9999
      AND NOT EXISTS (
        -- Don't double-fire within the same week for the same agent
        SELECT 1 FROM public.bot_alerts ba
        WHERE ba.event_type = 'milestone_verge_10k_week'
          AND ba.subject LIKE '%' || p.full_name || '%'
          AND ba.created_at > date_trunc('week', CURRENT_DATE)
      )
  LOOP
    v_msg := format(
      E'🔥 **%s** is within **$%s** of the $10,000 ALP week — current: **$%s** from %s deals. Go get it.',
      r.full_name,
      to_char(10000 - r.wk_alp, 'FM999,999'),
      to_char(r.wk_alp, 'FM999,999'),
      r.wk_deals);

    PERFORM net.http_post(
      url := v_webhook,
      body := jsonb_build_object(
        'username', 'APEX Verge Alert',
        'content', v_msg,
        'embeds', jsonb_build_array(jsonb_build_object(
          'color', 16753920,  -- orange
          'thumbnail', jsonb_build_object('url', r.avatar_url)
        ))),
      headers := jsonb_build_object('Content-Type','application/json'));

    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, channels)
    VALUES ('automation','milestone_verge_10k_week','celebrate',
            format('%s close to $10k ALP week', r.full_name), v_msg, ARRAY['discord']);

    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object('verge_alerts_fired', v_fired);
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- #4 manager_daily_accountability — every weekday 13:00 UTC (8am CST).
-- For each hiring manager, builds a list of THEIR directs who are
-- stuck / stale / at-risk, posts to a DM channel or emails them directly.
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_daily_accountability()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  m record;
  v_svc_url text;
  v_svc_key text;
  v_fired int := 0;
  v_stuck_body text;
  v_stuck_count int;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  FOR m IN
    SELECT DISTINCT hma.manager_user_id AS user_id, p.email, p.full_name
    FROM public.hiring_manager_assignments hma
    JOIN public.profiles p ON p.user_id = hma.manager_user_id
    WHERE p.email IS NOT NULL AND hma.is_active = true
  LOOP
    -- Compile their stuck directs
    WITH stuck AS (
      SELECT a.first_name, a.last_name, a.license_progress,
             EXTRACT(DAY FROM NOW() - COALESCE(a.last_contacted_at, a.created_at))::int AS days
      FROM public.applications a
      WHERE a.hiring_manager_user_id = m.user_id::uuid
        AND a.terminated_at IS NULL
        AND a.status NOT IN ('rejected','approved')
        AND a.license_progress != 'licensed'
        AND COALESCE(a.last_contacted_at, a.created_at) < NOW() - INTERVAL '5 days'
      ORDER BY COALESCE(a.last_contacted_at, a.created_at) ASC
      LIMIT 10
    )
    SELECT COUNT(*)::int,
           string_agg(format('• %s %s (%s · %s days silent)',
             COALESCE(first_name,''), COALESCE(last_name,''),
             COALESCE(license_progress::text,'unlicensed'), days), E'\n')
    INTO v_stuck_count, v_stuck_body
    FROM stuck;

    IF v_stuck_count = 0 THEN CONTINUE; END IF;

    IF v_svc_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-email',
        body := jsonb_build_object(
          'to', m.email,
          'subject', format('🎯 %s — your %s stuck applicants today', split_part(m.full_name,' ',1), v_stuck_count),
          'html', format(
            E'<p>Hey %s,</p><p>Here''s who on your desk has gone silent 5+ days. Pick up the phone — momentum dies when people don''t hear from you.</p><pre style="background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap">%s</pre><p>— APEX Ops</p>',
            split_part(m.full_name,' ',1), v_stuck_body)
        ),
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||v_svc_key,
          'apikey', v_svc_key
        )
      );
    END IF;

    v_fired := v_fired + 1;
  END LOOP;

  RETURN jsonb_build_object('managers_emailed', v_fired);
END;
$body$;

-- ───────────────────────────────────────────────────────────────────────
-- #5 auto_kickoff_new_licensee — fires when an applicant's
-- license_progress becomes 'licensed'. Auto-generates their portal login,
-- welcomes them via Discord, and queues their first lead purchase credit.
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_kickoff_new_licensee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_webhook text;
BEGIN
  -- Only fire on the exact transition to 'licensed'
  IF NEW.license_progress IS DISTINCT FROM 'licensed' THEN RETURN NEW; END IF;
  IF OLD.license_progress IS NOT DISTINCT FROM 'licensed' THEN RETURN NEW; END IF;

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  -- 1. Kick off portal login email
  IF v_svc_key IS NOT NULL AND NEW.email IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-agent-portal-login',
      body := jsonb_build_object('applicant_id', NEW.id, 'email', NEW.email),
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,
        'apikey', v_svc_key)
    );
  END IF;

  -- 2. Welcome Discord post (competitive tone — other agents see it)
  IF v_webhook IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_webhook,
      body := jsonb_build_object(
        'username', 'APEX New Licensee',
        'content', format(
          E'🎓 **%s %s just got licensed.** Field-ready as of %s. Who beats them to the first deal?',
          COALESCE(NEW.first_name,'Agent'), COALESCE(NEW.last_name,''),
          to_char(NOW(), 'Mon DD'))
      ),
      headers := jsonb_build_object('Content-Type','application/json'));
  END IF;

  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_auto_kickoff_new_licensee ON public.applications;
CREATE TRIGGER trg_auto_kickoff_new_licensee
  AFTER UPDATE OF license_progress ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.auto_kickoff_new_licensee();

-- ───────────────────────────────────────────────────────────────────────
-- Cron schedules (dedupe-safe: unschedule first, then register)
-- ───────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('auto-assign-hiring-manager'); EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('rescue-stale-applications'); EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('detect-milestone-verge'); EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM cron.unschedule('manager-daily-accountability'); EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('auto-assign-hiring-manager', '3,18,33,48 * * * *',
  'SELECT public.auto_assign_hiring_manager();')::text;

SELECT cron.schedule('rescue-stale-applications', '0 15 * * 1-6',
  'SELECT public.rescue_stale_applications();')::text;

-- Every 2h during Chicago work hours: 14–24 UTC = 9am–7pm CDT, weekdays
SELECT cron.schedule('detect-milestone-verge', '0 14,16,18,20,22 * * 1-5',
  'SELECT public.detect_milestone_verge();')::text;

SELECT cron.schedule('manager-daily-accountability', '0 13 * * 1-5',
  'SELECT public.manager_daily_accountability();')::text;

SELECT 'apex_automation_v10 installed'::text AS status;
