-- Bind APEX's production Slack workspace to semantic destinations and queue
-- sanitized, idempotent events for the operating channels. Raw Slack secrets
-- stay in Supabase's secret store under SLACK_BOT_TOKEN.

begin;

do $block$
declare
  v_installation_id uuid;
  v_destination_id uuid;
  v_destination record;
  v_route record;
begin
  insert into public.messaging_workspace_installations(
    provider,
    environment,
    workspace_id,
    workspace_name,
    bot_token_secret_ref,
    granted_scopes,
    status
  ) values (
    'slack',
    'production',
    'T0BSN03M2AJ',
    'Apex Financial',
    'SLACK_BOT_TOKEN',
    array['chat:write', 'chat:write.public', 'channels:read', 'groups:read'],
    'not_configured'
  )
  on conflict (provider, environment, workspace_id) do update set
    workspace_name = excluded.workspace_name,
    bot_token_secret_ref = excluded.bot_token_secret_ref,
    granted_scopes = excluded.granted_scopes,
    status = case
      when messaging_workspace_installations.status = 'active' then 'active'
      else excluded.status
    end,
    last_error_redacted = null
  returning id into v_installation_id;

  for v_destination in
    select * from (values
      ('announcements',       'C0BSNB9SSR4', 'apex-announcements',        'public'),
      ('sales_wins',          'C0BTJLBKC2C', 'apex-sales-wins',           'public'),
      ('recruiting_growth',   'C0BSTVB98DA', 'apex-recruiting-growth',    'public'),
      ('training',            'C0BSNBA0A4W', 'apex-training',             'public'),
      ('help',                'C0BSJ2AF5U3', 'apex-help',                 'public'),
      ('contracting_support', 'C0BSNBA5NES', 'apex-contracting-support',  'restricted'),
      ('manager_ops',         'C0BS8U2RAVD', 'apex-manager-ops',          'restricted'),
      ('system_alerts',       'C0BSJ2ANTPD', 'apex-system-alerts',        'restricted'),
      ('finance_ops',         'C0BSNBA961L', 'apex-finance-ops',          'restricted')
    ) as d(purpose, channel_id, channel_name, privacy_level)
  loop
    insert into public.messaging_destinations(
      installation_id,
      channel_id,
      channel_name,
      purpose,
      scope_type,
      privacy_level,
      is_enabled,
      verified_at
    ) values (
      v_installation_id,
      v_destination.channel_id,
      v_destination.channel_name,
      v_destination.purpose,
      'organization',
      v_destination.privacy_level,
      true,
      now()
    )
    on conflict do nothing;

    update public.messaging_destinations
    set channel_id = v_destination.channel_id,
        channel_name = v_destination.channel_name,
        privacy_level = v_destination.privacy_level,
        is_enabled = true,
        verified_at = now()
    where installation_id = v_installation_id
      and purpose = v_destination.purpose
      and scope_type = 'organization'
      and scope_key is null;
  end loop;

  for v_route in
    select * from (values
      ('candidate.application_submitted',  'recruiting_growth',   1::smallint),
      ('candidate.licensing_milestone',    'recruiting_growth',   2::smallint),
      ('contracting.intake_submitted',     'contracting_support', 1::smallint),
      ('deal.posted',                      'sales_wins',          1::smallint)
    ) as r(event_type, purpose, priority)
  loop
    select id into v_destination_id
    from public.messaging_destinations
    where installation_id = v_installation_id
      and purpose = v_route.purpose
      and scope_type = 'organization'
      and scope_key is null;

    insert into public.messaging_route_rules(
      installation_id,
      event_type,
      destination_id,
      audience_scope,
      priority,
      batch_policy,
      is_enabled
    ) values (
      v_installation_id,
      v_route.event_type,
      v_destination_id,
      'organization',
      v_route.priority,
      'instant',
      true
    )
    on conflict (installation_id, event_type, destination_id, audience_scope)
    do update set
      priority = excluded.priority,
      batch_policy = excluded.batch_policy,
      is_enabled = true;
  end loop;
end;
$block$;

create or replace function public.fn_queue_application_slack()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.outbox_events(
    aggregate_type,
    aggregate_id,
    event_type,
    destination,
    payload,
    idempotency_key,
    correlation_id
  ) values (
    'application',
    new.id,
    'candidate.application_submitted',
    'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'applicationId', new.id,
      'candidateName', btrim(concat_ws(' ', new.first_name, new.last_name)),
      'isLicensed', new.license_status::text = 'licensed',
      'state', case
        when upper(btrim(coalesce(new.state, ''))) ~ '^[A-Z]{2}$'
          then upper(btrim(new.state))
        else null
      end,
      'openUrl', 'https://apex-financial.org/dashboard/recruiting/pipeline'
    )),
    'candidate.application_submitted:' || new.id::text || ':slack',
    gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- A notification must never roll back an applicant's submission.
  return new;
end;
$function$;

drop trigger if exists trg_queue_application_slack on public.applications;
create trigger trg_queue_application_slack
  after insert on public.applications
  for each row execute function public.fn_queue_application_slack();

create or replace function public.fn_queue_contracting_slack()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.outbox_events(
    aggregate_type,
    aggregate_id,
    event_type,
    destination,
    payload,
    idempotency_key,
    correlation_id
  ) values (
    'contracting_intake',
    new.id,
    'contracting.intake_submitted',
    'slack',
    jsonb_build_object(
      'intakeId', new.id,
      'agentName', btrim(concat_ws(' ', new.first_name, new.last_name)),
      'npnLast4', right(new.npn, 4),
      'openUrl', 'https://apex-financial.org/dashboard/contracting/ops'
    ),
    'contracting.intake_submitted:' || new.id::text || ':slack',
    gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- Contracting intake is canonical even if its notification cannot queue.
  return new;
end;
$function$;

drop trigger if exists trg_queue_contracting_slack on public.contracting_intakes;
create trigger trg_queue_contracting_slack
  after insert on public.contracting_intakes
  for each row execute function public.fn_queue_contracting_slack();

create or replace function public.fn_queue_deal_slack()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_agent_name text;
begin
  if new.agent_id is null or coalesce(new.status, 'draft') = 'draft' then
    return new;
  end if;

  if tg_op = 'INSERT'
     and not public.is_fresh_deal_close(new.effective_date, new.posted_at, new.created_at) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and not (new.source = 'apex_native' and old.source is distinct from new.source) then
    return new;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(a.display_name), ''), 'APEX producer')
    into v_agent_name
  from public.agents a
  left join public.profiles p on p.id = a.profile_id or p.user_id = a.user_id
  where a.id = new.agent_id
  order by (p.id = a.profile_id) desc nulls last
  limit 1;

  insert into public.outbox_events(
    aggregate_type,
    aggregate_id,
    event_type,
    destination,
    payload,
    idempotency_key,
    correlation_id
  ) values (
    'deal',
    new.id,
    'deal.posted',
    'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'dealId', new.id,
      'agentId', new.agent_id,
      'agentName', coalesce(v_agent_name, 'APEX producer'),
      'carrierId', new.carrier_id,
      'productCategory', new.product_sold,
      'annualPremium', coalesce(new.annualized_commissionable_premium, new.annual_premium, 0),
      'openUrl', 'https://apex-financial.org/dashboard'
    )),
    'deal.posted:' || new.id::text || ':slack',
    coalesce(new.correlation_id, gen_random_uuid())
  ) on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- A Slack notification must never roll back a canonical deal.
  return new;
end;
$function$;

drop trigger if exists trg_queue_deal_slack_insert on public.deals;
create trigger trg_queue_deal_slack_insert
  after insert on public.deals
  for each row execute function public.fn_queue_deal_slack();

drop trigger if exists trg_queue_deal_slack_native on public.deals;
create trigger trg_queue_deal_slack_native
  after update of source on public.deals
  for each row execute function public.fn_queue_deal_slack();

revoke all on function public.fn_queue_application_slack()
  from public, anon, authenticated;
revoke all on function public.fn_queue_contracting_slack()
  from public, anon, authenticated;
revoke all on function public.fn_queue_deal_slack()
  from public, anon, authenticated;

comment on function public.fn_queue_application_slack() is
  'Queues one PII-minimized recruiting Slack event per new application.';
comment on function public.fn_queue_contracting_slack() is
  'Queues one contracting-support Slack event per accepted one-link intake.';
comment on function public.fn_queue_deal_slack() is
  'Queues one canonical, deduplicated Slack sales win for each fresh or native APEX deal.';

commit;
