-- MP-339b: the roll call was grading Discord membership on a column nothing
-- writes.
--
-- Shipped an hour earlier, this function reported in_discord from
-- agents.has_discord_access and put "16 not in Discord" on Sam's dashboard as
-- fact. It is not a fact. Nothing in src/, supabase/functions/ or the
-- migrations ever WRITES that column — every hit is a read. Its last true value
-- was set 2026-02-05 and all 191 rows created since carry the false default.
--
-- So the panel was reporting the default value wearing the costume of a
-- measurement, and it would have said "not in Discord" about the entire roster
-- forever, including people sitting in the server right now. Worse, it was
-- about to justify re-blasting 11 people who already received the invite —
-- telling people who are already in the room to please come in.
--
-- Same operand error this codebase keeps finding: counting a column answers
-- "how many rows hold this value", not the question a human asked.
--
-- The honest operand is what IS tracked: agent_onboarding_queue records when
-- the Slack/Discord invite email was actually SENT. Measured with it, 11 of 16
-- were invited (some 5 days ago) and the real gaps are elsewhere — no contact
-- on file, a mistyped address, a missing login.

drop function if exists public.my_onboarding_roll_call(integer);

begin;

create or replace function public.my_onboarding_roll_call(p_days integer default 14)
returns table(
  agent_id uuid,
  display_name text,
  hired_on date,
  days_since_hire integer,
  license_status text,
  onboarding_stage text,
  manager_name text,
  email text,
  phone text,
  has_login boolean,
  invite_email_sent_on date,
  email_deliverable boolean,
  reachable boolean,
  blocker text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with caller as (
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) as id
    from public.agents a
    where a.user_id = auth.uid() and coalesce(a.is_deactivated, false) = false
    limit 1
  ), scope as (
    select a.id from public.agents a where public.apex_is_admin()
    union
    select h.member from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h
  ), base as (
    select
      a.id,
      a.display_name,
      a.created_at::date as hired_on,
      (current_date - a.created_at::date)::integer as days_since_hire,
      a.license_status::text as license_status,
      coalesce(a.onboarding_stage::text, 'not_started') as onboarding_stage,
      coalesce(m.display_name, 'Unassigned') as manager_name,
      nullif(btrim(coalesce(p.email, ap.email, '')), '') as email,
      nullif(btrim(coalesce(p.phone, ap.phone, '')), '') as phone,
      (a.user_id is not null) as has_login,
      -- The community invite email IS tracked. Whether they actually joined is
      -- NOT: agents.has_discord_access is written by nothing anywhere in the
      -- codebase, its last true value was set 2026-02-05, and every row created
      -- since defaults to false. Grading on it would report the whole roster as
      -- "not in Discord" forever — the default value wearing the costume of a
      -- measurement. This column answers the question we can actually answer.
      (select max(q.sent_at)::date from public.agent_onboarding_queue q
        where q.agent_id = a.id and q.email_kind = 'discord' and q.sent_at is not null)
        as invite_email_sent_on
    from public.agents a
    left join public.agents m on m.id = a.manager_id
    left join public.profiles p on p.id = a.profile_id
    left join public.applications ap on ap.id = a.source_application_id
    join scope s on s.id = a.id
    where a.status = 'active'
      and coalesce(a.is_deactivated, false) = false
      and coalesce(a.is_inactive, false) = false
      and a.created_at >= current_date - greatest(coalesce(p_days, 14), 1)
      and not public.fn_agent_is_roster_excluded(a.id)
  )
  select
    b.id, b.display_name, b.hired_on, b.days_since_hire,
    b.license_status, b.onboarding_stage, b.manager_name,
    b.email, b.phone, b.has_login, b.invite_email_sent_on,
    (b.email is not null and split_part(b.email, '@', 2) not in
       ('gmai.com','gmial.com','gmail.co','gmaill.com','yaho.com','hotmial.com','outlok.com','iclou.com')
    ) as email_deliverable,
    (b.email is not null or b.phone is not null) as reachable,
    case
      when b.email is null and b.phone is null then 'no contact on file — only their manager can reach them'
      when b.email is not null and split_part(b.email, '@', 2) in
        ('gmai.com','gmial.com','gmail.co','gmaill.com','yaho.com','hotmial.com','outlok.com','iclou.com')
        then 'email address looks mistyped — mail to it is bouncing'
      when not b.has_login then 'no login yet — account was never provisioned'
      when b.invite_email_sent_on is null then 'never sent the Slack/Discord invite'
      else 'invite sent ' || to_char(b.invite_email_sent_on, 'Mon DD')
    end as blocker
  from base b
  order by (b.email is null and b.phone is null) desc, b.hired_on desc, b.display_name;
$function$;

comment on function public.my_onboarding_roll_call(integer) is
  'MP-339: Monday roll call, scoped to the caller. Reports whether the '
  'Slack/Discord INVITE was sent, never whether they joined: '
  'agents.has_discord_access is written by nothing in the codebase (last true '
  '2026-02-05), so grading on it reports the default value as a measurement.';

commit;
