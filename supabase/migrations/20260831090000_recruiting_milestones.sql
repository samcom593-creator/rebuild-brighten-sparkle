-- wave-recruiting-milestones — recognise hiring, daily and monthly, in Slack,
-- Discord and on the dashboard.
--
-- WHY NOTHING WAS FIRING: supabase/functions/check-recruiting-milestones has
-- existed for months with daily tiers already defined (3 = RECRUITER RISING,
-- 5 = HIRING CHAMPION). It is on NO cron job and plaque_awards contains ZERO
-- recruiting or hiring rows — it has never run once. Built and never wired, the
-- same shape as the sub-agency Discord webhook and slack_community_invite_url.
--
-- THRESHOLDS ARE MEASURED, NOT INVENTED. A tier nobody can reach is worse than
-- no tier, so these come from 6 months of real hiring:
--   per recruiter per DAY:    1 hire x56 occurrences, 2 x8, 3 x6, 4 x4, 5 x2,
--                             plus single days of 7, 10 and 12
--   per recruiter per MONTH:  1 x7, 2 x5, 3, 4, 5 x3, 6 x2, 11 x2, 13, 15, 17, 27
-- So the existing 3/5 daily tiers ARE reachable (15 occurrences in 6 months) and
-- are kept. What was missing is the entry rung — one hire in a day is the actual
-- cadence and happened 56 times — and any monthly ladder at all.
--
-- Announcements go to BOTH Slack and Discord through outbox_events, which is
-- already delivering to both (62 discord / 55 slack in 30 days). Nothing new is
-- invented for delivery; a milestone is just another durable outbox event, so it
-- inherits the retry and the receipt.

begin;

create or replace function public.recruiting_tier(p_count integer, p_period text)
returns jsonb
language sql
immutable
as $$
  select case
    when p_period = 'day' then
      case
        when p_count >= 5 then jsonb_build_object('key','hiring_champion','label','HIRING CHAMPION','threshold',5)
        when p_count >= 3 then jsonb_build_object('key','recruiter_rising','label','RECRUITER RISING','threshold',3)
        when p_count >= 1 then jsonb_build_object('key','on_the_board','label','ON THE BOARD','threshold',1)
        else null end
    else
      case
        when p_count >= 20 then jsonb_build_object('key','empire_builder','label','EMPIRE BUILDER','threshold',20)
        when p_count >= 10 then jsonb_build_object('key','agency_builder','label','AGENCY BUILDER','threshold',10)
        when p_count >= 5  then jsonb_build_object('key','team_builder','label','TEAM BUILDER','threshold',5)
        when p_count >= 3  then jsonb_build_object('key','builder','label','BUILDER','threshold',3)
        when p_count >= 1  then jsonb_build_object('key','first_hire','label','FIRST HIRE','threshold',1)
        else null end
  end;
$$;

comment on function public.recruiting_tier(integer, text) is
  'Recruiting tier for a hire count over a day or a month. Thresholds are '
  'derived from 6 months of real hiring rather than chosen — a tier nobody can '
  'reach is worse than no tier. See migration 20260831090000.';

-- ─── The sweep ───────────────────────────────────────────────────────────────
-- Idempotent on (agent_id, milestone_type, milestone_date), so re-running it
-- announces nothing twice. Returns the count actually announced so a caller can
-- tell "nothing qualified" from "it did not run".
create or replace function public.fn_sweep_recruiting_milestones(p_period text default 'day')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket date;
  v_new int := 0;
  r record;
  v_tier jsonb;
begin
  if p_period not in ('day','month') then
    raise exception 'p_period must be day or month, got %', p_period;
  end if;

  v_bucket := case when p_period = 'day'
                   then (now() at time zone 'America/Phoenix')::date
                   else date_trunc('month', (now() at time zone 'America/Phoenix'))::date end;

  for r in
    select coalesce(a.invited_by_manager_id, a.manager_id) as recruiter_id,
           count(*)::int as hires
    from public.agents a
    where coalesce(a.invited_by_manager_id, a.manager_id) is not null
      and (case when p_period = 'day'
                then (a.created_at at time zone 'America/Phoenix')::date = v_bucket
                else date_trunc('month', (a.created_at at time zone 'America/Phoenix'))::date = v_bucket end)
    group by 1
  loop
    v_tier := public.recruiting_tier(r.hires, p_period);
    if v_tier is null then continue; end if;

    insert into public.plaque_awards (agent_id, milestone_type, milestone_date, amount, badge_label)
    values (r.recruiter_id,
            p_period || '_' || (v_tier->>'key'),
            v_bucket,
            r.hires,
            v_tier->>'label')
    on conflict do nothing;

    if not found then continue; end if;
    v_new := v_new + 1;

    -- One event per destination. Both are already live delivery paths, so a
    -- milestone inherits the outbox's retry and its receipt rather than getting
    -- a bespoke fire-and-forget post.
    insert into public.outbox_events
      (aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key)
    select 'recruiting_milestone', r.recruiter_id, 'recruiting.milestone', d,
           jsonb_build_object(
             'agentId', r.recruiter_id,
             'agentName', coalesce((select display_name from public.agents where id = r.recruiter_id), 'An agent'),
             'badge', v_tier->>'label',
             'hires', r.hires,
             'period', p_period,
             'bucket', v_bucket,
             'openUrl', 'https://apex-financial.org/dashboard/leaderboard'),
           -- The DESTINATION is part of the key. Without it the Discord row
           -- collided with the Slack row on the same conflict target and was
           -- silently dropped — the first run queued 3 Slack events and ZERO
           -- Discord ones, and `on conflict do nothing` reported success.
           format('recruiting.milestone:%s:%s:%s:%s:%s', r.recruiter_id, p_period, v_tier->>'key', v_bucket, d)
    from unnest(array['slack','discord']) d
    on conflict (idempotency_key) do nothing;
  end loop;

  return v_new;
end
$$;

revoke all on function public.fn_sweep_recruiting_milestones(text) from public, anon;
grant execute on function public.fn_sweep_recruiting_milestones(text) to service_role;

-- ─── My standing, for the dashboard ─────────────────────────────────────────
-- The upward-mobility view: where the caller is now and what the next rung
-- costs. Resolves the caller from auth.uid(); no arguments, so one agent cannot
-- read another's standing.
create or replace function public.my_recruiting_standing()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_agent uuid; v_month int; v_all int; v_tier jsonb; v_next int;
begin
  select a.id into v_agent from public.agents a where a.user_id = auth.uid() limit 1;
  if v_agent is null then return jsonb_build_object('state','no_agent_record'); end if;

  select count(*)::int into v_month from public.agents a
   where coalesce(a.invited_by_manager_id, a.manager_id) = v_agent
     and date_trunc('month', (a.created_at at time zone 'America/Phoenix'))
         = date_trunc('month', (now() at time zone 'America/Phoenix'));

  select count(*)::int into v_all from public.agents a
   where coalesce(a.invited_by_manager_id, a.manager_id) = v_agent;

  v_tier := public.recruiting_tier(v_month, 'month');
  v_next := case
    when v_month >= 20 then null
    when v_month >= 10 then 20
    when v_month >= 5  then 10
    when v_month >= 3  then 5
    when v_month >= 1  then 3
    else 1 end;

  return jsonb_build_object(
    'state','ok',
    'hires_this_month', v_month,
    'hires_all_time', v_all,
    'tier_label', v_tier->>'label',
    'next_threshold', v_next,
    'to_next', case when v_next is null then 0 else greatest(v_next - v_month, 0) end);
end
$$;

revoke all on function public.my_recruiting_standing() from public, anon;
grant execute on function public.my_recruiting_standing() to authenticated, service_role;

commit;
