-- Phase 8: Enable realtime push on audit_log so the Activity Feed updates live.
-- REPLICA IDENTITY FULL ensures the payload contains the full row.
ALTER TABLE public.audit_log REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'audit_log'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log';
  END IF;
END$$;
