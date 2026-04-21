-- Licensing nudge cron + data backfill for mismatched rows.

-- ─── Cron: daily 10am CST (15:00 UTC) licensing stage sweep ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron missing — skip';
    RETURN;
  END IF;

  PERFORM cron.unschedule('apex-licensing-stage-nudge')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-licensing-stage-nudge');
  PERFORM cron.schedule(
    'apex-licensing-stage-nudge',
    '0 15 * * *',   -- 10am CST
    $sql$SELECT public.run_automation_job('apex-licensing-stage-nudge','licensing-stage-nudge','{}'::jsonb)$sql$
  );
END $$;

-- ─── Auto-fire NIPR verify when a new application claims 'licensed' ──
-- Uses pg_net to hit the verify-nipr edge function async on INSERT.
-- If verify-nipr is unavailable, the HTTP call no-ops.
CREATE OR REPLACE FUNCTION public.auto_nipr_verify_on_apply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  service_url TEXT;
  service_key TEXT;
BEGIN
  IF NEW.license_status = 'licensed' AND NEW.nipr_number IS NOT NULL THEN
    service_url := current_setting('app.settings.supabase_url', true);
    service_key := current_setting('app.settings.service_role_key', true);
    IF service_url IS NOT NULL AND service_key IS NOT NULL AND service_url <> '' THEN
      PERFORM net.http_post(
        url := service_url || '/functions/v1/verify-nipr',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization', 'Bearer ' || service_key
        ),
        body := jsonb_build_object('application_id', NEW.id, 'nipr_number', NEW.nipr_number)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_nipr_verify ON public.applications;
CREATE TRIGGER trg_auto_nipr_verify
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.auto_nipr_verify_on_apply();

-- ─── Backfill: license_status='licensed' AND license_progress='unlicensed' ──
-- There are ~21 rows with this data mismatch. Flip their progress to
-- 'licensed' so the pipeline UI / nudge logic stops treating them as
-- unlicensed prospects.
UPDATE public.applications
  SET license_progress = 'licensed'::license_progress,
      license_approved_at = COALESCE(license_approved_at, now())
  WHERE license_status = 'licensed' AND license_progress = 'unlicensed';
