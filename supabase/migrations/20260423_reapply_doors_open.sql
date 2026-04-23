-- ════════════════════════════════════════════════════════════════════════
-- Reapply-blast: "The doors are back open"
-- 30-day warm applicants who never converted. Licensed variant vs Unlicensed
-- variant (different CTA). Email via send-bulk-email, SMS via
-- send-sms-auto-detect. Campaign-tagged in notification_log for dedup.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.send_reapply_blast(p_dry_run boolean DEFAULT false, p_limit int DEFAULT 999)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net
AS $fn$
DECLARE
  v_base_url  text;
  v_key       text;
  v_campaign  text := 'reapply_doors_open_2026_04_23';
  v_row       record;
  v_subject   text := 'The doors are back open.';
  v_cta       text;
  v_html      text;
  v_text      text;
  v_sms       text;
  v_first     text;
  v_sent_email int := 0;
  v_sent_sms   int := 0;
  v_skipped    int := 0;
  v_failed     int := 0;
  v_list       jsonb := '[]'::jsonb;
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  -- Resolve service URL + key from system_settings
  SELECT value INTO v_base_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_key      FROM public.system_settings WHERE key='service_role_key';
  IF v_base_url IS NULL OR v_key IS NULL THEN
    RETURN jsonb_build_object('error','supabase_url or service_role_key missing in system_settings');
  END IF;

  FOR v_row IN
    SELECT id, first_name, last_name, email, phone, license_status
    FROM public.applications
    WHERE created_at >= now() - interval '30 days'
      AND terminated_at IS NULL
      AND status IN ('new','no_pickup','reviewing','interview')
      AND email IS NOT NULL AND email <> ''
    ORDER BY created_at DESC
    LIMIT p_limit
  LOOP
    -- Dedup: skip if this campaign already sent to this email
    IF EXISTS (
      SELECT 1 FROM public.notification_log
      WHERE LOWER(recipient_email) = LOWER(v_row.email)
        AND metadata->>'campaign' = v_campaign
        AND status = 'sent'
    ) THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;

    v_first := COALESCE(NULLIF(TRIM(v_row.first_name),''), 'there');

    IF v_row.license_status = 'licensed' THEN
      v_cta := 'We''ll walk you through contracts today and have you writing deals by Friday.';
      v_sms := 'Sam from APEX. Doors are back open — we''re pulling the gloves back on. You''re already licensed; we want you carrying our flag. Call (469) 767-6068 or reply YES to reapply.';
    ELSE
      v_cta := 'We fund your license course. You pass the state exam, you''re writing deals inside 30 days.';
      v_sms := 'Sam from APEX. Doors are back open — we''re hiring again. No license? We fund your course. Call (469) 767-6068 or reply YES and we''ll get you on a call today.';
    END IF;

    -- Plain text version
    v_text := format(
      E'Hey %s,\n\nWhen you applied to APEX a few weeks back, we weren''t taking anyone new. Doors are back open this week.\n\nThis team is not for people looking for a job. It''s for people who want to out-earn everyone they went to high school with. If that''s not you, delete this.\n\nIf it IS you:\n\n→ Call me now: (469) 767-6068\n→ Or reply to this email with "I''m in"\n\n%s\n\n— Sam\nAPEX Financial',
      v_first, v_cta);

    -- HTML version (kept lightweight — MTA-friendly)
    v_html := format(
      $h$<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0b1220;line-height:1.6">
<p>Hey %s,</p>
<p>When you applied to APEX a few weeks back, we weren't taking anyone new. <strong>Doors are back open this week.</strong></p>
<p>This team is not for people looking for a job. It's for people who want to out-earn everyone they went to high school with. If that's not you, delete this.</p>
<p>If it <em>is</em> you:</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0">
<tr><td style="padding:12px 22px;background:#0f172a;border-radius:8px">
  <a href="tel:+14697676068" style="color:#fff;font-weight:700;text-decoration:none;font-size:16px">📞 Call (469) 767-6068</a>
</td></tr>
</table>
<p style="color:#475569;font-size:14px">Or reply to this email with <strong>"I'm in"</strong></p>
<p style="margin-top:24px">%s</p>
<p>— Sam<br><span style="color:#64748b;font-size:13px">APEX Financial</span></p>
</div>$h$,
      v_first, v_cta);

    IF p_dry_run THEN
      v_list := v_list || jsonb_build_object(
        'id', v_row.id, 'email', v_row.email, 'phone', v_row.phone,
        'name', v_first, 'licensed', v_row.license_status = 'licensed',
        'sms_preview', v_sms, 'email_subject', v_subject);
      CONTINUE;
    END IF;

    -- Fire email via send-bulk-email (one recipient, personalized body)
    PERFORM net.http_post(
      url := v_base_url || '/functions/v1/send-bulk-email',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer '||v_key,
        'apikey', v_key),
      body := jsonb_build_object(
        'recipients', jsonb_build_array(jsonb_build_object('email', v_row.email, 'name', v_first)),
        'subject', v_subject,
        'html', v_html,
        'text', v_text),
      timeout_milliseconds := 20000);
    v_sent_email := v_sent_email + 1;

    -- Fire SMS via send-sms-auto-detect (tolerates missing carrier)
    IF v_row.phone IS NOT NULL AND v_row.phone <> '' THEN
      PERFORM net.http_post(
        url := v_base_url || '/functions/v1/send-sms-auto-detect',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||v_key,
          'apikey', v_key),
        body := jsonb_build_object(
          'phone', v_row.phone,
          'message', v_sms,
          'applicationId', v_row.id),
        timeout_milliseconds := 15000);
      v_sent_sms := v_sent_sms + 1;
    END IF;

    -- Log the send for dedup + audit
    INSERT INTO public.notification_log
      (recipient_email, channel, title, message, status, metadata)
    VALUES
      (v_row.email, 'email', v_subject, 'reapply blast', 'sent',
       jsonb_build_object('campaign', v_campaign, 'applicationId', v_row.id, 'licensed', v_row.license_status = 'licensed'));
  END LOOP;

  RETURN jsonb_build_object(
    'campaign', v_campaign,
    'dry_run', p_dry_run,
    'sent_email', v_sent_email,
    'sent_sms',   v_sent_sms,
    'skipped_dedup', v_skipped,
    'failed', v_failed,
    'preview', CASE WHEN p_dry_run THEN v_list ELSE NULL END);
END $fn$;
GRANT EXECUTE ON FUNCTION public.send_reapply_blast(boolean,int) TO service_role, authenticated;

SELECT 'send_reapply_blast installed' AS r;
