-- Overnight DM digest. While Sam sleeps, instagram-webhook auto-classifies
-- and auto-replies to inbound DMs via the Sam-voice templates. At 7am CST
-- (12:00 UTC), this function emails him a one-screen summary of what
-- happened overnight so he can spot anything the auto-replier got wrong.

CREATE OR REPLACE FUNCTION public.dm_overnight_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_svc_url text;
  v_svc_key text;
  v_inbound_count int;
  v_replied_count int;
  v_hot_count int;
  v_skipped_count int;
  v_body text;
  v_window_hours int := 14;  -- "overnight" = last 14h since 7am-prior-day
BEGIN
  PERFORM set_config('statement_timeout','0', true);

  SELECT value INTO v_svc_url FROM public.system_settings WHERE key='supabase_url';
  SELECT value INTO v_svc_key FROM public.system_settings WHERE key='supabase_anon_key';
  IF v_svc_url IS NULL THEN v_svc_url := 'https://xrzweoneiieddzxogewk.supabase.co'; END IF;

  SELECT COUNT(*) FILTER (WHERE direction = 'inbound')::int,
         COUNT(*) FILTER (WHERE direction = 'outbound')::int,
         COUNT(*) FILTER (WHERE direction = 'inbound' AND lead_score >= 70)::int,
         COUNT(*) FILTER (WHERE direction = 'inbound' AND auto_replied = false)::int
  INTO v_inbound_count, v_replied_count, v_hot_count, v_skipped_count
  FROM public.inbox_messages
  WHERE created_at > NOW() - (v_window_hours || ' hours')::interval;

  IF v_inbound_count = 0 THEN
    RETURN jsonb_build_object('inbound', 0, 'skipped', 'no_inbound');
  END IF;

  -- Build the digest HTML: top hot leads + sample replies + skipped list
  WITH hot AS (
    SELECT sender_handle, sender_name, body AS msg, intent, lead_score, created_at
    FROM public.inbox_messages
    WHERE direction = 'inbound'
      AND lead_score >= 70
      AND created_at > NOW() - (v_window_hours || ' hours')::interval
    ORDER BY lead_score DESC, created_at DESC
    LIMIT 10
  ),
  skipped AS (
    SELECT sender_handle, body AS msg, intent, created_at
    FROM public.inbox_messages
    WHERE direction = 'inbound'
      AND auto_replied = false
      AND intent NOT IN ('spam', 'not_interested')
      AND created_at > NOW() - (v_window_hours || ' hours')::interval
    ORDER BY created_at DESC
    LIMIT 5
  ),
  hot_html AS (
    SELECT string_agg(format(
      '<div style="margin:8px 0;padding:10px;background:#f8fafc;border-left:3px solid #10b981;border-radius:4px"><strong>%s</strong> · <span style="color:#10b981;font-weight:700">tier %s</span> · <span style="color:#64748b;font-size:12px">%s</span><br/><span style="color:#0f172a">%s</span></div>',
      COALESCE(NULLIF(sender_name,''), sender_handle, 'unknown'),
      lead_score,
      to_char(created_at AT TIME ZONE 'America/Chicago', 'HH12:MI AM'),
      LEFT(msg, 200)), '') AS html
    FROM hot
  ),
  skipped_html AS (
    SELECT string_agg(format(
      '<div style="margin:6px 0;padding:8px;background:#fef9c3;border-radius:4px;font-size:13px"><strong>%s</strong> said: "%s" <span style="color:#854d0e">(intent: %s, no auto-reply fired)</span></div>',
      COALESCE(sender_handle, 'unknown'),
      LEFT(msg, 120),
      intent), '') AS html
    FROM skipped
  )
  SELECT format(
    '<h2 style="margin:0 0 8px 0">DM digest — overnight</h2>'
    '<p style="color:#64748b;margin:0 0 16px 0">%s inbound · %s auto-replies fired · %s hot leads (≥70) · %s needed your manual touch</p>'
    '<h3 style="color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px">🔥 Hot leads (call these first)</h3>'
    '%s'
    '<h3 style="color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin-top:24px">⚠️ Got past the auto-replier — needs you</h3>'
    '%s'
    '<p style="margin-top:24px"><a href="https://apex-financial.org/dashboard/inbox" style="color:#0ea5e9">Open inbox →</a></p>',
    v_inbound_count, v_replied_count, v_hot_count, v_skipped_count,
    COALESCE((SELECT html FROM hot_html), '<p style="color:#64748b">no hot leads tonight</p>'),
    COALESCE((SELECT html FROM skipped_html), '<p style="color:#64748b">none — auto-replier covered everything</p>')
  ) INTO v_body;

  IF v_svc_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_svc_url || '/functions/v1/send-admin-email',
      body := jsonb_build_object(
        'to','info@kingofsales.net',
        'subject', format('💬 DM digest · %s overnight (%s hot)', v_inbound_count, v_hot_count),
        'html', v_body),
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));

    -- SMS only if there are HOT leads worth waking up to
    IF v_hot_count > 0 THEN
      PERFORM net.http_post(
        url := v_svc_url || '/functions/v1/send-sms-auto-detect',
        body := jsonb_build_object(
          'phone','4697676068',
          'message', format('APEX 💬 %s DMs overnight, %s hot leads — check email for chase list.', v_inbound_count, v_hot_count)),
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer '||v_svc_key,'apikey', v_svc_key));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'inbound', v_inbound_count,
    'replied', v_replied_count,
    'hot', v_hot_count,
    'needs_manual', v_skipped_count
  );
END;
$body$;

-- Schedule: 12:00 UTC = 7am CDT / 6am CST (depending on season)
DO $$ BEGIN PERFORM cron.unschedule('dm-overnight-digest'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('dm-overnight-digest', '0 12 * * *',
  'SELECT public.dm_overnight_digest();')::text;
