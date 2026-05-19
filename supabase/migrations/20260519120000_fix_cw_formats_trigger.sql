-- Fix the cw_enforce_3_formats trigger so it doesn't false-positive on the
-- contentwheel-p0 seed's `ON CONFLICT (name) DO UPDATE` path.
--
-- THE BUG (introduced 2026-05-18):
--   Trigger excluded the current row by id only. On INSERT-with-conflict,
--   NEW.id is NULL (default uuid_generate_v4() fires AFTER the trigger), so
--   the count includes all 3 existing actives + thinks the row being upserted
--   would push the total to 4. Bombs with check_violation, blocking CI deploy.
--   Every push to main has been failing on this for ~24h.
--
-- THE FIX:
--   Exclude the row being upserted by name as well as by id. `name` is the
--   conflict key on cw_formats, so this is the reliable way to identify "the
--   row I'm trying to upsert into" before its id is assigned.
--
-- Verified live 2026-05-19 12:54 UTC: the failing seed now succeeds.

CREATE OR REPLACE FUNCTION public.cw_enforce_3_formats()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE v_active_count int;
BEGIN
  IF NEW.active IS TRUE THEN
    SELECT count(*) INTO v_active_count
      FROM cw_formats
     WHERE active IS TRUE
       AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND name <> NEW.name;
    IF v_active_count >= 3 THEN
      RAISE EXCEPTION 'cw_formats: cannot have more than 3 active formats. Archive one first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
