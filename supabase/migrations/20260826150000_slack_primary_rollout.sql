-- APEX Slack primary-app rollout (2026-08-26).
--
-- The Slack audience is deliberately independent from the production hierarchy.
-- KJ Vaughns and his seven active direct reports remain active APEX agents and
-- keep all production attribution, but none may be invited, linked, routed to a
-- Slack DM, or counted as Slack-eligible.

begin;

create table if not exists public.messaging_audience_exclusions (
  provider text not null check (provider in ('slack')),
  agent_id uuid not null references public.agents(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 3 and 300),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, agent_id)
);

alter table public.messaging_audience_exclusions enable row level security;

drop policy if exists messaging_audience_exclusions_admin_read
  on public.messaging_audience_exclusions;
create policy messaging_audience_exclusions_admin_read
  on public.messaging_audience_exclusions for select to authenticated
  using (public.apex_is_admin());

grant select on public.messaging_audience_exclusions to authenticated;
grant all on public.messaging_audience_exclusions to service_role;

insert into public.messaging_audience_exclusions(provider, agent_id, reason, created_by)
values
  ('slack', '431dff0d-7c82-4134-a85e-457e5226fc7f', 'Approved Slack exclusion: KJ Vaughns', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('slack', '45eebd82-7d41-438a-a7aa-45bcbe08d2bc', 'Approved Slack exclusion: KJ active downline', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('slack', 'c7ffeea3-0122-4f22-884e-54d8a3a645e5', 'Approved Slack exclusion: KJ active downline', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('slack', 'd607c992-7625-4e41-81de-b06c0a5c8161', 'Approved Slack exclusion: KJ active downline', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('slack', '3523dc25-61e0-4ce3-bb97-197bbf1a049a', 'Approved Slack exclusion: KJ active downline', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('slack', '021f1686-2560-4b05-9281-c3a66d23c1f2', 'Approved Slack exclusion: KJ active downline', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('slack', '20344eff-2a14-4b9f-bae2-fabc87f55c07', 'Approved Slack exclusion: KJ active downline', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('slack', '19e7f9d8-0277-43f9-a90c-3e326cca4403', 'Approved Slack exclusion: KJ active downline', '71826bba-5577-4810-a226-1f6f2ad5288a')
on conflict (provider, agent_id) do update
set reason = excluded.reason,
    is_active = true,
    updated_at = now();

comment on table public.messaging_audience_exclusions is
  'Provider-specific communication exclusions. These rows never change APEX hierarchy, status, production, or historical attribution.';

-- One row per active agent, including explicit ineligibility reasons. A source
-- application email is accepted only for a real hired agent whose profile has
-- not been provisioned yet. Placeholder and non-canonical alias records are
-- never inviteable.
create or replace view public.v_slack_invite_eligibility
with (security_invoker = true)
as
select
  a.id as agent_id,
  a.user_id,
  coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(a.display_name), ''),
           nullif(btrim(concat_ws(' ', app.first_name, app.last_name)), ''), 'Agent') as full_name,
  lower(coalesce(nullif(btrim(p.email), ''), nullif(btrim(app.email), ''))) as email,
  a.license_status::text as license_status,
  a.is_manager,
  case
    when a.status::text <> 'active' or coalesce(a.is_deactivated, false) or coalesce(a.is_inactive, false)
      then 'inactive'
    when x.agent_id is not null then 'audience_excluded'
    when a.canonical_agent_id is not null and a.canonical_agent_id <> a.id then 'noncanonical_alias'
    when coalesce(nullif(btrim(p.email), ''), nullif(btrim(app.email), '')) is null then 'missing_email'
    when lower(coalesce(nullif(btrim(p.email), ''), nullif(btrim(app.email), ''))) like '%@placeholder.apex'
      then 'placeholder_email'
    when lower(coalesce(nullif(btrim(p.email), ''), nullif(btrim(app.email), ''))) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      then 'invalid_email'
    else 'eligible'
  end as eligibility_status,
  (
    a.status::text = 'active'
    and not coalesce(a.is_deactivated, false)
    and not coalesce(a.is_inactive, false)
    and x.agent_id is null
    and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
    and coalesce(nullif(btrim(p.email), ''), nullif(btrim(app.email), '')) is not null
    and lower(coalesce(nullif(btrim(p.email), ''), nullif(btrim(app.email), ''))) not like '%@placeholder.apex'
    and lower(coalesce(nullif(btrim(p.email), ''), nullif(btrim(app.email), ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) as is_eligible
from public.agents a
left join public.profiles p on p.user_id = a.user_id
left join public.applications app on app.id = a.source_application_id
left join public.messaging_audience_exclusions x
  on x.provider = 'slack' and x.agent_id = a.id and x.is_active;

revoke all on public.v_slack_invite_eligibility from public, anon, authenticated;
grant select on public.v_slack_invite_eligibility to service_role;

-- Applicants no longer receive workspace links. Hired-agent invitations are
-- queued explicitly after eligibility has been evaluated.
drop trigger if exists trg_applicant_slack_invite on public.applications;

-- Route future candidate-bearing events only to the private staff channels
-- created and bot-joined in the production workspace before this migration.
update public.messaging_destinations
set channel_id = 'C0BSPC0P2AX',
    channel_name = 'apex-recruiting-staff',
    privacy_level = 'private',
    verified_at = now(),
    updated_at = now()
where purpose = 'recruiting_growth'
  and installation_id in (
    select id from public.messaging_workspace_installations
    where provider = 'slack' and environment = 'production' and status = 'active'
  );

update public.messaging_destinations
set channel_id = 'C0BSXH22GL9',
    channel_name = 'apex-licensing-staff',
    privacy_level = 'private',
    verified_at = now(),
    updated_at = now()
where purpose = 'licensing_support'
  and installation_id in (
    select id from public.messaging_workspace_installations
    where provider = 'slack' and environment = 'production' and status = 'active'
  );

-- Admin verification proves both sides of the identity claim: an eligible APEX
-- agent and the exact email shown in Slack. Slack ownership is attested by an
-- APEX admin selecting the provider user ID; uniqueness constraints reject
-- Slack-user, auth-user, or agent conflicts.
create or replace function public.admin_verify_slack_identity(
  p_agent_id uuid,
  p_slack_user_id text,
  p_slack_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_installation_id uuid;
  v_eligible public.v_slack_invite_eligibility;
  v_link_id uuid;
begin
  if auth.role() <> 'service_role' and not public.apex_is_admin() then
    raise exception 'Admin or service role required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_slack_user_id, '')) !~ '^[UW][A-Z0-9]{8,}$' then
    raise exception 'Invalid Slack user ID' using errcode = '22023';
  end if;

  select * into v_eligible
  from public.v_slack_invite_eligibility
  where agent_id = p_agent_id;
  if not found or not v_eligible.is_eligible then
    raise exception 'Agent is not Slack eligible' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_slack_email, ''))) <> v_eligible.email then
    raise exception 'Slack email does not match the APEX hired-agent record' using errcode = '22023';
  end if;

  select id into v_installation_id
  from public.messaging_workspace_installations
  where provider = 'slack' and environment = 'production' and status = 'active'
  order by installed_at desc nulls last, created_at desc
  limit 1;
  if v_installation_id is null then
    raise exception 'Active Slack installation not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.messaging_identity_links
    where installation_id = v_installation_id
      and slack_user_id = btrim(p_slack_user_id)
      and agent_id is distinct from p_agent_id
      and revoked_at is null
  ) then
    raise exception 'Slack user is already linked to another APEX agent' using errcode = '23505';
  end if;

  insert into public.messaging_identity_links(
    installation_id, slack_user_id, auth_user_id, agent_id, match_method,
    verification_status, linked_by, linked_at, verified_at, revoked_at
  ) values (
    v_installation_id, btrim(p_slack_user_id), v_eligible.user_id, p_agent_id,
    'admin_verified', 'verified', auth.uid(), now(), now(), null
  )
  on conflict (installation_id, slack_user_id) do update
  set auth_user_id = excluded.auth_user_id,
      agent_id = excluded.agent_id,
      match_method = 'admin_verified',
      verification_status = 'verified',
      linked_by = auth.uid(),
      linked_at = now(),
      verified_at = now(),
      revoked_at = null,
      updated_at = now()
  returning id into v_link_id;

  return jsonb_build_object(
    'ok', true,
    'link_id', v_link_id,
    'agent_id', p_agent_id,
    'slack_user_id', btrim(p_slack_user_id),
    'verification_status', 'verified'
  );
end;
$$;

revoke all on function public.admin_verify_slack_identity(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_verify_slack_identity(uuid, text, text)
  to service_role;

-- Produces idempotent hired-only invitation jobs. The dispatcher rechecks this
-- same eligibility view immediately before the provider send.
create or replace function public.queue_active_hired_slack_invites()
returns table(agent_id uuid, outbox_event_id uuid, eligibility_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select e.agent_id
    from public.v_slack_invite_eligibility e
    where e.is_eligible
      and not exists (
        select 1
        from public.messaging_identity_links l
        join public.messaging_workspace_installations i on i.id = l.installation_id
        where i.provider = 'slack' and i.environment = 'production'
          and l.agent_id = e.agent_id
          and l.verification_status = 'verified'
          and l.revoked_at is null
      )
  ), inserted as (
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key
    )
    select 'agent', c.agent_id, 'recruiting.slack_invite_requested',
           'application_slack_invite', jsonb_build_object('agentId', c.agent_id),
           'recruiting.slack_invite:hired-v2:' || c.agent_id::text
    from candidates c
    on conflict (idempotency_key) do update
      set updated_at = public.outbox_events.updated_at
    returning public.outbox_events.aggregate_id, public.outbox_events.id
  )
  select i.aggregate_id, i.id, 'eligible'::text from inserted i;
end;
$$;

revoke all on function public.queue_active_hired_slack_invites()
  from public, anon, authenticated;
grant execute on function public.queue_active_hired_slack_invites()
  to service_role;

create or replace view public.v_slack_invite_receipts
with (security_invoker = true)
as
select
  o.aggregate_id as agent_id,
  e.full_name,
  e.email,
  o.id as outbox_event_id,
  o.status as outbox_status,
  o.attempts,
  o.processed_at,
  d.status as attempt_status,
  d.provider_message_id,
  d.finished_at,
  o.last_error_redacted
from public.outbox_events o
join public.v_slack_invite_eligibility e on e.agent_id = o.aggregate_id
left join lateral (
  select da.status, da.provider_message_id, da.finished_at
  from public.delivery_attempts da
  where da.outbox_event_id = o.id
  order by da.attempt_number desc
  limit 1
) d on true
where o.aggregate_type = 'agent'
  and o.event_type = 'recruiting.slack_invite_requested'
  and o.destination = 'application_slack_invite';

revoke all on public.v_slack_invite_receipts from public, anon, authenticated;
grant select on public.v_slack_invite_receipts to service_role;

commit;
