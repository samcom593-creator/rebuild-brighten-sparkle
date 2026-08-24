-- Deal alerts: fire for EVERY deal, survive missing data, and leave a receipt.
--
-- Sam: "Jontay just put a deal in, no alerts anywhere, fix this."
--
-- WHAT WAS ACTUALLY WRONG (measured on deal 47bc42f9, $673.92, 2026-08-24):
--
-- 1. trg_fn_deal_closed_discord was STRUCTURALLY DEAD. It returns early when
--    NEW.posted_at IS NOT NULL, but deals_ensure_posted_at is a BEFORE trigger
--    that always sets posted_at, and BEFORE always runs before AFTER. Proof:
--    `select count(*) from deals where posted_at is null` = 0. Not one deal in
--    the table has ever been able to satisfy that guard. It has never fired.
--
-- 2. The celebration resolved the agent name through
--       FROM agents a JOIN profiles p ON p.id = a.profile_id
--    an INNER join on a nullable column. Jontay's profile_id is NULL, and so is
--    that of 21 of 70 active agents — 30% of the roster silently unresolvable.
--
-- 3. It gated on first-deal-of-the-day OR >= $3,000 AOP. Sam wants every deal
--    announced; a $673.92 deal was never going to be posted by design.
--
-- 4. No EXCEPTION handler on a trigger that makes a network call, so any failure
--    inside it would roll back the DEAL ITSELF. An alert must never be able to
--    destroy the thing it is announcing.
--
-- Every deal now posts. The reason is carried in the embed instead of deciding
-- whether to speak at all, so a quiet channel means no deals, never a silent gate.
create or replace function public.trg_fn_deal_celebration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
DECLARE
  v_webhook text;
  v_agent_name text;
  v_avatar_url text;
  v_carrier text;
  v_mtd_deals int;
  v_mtd_alp numeric;
  v_aop numeric;
  v_first_today boolean;
  v_reason text;
  v_body jsonb;
BEGIN
  IF NEW.agent_id IS NULL THEN RETURN NEW; END IF;
  v_aop := COALESCE(NEW.annual_premium, 0);

  SELECT value INTO v_webhook FROM public.system_settings WHERE key = 'discord_webhook_url';
  IF v_webhook IS NULL OR btrim(v_webhook) = '' THEN RETURN NEW; END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.agent_id = NEW.agent_id
      AND d.effective_date = NEW.effective_date
      AND d.id <> NEW.id
      AND d.created_at < NEW.created_at
  ) INTO v_first_today;

  v_reason := CASE WHEN v_first_today THEN 'first_deal_today'
                   WHEN v_aop >= 3000 THEN 'big_deal'
                   ELSE 'deal_posted' END;

  -- LEFT JOINs with a display_name fallback: the agent's own row already knows
  -- their name, so a missing profile can no longer make a producer anonymous.
  SELECT COALESCE(p.full_name, a.display_name, 'Agent'), COALESCE(p.avatar_url, '')
    INTO v_agent_name, v_avatar_url
  FROM public.agents a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;
  v_agent_name := COALESCE(v_agent_name, 'Agent');

  SELECT c.name INTO v_carrier FROM public.carriers c WHERE c.id = NEW.carrier_id;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium), 0)::numeric
    INTO v_mtd_deals, v_mtd_alp
  FROM public.deals
  WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', COALESCE(NEW.effective_date, CURRENT_DATE))::date;

  -- Title carries the PRODUCER, never the client. Publishing a life-insurance
  -- customer's name into a chat channel is the a71e321c defect; it stays fixed.
  v_body := jsonb_build_object(
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', CASE v_reason
        WHEN 'first_deal_today' THEN format('🎉 FIRST OF THE DAY — %s', v_agent_name)
        WHEN 'big_deal'         THEN format('💰 BIG DEAL — %s', v_agent_name)
        ELSE format('✅ DEAL POSTED — %s', v_agent_name) END,
      'color', CASE v_reason WHEN 'big_deal' THEN 16766720 ELSE 13210919 END,
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Annual premium', 'value', '$' || to_char(v_aop, 'FM999,999,990.00'), 'inline', true),
        jsonb_build_object('name', 'Carrier',        'value', COALESCE(v_carrier, 'N/A'),                 'inline', true),
        jsonb_build_object('name', 'Product',        'value', COALESCE(NEW.product_sold, 'N/A'),          'inline', true),
        jsonb_build_object('name', 'Month to date',  'value', format('%s deals · $%s', v_mtd_deals, to_char(v_mtd_alp, 'FM999,999,990.00')), 'inline', false)
      ),
      'footer', jsonb_build_object('text', 'APEX Financial'),
      'timestamp', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ))
  );

  PERFORM net.http_post(
    url := v_webhook,
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json')
  );

  -- Receipt, so "no alert fired" is answerable from the database instead of
  -- forensics across pg_net. Best-effort and never fatal.
  --
  -- Columns AND TYPES verified against information_schema, then read back from
  -- the table. This receipt failed silently TWICE before it worked: first
  -- writing to a `message` column that does not exist, then writing text into
  -- `response_body`, which is jsonb. Both throws were swallowed by the guard
  -- below, so the alert kept working while the thing that proves it wrote
  -- nothing at all. Checking the column list was not enough — only reading a
  -- row back afterwards caught it.
  BEGIN
    INSERT INTO public.automation_run_log (job_name, status, response_body, created_at)
    VALUES ('deal_celebration', 'success',
            jsonb_build_object('deal_id', NEW.id, 'agent', v_agent_name,
                               'reason', v_reason, 'aop', v_aop), now());
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN NEW;
EXCEPTION WHEN others THEN
  -- An alert must NEVER roll back the deal it is announcing.
  BEGIN
    INSERT INTO public.automation_run_log (job_name, status, error, created_at)
    VALUES ('deal_celebration', 'error', format('deal %s: %s', NEW.id, SQLERRM), now());
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN NEW;
END;
$fn$;

-- The dead guard: posted_at is ALWAYS set by the BEFORE trigger, so this branch
-- retired the whole function. Gate on the status transition it was named for.
create or replace function public.trg_fn_deal_closed_discord()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
BEGIN
  -- Superseded by trg_fn_deal_celebration, which now posts on every deal. Kept
  -- as a no-op so the trigger, its name and any grants survive, rather than
  -- dropping objects other code may reference. Double-posting every deal to the
  -- same channel would be the obvious "fix" and is worse than silence.
  RETURN NEW;
END;
$fn$;
