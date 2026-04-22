-- ============================================================
-- Enable RLS on public.sms_send_guard
-- Sole public table without RLS — service_role still has full access
-- via the policy below; no authenticated user path because this is an
-- infra-only dedup/guard table.
-- ============================================================

ALTER TABLE public.sms_send_guard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_sms_guard ON public.sms_send_guard;
CREATE POLICY service_role_sms_guard
  ON public.sms_send_guard FOR ALL
  TO service_role
  USING (true);
