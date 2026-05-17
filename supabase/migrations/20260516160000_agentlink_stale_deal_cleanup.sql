-- 2026-05-16 — Auto-cancel stale AgentLink deals
--
-- Pattern caught tonight: an agent submits a deal in AgentLink, then
-- duplicates or voids it upstream (different policy number, same client,
-- minutes apart). The original /api/deals payload included the duplicate
-- for one sync tick; the next sync no longer carried it. Our local deals
-- table kept the orphan row forever, inflating weekly/monthly ALP.
--
-- Marcos's specific incident: 2 duplicate "Dimitri Anthony" deals at
-- $5,520 each (policy FEXB513422 + FEXB513423) created 12 minutes apart
-- on 2026-05-16. AgentLink kept one. We kept both. His week ALP read
-- $11k against an upstream reality of $0.
--
-- This function reconciles: any agent_link deal whose external_deal_id
-- is missing from the latest /api/deals snapshot gets status='cancelled'
-- so it falls out of the dashboard's submitted/active filter. The raw
-- row stays for audit; only its truth-layer visibility changes.
--
-- Two safety gates so the function can't accidentally mass-cancel:
--   1. The upstream snapshot must have >100 deal entries (defense against
--      a partial/empty pull marking the whole book stale).
--   2. The snapshot must be < 2 hours old (defense against running the
--      cleanup against ancient cached payloads).

BEGIN;

CREATE OR REPLACE FUNCTION public.agentlink_mark_stale_deals_cancelled()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
BEGIN
  WITH latest AS (
    SELECT payload AS p
    FROM public.agentlink_raw_exports
    WHERE endpoint = '/api/deals' AND upstream_status = 200
    ORDER BY captured_at DESC LIMIT 1
  ),
  upstream_ids AS (
    SELECT DISTINCT COALESCE(d->>'externalId', d->>'id') AS ext_id
    FROM latest, jsonb_array_elements(latest.p) AS d
  ),
  updated AS (
    UPDATE public.deals
    SET status = 'cancelled',
        notes = COALESCE(notes, '') || E'\n[auto] stale-not-in-upstream-' || to_char(now(), 'YYYY-MM-DD'),
        updated_at = now()
    WHERE source = 'agent_link'
      AND external_deal_id IS NOT NULL
      AND external_deal_id NOT IN (SELECT ext_id FROM upstream_ids)
      AND status IN ('submitted','active')
      AND (SELECT count(*) FROM upstream_ids) > 100
      AND EXISTS (
        SELECT 1 FROM public.agentlink_raw_exports
        WHERE endpoint = '/api/deals' AND upstream_status = 200
          AND captured_at > now() - interval '2 hours'
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM updated;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.agentlink_mark_stale_deals_cancelled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentlink_mark_stale_deals_cancelled() TO service_role;

COMMIT;
