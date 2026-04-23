-- Extend the Discord number watchdog into the deal-celebration trigger.
-- Every post agents see now recomputes MTD from the deals table and aborts
-- if the claim drifts (safety net — the same recalc runs right before the
-- post, so it should never drift unless a future refactor decouples them).

CREATE OR REPLACE FUNCTION public.trg_fn_deal_celebration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_webhook      text;
  v_agent_name   text;
  v_avatar       text;
  v_carrier      text;
  v_mtd_deals    int;
  v_mtd_alp      numeric;
  v_body         jsonb;
  v_req          bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.effective_date IS NULL OR NEW.effective_date < CURRENT_DATE - 7 THEN RETURN NEW; END IF;
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('active','issued','submitted','pending','approved') THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_sales_wins';
  IF v_webhook IS NULL OR length(v_webhook) < 20 THEN
    SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  END IF;
  IF v_webhook IS NULL THEN RETURN NEW; END IF;

  SELECT p.full_name, p.avatar_url
    INTO v_agent_name, v_avatar
  FROM public.agents a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  SELECT name INTO v_carrier FROM public.carriers WHERE id = NEW.carrier_id;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_mtd_deals, v_mtd_alp
  FROM public.deals
  WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', CURRENT_DATE)::date;

  IF NOT public.discord_audit_ok('trg_deal_celebration', 'mtd_alp', v_mtd_alp) THEN
    RETURN NEW;
  END IF;

  v_body := jsonb_build_object(
    'username', 'APEX Deal Alert',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('🔥 DEAL CLOSED — %s %s',
        COALESCE(NEW.client_first_name,'Client'),
        COALESCE(NEW.client_last_name,'')),
      'description', format('**%s** just wrote **$%s** · %s · %s',
        COALESCE(v_agent_name, 'An agent'),
        to_char(COALESCE(NEW.annual_premium,0), 'FM999,999,999'),
        COALESCE(v_carrier, 'Carrier TBD'),
        COALESCE(NEW.product_sold, 'Product')),
      'color', 5763719,
      'thumbnail', jsonb_build_object('url', COALESCE(v_avatar, 'https://apex-financial.org/placeholder-avatar.png')),
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Face amount', 'value', format('$%s', to_char(COALESCE(NEW.face_amount,0), 'FM999,999,999')), 'inline', true),
        jsonb_build_object('name', 'Monthly premium', 'value', format('$%s', to_char(COALESCE(NEW.monthly_premium,0), 'FM999,999,999')), 'inline', true),
        jsonb_build_object('name', 'MTD', 'value', format('%s deals · $%s ALP', v_mtd_deals, to_char(v_mtd_alp, 'FM999,999,999')), 'inline', true)
      ),
      'footer', jsonb_build_object('text', format('Effective %s', NEW.effective_date::text))
    ))
  );

  v_req := net.http_post(
    url := v_webhook,
    body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));

  RETURN NEW;
END;
$body$;

-- Agent Link sync functions that hit pg_net need statement_timeout=0 prefix
-- on the cron command (pg_net's _await_response uses pg_sleep which hits the
-- default cron statement_timeout). Applied via bot-sql already; captured
-- here for reproducibility.
DO $$
BEGIN
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname='agentlink-downline-refresh'),
    command := 'SET LOCAL statement_timeout = 0; SELECT public.agentlink_refresh_downline();');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname='agentlink-leads-pull'),
    command := 'SET LOCAL statement_timeout = 0; SELECT public.agentlink_pull_leads();');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.alter_job(
    job_id := (SELECT jobid FROM cron.job WHERE jobname='agentlink-top-producers'),
    command := 'SET LOCAL statement_timeout = 0; SELECT public.agentlink_award_top_producers();');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
