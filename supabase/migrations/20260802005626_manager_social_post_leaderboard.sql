-- Internal, self-reported manager social-post counter and weekly leaderboard.
-- The board is authenticated-only and intentionally remains off public surfaces.
begin;

create table if not exists public.manager_social_posts (
  agent_id uuid not null references public.agents(id) on delete cascade,
  post_date date not null default (now() at time zone 'America/Chicago')::date,
  post_count integer not null default 0 check (post_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (agent_id, post_date)
);

comment on table public.manager_social_posts is
  'Self-reported daily social-post count per manager. One row per manager and day. Internal motivation metric only.';

create index if not exists idx_manager_social_posts_date
  on public.manager_social_posts (post_date desc);

alter table public.manager_social_posts enable row level security;
revoke all on public.manager_social_posts from anon;

drop policy if exists "Authenticated users can view manager post counts" on public.manager_social_posts;
create policy "Authenticated users can view manager post counts"
  on public.manager_social_posts for select to authenticated
  using (true);

drop policy if exists "Managers can insert own post counts" on public.manager_social_posts;
create policy "Managers can insert own post counts"
  on public.manager_social_posts for insert to authenticated
  with check (
    has_role(auth.uid(), 'manager'::app_role)
    and agent_id = current_agent_id()
  );

drop policy if exists "Managers can update own post counts" on public.manager_social_posts;
create policy "Managers can update own post counts"
  on public.manager_social_posts for update to authenticated
  using (
    has_role(auth.uid(), 'manager'::app_role)
    and agent_id = current_agent_id()
  )
  with check (
    has_role(auth.uid(), 'manager'::app_role)
    and agent_id = current_agent_id()
  );

drop policy if exists "Admins can manage all manager post counts" on public.manager_social_posts;
create policy "Admins can manage all manager post counts"
  on public.manager_social_posts for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create or replace view public.v_manager_roster as
with manager_ids as (
  select a.id
  from public.agents a
  join public.user_roles ur
    on ur.user_id = a.user_id
   and ur.role = 'manager'::app_role
  union
  select distinct manager_id
  from public.agents
  where manager_id is not null
)
select
  manager_ids.id as agent_id,
  coalesce(a.display_name, p.full_name, '(unnamed manager)') as manager_name,
  p.avatar_url
from manager_ids
join public.agents a on a.id = manager_ids.id
left join public.profiles p on p.id = a.profile_id
where coalesce(a.is_deactivated, false) = false
  and a.status = 'active'::agent_status;

comment on view public.v_manager_roster is
  'Active managers from explicit manager roles plus agents referenced as a manager by the hierarchy.';

create or replace view public.v_manager_social_leaderboard as
with business_day as (
  select (now() at time zone 'America/Chicago')::date as today
)
select
  r.agent_id,
  r.manager_name,
  r.avatar_url,
  coalesce(
    sum(sp.post_count) filter (where sp.post_date = b.today),
    0
  )::integer as posts_today,
  coalesce(
    sum(sp.post_count) filter (
      where sp.post_date >= date_trunc('week', b.today)::date
    ),
    0
  )::integer as posts_week,
  coalesce(
    count(distinct sp.post_date) filter (
      where sp.post_date >= date_trunc('week', b.today)::date
        and sp.post_count > 0
    ),
    0
  )::integer as active_days_week,
  rank() over (
    order by coalesce(
      sum(sp.post_count) filter (
        where sp.post_date >= date_trunc('week', b.today)::date
      ),
      0
    ) desc
  )::integer as week_rank
from public.v_manager_roster r
cross join business_day b
left join public.manager_social_posts sp on sp.agent_id = r.agent_id
group by r.agent_id, r.manager_name, r.avatar_url, b.today;

comment on view public.v_manager_social_leaderboard is
  'Internal self-reported manager social-post board. America/Chicago; Monday week start; ties share a rank.';

alter view public.v_manager_roster set (security_invoker = false);
alter view public.v_manager_social_leaderboard set (security_invoker = false);

create or replace function public.bump_manager_post(
  p_delta integer default 1,
  p_agent_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := public.current_agent_id();
  v_target uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_new integer;
begin
  if p_delta is null or p_delta not in (-1, 1) then
    raise exception 'bump_manager_post: p_delta must be 1 or -1 (got %)', p_delta;
  end if;

  v_target := coalesce(p_agent_id, v_me);

  if v_target is null then
    raise exception 'bump_manager_post: no agent record linked to this login';
  end if;

  if not (
    has_role(auth.uid(), 'manager'::app_role)
    or has_role(auth.uid(), 'admin'::app_role)
  ) then
    raise exception 'bump_manager_post: manager or admin role required';
  end if;

  if v_target is distinct from v_me
    and not has_role(auth.uid(), 'admin'::app_role)
  then
    raise exception 'bump_manager_post: only an admin may log posts for another manager';
  end if;

  insert into public.manager_social_posts as t (
    agent_id,
    post_date,
    post_count,
    updated_at
  )
  values (v_target, v_today, greatest(p_delta, 0), now())
  on conflict (agent_id, post_date) do update
    set post_count = greatest(t.post_count + p_delta, 0),
        updated_at = now()
  returning t.post_count into v_new;

  return v_new;
end;
$$;

comment on function public.bump_manager_post(integer, uuid) is
  'Adds or removes one self-reported social post for today. Managers can change only themselves; admins may target another agent.';

revoke all on public.v_manager_roster from anon;
revoke all on public.v_manager_social_leaderboard from anon;
revoke execute on function public.bump_manager_post(integer, uuid) from public, anon;

grant select on public.v_manager_roster to authenticated;
grant select on public.v_manager_social_leaderboard to authenticated;
grant execute on function public.bump_manager_post(integer, uuid) to authenticated;

commit;
