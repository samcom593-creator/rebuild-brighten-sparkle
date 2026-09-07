-- 20260907233000_retire_whatsapp_settings.sql
-- Sam, 2026-09-07: "we're still saying WhatsApp. We don't even use WhatsApp.
-- Remove all that." Code side shipped in the same commit (InboxPage copy,
-- send-seminar-invite-blast CTA -> Slack, send-login-to-manager wording,
-- apex-alert-dispatch WhatsApp channel removed, dead send-whatsapp function
-- deleted). This is the data side: the two orphan invite rows seeded by
-- 20260701140000 whose last reader was retired on 2026-08-28.
--
-- Deliberately NOT rewritten here: broadcast_to_all_channels(),
-- trg_fn_reward_broadcast(), trg_fn_new_app_notify() and fn_reissue_40d_*
-- still contain a WhatsApp line, but every one of them reads
-- system_settings.whatsapp_group_link, which 20260701140000 deleted — the
-- line cannot render. Redefining four live trigger functions to remove dead
-- text is more risk than value; recorded so nobody re-inserts that key.

delete from public.system_settings
 where key in ('whatsapp_prospect_invite_url', 'whatsapp_hired_invite_url', 'whatsapp_group_link', 'whatsapp_group_invite_url');
