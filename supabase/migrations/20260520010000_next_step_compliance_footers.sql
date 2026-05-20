-- =====================================================================
-- NEXT STEP ENGINE — CAN-SPAM + TCPA compliance footers
-- 2026-05-20 · idempotent
--
-- Adds:
--   - CAN-SPAM unsubscribe link in every email_body_template that lacks one
--     (links to /functions/v1/unsubscribe?u=<email>; the unsubscribe edge fn
--      writes email_unsubscribes which the dispatcher checks pre-send).
--   - "Reply STOP to opt out." appended to every sms_template that lacks it
--     (TCPA — required for marketing SMS).
--
-- Safe to re-run: each UPDATE is guarded by a position(...) check so an
-- already-patched template stays unchanged.
-- =====================================================================

-- Append CAN-SPAM block + correct ?u={{email}} param
update public.next_step_stages
set email_body_template = email_body_template ||
  E'\n<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>\n<p style="font-size:11px;color:#6b7280;line-height:1.5">' ||
  'Apex Financial · Recruiting Communications<br/>' ||
  'You received this because you applied to Apex Financial. ' ||
  'You can <a href="https://xrzweoneiieddzxogewk.supabase.co/functions/v1/unsubscribe?u={{email}}" style="color:#6b7280">unsubscribe</a> ' ||
  'or <a href="mailto:hello@apex-financial.org?subject=STOP">reply STOP</a> to stop these messages.<br/>' ||
  'Apex Financial Empire · Dallas, TX</p>',
  updated_at = now()
where stage_key <> 'closed_lost'
  and email_body_template is not null
  and position('unsubscribe' in email_body_template) = 0;

-- TCPA STOP appended to SMS templates
update public.next_step_stages
set sms_template = sms_template || ' Reply STOP to opt out.',
    updated_at = now()
where stage_key <> 'closed_lost'
  and sms_template is not null and sms_template <> ''
  and position(' Reply STOP to opt out.' in sms_template) = 0;
