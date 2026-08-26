-- Real Slack community destinations and durable applicant workspace invites.
--
-- Channel IDs below were created and verified in the production APEX Financial
-- Slack workspace on 2026-08-25. Do not replace them with C_* placeholders.

insert into public.system_settings (key, value)
values (
  'slack_community_invite_url',
  'https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ'
)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

with live_installation as (
  select id
  from public.messaging_workspace_installations
  where provider = 'slack'
    and environment = 'production'
    and status = 'active'
  order by installed_at desc nulls last, created_at desc
  limit 1
), destinations(purpose, channel_id, channel_name, privacy_level) as (
  values
    ('general_licensed', 'C0BS9F2M35M', 'general-licensed', 'public'),
    ('general_unlicensed', 'C0BSUGBR62G', 'general-unlicensed', 'public'),
    ('leadership_builders', 'C0BSSPUACN5', 'apex-leadership', 'private'),
    ('admin_contracting', 'C0BTK7BHCTS', 'admin-contracting-desk', 'private'),
    ('licensing_support', 'C0BS9F2V3M5', 'licensing-academy-support', 'public'),
    ('trainer_coaching', 'C0BTK7BCDEC', 'trainer-coaching-vault', 'private')
)
insert into public.messaging_destinations (
  installation_id,
  purpose,
  channel_id,
  channel_name,
  scope_type,
  privacy_level,
  is_enabled,
  verified_at
)
select
  live_installation.id,
  destinations.purpose,
  destinations.channel_id,
  destinations.channel_name,
  'organization',
  destinations.privacy_level,
  true,
  now()
from live_installation
cross join destinations
on conflict (installation_id, purpose, scope_type, (coalesce(scope_key, '')))
do update set
  channel_id = excluded.channel_id,
  channel_name = excluded.channel_name,
  privacy_level = excluded.privacy_level,
  is_enabled = true,
  verified_at = now(),
  updated_at = now();

-- The outbox payload is deliberately PII-free. The dispatcher resolves email,
-- phone, consent, and carrier server-side from aggregate_id at delivery time.
create or replace function public.trg_auto_dispatch_slack_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.outbox_events (
    aggregate_type,
    aggregate_id,
    event_type,
    destination,
    payload,
    idempotency_key
  ) values (
    'application',
    new.id,
    'recruiting.slack_invite_requested',
    'application_slack_invite',
    jsonb_build_object('applicationId', new.id),
    'recruiting.slack_invite:' || new.id::text
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_applicant_slack_invite on public.applications;
create trigger trg_applicant_slack_invite
  after insert on public.applications
  for each row execute function public.trg_auto_dispatch_slack_invite();

comment on function public.trg_auto_dispatch_slack_invite() is
  'Queues one PII-free durable Slack workspace invitation event for every new application. Email is automatic; SMS delivery is consent-gated by the dispatcher.';
