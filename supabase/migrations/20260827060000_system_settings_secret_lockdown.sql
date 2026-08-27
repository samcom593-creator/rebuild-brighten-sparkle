-- CRITICAL security fix (head-to-toe audit 2026-08-27): public.system_settings
-- had a SELECT policy `USING (true)` for role `authenticated`, so every one of
-- ~549 authenticated accounts (every agent, and anyone who self-registers via
-- /agent-signup) could read the LIVE service_role key, the bot-sql admin token,
-- the Stripe live secret, Resend/Postmark/ManyChat/ReadyMode keys, the
-- InsuraCloud API token, and Sam's AgentLink session cookie — total production
-- compromise reachable by a signup.
--
-- Edge functions read system_settings via the SERVICE ROLE, which bypasses RLS,
-- so restricting client reads does not touch them. The only non-admin CLIENT
-- readers pull NON-secret config (seminar_*, readymode_inventory_*,
-- icloud_photos_link, hire goals, invite URLs), which stay readable below.
--
-- Non-admins may read a key only when it is NOT secret-shaped
-- (secret|token|cookie|password|_key anywhere in the name) and not one of the
-- two explicitly-named non-matching secrets. Admins keep full access. New
-- secrets that follow the naming convention are protected by default.

drop policy if exists "Authenticated users can read system settings" on public.system_settings;

create policy "read non-secret system settings"
  on public.system_settings
  for select
  to authenticated
  using (
    public.apex_is_admin()
    or not (
      lower(key) ~ '(secret|token|cookie|password|_key)'
      or key in ('stripe_webhook_apex', 'service_role_key')
    )
  );

comment on policy "read non-secret system settings" on public.system_settings is
  'Non-admins read only non-secret config keys; secrets (service_role_key, *_token, *_secret, *_key, *cookie*, stripe_webhook_apex) are admin-only. Edge functions use the service role and bypass RLS. Added by the 2026-08-27 head-to-toe audit.';
