-- 20260504143100 — add the FK constraint applications.referral_manager_id → agents.id.
-- The column has been used as an agent_id reference in app code for a while
-- (the routing trigger looks up agents.id by it) but no FK constraint
-- existed, so PostgREST refused to embed the relationship and any client
-- query attempting `referrer:agents!applications_referral_manager_id_fkey`
-- was rejected with PGRST200.
--
-- ON DELETE SET NULL because losing a referrer agent shouldn't cascade-
-- delete the application — the application stays, it just becomes
-- unattributed (no_referrer state).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'applications_referral_manager_id_fkey'
      AND conrelid = 'public.applications'::regclass
  ) THEN
    -- Null out any orphan references first so the FK can be created cleanly.
    UPDATE public.applications a
    SET referral_manager_id = NULL
    WHERE a.referral_manager_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.agents WHERE id = a.referral_manager_id);

    ALTER TABLE public.applications
      ADD CONSTRAINT applications_referral_manager_id_fkey
      FOREIGN KEY (referral_manager_id) REFERENCES public.agents(id)
      ON DELETE SET NULL;
  END IF;
END $$;
