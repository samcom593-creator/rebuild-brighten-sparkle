-- wave-outbox-direction (2026-08-11)
--
-- 5558a86a, shipped four hours before this migration, said the Apex ->
-- InsuraCloud write path had never synced one of 1,759 deals and was holding
-- $2,336,292.84 of annual premium. Both halves of that sentence are true about
-- the COLUMN and false about the BUSINESS. Re-measured before the "obvious"
-- follow-up (wire in the working session cookie) could be shipped:
--
--   deals.source = 'agent_link' on 1,749 of 1,759 rows ($2,327,188.80 of the
--     $2,336,292.84). Only 10 rows are source='apex', worth $9,104.04.
--   agentlink_book holds 1,701 rows / 1,346 distinct policy numbers — exactly
--     the live GET /api/deals payload. public.deals is an IMPORT MIRROR of
--     InsuraCloud, not a source that feeds it.
--   Matching Apex's 1,336 distinct policy numbers against InsuraCloud's live
--     1,345 gives an intersection of 1,251 = 93.6% of Apex's book.
--
-- So synced_to_insuracloud_at IS NULL on an imported row is CORRECT state. It
-- was never pushed because it must never be pushed. The real backlog is 92
-- deals worth $118,693.08 — 5.1% of the number the previous wave shipped.
--
-- Why this is a guard and not a cleanup: sweepUnsynced() selected
-- `synced_to_insuracloud_at IS NULL AND status <> 'draft'` with no dedupe, and
-- pushOne() POSTs unconditionally. The session-cookie branch WORKS — verified
-- live at 09:5x: GET /api/csrf-token returns 200 on connect.sid alone and GET
-- /api/deals returns 1,701 rows. The only reason 1,667 duplicate policies are
-- not already sitting in the book Sam's commissions run on is that the stored
-- default token happens to be an al_ api-key. That is not a safety property,
-- it is an accident, and the previous wave's own open-items list was pointed
-- straight at removing it.
--
-- InsuraCloud exposes externalId/externalSource, but 0 of its 1,701 rows carry
-- either, so its dedupe path has never once been exercised. Nothing here bets
-- on the receiver catching the collision.
--
-- Deliberately NOT backfilling synced_to_insuracloud_at to "clear" the 1,667.
-- Stamping a sync time for a sync that never happened is the exact disease this
-- repo has burned six waves on (465 InsuraCloud rows, 198 AgentLink rows). The
-- rows stay honestly unsynced; eligibility is computed live instead.

-- ---------------------------------------------------------------------------
-- 1. Push eligibility, computed live. Single source of truth for "may this
--    deal be POSTed to InsuraCloud". Live rather than a stored column because
--    a deal entered in Apex today can legitimately appear in the book tomorrow
--    via the import, and a stale flag would push it anyway.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_insuracloud_push_eligible AS
SELECT d.*
FROM public.deals d
WHERE d.synced_to_insuracloud_at IS NULL
  AND d.status IS DISTINCT FROM 'draft'
  -- imported rows travel InsuraCloud -> agentlink_book -> deals. Pushing one
  -- back is a round trip that can only create a duplicate.
  AND COALESCE(d.source, '') IS DISTINCT FROM 'agent_link'
  -- and regardless of source, never push a policy number the destination is
  -- already carrying.
  AND NOT EXISTS (
    SELECT 1
    FROM public.agentlink_book b
    WHERE upper(trim(b.policy_number)) = upper(trim(d.policy_number))
  );

COMMENT ON VIEW public.v_insuracloud_push_eligible IS
  'wave-outbox-direction 2026-08-11: the ONLY deals the outbox may POST. Excludes imported (source=agent_link) rows and any policy number already present in agentlink_book, the local mirror of InsuraCloud. Measured at creation: 1,759 unsynced -> 92 eligible ($118,693.08 AP).';

-- ---------------------------------------------------------------------------
-- 2. Stop enqueueing imported rows at the trigger. Cheap, deterministic, and
--    it means the queue never fills with work the sweep would refuse anyway.
--    EXCEPTION guard and early-returns preserved byte-for-byte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deals_trigger_insuracloud_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.synced_to_insuracloud_at IS NOT NULL OR NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- wave-outbox-direction: an agent_link row came FROM InsuraCloud. Pushing it
  -- back duplicates a policy in the book Sam's commissions are computed from.
  IF COALESCE(NEW.source, '') = 'agent_link' THEN
    RETURN NEW;
  END IF;

  PERFORM public.run_automation_job(
    'deal-insuracloud-push',
    'insuracloud-outbox',
    jsonb_build_object('deal_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Truth view. The old one reported deals_pending=1,759 and
--    unsynced_annual_premium=$2,336,292.84 with lifetime_success_pct=0.00 —
--    all three arithmetically correct and all three telling Sam a story about
--    a $2.3M outage that does not exist. Split so the honest number leads.
-- ---------------------------------------------------------------------------
-- DROP first: CREATE OR REPLACE cannot rename deals_pending ->
-- deals_eligible_pending, and the rename is the point. Verified via pg_depend
-- that nothing else in the database selects from this view (apex-doctor reads
-- it over bot-sql, which is not a catalog dependency and is updated in the
-- same commit).
DROP VIEW IF EXISTS public.v_insuracloud_outbox_truth;

CREATE VIEW public.v_insuracloud_outbox_truth AS
WITH e AS (SELECT id FROM public.v_insuracloud_push_eligible)
SELECT
  count(*)                                                       AS deals_total,
  count(d.synced_to_insuracloud_at)                              AS deals_synced_lifetime,
  -- what actually needs to move
  count(*) FILTER (WHERE d.id IN (SELECT id FROM e))             AS deals_eligible_pending,
  round(COALESCE(sum(d.annual_premium) FILTER (
    WHERE d.id IN (SELECT id FROM e)), 0::numeric), 2)           AS eligible_annual_premium,
  round(COALESCE(sum(d.annual_premium) FILTER (
    WHERE d.id IN (SELECT id FROM e)
      AND d.created_at > now() - interval '30 days'), 0::numeric), 2)
                                                                 AS eligible_annual_premium_30d,
  -- what is unsynced and CORRECTLY so — the 94.9% that is not a leak
  count(*) FILTER (
    WHERE d.synced_to_insuracloud_at IS NULL
      AND d.status IS DISTINCT FROM 'draft'
      AND d.id NOT IN (SELECT id FROM e))                        AS deals_not_pushable,
  count(*) FILTER (WHERE COALESCE(d.source,'') = 'agent_link')   AS deals_imported,
  -- errors only count where a push was actually owed
  count(*) FILTER (
    WHERE d.insuracloud_sync_error IS NOT NULL
      AND d.id IN (SELECT id FROM e))                            AS deals_errored,
  max(d.synced_to_insuracloud_at)                                AS newest_sync_at,
  max(d.updated_at) FILTER (WHERE d.insuracloud_sync_error IS NOT NULL)
                                                                 AS newest_error_at
FROM public.deals d;

COMMENT ON VIEW public.v_insuracloud_outbox_truth IS
  'wave-outbox-direction 2026-08-11: superseded the 5558a86a version, which reported $2,336,292.84 "unsynced" when 94.9% of it was imported data that must never be pushed. deals_eligible_pending / eligible_annual_premium are the only figures that describe a real backlog.';
