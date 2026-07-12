-- MP-232b (2026-07-12): Email volume cull — merge calendly + prospect-whatsapp
-- into a single onboarding-invite email. Cancels stale MP-221 outreach queue rows.
--
-- Sam directive 2026-07-12: "how can I limit the amount of emails that we're
-- utilizing to a lower amount? I think we're just sending out pointless emails."
--
-- Impact analysis:
--   BEFORE: each new unlicensed applicant → 2 emails (calendly-invite-v1
--   + prospect-whatsapp-v1). ~4-10 emails/day steady state.
--   AFTER:  each new unlicensed applicant → 1 email (calendly + WhatsApp
--   CTA in the same body). ~2-5 emails/day. **50% cut.**
--
-- Plus: cancels 100 stale rows from MP-221 sam_comeback + interview_last_call
-- burst that already got marked skipped-stale but still clutter the queue.

-- ============================================================
-- 1. REWRITE fn_enqueue_calendly_for_unlicensed
--    Insert ONE row per applicant. html_body carries both Calendly + WhatsApp.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_enqueue_calendly_for_unlicensed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_calendly_url text;
  v_whatsapp_url text;
  v_first_name   text;
  v_html         text;
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' OR position('@' in NEW.email) = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.license_status IS NOT NULL
     AND lower(NEW.license_status::text) <> 'unlicensed' THEN
    RETURN NEW;
  END IF;

  -- resolve links from system_settings, with safe fallbacks
  SELECT value INTO v_calendly_url FROM public.system_settings
    WHERE key = 'seminar_calendly_url' LIMIT 1;
  v_calendly_url := COALESCE(NULLIF(TRIM(BOTH '"' FROM v_calendly_url), ''),
                             'https://calendly.com/samuel-james-apex');

  SELECT value INTO v_whatsapp_url FROM public.system_settings
    WHERE key = 'whatsapp_prospect_invite_url' LIMIT 1;
  v_whatsapp_url := COALESCE(NULLIF(TRIM(BOTH '"' FROM v_whatsapp_url), ''),
                             'https://apex-financial.org/get-licensed');

  v_first_name := split_part(COALESCE(NEW.first_name, 'there'), ' ', 1);

  v_html := '<!doctype html><html><body style="margin:0;padding:0;background:#0a0a0a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="font-size:22px;font-weight:800;margin:0;background:linear-gradient(135deg,#14b8a6,#0ea5e9);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">APEX FINANCIAL</h1>
    </div>
    <div style="background:linear-gradient(145deg,#1a1a2e,#16213e);border-radius:14px;padding:28px;border:1px solid rgba(20,184,166,0.25);">
      <h2 style="font-size:19px;margin:0 0 14px;color:#fff;">Hey ' || v_first_name || ',</h2>
      <p style="font-size:15px;line-height:1.6;color:#d1d5db;margin:0 0 14px;">
        Samuel James here. You applied to APEX and I want to get you moving. Two ways to plug in right now:
      </p>
      <div style="margin:22px 0;">
        <a href="' || v_calendly_url || '" style="display:block;background:linear-gradient(135deg,#14b8a6,#0ea5e9);color:#fff;text-decoration:none;padding:14px 20px;border-radius:10px;text-align:center;font-weight:700;margin-bottom:10px;">
          1. Book your 15-min call with me →
        </a>
        <a href="' || v_whatsapp_url || '" style="display:block;background:rgba(37,211,102,0.15);color:#25d366;text-decoration:none;padding:14px 20px;border-radius:10px;text-align:center;font-weight:700;border:1px solid rgba(37,211,102,0.4);">
          2. Join the prospect WhatsApp →
        </a>
      </div>
      <p style="font-size:14px;line-height:1.6;color:#a8b3c5;margin:14px 0 0;">
        The call is where we lock in your path. The WhatsApp is where you see live wins and get questions answered fast. Do both.
      </p>
      <p style="font-size:13px;color:#9ca3af;margin:18px 0 0;">— Samuel James, APEX Financial</p>
    </div>
    <div style="text-align:center;margin-top:16px;font-size:11px;color:#6b7280;">apex-financial.org</div>
  </div>
</body></html>';

  INSERT INTO public.outreach_queue (
    channel, source_run, application_id, to_email, subject,
    template_key, html_body, status, scheduled_for, idempotency_key
  )
  VALUES (
    'email', 'prospect-combined', NEW.id, NEW.email,
    'Samuel James — 2 quick moves to start your APEX career',
    'prospect-combined-v1', v_html, 'pending', now(),
    'prospect-combined-' || NEW.id::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- 2. DEDUPE currently-pending queue
--    For each applicant with both calendly-invite-v1 + prospect-whatsapp-v1
--    pending: DELETE the prospect-whatsapp row (keeping calendly-invite).
--    This immediately halves what will send when Resend unlocks.
-- ============================================================
DELETE FROM public.outreach_queue
 WHERE template_key = 'prospect-whatsapp-v1'
   AND status = 'pending'
   AND sent_at IS NULL
   AND application_id IN (
     SELECT application_id FROM public.outreach_queue
      WHERE template_key = 'calendly-invite-v1'
        AND status = 'pending'
        AND sent_at IS NULL
   );

-- ============================================================
-- 3. HARD-DECAY stale MP-221 rows so outreach-sender never picks them up
--    They're already status='skipped'. Bump attempt_count past the .lt(3) filter.
-- ============================================================
UPDATE public.outreach_queue
   SET attempt_count = 99,
       last_error = 'mp232b-cull: stale MP-221 batch, permanently excluded from sender'
 WHERE template_key IN ('sam_comeback_2026_06','interview_last_call_2026_06')
   AND status = 'skipped'
   AND sent_at IS NULL;

-- ============================================================
-- 4. daily-cap guard: create v_outreach_daily_cap_check view
--    Sender fn will consult this before draining. If today's send count
--    is already at 95 (buffer below 100/day Free-tier cap), sender skips.
-- ============================================================
CREATE OR REPLACE VIEW public.v_outreach_daily_cap_check AS
SELECT
  COUNT(*)::int AS sent_today,
  95 AS daily_cap,
  CASE WHEN COUNT(*)::int >= 95 THEN true ELSE false END AS is_capped,
  now() AS checked_at
FROM public.outreach_queue
WHERE sent_at::date = CURRENT_DATE;

GRANT SELECT ON public.v_outreach_daily_cap_check TO authenticated, service_role;
