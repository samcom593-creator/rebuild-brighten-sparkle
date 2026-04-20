-- ============================================================
-- Drop the old single-channel Discord trigger.
-- notify-deal-submitted now handles Discord + email-all + SMS-all + plaque,
-- so trg_deals_discord_notify would cause a duplicate Discord embed.
-- ============================================================

DROP TRIGGER IF EXISTS trg_deals_discord_notify ON public.deals;
DROP FUNCTION  IF EXISTS public.deals_trigger_discord_notify();

-- The InsuraCloud push trigger stays — it fires insuracloud-outbox with
-- the specific deal_id, separate from the broadcast chain.
