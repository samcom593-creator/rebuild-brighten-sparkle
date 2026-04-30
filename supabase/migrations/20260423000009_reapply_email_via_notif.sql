-- Reapply-email blast via send-notification (deployed Resend path).
-- Tradeoff: send-notification auto-CCs admin on every send. User approved
-- shipping via this route to avoid waiting on send-reapply-blast deploy.
-- Throttled 1.2s/send to stay under 60/min rate limit.

CREATE OR REPLACE FUNCTION public.send_reapply_email_blast(p_dry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base text; v_key text; v_row record;
  v_campaign text := 'reapply_doors_open_2026_04_23_email';
  v_first text; v_licensed boolean; v_cta text; v_body_html text;
  v_fired int := 0; v_skipped int := 0; v_list text := '';
BEGIN
  PERFORM set_config('statement_timeout','0', true);
  SELECT value INTO v_base FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key  FROM public.system_settings WHERE key='service_role_key';

  FOR v_row IN
    SELECT id, first_name, email, license_status
    FROM public.applications
    WHERE created_at >= now() - interval '30 days'
      AND terminated_at IS NULL
      AND status IN ('new','no_pickup','reviewing','interview')
      AND email IS NOT NULL AND email <> ''
    ORDER BY created_at DESC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.notification_log
      WHERE LOWER(recipient_email) = LOWER(v_row.email)
        AND metadata->>'campaign' = v_campaign
        AND channel = 'email' AND status = 'sent'
    ) THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    v_licensed := v_row.license_status = 'licensed';
    v_first := COALESCE(NULLIF(TRIM(v_row.first_name),''),'there');
    v_cta := CASE WHEN v_licensed THEN
      'We''ll walk you through contracts today and have you writing deals by Friday.'
    ELSE
      'We fund your license course. You pass the state exam, you''re writing deals inside 30 days.'
    END;

    v_body_html := format(
      $h$Hey %s,<br><br>
When you applied to APEX a few weeks back, we weren't taking anyone new. <strong>Doors are back open this week.</strong><br><br>
This team is not for people looking for a job. It's for people who want to out-earn everyone they went to high school with. If that's not you, delete this.<br><br>
If it <em>is</em> you:<br><br>
<a href="tel:+14697676068" style="display:inline-block;padding:12px 22px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;border-radius:8px">📞 Call (469) 767-6068</a><br><br>
Or reply to this email with <strong>"I'm in"</strong><br><br>
%s<br><br>
— Sam<br>APEX Financial$h$,
      v_first, v_cta);

    IF p_dry THEN
      v_list := v_list || v_first || ' <' || v_row.email || '>; ';
      CONTINUE;
    END IF;

    PERFORM net.http_post(
      url := v_base || '/functions/v1/send-notification',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object(
        'email', v_row.email,
        'title', 'The doors are back open.',
        'message', v_body_html),
      timeout_milliseconds := 20000);
    v_fired := v_fired + 1;

    INSERT INTO public.notification_log (recipient_email, channel, title, message, status, metadata)
    VALUES (v_row.email, 'email', 'The doors are back open.', 'reapply campaign', 'sent',
      jsonb_build_object('campaign', v_campaign, 'applicationId', v_row.id, 'licensed', v_licensed,
        'route','send-notification'));

    PERFORM pg_sleep(1.2);  -- <=60/min rate limit
  END LOOP;

  RETURN jsonb_build_object('campaign', v_campaign, 'dry', p_dry, 'fired', v_fired, 'skipped', v_skipped,
    'preview', CASE WHEN p_dry THEN v_list ELSE NULL END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.send_reapply_email_blast(boolean) TO service_role, authenticated;
