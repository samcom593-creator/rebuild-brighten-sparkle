-- Unified inbound inbox: TikTok/Instagram/FB DMs, SMS replies, etc.
-- Ingested by the manychat-webhook edge function (ManyChat is the aggregator
-- that covers Instagram + Messenger natively; TikTok we'll route via the
-- same shape so it all lands in one queue).

CREATE TABLE IF NOT EXISTS public.inbox_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,                           -- 'tiktok' | 'instagram' | 'messenger' | 'sms' | 'email' | 'whatsapp'
  external_id   TEXT,                                    -- ManyChat subscriber ID or platform message id
  sender_handle TEXT,                                    -- @username or phone
  sender_name   TEXT,
  sender_avatar TEXT,
  body          TEXT NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'inbound'          -- 'inbound' | 'outbound'
                 CHECK (direction IN ('inbound','outbound')),
  intent        TEXT,                                    -- 'interested' | 'licensed' | 'spam' | 'question' | 'unknown'
  assigned_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_score    INTEGER DEFAULT 0,
  replied_at    TIMESTAMPTZ,
  auto_replied  BOOLEAN DEFAULT false,
  application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL,
  raw_payload   JSONB,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_source_recv ON public.inbox_messages(source, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_sender ON public.inbox_messages(sender_handle);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_intent ON public.inbox_messages(intent) WHERE intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_messages_assigned ON public.inbox_messages(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_messages_unreplied ON public.inbox_messages(received_at DESC) WHERE replied_at IS NULL AND direction = 'inbound';

ALTER TABLE public.inbox_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage all inbox" ON public.inbox_messages;
CREATE POLICY "Admins manage all inbox"
  ON public.inbox_messages FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Assigned user sees own" ON public.inbox_messages;
CREATE POLICY "Assigned user sees own"
  ON public.inbox_messages FOR SELECT TO public
  USING (assigned_to = auth.uid());
