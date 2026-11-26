-- Carrier transitions only; no historical backfill and no customer PII.
-- Apply each -- statement boundary separately through bot-sql.
create or replace function public.fn_policy_slack_agent(p_agent_id uuid, p_name text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select jsonb_strip_nulls(jsonb_build_object(
    'agentId', p_agent_id,
    'agentName', coalesce(nullif(a.display_name,''), nullif(p_name,''), 'Unmapped agent'),
    'slackUserId', l.slack_user_id,
    'slackInstallationId', l.installation_id
  ))
  from (select 1) seed
  left join public.agents a on a.id = p_agent_id
  left join lateral (
    select i.slack_user_id, i.installation_id
    from public.messaging_identity_links i
    join public.messaging_workspace_installations w on w.id = i.installation_id
    where i.agent_id = a.id and i.verification_status = 'verified'
      and a.status::text = 'active' and w.provider = 'slack'
      and w.environment = 'production' and w.status = 'active'
      and i.slack_user_id ~ '^[UW][A-Z0-9]{8,}$'
    order by i.verified_at desc limit 1
  ) l on true;
$fn$;
-- statement
revoke all on function public.fn_policy_slack_agent(uuid,text) from public, anon, authenticated;
-- statement
create or replace function public.fn_queue_policy_status_slack()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare p public.carrier_book_policies%rowtype; v_agent uuid;
begin
  if new.from_bucket is null or new.from_bucket = new.to_bucket then return new; end if;
  if not (new.to_bucket in ('lapsed','at_risk','not_taken','declined','claim')
          or (new.from_bucket = 'pending' and new.to_bucket = 'active')) then return new; end if;
  select * into p from public.carrier_book_policies
   where carrier = new.carrier and policy_key = new.policy_key;
  if not found then raise exception 'carrier policy missing'; end if;
  v_agent := p.agent_id;
  if v_agent is null then
    select r.agent_id into v_agent from public.fn_carrier_resolve_agent(p.agent_npn,p.agent_name) r;
  end if;
  insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key)
  values ('carrier_policy', coalesce(p.site_deal_id, gen_random_uuid()), 'policy.status_changed', 'slack',
    public.fn_policy_slack_agent(v_agent,p.agent_name) || jsonb_build_object(
      'carrier', new.carrier, 'policyNumber', p.policy_number,
      'fromBucket', new.from_bucket, 'toBucket', new.to_bucket,
      'annualPremium', p.annual_premium, 'siteDealId', p.site_deal_id,
      'openUrl', 'https://galaxyfinancial.org/dashboard/finances'),
    'policy_status:' || new.id::text)
  on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  raise warning 'policy status Slack enqueue failed event %, SQLSTATE %', new.id, sqlstate;
  return new;
end;
$fn$;
-- statement
revoke all on function public.fn_queue_policy_status_slack() from public, anon, authenticated;
-- statement
create or replace trigger trg_queue_policy_status_slack
  after insert on public.carrier_book_status_events
  for each row execute function public.fn_queue_policy_status_slack();
-- statement
create or replace function public.fn_queue_policy_chargeback_slack()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_agent uuid;
begin
  -- Agent resolution in ingest runs AFTER this insert; resolve now as well.
  v_agent := new.agent_id;
  if v_agent is null then
    select r.agent_id into v_agent from public.fn_carrier_resolve_agent(new.agent_npn,new.agent_name) r;
  end if;
  insert into public.outbox_events(aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key)
  values ('carrier_chargeback', gen_random_uuid(), 'policy.chargeback', 'slack',
    public.fn_policy_slack_agent(v_agent,new.agent_name) || jsonb_build_object(
      'carrier', new.carrier, 'policyNumber', new.policy_number,
      'amount', new.amount, 'chargebackOn', new.chargeback_on,
      'openUrl', 'https://galaxyfinancial.org/dashboard/finances'),
    'policy_chargeback:' || jsonb_build_array(new.carrier,new.source,new.ref_id)::text)
  on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  raise warning 'policy chargeback Slack enqueue failed SQLSTATE %', sqlstate;
  return new;
end;
$fn$;
-- statement
revoke all on function public.fn_queue_policy_chargeback_slack() from public, anon, authenticated;
-- statement
create or replace trigger trg_queue_policy_chargeback_slack
  after insert on public.carrier_book_chargebacks
  for each row execute function public.fn_queue_policy_chargeback_slack();
-- statement
-- Sam explicitly requested manager_ops fallback. Enable its existing destination.
update public.messaging_destinations d set is_enabled = true
from public.messaging_workspace_installations w
where w.id = d.installation_id and w.provider = 'slack' and w.environment = 'production'
  and w.status = 'active' and d.purpose = 'manager_ops' and d.scope_type = 'organization';
-- statement
insert into public.messaging_route_rules
  (installation_id,event_type,destination_id,audience_scope,priority,batch_policy,is_enabled)
select d.installation_id,e.event_type,d.id,'organization',1,'instant',true
from public.messaging_destinations d
join public.messaging_workspace_installations w on w.id=d.installation_id
cross join (values ('policy.status_changed'),('policy.chargeback')) e(event_type)
where d.purpose='manager_ops' and d.scope_type='organization' and d.is_enabled
  and w.provider='slack' and w.environment='production' and w.status='active'
on conflict (installation_id,event_type,destination_id,audience_scope)
do update set is_enabled=true;
