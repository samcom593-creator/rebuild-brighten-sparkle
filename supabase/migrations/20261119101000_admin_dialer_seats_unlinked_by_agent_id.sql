-- MP-SEATS-1 follow-up (2026-11-19): "not linked to an agent" must mean the call has no agent.
--
-- admin_dialer_seats() took its unlinked-dialers list from v_dialer_unattributed, which tests
-- whether the dialer's login name EQUALS an agent's full display name. Almost nobody's does
-- ("meja", "Obi", "Edwin"), so it listed meja with 3,523 calls as unlinked while every one of
-- those calls carries her agent_id through readymode_agent_aliases. Measured over 30 days: the
-- view names 8 dialers; calls with agent_id IS NULL belong to 2 (nate 1,142, Manager 2).
-- The list now counts calls whose agent_id is null. v_dialer_unattributed is left as it is.

create or replace function public.admin_dialer_seats()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v jsonb;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with latest as (
    select * from public.readymode_seat_snapshots order by taken_at desc limit 1
  ),
  calls as (
    select lower(btrim(c.agent_raw)) as k,
           max(c.call_started_at) as last_call_at,
           count(*) filter (where (c.call_started_at at time zone 'America/Phoenix')::date = (now() at time zone 'America/Phoenix')::date) as calls_today,
           count(*) filter (where c.call_started_at > now() - interval '30 days') as calls_30d
    from public.readymode_dialer_calls c
    where c.agent_raw is not null and c.call_started_at > now() - interval '120 days'
    group by 1
  ),
  holders as (
    select h.value as claim, cl.last_call_at, coalesce(cl.calls_today, 0) as calls_today, ag.display_name as agent_name
    from latest l
    cross join lateral jsonb_array_elements(l.claims) h
    left join calls cl on cl.k = lower(btrim(h.value->>'name'))
    left join public.readymode_agent_aliases al on al.agent_raw = lower(btrim(h.value->>'name')) and al.agent_id is not null
    left join public.agents ag on ag.id = al.agent_id
  ),
  dormant as (
    select (x.value->>'uid')::integer as uid, x.value->>'name' as name, x.value->>'grp' as grp, cl.last_call_at, ag.display_name as agent_name
    from latest l
    cross join lateral jsonb_array_elements(l.accounts) x
    left join calls cl on cl.k = lower(btrim(x.value->>'name'))
    left join public.readymode_agent_aliases al on al.agent_raw = lower(btrim(x.value->>'name')) and al.agent_id is not null
    left join public.agents ag on ag.id = al.agent_id
    where coalesce(cl.calls_30d, 0) = 0 and x.value->>'grp' = 'Agents'
  ),
  week as (
    select count(*) as snapshots,
           count(*) filter (where agent_remaining = 0) as full_snapshots
    from public.readymode_seat_snapshots
    where taken_at > now() - interval '7 days'
      and extract(hour from taken_at at time zone 'America/Phoenix') between 7 and 18
  ),
  acts as (
    select * from public.readymode_seat_actions where at > now() - interval '7 days' and not dry_run
  )
  select jsonb_build_object(
    'generated_at', now(),
    'snapshot_at', (select taken_at from latest),
    'seats', (select jsonb_build_object('agent_total', agent_total, 'agent_assigned', agent_assigned, 'agent_remaining', agent_remaining,
                                        'admin_total', admin_total, 'admin_assigned', admin_assigned, 'admin_remaining', admin_remaining) from latest),
    'holders', (select coalesce(jsonb_agg(claim || jsonb_build_object('agent_name', agent_name, 'calls_today', calls_today, 'last_call_at', last_call_at)), '[]'::jsonb) from holders),
    'week', (select to_jsonb(w) from week w),
    'signed_out_7d', (select count(*) from acts where action = 'signout_inactive' and ok),
    'locked_7d', (select count(*) from acts where action = 'lock_banned_account' and ok),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'action', action, 'name', rm_name, 'reason', reason, 'ok', ok) order by at desc), '[]'::jsonb)
                from (select * from acts order by at desc limit 25) a),
    'dormant_logins', (select coalesce(jsonb_agg(jsonb_build_object('uid', uid, 'name', name, 'agent_name', agent_name, 'last_call_at', last_call_at) order by last_call_at desc nulls last), '[]'::jsonb) from dormant),
    'unlinked_dialers', (select coalesce(jsonb_agg(jsonb_build_object('dialer_name', u.dialer_name, 'calls_30d', u.calls_30d, 'last_call_at', u.last_call_at) order by u.calls_30d desc), '[]'::jsonb)
                         from (select btrim(c.agent_raw) as dialer_name, count(*)::integer as calls_30d, max(c.call_started_at) as last_call_at
                               from public.readymode_dialer_calls c
                               where c.call_started_at >= now() - interval '30 days'
                                 and nullif(btrim(c.agent_raw), '') is not null
                                 and c.agent_id is null
                               group by btrim(c.agent_raw)) u),
    'automation', jsonb_build_object(
      'autosignout', coalesce((select value = 'true' from public.system_settings where key = 'dialer_seat_autosignout'), false),
      'autolock', coalesce((select value = 'true' from public.system_settings where key = 'dialer_seat_autolock'), false))
  ) into v;
  return v;
end
$fn$;
revoke all on function public.admin_dialer_seats() from public, anon;
grant execute on function public.admin_dialer_seats() to authenticated;
