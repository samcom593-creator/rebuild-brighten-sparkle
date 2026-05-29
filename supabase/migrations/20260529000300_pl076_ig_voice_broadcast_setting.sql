-- PL-076: register the Discord voice-channel webhook URL slot in
-- system_settings so the ig-voice-broadcast edge fn knows where to send
-- sanitized recruit/deal notifications.
--
-- The row is inserted with an EMPTY value on purpose — Sam-only action
-- is to paste the actual voice-channel webhook URL when he creates the
-- channel in Discord. Until then the edge fn returns {status:'disabled'}
-- without erroring so upstream callers (instagram-webhook, post-deal,
-- etc.) never hard-fail when broadcasting.
insert into system_settings (key, value, updated_at)
values (
  'discord_webhook_url_voice',
  '',
  now()
)
on conflict (key) do nothing;

comment on column system_settings.value is
  'Per-key value. PL-076 added discord_webhook_url_voice for ig-voice-broadcast edge fn. Set this when the Discord voice channel is created.';
