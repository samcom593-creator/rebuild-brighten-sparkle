-- Authorized, idempotent contact actions for the Licensed Inbox.
--
-- The browser identifies a record, never a recipient. The RPC resolves the
-- current phone/email server-side, enforces staff scope and opt-out/consent
-- state, then writes a durable action plus a redacted outbox event. Provider
-- delivery is performed by apex-outbox-dispatcher.

alter table public.apex_toolkit_agents
  add column if not exists sms_opted_out_at timestamptz,
  add column if not exists email_opted_out_at timestamptz;

create table if not exists public.apex_contact_actions (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('application', 'toolkit_agent')),
  application_id uuid references public.applications(id) on delete restrict,
  toolkit_agent_id uuid references public.apex_toolkit_agents(id) on delete restrict,
  channel text not null check (channel in ('call', 'sms', 'email')),
  recipient_address text not null,
  recipient_name text not null,
  subject text,
  message text,
  status text not null check (status in (
    'initiated', 'queued', 'processing', 'retrying', 'provider_accepted',
    'fallback_required', 'failed', 'dead_letter'
  )),
  provider text,
  provider_message_id text,
  delivery_confirmed boolean not null default false,
  idempotency_key uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  correlation_id uuid not null default gen_random_uuid(),
  last_error_redacted text,
  requested_at timestamptz not null default now(),
  provider_accepted_at timestamptz,
  logged_at timestamptz,
  updated_at timestamptz not null default now(),
  check (num_nonnulls(application_id, toolkit_agent_id) = 1),
  check (
    (subject_kind = 'application' and application_id is not null)
    or (subject_kind = 'toolkit_agent' and toolkit_agent_id is not null)
  ),
  check (subject is null or char_length(subject) between 1 and 200),
  check (message is null or char_length(message) between 1 and 4000),
  unique(requested_by, idempotency_key)
);

create index if not exists apex_contact_actions_subject_idx
  on public.apex_contact_actions(subject_kind, application_id, toolkit_agent_id, requested_at desc);
create index if not exists apex_contact_actions_status_idx
  on public.apex_contact_actions(status, requested_at)
  where status in ('queued', 'processing', 'retrying', 'failed');

alter table public.application_contact_log
  add column if not exists contact_action_id uuid references public.apex_contact_actions(id) on delete set null;
create unique index if not exists application_contact_log_action_unique
  on public.application_contact_log(contact_action_id)
  where contact_action_id is not null;

alter table public.apex_toolkit_agent_contact_log
  add column if not exists contact_action_id uuid references public.apex_contact_actions(id) on delete set null;
create unique index if not exists apex_toolkit_contact_log_action_unique
  on public.apex_toolkit_agent_contact_log(contact_action_id)
  where contact_action_id is not null;

alter table public.apex_contact_actions enable row level security;

drop policy if exists apex_contact_actions_scoped_read on public.apex_contact_actions;
create policy apex_contact_actions_scoped_read
  on public.apex_contact_actions for select to authenticated
  using (
    requested_by = auth.uid()
    or public.apex_is_admin()
    or (application_id is not null and public.apex_toolkit_can_work_application(application_id))
    or (toolkit_agent_id is not null and public.apex_toolkit_is_staff())
  );

grant select on public.apex_contact_actions to authenticated;

create or replace function public.queue_apex_contact_action(
  p_subject_kind text,
  p_subject_id uuid,
  p_channel text,
  p_idempotency_key uuid,
  p_subject text default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_subject_kind, '')));
  v_channel text := lower(btrim(coalesce(p_channel, '')));
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_name text;
  v_address text;
  v_carrier text;
  v_phone_bad_at timestamptz;
  v_sms_consent boolean;
  v_email_consent boolean;
  v_sms_opted_out_at timestamptz;
  v_email_opted_out_at timestamptz;
  v_action public.apex_contact_actions;
  v_outbox_id uuid;
  v_status text;
  v_provider text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_subject_id is null or p_idempotency_key is null then
    raise exception 'Subject and idempotency key are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0));
  if v_kind not in ('application', 'toolkit_agent') then
    raise exception 'Unsupported contact subject' using errcode = '22023';
  end if;
  if v_channel not in ('call', 'sms', 'email') then
    raise exception 'Unsupported contact channel' using errcode = '22023';
  end if;

  select * into v_action
  from public.apex_contact_actions ca
  where ca.requested_by = v_user_id
    and ca.idempotency_key = p_idempotency_key;
  if found then
    if v_action.subject_kind <> v_kind
       or v_action.channel <> v_channel
       or coalesce(v_action.application_id, v_action.toolkit_agent_id) <> p_subject_id
       or coalesce(v_action.subject, '') <> coalesce(v_subject, '')
       or coalesce(v_action.message, '') <> coalesce(v_message, '') then
      raise exception 'Idempotency key was already used for different contact content'
        using errcode = '22023';
    end if;
    select oe.id into v_outbox_id
    from public.outbox_events oe
    where oe.aggregate_type = 'contact_action' and oe.aggregate_id = v_action.id
    limit 1;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'actionId', v_action.id,
      'status', v_action.status, 'channel', v_action.channel,
      'recipient', v_action.recipient_address, 'outboxEventId', v_outbox_id,
      'provider', v_action.provider, 'providerMessageId', v_action.provider_message_id,
      'deliveryConfirmed', v_action.delivery_confirmed
    );
  end if;

  if v_kind = 'application' then
    if not public.apex_toolkit_can_work_application(p_subject_id, v_user_id) then
      raise exception 'You are not allowed to contact this application' using errcode = '42501';
    end if;
    select
      concat_ws(' ', nullif(btrim(a.first_name), ''), nullif(btrim(a.last_name), '')),
      case when v_channel = 'email' then lower(btrim(a.email)) else a.phone end,
      lower(nullif(btrim(a.carrier), '')),
      a.phone_bad_at,
      a.sms_consent_given,
      a.email_consent_given
    into v_name, v_address, v_carrier, v_phone_bad_at, v_sms_consent, v_email_consent
    from public.applications a
    where a.id = p_subject_id;
    if not found then
      raise exception 'Application not found' using errcode = 'P0002';
    end if;
  else
    if not public.apex_toolkit_is_staff(v_user_id) then
      raise exception 'Staff access is required' using errcode = '42501';
    end if;
    select
      concat_ws(' ', nullif(btrim(a.first_name), ''), nullif(btrim(a.last_name), '')),
      case when v_channel = 'email' then lower(btrim(a.email)) else a.phone end,
      a.sms_opted_out_at,
      a.email_opted_out_at
    into v_name, v_address, v_sms_opted_out_at, v_email_opted_out_at
    from public.apex_toolkit_agents a
    where a.id = p_subject_id and a.status = 'active';
    if not found then
      raise exception 'Active added agent not found' using errcode = 'P0002';
    end if;
  end if;

  v_name := coalesce(nullif(btrim(v_name), ''), 'APEX contact');
  if v_channel = 'email' then
    if v_address is null
       or char_length(v_address) > 254
       or v_address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'A valid email address is required' using errcode = '22023';
    end if;
    if v_subject is null or char_length(v_subject) > 200 then
      raise exception 'Email subject is required and must be 200 characters or fewer' using errcode = '22023';
    end if;
    if v_message is null or char_length(v_message) > 4000 then
      raise exception 'Email message is required and must be 4,000 characters or fewer' using errcode = '22023';
    end if;
    if v_email_opted_out_at is not null
       or exists (
         select 1 from public.email_unsubscribes eu
         where lower(btrim(eu.email)) = v_address
       ) then
      raise exception 'This recipient has opted out of email' using errcode = '42501';
    end if;
    -- A false value on older applications is often a legacy missing-answer
    -- default, not an explicit unsubscribe. Explicit unsubscribes are enforced
    -- above; preserve manual one-to-one follow-up for active applications.
    v_status := 'queued';
    v_provider := 'resend';
  elsif v_channel = 'sms' then
    v_address := regexp_replace(coalesce(v_address, ''), '[^0-9]', '', 'g');
    if char_length(v_address) = 11 and left(v_address, 1) = '1' then
      v_address := right(v_address, 10);
    end if;
    if char_length(v_address) <> 10 then
      raise exception 'A valid 10-digit phone number is required' using errcode = '22023';
    end if;
    if v_phone_bad_at is not null or v_sms_opted_out_at is not null then
      raise exception 'Texting is blocked for this phone number' using errcode = '42501';
    end if;
    if v_kind = 'application' and v_sms_consent is not true then
      raise exception 'SMS consent is not recorded for this application' using errcode = '42501';
    end if;
    if v_message is null or char_length(v_message) > 160 then
      raise exception 'Text message is required and must be 160 characters or fewer' using errcode = '22023';
    end if;
    if v_carrier in ('att', 'verizon', 'tmobile', 'sprint', 'uscellular', 'cricket', 'metro', 'boost') then
      v_status := 'queued';
      v_provider := 'resend_carrier_gateway';
    else
      v_status := 'fallback_required';
      v_provider := 'device_sms';
    end if;
  else
    v_address := regexp_replace(coalesce(v_address, ''), '[^0-9+]', '', 'g');
    if char_length(regexp_replace(v_address, '[^0-9]', '', 'g')) < 10 then
      raise exception 'A valid phone number is required' using errcode = '22023';
    end if;
    if v_phone_bad_at is not null then
      raise exception 'Calling is blocked because this phone is marked bad' using errcode = '42501';
    end if;
    v_status := 'initiated';
    v_provider := 'device_phone';
  end if;

  insert into public.apex_contact_actions(
    subject_kind, application_id, toolkit_agent_id, channel,
    recipient_address, recipient_name, subject, message, status, provider,
    idempotency_key, requested_by
  ) values (
    v_kind,
    case when v_kind = 'application' then p_subject_id end,
    case when v_kind = 'toolkit_agent' then p_subject_id end,
    v_channel, v_address, v_name, v_subject, v_message, v_status, v_provider,
    p_idempotency_key, v_user_id
  ) returning * into v_action;

  if v_status = 'queued' then
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, destination, payload,
      idempotency_key, correlation_id
    ) values (
      'contact_action', v_action.id, 'contact.' || v_channel || '_requested',
      'contact_' || v_channel, jsonb_build_object('contactActionId', v_action.id),
      'contact.' || v_channel || ':' || v_action.id::text, v_action.correlation_id
    ) returning id into v_outbox_id;
  elsif v_status = 'initiated' then
    if v_kind = 'application' then
      insert into public.application_contact_log(
        application_id, channel, outcome, notes, logged_by, contact_action_id
      ) values (
        p_subject_id, 'call', 'call_started', 'Started from Licensed Inbox',
        v_user_id, v_action.id
      );
    else
      insert into public.apex_toolkit_agent_contact_log(
        toolkit_agent_id, channel, outcome, logged_by, contact_action_id
      ) values (p_subject_id, 'call', 'call_started', v_user_id, v_action.id);
    end if;
    update public.apex_contact_actions set logged_at = now() where id = v_action.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'actionId', v_action.id,
    'status', v_status, 'channel', v_channel, 'recipient', v_address,
    'outboxEventId', v_outbox_id, 'provider', v_provider,
    'deliveryConfirmed', false
  );
end;
$fn$;

grant execute on function public.queue_apex_contact_action(text, uuid, text, uuid, text, text)
  to authenticated;

create or replace function public.record_apex_licensed_disposition(
  p_subject_kind text,
  p_subject_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_subject_kind, '')));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_terminal boolean := v_outcome in ('hired', 'passed');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_subject_id is null or v_kind not in ('application', 'toolkit_agent') then
    raise exception 'A valid disposition subject is required' using errcode = '22023';
  end if;
  if v_outcome not in ('called', 'voicemail', 'hired', 'passed') then
    raise exception 'Unsupported disposition' using errcode = '22023';
  end if;

  if v_kind = 'application' then
    if not public.apex_toolkit_can_work_application(p_subject_id, v_user_id) then
      raise exception 'You are not allowed to work this application' using errcode = '42501';
    end if;
    if v_outcome = 'hired' then
      update public.applications set status = 'contracting', updated_at = now()
      where id = p_subject_id;
    elsif v_outcome = 'passed' then
      update public.applications set status = 'rejected', updated_at = now()
      where id = p_subject_id;
    end if;
    if not exists (select 1 from public.applications where id = p_subject_id) then
      raise exception 'Application not found' using errcode = 'P0002';
    end if;
    insert into public.application_contact_log(
      application_id, channel, outcome, notes, logged_by
    ) values (
      p_subject_id,
      case when v_outcome in ('called', 'voicemail') then 'call' else 'note' end,
      v_outcome, 'Recorded from Licensed Inbox', v_user_id
    );
  else
    if not public.apex_toolkit_is_staff(v_user_id) then
      raise exception 'Staff access is required' using errcode = '42501';
    end if;
    if v_outcome in ('hired', 'passed') then
      update public.apex_toolkit_agents
      set status = v_outcome, updated_at = now()
      where id = p_subject_id and status = 'active';
    end if;
    if not exists (select 1 from public.apex_toolkit_agents where id = p_subject_id) then
      raise exception 'Added agent not found' using errcode = 'P0002';
    end if;
    insert into public.apex_toolkit_agent_contact_log(
      toolkit_agent_id, channel, outcome, logged_by
    ) values (
      p_subject_id,
      case when v_outcome in ('called', 'voicemail') then 'call' else 'note' end,
      v_outcome, v_user_id
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'subjectKind', v_kind, 'subjectId', p_subject_id,
    'outcome', v_outcome, 'terminal', v_terminal
  );
end;
$fn$;

grant execute on function public.record_apex_licensed_disposition(text, uuid, text)
  to authenticated;

create or replace function public.claim_apex_contact_action_event(p_action_id uuid)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with claimable as (
    select oe.id
    from public.outbox_events oe
    where oe.aggregate_type = 'contact_action'
      and oe.aggregate_id = p_action_id
      and (
        oe.status in ('pending', 'failed')
        or (oe.status = 'processing' and oe.locked_at < now() - interval '10 minutes')
      )
      -- This RPC is used only for an explicit, authenticated UI retry and is
      -- service-role protected. Generic cron claims still honor available_at.
      and oe.attempts < 5
    for update skip locked
  )
  update public.outbox_events oe
  set status = 'processing', attempts = oe.attempts + 1,
      locked_at = now(), updated_at = now()
  from claimable c
  where oe.id = c.id
  returning oe.*;
end;
$fn$;

revoke all on function public.claim_apex_contact_action_event(uuid) from public, anon, authenticated;
grant execute on function public.claim_apex_contact_action_event(uuid) to service_role;

insert into public.apex_schema_meta(version, description)
values ('20260811222000', 'Authorized durable phone, text, and email contact actions')
on conflict (version) do nothing;

comment on table public.apex_contact_actions is
  'Server-resolved contact requests and provider receipts. provider_accepted never means delivery_confirmed.';
