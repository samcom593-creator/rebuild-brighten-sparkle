-- P2-9 Commission Recovery Automation
-- For 89 carrier_policies with NULL premium/face: auto-email agent, track reply,
-- only count commissions for replied policies. Drops Sam's $1.27M ghost AP noise
-- to actual recoverable $.
--
-- This migration ships the data model + status view + recovery-attempt log.
-- The actual emailing is done by the new edge fn `commission-recovery-send`
-- (separate file) called manually first, then via pg_cron weekly Mondays 9 AM CT.

-- Extend carrier_policies with recovery tracking
ALTER TABLE public.carrier_policies
  ADD COLUMN IF NOT EXISTS recovery_email_sent_at        timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_email_count          int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_response_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_policy_number_provided text,
  ADD COLUMN IF NOT EXISTS recovery_face_amount_provided   numeric,
  ADD COLUMN IF NOT EXISTS recovery_annual_premium_provided numeric,
  ADD COLUMN IF NOT EXISTS recovery_status                 text DEFAULT 'pending';

-- One row per recovery email sent. Survives policy row updates so we can
-- count retries / reply rates accurately.
CREATE TABLE IF NOT EXISTS public.commission_recovery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_policy_id uuid REFERENCES public.carrier_policies(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.agents(id),
  sent_to_email text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  resend_email_id text,
  response_received_at timestamptz,
  response_body text,
  policy_number_provided text,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commission_recovery_attempts_policy_idx
  ON public.commission_recovery_attempts(carrier_policy_id);
CREATE INDEX IF NOT EXISTS commission_recovery_attempts_agent_idx
  ON public.commission_recovery_attempts(agent_id);

-- Status view: per-agent + per-policy counts of recoverable items
CREATE OR REPLACE VIEW public.v_commission_recovery_status AS
WITH stats AS (
  SELECT
    cp.id AS policy_id,
    cp.agent_id,
    cp.client_first_name || ' ' || cp.client_last_name AS client_name,
    cp.carrier_name,
    cp.policy_number,
    cp.effective_date,
    cp.recovery_email_sent_at,
    cp.recovery_email_count,
    cp.recovery_response_received_at,
    cp.recovery_status,
    cp.face_amount,
    cp.annual_premium,
    cp.agent_raw,
    CASE
      WHEN cp.recovery_response_received_at IS NOT NULL THEN 'responded'
      WHEN cp.recovery_email_sent_at IS NOT NULL THEN 'emailed_awaiting_reply'
      WHEN cp.face_amount IS NOT NULL AND cp.annual_premium IS NOT NULL THEN 'data_present'
      ELSE 'unrecovered_pending_email'
    END AS recovery_state
  FROM public.carrier_policies cp
  WHERE cp.face_amount IS NULL OR cp.annual_premium IS NULL OR cp.face_amount = 0 OR cp.annual_premium = 0
)
SELECT * FROM stats;

-- Per-agent aggregate (for CFO dashboard tile)
CREATE OR REPLACE VIEW public.v_commission_recovery_by_agent AS
  SELECT
    COALESCE(a.display_name, '(unmatched: ' || cp.agent_raw || ')') AS agent_display,
    cp.agent_id,
    count(*) AS total_to_recover,
    count(*) FILTER (WHERE cp.recovery_email_sent_at IS NOT NULL) AS emailed,
    count(*) FILTER (WHERE cp.recovery_response_received_at IS NOT NULL) AS responded,
    count(*) FILTER (WHERE cp.recovery_email_sent_at IS NULL) AS not_yet_emailed
  FROM public.carrier_policies cp
  LEFT JOIN public.agents a ON a.id = cp.agent_id
  WHERE (cp.face_amount IS NULL OR cp.annual_premium IS NULL OR cp.face_amount = 0 OR cp.annual_premium = 0)
  GROUP BY a.display_name, cp.agent_id
  ORDER BY total_to_recover DESC;

-- One-shot helper to emit the "next batch" of policies needing email
CREATE OR REPLACE FUNCTION public.fn_commission_recovery_next_batch(p_limit int DEFAULT 50)
RETURNS TABLE (
  policy_id uuid,
  agent_id uuid,
  agent_display text,
  agent_email text,
  carrier_name text,
  effective_date date,
  client_name text
) LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    cp.id,
    cp.agent_id,
    a.display_name,
    a.email,
    cp.carrier_name,
    cp.effective_date,
    cp.client_first_name || ' ' || cp.client_last_name
  FROM public.carrier_policies cp
  LEFT JOIN public.agents a ON a.id = cp.agent_id
  WHERE (cp.face_amount IS NULL OR cp.annual_premium IS NULL OR cp.face_amount = 0 OR cp.annual_premium = 0)
    AND (cp.recovery_email_sent_at IS NULL OR cp.recovery_email_sent_at < now() - interval '7 days')
    AND cp.recovery_response_received_at IS NULL
    AND a.email IS NOT NULL
  ORDER BY cp.imported_at DESC NULLS LAST
  LIMIT p_limit;
END$$;
