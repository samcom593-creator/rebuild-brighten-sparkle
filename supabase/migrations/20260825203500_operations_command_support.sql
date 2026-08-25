-- One truthful admin command surface plus an APEX-native support desk.
-- This is additive: no recruiting, production, contracting, or dialer rows are rewritten.

-- The prior health view reused a stored ingest_24h counter forever and checked
-- Chicago hours. Recompute the count and use the agency's Phoenix timezone.
create or replace view public.v_readymode_ingest_health as
select
  s.current_mode,
  s.webhook_enabled,
  s.pull_enabled,
  s.last_ingest_at,
  extract(epoch from (now() - s.last_ingest_at))::int as seconds_since_last_ingest,
  (select count(*)::int from public.readymode_dialer_calls c where c.imported_at >= now() - interval '24 hours') as ingest_24h,
  (select count(*)::bigint from public.readymode_dialer_calls) as ingest_total,
  s.last_heartbeat_at,
  extract(epoch from (now() - s.last_heartbeat_at))::int as seconds_since_heartbeat,
  s.last_error,
  s.last_error_at,
  case
    when s.current_mode = 'AWAITING_WEBHOOK' then 'awaiting_creds'
    when s.last_ingest_at is null then 'never_ingested'
    when s.last_ingest_at < now() - interval '2 hours'
      and extract(dow from now() at time zone 'America/Phoenix') between 1 and 5
      and extract(hour from now() at time zone 'America/Phoenix') between 8 and 20
      then 'DARK_DURING_BUSINESS_HOURS'
    when s.last_ingest_at < now() - interval '24 hours' then 'stale_24h'
    else 'healthy'
  end as status
from public.readymode_bot_state s;

grant select on public.v_readymode_ingest_health to authenticated;

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  requester_agent_id uuid references public.agents(id) on delete set null,
  category text not null check (category in (
    'website', 'contracting', 'readymode', 'recruiting',
    'licensing_training', 'sales_deals', 'account_access', 'other'
  )),
  subject text not null check (char_length(trim(subject)) between 3 and 160),
  details text not null check (char_length(trim(details)) between 10 and 5000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_on_requester', 'resolved', 'closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists support_requests_queue_idx
  on public.support_requests(status, priority, created_at desc);
create index if not exists support_requests_owner_idx
  on public.support_requests(created_by, created_at desc);

alter table public.support_requests enable row level security;
drop policy if exists support_requests_scoped_read on public.support_requests;
create policy support_requests_scoped_read on public.support_requests
  for select to authenticated
  using (created_by = auth.uid() or public.apex_is_admin());
drop policy if exists support_requests_own_insert on public.support_requests;
create policy support_requests_own_insert on public.support_requests
  for insert to authenticated
  with check (created_by = auth.uid());
drop policy if exists support_requests_admin_update on public.support_requests;
create policy support_requests_admin_update on public.support_requests
  for update to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create or replace function public.apex_submit_support_request(
  p_category text,
  p_subject text,
  p_details text,
  p_priority text default 'normal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_agent_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_category not in ('website','contracting','readymode','recruiting','licensing_training','sales_deals','account_access','other') then
    raise exception 'Invalid category';
  end if;
  if p_priority not in ('low','normal','high','urgent') then
    raise exception 'Invalid priority';
  end if;
  if char_length(trim(coalesce(p_subject, ''))) not between 3 and 160 then
    raise exception 'Subject must be 3-160 characters';
  end if;
  if char_length(trim(coalesce(p_details, ''))) not between 10 and 5000 then
    raise exception 'Details must be 10-5000 characters';
  end if;

  select a.id into v_agent_id
  from public.agents a
  where a.user_id = auth.uid()
  order by a.updated_at desc nulls last, a.id
  limit 1;

  insert into public.support_requests(created_by, requester_agent_id, category, subject, details, priority)
  values (auth.uid(), v_agent_id, p_category, trim(p_subject), trim(p_details), p_priority)
  returning id into v_id;

  insert into public.notifications(user_id, title, body, type, priority, link, metadata)
  select distinct ur.user_id,
    'New ' || replace(p_category, '_', ' ') || ' support request',
    trim(p_subject), 'support_request', p_priority,
    '/dashboard/help?tab=desk', jsonb_build_object('support_request_id', v_id)
  from public.user_roles ur
  where ur.role::text in ('admin','super_admin','owner');

  return v_id;
end;
$$;

create or replace function public.apex_support_requests(p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.created_at desc)
    from (
      select sr.id, sr.category, sr.subject, sr.details, sr.priority, sr.status,
        sr.resolution_note, sr.created_at, sr.updated_at, sr.resolved_at,
        coalesce(p.full_name, a.display_name, u.email, 'APEX user') as requester_name,
        u.email as requester_email
      from public.support_requests sr
      left join public.agents a on a.id = sr.requester_agent_id
      left join public.profiles p on p.id = a.profile_id
      left join auth.users u on u.id = sr.created_by
      where sr.created_by = auth.uid() or public.apex_is_admin()
      order by case sr.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
        sr.created_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 250))
    ) q
  ), '[]'::jsonb);
end;
$$;

create or replace function public.apex_update_support_request(
  p_id uuid,
  p_status text,
  p_resolution_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_status not in ('open','in_progress','waiting_on_requester','resolved','closed') then
    raise exception 'Invalid status';
  end if;
  update public.support_requests
  set status = p_status,
      resolution_note = nullif(trim(coalesce(p_resolution_note, '')), ''),
      assigned_to = case when p_status in ('in_progress','waiting_on_requester','resolved','closed') then auth.uid() else assigned_to end,
      resolved_at = case when p_status in ('resolved','closed') then coalesce(resolved_at, now()) else null end,
      updated_at = now()
  where id = p_id;
  if not found then raise exception 'Support request not found'; end if;
end;
$$;

create or replace function public.apex_admin_operations_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recruiting jsonb;
  v_onboarding jsonb;
  v_contracting jsonb;
  v_sales jsonb;
  v_readymode jsonb;
  v_support jsonb;
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'active', count(*),
    'new', count(*) filter (where status::text = 'new'),
    'uncontacted', count(*) filter (where contacted_at is null and closed_at is null),
    'uncontacted_48h', count(*) filter (where contacted_at is null and closed_at is null and created_at < now() - interval '48 hours'),
    'interview', count(*) filter (where status::text = 'interview'),
    'contracting', count(*) filter (where status::text = 'contracting'),
    'hired', count(*) filter (where closed_at is not null)
  ) into v_recruiting
  from public.applications
  where record_type = 'application' and terminated_at is null;

  select jsonb_build_object(
    'stalled', count(*) filter (where next_missing_step not like 'COMPLETE%'),
    'intake_missing', count(*) filter (where next_missing_step like '1.%'),
    'npn_comp_missing', count(*) filter (where next_missing_step like '2.%'),
    'carrier_contracting', count(*) filter (where next_missing_step like '3.%'),
    'appointment_missing', count(*) filter (where next_missing_step like '4.%'),
    'discord_missing', count(*) filter (where next_missing_step like '5.%'),
    'training_missing', count(*) filter (where next_missing_step like '6.%'),
    'launch_missing', count(*) filter (where next_missing_step like '7.%'),
    'first_sale_missing', count(*) filter (where next_missing_step like '8.%'),
    'complete', count(*) filter (where next_missing_step like 'COMPLETE%')
  ) into v_onboarding from public.v_onboarding_sequence;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where lower(coalesce(status,'')) = 'active'),
    'pending', count(*) filter (where lower(coalesce(status,'')) in ('requested','submitted','pending','agent_action_required')),
    'issues', count(*) filter (where lower(coalesce(status,'')) in ('issue','declined','error'))
  ) into v_contracting from public.apex_carrier_contracts;

  select jsonb_build_object(
    'expected_to_sell', count(*),
    'sold_today', count(*) filter (where pulse = 'sold_today'),
    'not_selling', count(*) filter (where pulse <> 'sold_today'),
    'people', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select vp.agent_id, vp.agent_name, vp.leg, vp.pulse, vp.business_days_quiet,
          vp.last_sale, vp.deals_mtd, vp.ap_mtd,
          coalesce(p.phone, '') as phone, coalesce(p.email, '') as email
        from public.v_producer_pulse vp
        left join public.agents a on a.id = vp.agent_id
        left join public.profiles p on p.id = a.profile_id
        where vp.pulse <> 'sold_today'
        order by case vp.pulse when 'cold' then 0 when 'slipping' then 1 when 'quiet' then 2 else 3 end,
          vp.business_days_quiet desc nulls last, vp.agent_name
        limit 12
      ) x
    ), '[]'::jsonb)
  ) into v_sales from public.v_producer_pulse;

  select coalesce(to_jsonb(h), '{}'::jsonb) || jsonb_build_object(
    'sync_enabled', coalesce((select value::text::boolean from public.system_settings where key='readymode_sync_enabled'), false)
  ) into v_readymode
  from public.v_readymode_ingest_health h
  limit 1;

  select jsonb_build_object(
    'open', count(*) filter (where status in ('open','in_progress','waiting_on_requester')),
    'urgent', count(*) filter (where status in ('open','in_progress','waiting_on_requester') and priority = 'urgent')
  ) into v_support from public.support_requests;

  return jsonb_build_object(
    'as_of', now(), 'recruiting', coalesce(v_recruiting, '{}'::jsonb),
    'onboarding', coalesce(v_onboarding, '{}'::jsonb),
    'contracting', coalesce(v_contracting, '{}'::jsonb),
    'sales', coalesce(v_sales, '{}'::jsonb),
    'readymode', coalesce(v_readymode, '{}'::jsonb),
    'support', coalesce(v_support, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.apex_submit_support_request(text,text,text,text) from public, anon, authenticated;
revoke all on function public.apex_support_requests(int) from public, anon, authenticated;
revoke all on function public.apex_update_support_request(uuid,text,text) from public, anon, authenticated;
revoke all on function public.apex_admin_operations_snapshot() from public, anon, authenticated;
grant execute on function public.apex_submit_support_request(text,text,text,text) to authenticated;
grant execute on function public.apex_support_requests(int) to authenticated;
grant execute on function public.apex_update_support_request(uuid,text,text) to authenticated;
grant execute on function public.apex_admin_operations_snapshot() to authenticated;
