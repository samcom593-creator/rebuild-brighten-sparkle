-- wave-discord-client-pii (2026-08-11)
--
-- trg_fn_deal_celebration built its Discord embed TITLE out of the insurance
-- client's first and last name:
--
--   format('%s DEAL — %s %s', <prefix>, NEW.client_first_name, NEW.client_last_name)
--
-- Every "first deal of the day" and every deal >= $3,000 AOP therefore
-- broadcast a named life-insurance customer into a Discord channel, alongside
-- the carrier, the product sold, the premium and the effective date. That is
-- nonpublic personal information about a customer of an insurance producer,
-- disclosed to every member of a chat server.
--
-- MEASURED before this migration, against the live database:
--   * public.system_settings.discord_webhook_url = SET (discord.com, len 121)
--   * trigger trg_deal_celebration on public.deals = ENABLED ('O')
--   * 464 of 1,759 deals satisfy the WHEN gate + post conditions + have a
--     client name; 77 of those were created in the last 30 days
--   * net._http_response shows Discord's 204-No-Content success (cloudflare,
--     cf-ray, PDX) at 2026-08-11 03:58:35Z — the path delivers, it is not
--     theoretical
--
-- The celebration exists to celebrate the AGENT. The client's name was never
-- load-bearing for that. Removing it also repairs the copy: the old format
-- string rendered the non-sentence "🎉 FIRST OF THE DAY FOR DEAL — John Smith",
-- because the "FOR" prefix was followed by the client rather than the agent.
--
-- ONLY the title changes. description (agent, AOP, carrier, product), fields
-- (monthly, MTD deals, MTD ALP), thumbnail (agent avatar) and footer
-- (effective date, reason) are all agent/production data and are preserved
-- byte-for-byte, so the feed keeps every signal Sam actually reads.
--
-- Guarded going forward by scripts/check-discord-pii.mjs (repo, commit-time)
-- and apex-doctor Check #16 (live pg_proc, catches hand-applied SQL that never
-- passes through this repo — which is how most functions here actually land).

CREATE OR REPLACE FUNCTION public.trg_fn_deal_celebration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_webhook text;
  v_agent_name text;
  v_avatar_url text;
  v_carrier text;
  v_mtd_deals int;
  v_mtd_alp numeric;
  v_monthly numeric;
  v_aop numeric;
  v_first_today boolean;
  v_should_post boolean := false;
  v_reason text;
  v_body jsonb;
BEGIN
  IF NEW.agent_id IS NULL OR NEW.annual_premium IS NULL THEN RETURN NEW; END IF;

  v_aop := NEW.annual_premium;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.deals d
    WHERE d.agent_id = NEW.agent_id
      AND d.effective_date = NEW.effective_date
      AND d.id <> NEW.id
      AND d.created_at < NEW.created_at
  ) INTO v_first_today;

  IF v_first_today THEN
    v_should_post := true;
    v_reason := 'first_deal_today';
  ELSIF v_aop >= 3000 THEN
    v_should_post := true;
    v_reason := 'big_deal';
  END IF;

  IF NOT v_should_post THEN RETURN NEW; END IF;

  SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
  IF v_webhook IS NULL THEN RETURN NEW; END IF;

  SELECT p.full_name, COALESCE(p.avatar_url, '')
    INTO v_agent_name, v_avatar_url
  FROM public.agents a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  SELECT c.name INTO v_carrier FROM public.carriers c WHERE c.id = NEW.carrier_id;

  SELECT COUNT(*)::int, COALESCE(SUM(annual_premium),0)::numeric
    INTO v_mtd_deals, v_mtd_alp
  FROM public.deals
  WHERE agent_id = NEW.agent_id
    AND effective_date >= date_trunc('month', NEW.effective_date)::date;

  v_monthly := NEW.monthly_premium;

  v_body := jsonb_build_object(
    'username', CASE WHEN v_reason='big_deal' THEN 'APEX 🔥 BIG DEAL' ELSE 'APEX Deal Feed' END,
    'embeds', jsonb_build_array(jsonb_build_object(
      -- The subject of this sentence is the agent. It was the client.
      'title', CASE
                 WHEN v_reason='big_deal'
                   THEN format('🚀 BIG DEAL — %s', COALESCE(v_agent_name, 'Agent'))
                 ELSE format('🎉 FIRST DEAL OF THE DAY — %s', COALESCE(v_agent_name, 'Agent'))
               END,
      'description', format('**%s** just wrote **$%s AOP** with %s · **%s**',
        v_agent_name, to_char(v_aop, 'FM999,999'),
        COALESCE(v_carrier, 'carrier TBD'),
        COALESCE(NEW.product_sold, 'product TBD')),
      'color', CASE WHEN v_reason='big_deal' THEN 16738048 ELSE 5763719 END,
      'fields', jsonb_build_array(
        jsonb_build_object('name','Monthly','value', '$' || to_char(v_monthly,'FM999,999.99'),'inline', true),
        jsonb_build_object('name','MTD deals','value', v_mtd_deals::text,'inline', true),
        jsonb_build_object('name','MTD ALP','value', '$' || to_char(v_mtd_alp,'FM999,999'),'inline', true)),
      'thumbnail', jsonb_build_object('url', v_avatar_url),
      'footer', jsonb_build_object('text', format('Effective %s · %s', to_char(NEW.effective_date,'Mon DD'), v_reason)),
      'timestamp', to_char(NOW(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));

  PERFORM net.http_post(url := v_webhook, body := v_body,
    headers := jsonb_build_object('Content-Type','application/json'));

  RETURN NEW;
END;
$function$;
