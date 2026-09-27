-- New-hire portal-login auto-send (mirrors prod applied via bot-sql 2026-09-26).
-- Fixes: 26% of hired agents never signed in because the magic-login email was
-- a manual admin click (send-bulk-portal-logins), never wired into onboarding.
-- The account existed with a system-set password they were never told, no
-- invite email, and the sequence only sent Discord/course/call links that all
-- land behind auth. This adds an isolated hourly job that mails the SAME one-tap
-- magic-login email to new hires who have a login but have NEVER signed in.

-- Recipient selection (single source of truth for who gets a link).
create or replace view public.v_newhire_needs_portal_login as
select
  a.id                       as agent_id,
  a.created_at               as hired_at,
  p.email                    as email,
  coalesce(p.full_name, a.display_name, 'Agent') as full_name,
  lower(coalesce(a.license_status::text,'')) as license_status,
  a.invited_by_manager_id    as manager_id,
  mp.email                   as manager_email
from public.agents a
join auth.users u      on u.id = a.user_id
join public.profiles p on p.user_id = a.user_id
left join public.agents ma  on ma.id = a.invited_by_manager_id
left join public.profiles mp on mp.user_id = ma.user_id
where a.created_at > now() - interval '30 days'
  and a.user_id is not null
  and coalesce(a.is_deactivated,false) = false
  and coalesce(a.status::text,'') <> 'terminated'
  and u.last_sign_in_at is null                       -- never signed in
  and p.email is not null and p.email <> ''
  and position('placeholder' in lower(p.email)) = 0
  and not exists (                                    -- self-limit: <=1 send / 72h
    select 1 from public.magic_login_tokens t
    where t.agent_id = a.id and t.destination = 'portal'
      and t.created_at > now() - interval '72 hours'
  );
revoke all on public.v_newhire_needs_portal_login from anon, authenticated;

-- Hourly trigger of the cron-newhire-portal-login edge function. The x-cron-secret
-- is read from Vault by NAME (never a literal in source). If the secret is absent
-- in a given environment the function returns 401 and mails no one — a safe no-op.
select cron.schedule(
  'apex-newhire-portal-login-hourly',
  '22 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/cron-newhire-portal-login',
    headers := jsonb_build_object(
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='newhire_cron_secret' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
