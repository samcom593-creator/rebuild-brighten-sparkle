-- 2026-05-16 INCIDENT — disable agentlink_mark_stale_deals_cancelled()
--
-- The cleanup added in 20260516160000 marked agent_link deals as 'cancelled'
-- when they fell out of upstream's /api/deals payload. That status change
-- tripped trg_fn_deal_status_transition's retention branch, which posted to
-- the Discord webhook naming the agent. Five agents on the team quit within
-- an hour after seeing their names broadcast next to "Policy cancelled" —
-- even though their policies were never actually cancelled (the local rows
-- were duplicates AgentLink had merged).
--
-- This migration:
--   1. Patches trg_fn_deal_status_transition so it never broadcasts to
--      Discord when the row's notes contain '[auto]' (i.e., the status
--      change came from automated bookkeeping, not a real agent action).
--   2. Reverts agentlink_mark_stale_deals_cancelled() to a no-op stub.
--      The fingerprint stays so existing callers don't break, but it
--      returns 0 and touches no rows.
--
-- Permanent fix path (separate, future PR): add deals.is_stale_from_upstream
-- boolean, route stale handling through that column instead of `status`,
-- and gate dashboard filters on `is_stale_from_upstream = false`. No
-- trigger watches that column so Discord stays quiet.

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_fn_deal_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_rate numeric; v_rate_source text; v_amount numeric;
  v_webhook text; v_agent_name text; v_carrier_name text; v_body jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- submitted → active : commission booking
  IF NEW.status = 'active' AND OLD.status = 'submitted' THEN
    IF NEW.agent_id IS NULL OR NEW.carrier_id IS NULL THEN
      INSERT INTO public.agentlink_alerts (severity, message)
      VALUES ('blocker',
        format('Deal %s went active but has no agent_id or carrier_id — commission cannot be computed', NEW.id));
      RETURN NEW;
    END IF;
    SELECT rate_pct, rate_source INTO v_rate, v_rate_source
    FROM public.fn_commission_rate(NEW.agent_id, NEW.carrier_id);
    IF v_rate IS NULL THEN
      INSERT INTO public.agentlink_alerts (severity, message)
      VALUES ('blocker',
        format('Deal %s went active but agent has no commission schedule for carrier — cannot pay', NEW.id));
      INSERT INTO public.commission_audit_log (deal_id, agent_id, carrier_id, rate_source, note)
      VALUES (NEW.id, NEW.agent_id, NEW.carrier_id, 'missing', 'No rate found — alert raised');
      RETURN NEW;
    END IF;
    v_amount := COALESCE(NEW.annual_premium, 0) * v_rate / 100.0;
    INSERT INTO public.commission_ledger (
      deal_id, agent_id, carrier_id, annual_premium,
      rate_pct, rate_source, amount, as_earned_pct,
      expected_paid_date)
    VALUES (
      NEW.id, NEW.agent_id, NEW.carrier_id, NEW.annual_premium,
      v_rate, v_rate_source, v_amount, 100,
      COALESCE(NEW.effective_date, CURRENT_DATE) + interval '14 days')
    ON CONFLICT (deal_id) DO UPDATE SET
      rate_pct = EXCLUDED.rate_pct,
      rate_source = EXCLUDED.rate_source,
      amount = EXCLUDED.amount,
      updated_at = now();
    INSERT INTO public.commission_audit_log (deal_id, agent_id, carrier_id, rate_pct, rate_source, note)
    VALUES (NEW.id, NEW.agent_id, NEW.carrier_id, v_rate, v_rate_source,
      format('status %s → active, $%s booked', OLD.status, to_char(v_amount,'FM999,990.00')));
  END IF;

  -- lapsed/cancelled/charged_back : retention alert + ledger clawback
  IF NEW.status IN ('lapsed','cancelled','charged_back') AND OLD.status <> NEW.status THEN
    UPDATE public.commission_ledger
    SET status = CASE NEW.status WHEN 'charged_back' THEN 'clawed_back' ELSE 'voided' END,
        updated_at = now()
    WHERE deal_id = NEW.id AND status = 'pending';

    -- HARD GUARD added 2026-05-16 after live incident: never broadcast a
    -- retention alert for a status change driven by automated bookkeeping.
    -- The '[auto]' marker in notes is set by every internal cleanup path.
    IF NEW.notes IS NOT NULL AND NEW.notes LIKE '%[auto]%' THEN
      RETURN NEW;
    END IF;

    SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_retention_webhook';
    IF v_webhook IS NULL THEN
      SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
    END IF;
    IF v_webhook IS NOT NULL THEN
      SELECT p.full_name INTO v_agent_name FROM public.agents a
        JOIN public.profiles p ON p.id = a.profile_id WHERE a.id = NEW.agent_id;
      SELECT name INTO v_carrier_name FROM public.carriers WHERE id = NEW.carrier_id;
      v_body := jsonb_build_object('username','APEX Retention',
        'content', format(
          E'⚠️ **Policy %s — %s %s · agent %s · %s $%s**\n\nReach out, rescue if possible.',
          NEW.status, NEW.client_first_name, NEW.client_last_name,
          COALESCE(v_agent_name,'unknown'),
          COALESCE(v_carrier_name,'carrier'),
          to_char(NEW.annual_premium,'FM999,990.00')));
      PERFORM net.http_post(url := v_webhook,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := v_body, timeout_milliseconds := 10000);
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  INSERT INTO public.agentlink_alerts (severity, message)
  VALUES ('warning', 'trg_deal_status_transition swallowed exception: ' || SQLERRM);
  RETURN NEW;
END
$function$;

-- The cleanup function becomes a no-op stub. Existing cron callers stay
-- safe (just return 0). Will be properly re-implemented on a dedicated
-- `is_stale_from_upstream` boolean column in a future migration.
CREATE OR REPLACE FUNCTION public.agentlink_mark_stale_deals_cancelled()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN 0;
END
$$;

REVOKE ALL ON FUNCTION public.agentlink_mark_stale_deals_cancelled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentlink_mark_stale_deals_cancelled() TO service_role;

COMMIT;
