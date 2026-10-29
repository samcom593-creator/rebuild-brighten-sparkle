-- OVERHAUL-leaderboards (2026-10-29): the team board, the $5,000 bar and cheers.
--
-- Item 5 of the Galaxy app overhaul (master prompt 311), approved by Sam: remove the lead spend
-- category, "do not rank or count anyone under $5,000 for the month, state the rule on the
-- board", and "cheers or reactions on a teammate's row, visible to the team".
--
-- Why a new function and not leaderboard_board:
--   leaderboard_board(p_start, p_end) follows the CRM visibility contract (20260827040000,
--   20261016110210): an agent reads their own production and their downline's. Measured
--   2026-10-29 as Tyler Krejcha, an ordinary agent with no downline: 1 row (his own) of the 11
--   Sam sees for October. A board of one has no teammate to cheer. The agency already shares
--   per-agent sales with the whole team: discord-leaderboards posts the daily and weekly board
--   (names and amounts) to the production channel, and /board exists to be screenshotted and
--   posted. leaderboard_board is unchanged and keeps its callers (LiveCommissionsLeaderboard).
--
-- leaderboard_viewer_is_teammate(): who sees the team board and may cheer. Sam and the book
-- readers (api_is_full_reader), or anyone whose own agent record is active and not deactivated.
-- A self-signup gets a profile and the 'agent' role but no agent record (handle_new_user), so
-- signing up is not enough; terminated, inactive and deactivated people are not on the team.
--
-- leaderboard_team_board(p_start, p_end) returns the board for the window [p_start, p_end):
--   * The month: the calendar month of p_end - 1. Today, This week and This month are October
--     boards on 2026-10-29; Last month is the September board.
--   * Who is ranked: producers with $5,000 or more of annual premium posted in that month.
--     Everyone under $5,000 is neither ranked nor counted, and their rows never leave the
--     database, with one exception: the caller's own numbers come back as `me`, so an agent under
--     the bar sees how far they have to go. Full readers also get below_bar_ap, the window's
--     premium from producers under the bar, so the board total reconciles with the agency total.
--   * A row: rank, name, avatar, deals and annual premium in the window, annual premium in the
--     month, first policy date (tenure), agency, departed (terminated or deactivated: labelled,
--     historical attribution, never cheered), is_viewer, and the month's cheers. est_earnings
--     only where the caller may already read that agent's production (production_can_read_agent:
--     their own and their downline's; everyone for full readers), otherwise null, so a teammate
--     can never divide estimate by premium to read someone's contract level off the board.
--   * Names and avatars that carry an email address come back null (20261009001500); the page
--     shows a dash.
--   * The same book as leaderboard_board: v_production_comp_truth without the external-gap rows,
--     posted date, canonical agent, name-only producers keyed 'name:<lower name>'. External-gap
--     rows (agency production not attributed to a seller) come back in agency_gap, for full
--     readers only, and are never ranked.
--
-- Cheers: public.leaderboard_cheers, one row per (month, agent on the board, cheerer). Teammates
-- read them (RLS). Nobody writes the table directly: leaderboard_set_cheer(p_agent_key, p_month,
-- p_cheer) checks that the caller is a teammate, the month is this month or last month (Phoenix),
-- and, to add a cheer, that the agent is on that month's board, is not the caller, and has not
-- left. It is idempotent (set or clear, never toggle), so a double tap cannot undo itself.
--
-- Also: leaderboard_board loses EXECUTE for PUBLIC and anon again. 20260827040000 revoked it and
-- src/tests/lib/leaderboardHierarchyScope.test.ts says it stays closed; a later re-creation
-- restored the default grant (measured 2026-10-29: anon=X/postgres). Anon gets 0 rows from it
-- today (every row needs auth.uid()), so this closes a door, it does not change what anyone sees.
--
-- Tested 2026-10-29 in rolled-back transactions against production, as Sam, as an ordinary agent
-- on the board, as an ordinary agent under the bar, as a terminated agent, as a signed-in login
-- with no agent record, and as anon. Numbers in the PR body.

create or replace function public.leaderboard_viewer_is_teammate()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null and (
    public.api_is_full_reader()
    or exists (
      select 1
        from public.agents a
       where a.user_id = auth.uid()
         and a.status = 'active'
         and coalesce(a.is_deactivated, false) = false
    )
  );
$$;

revoke all on function public.leaderboard_viewer_is_teammate() from public, anon;
grant execute on function public.leaderboard_viewer_is_teammate() to authenticated, service_role;

comment on function public.leaderboard_viewer_is_teammate() is
  'OVERHAUL-leaderboards 2026-10-29: true for full-book readers and for a login whose own agent record is active and not deactivated. Gates the team board and cheers; a self-signup (no agent record) is not a teammate.';

create table if not exists public.leaderboard_cheers (
  id uuid primary key default gen_random_uuid(),
  month_start date not null,
  to_agent_key text not null,
  from_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint leaderboard_cheers_month_is_first check (extract(day from month_start) = 1),
  constraint leaderboard_cheers_key_shape check (
    to_agent_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or to_agent_key ~ '^name:.{1,200}$'
  ),
  constraint leaderboard_cheers_once unique (month_start, to_agent_key, from_user_id)
);

comment on table public.leaderboard_cheers is
  'OVERHAUL-leaderboards 2026-10-29: one cheer per (board month, agent on the board, cheerer). Read by teammates (RLS); written only by leaderboard_set_cheer. to_agent_key is the board''s agent key: the canonical agent id, or name:<lower name> for a name-only producer.';

alter table public.leaderboard_cheers enable row level security;

revoke all on table public.leaderboard_cheers from public, anon, authenticated;
grant select on table public.leaderboard_cheers to authenticated;
grant all on table public.leaderboard_cheers to service_role;

drop policy if exists "Teammates read cheers" on public.leaderboard_cheers;
create policy "Teammates read cheers"
  on public.leaderboard_cheers
  for select
  to authenticated
  using (public.leaderboard_viewer_is_teammate());

create or replace function public.leaderboard_team_board(p_start date, p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- The bar Sam set: $5,000 of annual premium in the board's month. src/lib/leaderboardBoard.ts
  -- carries the same number (BOARD_MONTHLY_MINIMUM) and a test holds the two together.
  v_minimum constant numeric := 5000;
  v_uid uuid := auth.uid();
  v_month_start date;
  v_month_end date;
  v_full boolean;
  v_team boolean;
  v_viewer_keys text[];
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to see the leaderboard' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end - p_start > 62 then
    raise exception 'Invalid board window' using errcode = '22023';
  end if;

  v_month_start := date_trunc('month', (p_end - 1)::timestamp)::date;
  v_month_end := (v_month_start + interval '1 month')::date;
  v_full := public.api_is_full_reader();
  v_team := public.leaderboard_viewer_is_teammate();

  -- The caller's own board keys: every agent record on this login, canonicalised.
  select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)::text), '{}'::text[])
    into v_viewer_keys
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
   where a.user_id = v_uid;

  with base as materialized (
    select coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) as agent_key,
           t.agent_id, t.agent_name, t.annual_premium, t.posted_date, t.direct_estimate, t.row_key
      from public.v_production_comp_truth t
     where t.origin is distinct from 'external_daily_gap'
       and (t.agent_id is not null or nullif(btrim(t.agent_name), '') is not null)
  ),
  month_totals as (
    select b.agent_key, sum(b.annual_premium) as month_ap, count(*) as month_deals
      from base b
     where b.posted_date >= v_month_start and b.posted_date < v_month_end
     group by b.agent_key
  ),
  window_totals as (
    select b.agent_key, b.agent_id, min(b.agent_name) as raw_name, count(*) as deals,
           sum(b.annual_premium) as ap, sum(b.direct_estimate) as est
      from base b
     where b.posted_date >= p_start and b.posted_date < p_end
     group by b.agent_key, b.agent_id
  ),
  qualified as (
    select w.*, mt.month_ap
      from window_totals w
      join month_totals mt on mt.agent_key = w.agent_key
     where mt.month_ap >= v_minimum
       and w.ap > 0
  ),
  first_policy as (
    select b.agent_key, min(b.posted_date) as first_on
      from base b
     where b.agent_key in (select q.agent_key from qualified q)
     group by b.agent_key
  ),
  agency as (
    select b.agent_key, mode() within group (order by mv.agency) as agency
      from base b
      join public.mv_production_comp_truth mv on mv.row_key = b.row_key
     where b.posted_date >= p_start and b.posted_date < p_end
       and b.agent_key in (select q.agent_key from qualified q)
     group by b.agent_key
  ),
  named as (
    select q.agent_key, q.agent_id, q.deals, q.ap, q.est, q.month_ap, fp.first_on, ag.agency,
           coalesce(
             case when pr.full_name like '%@%' then null else nullif(btrim(pr.full_name), '') end,
             case when a.display_name like '%@%' then null else nullif(btrim(a.display_name), '') end,
             case when q.raw_name like '%@%' then null else nullif(btrim(q.raw_name), '') end
           ) as name,
           case when pr.avatar_url like '%@%' then null else nullif(btrim(pr.avatar_url), '') end as avatar_url,
           coalesce(a.status = 'terminated' or coalesce(a.is_deactivated, false), false) as departed,
           (q.agent_key = any (v_viewer_keys)) as is_viewer,
           (v_full or (q.agent_id is not null and public.production_can_read_agent(q.agent_id))) as readable
      from qualified q
      left join first_policy fp on fp.agent_key = q.agent_key
      left join agency ag on ag.agent_key = q.agent_key
      left join public.agents a on a.id = q.agent_id
      left join public.profiles pr on pr.id = a.profile_id
  ),
  ranked as (
    select n.*, row_number() over (order by n.ap desc, n.deals desc, n.name asc nulls last, n.agent_key) as rank
      from named n
  ),
  cheer_rows as (
    select c.to_agent_key, c.from_user_id, c.created_at,
           coalesce(
             (select case when p2.full_name like '%@%' then null else nullif(btrim(p2.full_name), '') end
                from public.agents a2 join public.profiles p2 on p2.id = a2.profile_id
               where a2.user_id = c.from_user_id
               order by a2.created_at desc limit 1),
             (select case when a3.display_name like '%@%' then null else nullif(btrim(a3.display_name), '') end
                from public.agents a3
               where a3.user_id = c.from_user_id
               order by a3.created_at desc limit 1),
             (select case when p4.full_name like '%@%' then null else nullif(btrim(p4.full_name), '') end
                from public.profiles p4
               where p4.user_id = c.from_user_id
               limit 1)
           ) as from_name
      from public.leaderboard_cheers c
     where c.month_start = v_month_start
       and c.to_agent_key in (select r.agent_key from ranked r)
  ),
  -- names: up to three cheerers, newest first, never the caller (the page says "You").
  cheers as (
    select cr.to_agent_key, count(*)::int as n, bool_or(cr.from_user_id = v_uid) as mine,
           (array_agg(cr.from_name order by cr.created_at desc)
              filter (where cr.from_name is not null and cr.from_user_id <> v_uid))[1:3] as names
      from cheer_rows cr
     group by cr.to_agent_key
  ),
  gap as (
    select mv.agency, count(*) as deals, sum(mv.annual_premium) as ap
      from public.mv_production_comp_truth mv
     where mv.origin = 'external_daily_gap'
       and mv.posted_date >= p_start and mv.posted_date < p_end
     group by mv.agency
  )
  select jsonb_build_object(
    'access', case when v_team then 'team' else 'none' end,
    'full_reader', v_full,
    'as_of', now(),
    'window_start', p_start,
    'window_end', p_end,
    'month_start', v_month_start,
    'month_end', v_month_end,
    'minimum', v_minimum,
    'rows', case when v_team then coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', r.rank,
               'agent_key', r.agent_key,
               'agent_id', r.agent_id,
               'name', r.name,
               'avatar_url', r.avatar_url,
               'deals', r.deals,
               'ap', round(r.ap, 2),
               'month_ap', round(r.month_ap, 2),
               'est_earnings', case when r.readable then round(coalesce(r.est, 0), 2) end,
               'readable', r.readable,
               'first_policy_date', r.first_on,
               'agency', r.agency,
               'departed', r.departed,
               'is_viewer', r.is_viewer,
               'cheers', coalesce(ch.n, 0),
               'cheered_by_me', coalesce(ch.mine, false),
               'cheer_names', coalesce(to_jsonb(ch.names), '[]'::jsonb)
             ) order by r.rank)
        from ranked r
        left join cheers ch on ch.to_agent_key = r.agent_key), '[]'::jsonb)
      else '[]'::jsonb end,
    'me', case when cardinality(v_viewer_keys) = 0 then null else (
      select jsonb_build_object(
               'month_ap', round(coalesce((select sum(mt.month_ap) from month_totals mt where mt.agent_key = any (v_viewer_keys)), 0), 2),
               'month_deals', coalesce((select sum(mt.month_deals) from month_totals mt where mt.agent_key = any (v_viewer_keys)), 0),
               'ap', round(coalesce((select sum(w.ap) from window_totals w where w.agent_key = any (v_viewer_keys)), 0), 2),
               'deals', coalesce((select sum(w.deals) from window_totals w where w.agent_key = any (v_viewer_keys)), 0),
               'est_earnings', round(coalesce((select sum(w.est) from window_totals w where w.agent_key = any (v_viewer_keys)), 0), 2))
    ) end,
    'below_bar_ap', case when v_full then (
      select round(coalesce(sum(w.ap), 0), 2)
        from window_totals w
        left join month_totals mt on mt.agent_key = w.agent_key
       where coalesce(mt.month_ap, 0) < v_minimum
         and w.ap > 0
    ) end,
    'agency_gap', case when v_full then coalesce((
      select jsonb_agg(jsonb_build_object('agency', g.agency, 'deals', g.deals, 'ap', round(g.ap, 2)) order by g.ap desc)
        from gap g
       where g.ap > 0), '[]'::jsonb)
      else '[]'::jsonb end
  )
  into v_out;

  return v_out;
end;
$$;

revoke all on function public.leaderboard_team_board(date, date) from public, anon;
grant execute on function public.leaderboard_team_board(date, date) to authenticated, service_role;

comment on function public.leaderboard_team_board(date, date) is
  'OVERHAUL-leaderboards 2026-10-29: the team board for [p_start, p_end). Ranks producers with $5,000+ of annual premium in the calendar month of p_end - 1; nobody under the bar is ranked, counted or returned except the caller (me). Teammates only (leaderboard_viewer_is_teammate); est_earnings only where production_can_read_agent; below_bar_ap and agency_gap for full readers.';

create or replace function public.leaderboard_set_cheer(p_agent_key text, p_month date, p_cheer boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_minimum constant numeric := 5000;
  v_uid uuid := auth.uid();
  v_this_month date := date_trunc('month', ((now() at time zone 'America/Phoenix')::date)::timestamp)::date;
  v_month date;
  v_month_end date;
  v_month_ap numeric;
  v_count integer;
  v_mine boolean;
begin
  if v_uid is null then
    raise exception 'Sign in to cheer' using errcode = '42501';
  end if;
  if not public.leaderboard_viewer_is_teammate() then
    raise exception 'Only active agents can cheer' using errcode = '42501';
  end if;
  if p_agent_key is null or btrim(p_agent_key) = '' or p_month is null or p_cheer is null then
    raise exception 'Say who to cheer and for which month' using errcode = '22023';
  end if;

  v_month := date_trunc('month', p_month::timestamp)::date;
  -- This month and last month. The page's windows are Chicago business days, which run up to two
  -- hours ahead of Phoenix, so for those hours on the 1st the page's "this month" is Phoenix's
  -- next month; it is accepted too. Nobody can be cheered for a month before they are on its board.
  if v_month < (v_this_month - interval '1 month')::date or v_month > (v_this_month + interval '1 month')::date then
    raise exception 'Cheers are open for this month and last month' using errcode = '22023';
  end if;
  v_month_end := (v_month + interval '1 month')::date;

  if p_cheer then
    if exists (
      select 1
        from public.agents a
        left join public.v_agent_canonical_map m on m.agent_id = a.id
       where a.user_id = v_uid
         and coalesce(m.canonical_agent_id, a.id)::text = p_agent_key
    ) then
      raise exception 'You cannot cheer yourself' using errcode = '22023';
    end if;

    -- On the board: the materialized book first (refreshed every five minutes), and the live
    -- view only when it says no, so a sale posted a minute ago still counts.
    select sum(mv.annual_premium) into v_month_ap
      from public.mv_production_comp_truth mv
     where mv.origin is distinct from 'external_daily_gap'
       and coalesce(mv.agent_id::text, 'name:' || lower(btrim(mv.agent_name))) = p_agent_key
       and mv.posted_date >= v_month and mv.posted_date < v_month_end;
    if coalesce(v_month_ap, 0) < v_minimum then
      select sum(t.annual_premium) into v_month_ap
        from public.v_production_comp_truth t
       where t.origin is distinct from 'external_daily_gap'
         and coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) = p_agent_key
         and t.posted_date >= v_month and t.posted_date < v_month_end;
    end if;
    if coalesce(v_month_ap, 0) < v_minimum then
      raise exception 'Only agents on the board can be cheered' using errcode = '22023';
    end if;

    if p_agent_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and exists (
         select 1 from public.agents a
          where a.id = p_agent_key::uuid
            and (a.status = 'terminated' or coalesce(a.is_deactivated, false))
       ) then
      raise exception 'This agent has left the team' using errcode = '22023';
    end if;

    insert into public.leaderboard_cheers (month_start, to_agent_key, from_user_id)
    values (v_month, p_agent_key, v_uid)
    on conflict on constraint leaderboard_cheers_once do nothing;
  else
    delete from public.leaderboard_cheers c
     where c.month_start = v_month
       and c.to_agent_key = p_agent_key
       and c.from_user_id = v_uid;
  end if;

  select count(*)::int, coalesce(bool_or(c.from_user_id = v_uid), false)
    into v_count, v_mine
    from public.leaderboard_cheers c
   where c.month_start = v_month
     and c.to_agent_key = p_agent_key;

  return jsonb_build_object('agent_key', p_agent_key, 'month_start', v_month, 'cheers', v_count, 'cheered_by_me', v_mine);
end;
$$;

revoke all on function public.leaderboard_set_cheer(text, date, boolean) from public, anon;
grant execute on function public.leaderboard_set_cheer(text, date, boolean) to authenticated, service_role;

comment on function public.leaderboard_set_cheer(text, date, boolean) is
  'OVERHAUL-leaderboards 2026-10-29: set (p_cheer true) or clear (false) the caller''s cheer on an agent''s board row for a month (this month or last month, Phoenix). Teammates only; a cheer needs the agent on that month''s board ($5,000+), not the caller, not departed. Returns the row''s new count and whether the caller cheers it.';

revoke all on function public.leaderboard_board(date, date) from public, anon;
grant execute on function public.leaderboard_board(date, date) to authenticated, service_role;
