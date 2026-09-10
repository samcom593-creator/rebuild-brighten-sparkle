-- MP-ONB-1 (2026-09-10): unlicensed recruits got NOTHING on hire (trigger returned early for non-licensed; backfill was licensed-only).
-- Applied via connector 2026-09-10; idempotent. See ~/business-ops/session-state/active-work.md for the measured 30d gap.
-- Queue kind 'discord' = "Join APEX Slack + Discord" community email (carries slack_community_invite_url), not gated on licensure.
create or replace function public.fn_enqueue_agent_onboarding_emails() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare target timestamptz;
begin
  target := public.fn_next_onboarding_window();
  if new.license_status = 'licensed' then
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'course', target), (new.id, 'discord', target) on conflict (agent_id, email_kind) do nothing;
  else
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'get_licensed', target), (new.id, 'discord', target) on conflict (agent_id, email_kind) do nothing;
  end if;
  return new;
end $$;
create or replace function public.fn_enqueue_unlicensed_activation() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'active' and (old.status is distinct from 'active') and new.license_status <> 'licensed'
     and coalesce(new.is_deactivated,false) = false and coalesce(new.is_inactive,false) = false then
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'get_licensed', public.fn_next_onboarding_window()), (new.id, 'discord', public.fn_next_onboarding_window())
    on conflict (agent_id, email_kind) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists trg_agents_unlicensed_activation_enqueue on public.agents;
create trigger trg_agents_unlicensed_activation_enqueue after update of status on public.agents
  for each row execute function public.fn_enqueue_unlicensed_activation();
create or replace function public.fn_onboarding_email_backfill_sweep() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare enq_licensed int := 0; enq_unlicensed int := 0;
begin
  with targets as (
    select a.id as agent_id from public.agents a
    where a.status = 'active' and coalesce(a.is_deactivated,false) = false and coalesce(a.is_inactive,false) = false
      and a.license_status = 'licensed' and a.created_at >= now() - interval '30 days'
      and (exists (select 1 from public.profiles p where p.user_id = a.user_id and p.email is not null and p.email !~* 'placeholder')
           or exists (select 1 from auth.users u where u.id = a.user_id and u.email is not null))
      and not exists (select 1 from public.agent_onboarding_queue q where q.agent_id = a.id and q.email_kind = 'course')
  ), ins as (
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    select agent_id, kind, now() from targets cross join (values ('course'), ('discord')) as k(kind)
    on conflict (agent_id, email_kind) do nothing returning 1
  ) select count(*) into enq_licensed from ins;
  with targets as (
    select a.id as agent_id from public.agents a
    where a.status = 'active' and coalesce(a.is_deactivated,false) = false and coalesce(a.is_inactive,false) = false
      and a.license_status <> 'licensed' and a.created_at >= now() - interval '30 days'
      and (exists (select 1 from public.profiles p where p.user_id = a.user_id and p.email is not null and p.email !~* 'placeholder')
           or exists (select 1 from auth.users u where u.id = a.user_id and u.email is not null))
      and not exists (select 1 from public.agent_onboarding_queue q where q.agent_id = a.id and q.email_kind = 'get_licensed')
  ), ins as (
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    select agent_id, kind, now() from targets cross join (values ('get_licensed'), ('discord')) as k(kind)
    on conflict (agent_id, email_kind) do nothing returning 1
  ) select count(*) into enq_unlicensed from ins;
  return jsonb_build_object('enqueued_licensed', enq_licensed, 'enqueued_unlicensed', enq_unlicensed, 'ran_at', now());
end $$;
