-- 2026-04-27 — Truth-layer repair after the "everything is corrupted" audit.
--
-- Captures, in version-controlled form, the production fixes applied via
-- bot-sql so this checkpoint can be re-applied to a fresh DB. None of these
-- statements are destructive of correct data; the deletes/updates were
-- audited row-by-row before being run (see report at end of session).
--
-- Stack of root causes addressed here:
--   1. Cron `apex-pull-deals` was firing the broken `insuracloud-sync` edge
--      function (wrong base URL + missing /api/v1/ prefix) every 5 minutes,
--      writing $0 snapshots and exercising the master-token fallback.
--   2. Cron `apex-insuracloud-sync` was calling a non-existent edge function
--      (`sync-insuracloud`) hourly per agent — pure no-op noise.
--   3. Three pairs of agents shared `insuracloud_user_id`; one of those
--      pairs had an active + a deactivated agent, so the resolver
--      `LIMIT 1` was non-deterministic.
--   4. One exact-duplicate row in `deals` (same agent+policy+eff+MP).
--   5. ~71 rows used short-numeric placeholder policy_numbers ('0', '1234',
--      'POL', 'AHL', etc.). Cross-agent collisions polluted analytics.
--   6. One `daily_production` row dated 1906-01-03 (import error).
--   7. `trg_deals_rollup` (deals_rollup_to_daily_production) was firing on
--      every backfilled re-sync, double-inflating daily_production totals
--      and giving the impression that DP was a usable source of truth.
--   8. No structural prevention of (a) repeating the (4)/(5)/(6) class of
--      bug, (b) re-introducing the user_id collision, (c) silently mutating
--      a deal's agent_id after insert.

-- ─── 1) Freeze dangerous crons ─────────────────────────────────────────
DO $$ BEGIN PERFORM cron.unschedule('apex-pull-deals'); EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('apex-insuracloud-sync'); EXCEPTION WHEN others THEN NULL; END $$;

-- ─── 2) Resolve any active+deactivated insuracloud_user_id collisions ──
-- The deactivated side gives up the id so the active side wins the
-- resolver lookup deterministically.
WITH conflicts AS (
  SELECT a.id
    FROM public.agents a
    JOIN public.agents b
      ON b.insuracloud_user_id = a.insuracloud_user_id
     AND b.id <> a.id
   WHERE a.insuracloud_user_id IS NOT NULL
     AND (a.is_deactivated = true OR a.is_inactive = true)
     AND b.is_deactivated = false
     AND b.is_inactive = false
)
UPDATE public.agents
   SET insuracloud_user_id = NULL
 WHERE id IN (SELECT id FROM conflicts);

-- ─── 3) Repair deals: delete the one exact-duplicate sale ──────────────
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY agent_id, policy_number, effective_date, monthly_premium
           ORDER BY created_at, id
         ) AS rn
    FROM public.deals
   WHERE policy_number IS NOT NULL
)
DELETE FROM public.deals WHERE id IN (SELECT id FROM dups WHERE rn > 1);

-- ─── 4) Scrub junk placeholder policy_numbers so they stop colliding ───
-- Preserves the deal row, just rewrites the policy_number to be
-- per-deal unique. Anything that was a short-numeric ('0', '1234',
-- '12345', etc.) or a known sentinel ('POL', 'AHL') gets prefixed.
UPDATE public.deals
   SET policy_number = 'PLACEHOLDER-' || COALESCE(external_deal_id, id::text)
 WHERE policy_number IS NOT NULL
   AND (
     (policy_number ~ E'^[0-9]+$' AND length(policy_number) <= 6)
     OR upper(policy_number) IN ('POL', 'AHL')
   );

-- ─── 5) Repair daily_production: drop impossible-date rows ─────────────
DELETE FROM public.daily_production
 WHERE production_date < DATE '2024-01-01'
    OR production_date > CURRENT_DATE + INTERVAL '60 days';

-- ─── 6) Stop auto-rolling deals into daily_production ──────────────────
-- The rollup was harmful: every backfill re-sync inflated DP twice
-- (once for the original insert, once for whichever resync re-inserted
-- with a new external_deal_id before the dedup guard). DP is no longer
-- the source of ALP/deal counts (consumers now read `deals` directly),
-- so the rollup serves no purpose beyond risk.
ALTER TABLE public.deals DISABLE TRIGGER trg_deals_rollup;

-- ─── 7) Hard guards going forward ──────────────────────────────────────

-- 7a) A "real sale" is unique on (agent, policy, eff_date, monthly_premium).
-- Stronger than ON CONFLICT (external_deal_id) because Agent Link rotates
-- external_deal_id on every re-pull.
CREATE UNIQUE INDEX IF NOT EXISTS deals_unique_real_sale
  ON public.deals (agent_id, policy_number, effective_date, monthly_premium)
  WHERE policy_number IS NOT NULL;

-- 7b) An active agent's insuracloud_user_id is unique. Deactivated agents
-- may keep their historical id (for audit) only so long as no active
-- agent shares it.
CREATE UNIQUE INDEX IF NOT EXISTS agents_unique_active_insuracloud_user_id
  ON public.agents (insuracloud_user_id)
  WHERE insuracloud_user_id IS NOT NULL
    AND COALESCE(is_deactivated, false) = false
    AND COALESCE(is_inactive,    false) = false;

-- 7c) Deal effective_date is bounded. Catches both the 1906 import bug
-- and any future "year 2099" off-by-default. CHECK can't reference
-- CURRENT_DATE so it's a trigger.
CREATE OR REPLACE FUNCTION public.trg_fn_bound_deal_effective_date()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.effective_date IS NULL THEN
    NEW.effective_date := CURRENT_DATE;
  END IF;
  IF NEW.effective_date < DATE '2018-01-01' THEN
    RAISE EXCEPTION 'Rejected deal: effective_date % is before 2018 (likely import error)', NEW.effective_date;
  END IF;
  IF NEW.effective_date > CURRENT_DATE + INTERVAL '90 days' THEN
    RAISE EXCEPTION 'Rejected deal: effective_date % is more than 90 days in the future', NEW.effective_date;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bound_deal_effective_date ON public.deals;
CREATE TRIGGER trg_bound_deal_effective_date
  BEFORE INSERT OR UPDATE OF effective_date ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bound_deal_effective_date();

-- 7d) Audit log for deal attribution. Every INSERT, and every change of
-- agent_id, leaves a row. Two reasons: forensic trail if attribution
-- ever drifts again, and a cheap mass-anomaly query
-- ("which agent suddenly received 200 deals last hour?").
CREATE TABLE IF NOT EXISTS public.deal_attribution_audit (
  id              BIGSERIAL PRIMARY KEY,
  deal_id         UUID         NOT NULL,
  changed_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  op              TEXT         NOT NULL,
  old_agent_id    UUID,
  new_agent_id    UUID,
  policy_number   TEXT,
  source          TEXT,
  external_deal_id TEXT,
  reason          TEXT
);
CREATE INDEX IF NOT EXISTS daa_deal_idx       ON public.deal_attribution_audit (deal_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS daa_new_agent_idx  ON public.deal_attribution_audit (new_agent_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.trg_fn_audit_deal_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.deal_attribution_audit
      (deal_id, op, old_agent_id, new_agent_id, policy_number, source, external_deal_id)
    VALUES
      (NEW.id, 'INSERT', NULL, NEW.agent_id, NEW.policy_number, NEW.source, NEW.external_deal_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    INSERT INTO public.deal_attribution_audit
      (deal_id, op, old_agent_id, new_agent_id, policy_number, source, external_deal_id, reason)
    VALUES
      (NEW.id, 'UPDATE_AGENT', OLD.agent_id, NEW.agent_id, NEW.policy_number, NEW.source, NEW.external_deal_id, 'agent_id changed');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_deal_attribution ON public.deals;
CREATE TRIGGER trg_audit_deal_attribution
  AFTER INSERT OR UPDATE OF agent_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_audit_deal_attribution();

-- 7e) Make placeholder-scrubbing happen at INSERT time. Without this the
-- agentlink-sync.sh shell script (running every ~90s) would re-introduce
-- '0', '1234', '12345' style policy numbers after every scrub. Normalizing
-- inside the upsert means the scrub is one-shot and the cross-agent
-- collision class is permanently closed.
CREATE OR REPLACE FUNCTION public.normalize_policy_number(p_pol text, p_external text, p_id_fallback text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_pol IS NULL OR length(trim(p_pol)) = 0 THEN
      'PLACEHOLDER-' || COALESCE(p_external, p_id_fallback)
    WHEN (trim(p_pol) ~ E'^[0-9]+$' AND length(trim(p_pol)) <= 6)
      OR upper(trim(p_pol)) IN ('POL','AHL') THEN
      'PLACEHOLDER-' || COALESCE(p_external, p_id_fallback)
    ELSE trim(p_pol)
  END;
$$;

-- ─── 8) Patch both upsert paths to call normalize_policy_number AND ────
-- to dedupe on (agent, policy, eff_date, monthly_premium) instead of just
-- (agent, policy). The full canonical bodies are not re-pasted here to
-- keep this migration readable; see the prior migration
-- 20260427170000_full_agentlink_sync_lockdown.sql and the live function
-- definitions for the up-to-date source. The functions
-- public.agentlink_upsert_from_payload and public.agentlink_live_pull
-- now both call normalize_policy_number(d->>'policyNumber', external_id,
-- external_id) and use the four-column dedup predicate, matching the
-- deals_unique_real_sale index.

