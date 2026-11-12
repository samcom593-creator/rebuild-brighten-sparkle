-- Licensed agents to call (2026-11-12). Sam: "I need a tab that shows me licensed agents. I can just call
-- licensed agents and be able to bring them on the team."
--
-- The Licensed Inbox read public.applications directly (license_status = 'licensed', status not
-- contracting/rejected). Measured live before this change, it showed 118 rows:
--   45 belonged to a person who already has an agent profile under the same email (already on the team),
--   16 were duplicate records (is_duplicate), 1 was a closed (terminated) record,
--   34 were Calendly booking records (record_type 'interview_booking'), some for people who also applied.
-- So a list meant to say "call these licensed people and bring them on" mixed in the team itself.
--
-- licensed_prospects() returns ONE ROW PER PERSON (email, else last 10 phone digits, else the row):
--   - licensed, not a duplicate, not closed, an application or a licensed Calendly booking;
--   - nobody with any agents row (by source application, or by their profile's email or phone), so the
--     current team, departed agents and banned agents (KJ's team) never appear;
--   - nobody whose record is already in contracting, rejected or disqualified;
--   - nobody whose login is banned.
-- The row it returns is the person's newest application (an application beats a booking record), with
-- the newest activity date (applied, or the booked call's time for a booking record, whose created_at is
-- the 2026-08-01 import), the latest contact across all their records, and how many records they have.
-- created_at in the result IS that activity date; came_from says which ('applied' / 'booked a call').
-- Staff only (admin, VA manager, VA), the same audience as the Licensed Inbox route; anyone else gets an
-- error, never a silent empty list.

-- The returned record status is named record_status, not status: scripts/check-rpc-status-literals.mjs grades every
-- `.status === "..."` in a file against any called RPC's `status` column, and the Licensed page also compares the
-- contact-action result's status ("provider_accepted", "fallback_required"). Drop first: a renamed output column
-- changes the row type, which CREATE OR REPLACE refuses.
drop function if exists public.licensed_prospects();

create or replace function public.licensed_prospects()
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  state text,
  city text,
  license_status text,
  nipr_verified boolean,
  npn text,
  record_status text,
  created_at timestamptz,
  last_contacted_at timestamptz,
  came_from text,
  records integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not (public.apex_is_admin()
             or public.has_role(auth.uid(), 'va_manager')
             or public.has_role(auth.uid(), 'va')) then
    raise exception 'licensed_prospects: staff only' using errcode = '42501';
  end if;

  return query
  with lic as (
    select a.*,
           nullif(lower(btrim(a.email)), '') as em,
           nullif(right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10), '') as ph,
           -- A booking record's created_at is the 2026-08-01 import, not when the person booked: use the
           -- linked call's time (33 of 34 link by application_id), else fall back to created_at.
           case when a.record_type = 'interview_booking'
                then coalesce((select max(ie.scheduled_at) from public.interview_events ie where ie.application_id = a.id),
                              a.created_at)
                else a.created_at end as activity_at
      from public.applications a
     where a.license_status = 'licensed'
       and coalesce(a.is_duplicate, false) = false
       and a.terminated_at is null
       and a.record_type in ('application', 'interview_booking')
  ),
  keyed as (
    select l.*,
           coalesce(l.em, case when length(l.ph) = 10 then 'phone:' || l.ph end, 'id:' || l.id::text) as person_key
      from lic l
  ),
  people as (
    select k.person_key,
           array_agg(k.id) as ids,
           max(k.em) as em,
           max(k.ph) filter (where length(k.ph) = 10) as ph,
           max(k.activity_at) as newest_at,
           max(k.last_contacted_at) as last_contact,
           bool_or(coalesce(k.nipr_verified, false)) as verified,
           bool_or(k.status::text in ('contracting', 'rejected', 'disqualified')) as closed_out,
           bool_or(k.record_type = 'application') as applied,
           count(*)::int as n
      from keyed k
     group by k.person_key
  ),
  open_people as (
    select p.*
      from people p
     where not p.closed_out
       -- already an agent: hired from one of these records ...
       and not exists (select 1 from public.agents g where g.source_application_id = any(p.ids))
       -- ... or an agent whose profile carries the same email or phone
       and not exists (
         select 1
           from public.agents g
           join public.profiles pr on pr.id = g.profile_id or (g.profile_id is null and pr.user_id = g.user_id)
          where (p.em is not null and lower(btrim(pr.email)) = p.em)
             or (p.ph is not null and right(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), 10) = p.ph))
       -- a banned login
       and not exists (
         select 1
           from public.profiles pr
           join auth.users u on u.id = pr.user_id
          where p.em is not null and lower(btrim(pr.email)) = p.em
            and u.banned_until is not null and u.banned_until > now())
  )
  select pick.id,
         pick.first_name::text,
         pick.last_name::text,
         pick.email::text,
         coalesce(nullif(btrim(pick.phone), ''), (select k2.phone from keyed k2
                                                   where k2.person_key = o.person_key and nullif(btrim(k2.phone), '') is not null
                                                   order by k2.created_at desc limit 1))::text,
         pick.state::text,
         pick.city::text,
         pick.license_status::text,
         o.verified,
         coalesce(pick.nipr_number, (select k2.nipr_number from keyed k2
                                      where k2.person_key = o.person_key and k2.nipr_number is not null
                                      order by k2.created_at desc limit 1))::text,
         pick.status::text,
         o.newest_at,
         o.last_contact,
         case when o.applied then 'applied' else 'booked a call' end,
         o.n
    from open_people o
    cross join lateral (
      select k.*
        from keyed k
       where k.person_key = o.person_key
       order by (k.record_type = 'application') desc, k.created_at desc
       limit 1
    ) pick
   order by o.newest_at desc;
end;
$$;

revoke all on function public.licensed_prospects() from public;
revoke all on function public.licensed_prospects() from anon;
grant execute on function public.licensed_prospects() to authenticated;
grant execute on function public.licensed_prospects() to service_role;

comment on function public.licensed_prospects() is
  'Licensed people to call and bring onto the team: one row per person, never someone with an agents row, a closed-out record or a banned login. Staff only (admin, VA manager, VA). Read by /dashboard/recruiting/licensed.';
