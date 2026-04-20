-- Step 22: InsuraCloud auto-push outbox processor
INSERT INTO public.system_settings (key, value)
VALUES ('insuracloud_autopush_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.deals_trigger_insuracloud_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_enabled text;
  v_service_key text;
BEGIN
  IF NEW.synced_to_insuracloud_at IS NOT NULL OR NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_enabled FROM public.system_settings WHERE key = 'insuracloud_autopush_enabled';
  IF COALESCE(v_enabled, 'true') NOT IN ('true', '1', 'TRUE') THEN
    RETURN NEW;
  END IF;

  v_service_key := current_setting('app.settings.service_role_key', true);
  IF v_service_key IS NULL OR v_service_key = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/insuracloud-outbox',
    body := jsonb_build_object('deal_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    )
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_autopush_insuracloud ON public.deals;
CREATE TRIGGER trg_deals_autopush_insuracloud
AFTER INSERT ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.deals_trigger_insuracloud_push();

SELECT cron.unschedule('insuracloud-outbox-sweeper')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'insuracloud-outbox-sweeper');

SELECT cron.schedule(
  'insuracloud-outbox-sweeper',
  '*/10 * * * *',
  $sweeper$
  SELECT public.run_automation_job(
    'insuracloud-outbox-sweeper',
    'insuracloud-outbox',
    '{"sweep": true}'::jsonb
  );
  $sweeper$
);

CREATE TABLE IF NOT EXISTS public.insuracloud_backfill_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  agents_matched integer NOT NULL DEFAULT 0,
  agents_unmatched integer NOT NULL DEFAULT 0,
  carriers_matched integer NOT NULL DEFAULT 0,
  carriers_unmatched integer NOT NULL DEFAULT 0,
  details jsonb,
  ran_by uuid
);

ALTER TABLE public.insuracloud_backfill_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ic_backfill_admin_all" ON public.insuracloud_backfill_log;
CREATE POLICY "ic_backfill_admin_all"
ON public.insuracloud_backfill_log
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));