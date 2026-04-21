-- Team chat — real-time messages visible to every authenticated user
CREATE TABLE IF NOT EXISTS public.team_chat_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  author_name text NOT NULL,
  author_avatar text,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_chat_created ON public.team_chat_messages(created_at DESC);

ALTER TABLE public.team_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_read_team_chat ON public.team_chat_messages;
CREATE POLICY auth_read_team_chat ON public.team_chat_messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS auth_insert_team_chat ON public.team_chat_messages;
CREATE POLICY auth_insert_team_chat ON public.team_chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS author_delete_team_chat ON public.team_chat_messages;
CREATE POLICY author_delete_team_chat ON public.team_chat_messages FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Enable Realtime
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.team_chat_messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
