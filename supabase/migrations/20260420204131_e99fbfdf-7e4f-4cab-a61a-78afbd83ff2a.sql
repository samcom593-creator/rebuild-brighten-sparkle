CREATE TABLE IF NOT EXISTS public.inbox_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,
  external_id   TEXT,
  sender_handle TEXT,
  sender_name   TEXT,
  sender_avatar TEXT,
  body          TEXT NOT NULL,
  direction     TEXT NOT NULL DEFAULT 'inbound'
                 CHECK (direction IN ('inbound','outbound')),
  intent        TEXT,
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