-- 2026-05-16 — Link deals to their upstream pipeline_client_id
--
-- AgentLink's /api/deals payload carries pipelineClientId per deal. Without
-- it stored locally, the Book of Business view couldn't join out to the
-- agentlink_clients table (banking, financial profile, beneficiary, health).
-- This stashes the FK so the detail dialog can pull the full client profile
-- on demand.

BEGIN;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS pipeline_client_id int;

CREATE INDEX IF NOT EXISTS idx_deals_pipeline_client_id
  ON public.deals (pipeline_client_id);

-- Backfill already applied via bot-sql tonight (938 of 1032 deals linked).
-- Future deals from agentlink-cookie-sync should map this on insert; that
-- update lives in the edge function in a follow-up.

COMMIT;
