-- MP-SEATS-1 (2026-11-19): keep the dialer seats rolling, and tie dialer access to the ban list.
--
-- Measured that day inside ReadyMode: 4 agent licences, all 4 in use, and they are CONCURRENT
-- seats (a seat is held by whoever is signed in). 34 live logins existed for those 4 seats; 10 of
-- them belonged to people banned on the platform (KJ, in the Admin group, and his team), none
-- of whom had dialed since 2026-09-28. Platform bans never reached the dialer.
--
-- The local puller (readymode-bot/scripts/rm-calllog-pull.mjs, every 10 minutes, the only
-- process that can reach ReadyMode) now also:
--   1. writes one readymode_seat_snapshots row per run (licence counts, who holds a seat,
--      every live login);
--   2. signs out sessions ReadyMode ITSELF marks inactive ("not active for more than 10 minutes
--      ... can be safely signed out": the browser window is closed). Never a session with the
--      window open, so never someone on a call;
--   3. moves a login into ReadyMode's "Deleted Users" (revivable there) when
--      fn_readymode_accounts_to_lock() says its person is terminated, deactivated, login-banned
--      or under an open suspension. The rule lives here, in one place, not in the script.
-- Every action lands in readymode_seat_actions. Two switches in system_settings turn either
-- behaviour off; a missing or non-'true' value means OFF.

create table if not exists public.readymode_seat_snapshots (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  agent_total integer, agent_assigned integer, agent_remaining integer,
  admin_total integer, admin_assigned integer, admin_remaining integer,
  -- who is signed in: [{uid, account, name, licence, signed_in, last_active, inactive}]
  claims jsonb not null default '[]'::jsonb,
  -- every live login: [{uid, name, grp}]
  accounts jsonb not null default '[]'::jsonb
);
create index if not exists readymode_seat_snapshots_taken_at_idx on public.readymode_seat_snapshots (taken_at desc);
alter table public.readymode_seat_snapshots enable row level security;
revoke all on public.readymode_seat_snapshots from anon, authenticated;

create table if not exists public.readymode_seat_actions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('signout_inactive', 'lock_banned_account')),
  dry_run boolean not null default false,
  rm_user_id integer not null,
  rm_account text,
  rm_name text,
  agent_id uuid references public.agents(id) on delete set null,
  reason text not null,
  ok boolean not null,
  detail text
);
create index if not exists readymode_seat_actions_at_idx on public.readymode_seat_actions (at desc);
alter table public.readymode_seat_actions enable row level security;
revoke all on public.readymode_seat_actions from anon, authenticated;

-- Which live dialer logins belong to someone the platform has already shut out.
-- Input: [{"uid": 120, "name": "KJ"}, ...] (ReadyMode's live user list). A login is matched to a
-- person only through readymode_agent_aliases, the table a human keeps; a name that resolves to
-- nobody is never locked here.
create or replace function public.fn_readymode_accounts_to_lock(p_accounts jsonb)
returns table(rm_user_id integer, rm_name text, agent_id uuid, reason text)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with acc as (
    select distinct on ((x->>'uid')::integer) (x->>'uid')::integer as uid, btrim(x->>'name') as name
    from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) x
    where x->>'uid' ~ '^[0-9]+$' and btrim(coalesce(x->>'name', '')) <> ''
    order by (x->>'uid')::integer
  ),
  person as (
    select acc.uid, acc.name, a.id as agent_id,
           a.status::text = 'terminated' as terminated,
           coalesce(a.is_deactivated, false) as deactivated,
           coalesce(u.banned_until > now(), false) as banned,
           exists (select 1 from public.agent_access_suspensions s where s.user_id = a.user_id and s.lifted_at is null) as suspended
    from acc
    join public.readymode_agent_aliases al on al.agent_raw = lower(acc.name) and al.person_type = 'agent' and al.agent_id is not null
    join public.agents a on a.id = al.agent_id
    left join auth.users u on u.id = a.user_id
  )
  select p.uid, p.name, p.agent_id,
         concat_ws(', ', case when p.terminated then 'terminated' end, case when p.deactivated then 'deactivated' end,
                         case when p.banned then 'login banned' end, case when p.suspended then 'open suspension' end)
  from person p
  where p.terminated or p.deactivated or p.banned or p.suspended
$fn$;
revoke all on function public.fn_readymode_accounts_to_lock(jsonb) from public, anon, authenticated;

insert into public.system_settings (key, value) values
  ('dialer_seat_autosignout', 'true'),
  ('dialer_seat_autolock', 'true')
on conflict (key) do nothing;

-- What the owner sees: seats right now, who holds them and whether they are dialing, how often
-- the seats are full, what the automation did, and logins nobody has dialed from in 30 days.
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
    'unlinked_dialers', (select coalesce(jsonb_agg(to_jsonb(u) order by u.calls_30d desc), '[]'::jsonb) from public.v_dialer_unattributed u),
    'automation', jsonb_build_object(
      'autosignout', coalesce((select value = 'true' from public.system_settings where key = 'dialer_seat_autosignout'), false),
      'autolock', coalesce((select value = 'true' from public.system_settings where key = 'dialer_seat_autolock'), false))
  ) into v;
  return v;
end
$fn$;
revoke all on function public.admin_dialer_seats() from public, anon;
grant execute on function public.admin_dialer_seats() to authenticated;
