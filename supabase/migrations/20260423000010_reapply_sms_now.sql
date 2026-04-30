-- Reapply-SMS-only blast — fires via send-sms-auto-detect (deployed).
-- Throttled 500ms between sends to avoid pg_net burst that collapses the
-- edge function's cold-start pool (what killed the first attempt).
-- Dedup via notification_log.metadata.campaign.

CREATE OR REPLACE FUNCTION public.send_reapply_sms_blast(p_dry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'reapply_doors_open_2026_04_23';
  v_sms text; v_licensed boolean; v_first text;
  v_fired int := 0; v_skipped int := 0; v_names text := '';
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';

  FOR v_row IN
    SELECT id, first_name, email, phone, license_status
    FROM public.applications
    WHERE created_at >= now() - interval '30 days'
      AND terminated_at IS NULL
      AND status IN ('new','no_pickup','reviewing','interview')
      AND phone IS NOT NULL AND phone <> ''
    ORDER BY created_at DESC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.notification_log
      WHERE LOWER(recipient_email) = LOWER(v_row.email)
        AND metadata->>'campaign' = v_campaign
        AND channel = 'sms' AND status = 'sent'
    ) THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    v_licensed := v_row.license_status = 'licensed';
    v_first := COALESCE(NULLIF(TRIM(v_row.first_name),''),'there');
    v_sms := CASE WHEN v_licensed THEN
      'Sam from APEX. Doors are back open — we''re pulling the gloves back on. You''re already licensed; we want you carrying our flag. Call (469) 767-6068 or reply YES to reapply.'
    ELSE
      'Sam from APEX. Doors are back open — we''re hiring again. No license? We fund your course. Call (469) 767-6068 or reply YES and we''ll get you on a call today.'
    END;

    IF p_dry THEN
      v_names := v_names || v_first || ' (' || v_row.phone || '), ';
      CONTINUE;
    END IF;

    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-sms-auto-detect',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object(
        'phone', v_row.phone,
        'message', v_sms,
        'applicationId', v_row.id),
      timeout_milliseconds := 15000);
    v_fired := v_fired + 1;

    -- Log the SMS attempt (status='sent' since we got the queue ack)
    INSERT INTO public.notification_log (recipient_email, recipient_phone, channel, title, message, status, metadata)
    VALUES (v_row.email, v_row.phone, 'sms', 'The doors are back open.', v_sms, 'sent',
      jsonb_build_object('campaign', v_campaign, 'applicationId', v_row.id, 'licensed', v_licensed));

    PERFORM pg_sleep(0.5);  -- 2/sec cadence — enough headroom for cold starts
  END LOOP;

  RETURN jsonb_build_object('campaign', v_campaign, 'dry', p_dry, 'fired', v_fired, 'skipped', v_skipped,
    'preview', CASE WHEN p_dry THEN v_names ELSE NULL END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.send_reapply_sms_blast(boolean) TO service_role, authenticated;
