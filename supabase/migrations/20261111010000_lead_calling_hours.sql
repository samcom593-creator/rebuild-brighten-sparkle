-- MP-LEAD-CALLING-HOURS (2026-11-10). Sam: "every day at 7 PM, hide everyone's leads in the portal
-- since they can't be worked at that moment."
--
-- 7 PM is applied in the LEAD's time zone, not the agent's: 7 PM in Phoenix is 9 PM in Florida, so
-- an agent-clock cutoff would leave East Coast leads dialable past the legal 9 PM line. A lead is
-- callable from 08:00 to 19:00 local. Local = the lead's state, else its area code's state
-- (us_area_codes), else unknown. States that span two zones close by their EASTERN zone and open
-- by their WESTERN zone, so no part of the state is ever dialed outside the window. Unknown
-- location gets the strictest window: 8 AM Pacific to 7 PM Eastern.
--
-- my_lead_bundles() gains callable_now + callable_at (the next opening). The server says which
-- leads are workable; My Leads hides the closed ones from "To call" and work mode and removes
-- their Call button, but keeps them under "All" so an outcome from a 6:58 PM call can still be
-- logged. Measured at build time: 347 live pack leads, 81 with a state on file — the area code
-- covers the rest.

create table if not exists public.us_state_timezones (
  state text primary key,
  tz_east text not null,
  tz_west text not null
);
insert into public.us_state_timezones (state, tz_east, tz_west) values
  ('AK', 'America/Anchorage', 'America/Adak'),
  ('AL', 'America/Chicago', 'America/Chicago'),
  ('AR', 'America/Chicago', 'America/Chicago'),
  ('AZ', 'America/Phoenix', 'America/Phoenix'),
  ('CA', 'America/Los_Angeles', 'America/Los_Angeles'),
  ('CO', 'America/Denver', 'America/Denver'),
  ('CT', 'America/New_York', 'America/New_York'),
  ('DC', 'America/New_York', 'America/New_York'),
  ('DE', 'America/New_York', 'America/New_York'),
  ('FL', 'America/New_York', 'America/Chicago'),
  ('GA', 'America/New_York', 'America/New_York'),
  ('GU', 'Pacific/Guam', 'Pacific/Guam'),
  ('HI', 'Pacific/Honolulu', 'Pacific/Honolulu'),
  ('IA', 'America/Chicago', 'America/Chicago'),
  ('ID', 'America/Boise', 'America/Los_Angeles'),
  ('IL', 'America/Chicago', 'America/Chicago'),
  ('IN', 'America/Indiana/Indianapolis', 'America/Chicago'),
  ('KS', 'America/Chicago', 'America/Denver'),
  ('KY', 'America/New_York', 'America/Chicago'),
  ('LA', 'America/Chicago', 'America/Chicago'),
  ('MA', 'America/New_York', 'America/New_York'),
  ('MD', 'America/New_York', 'America/New_York'),
  ('ME', 'America/New_York', 'America/New_York'),
  ('MI', 'America/Detroit', 'America/Menominee'),
  ('MN', 'America/Chicago', 'America/Chicago'),
  ('MO', 'America/Chicago', 'America/Chicago'),
  ('MS', 'America/Chicago', 'America/Chicago'),
  ('MT', 'America/Denver', 'America/Denver'),
  ('NC', 'America/New_York', 'America/New_York'),
  ('ND', 'America/Chicago', 'America/Denver'),
  ('NE', 'America/Chicago', 'America/Denver'),
  ('NH', 'America/New_York', 'America/New_York'),
  ('NJ', 'America/New_York', 'America/New_York'),
  ('NM', 'America/Denver', 'America/Denver'),
  ('NV', 'America/Los_Angeles', 'America/Los_Angeles'),
  ('NY', 'America/New_York', 'America/New_York'),
  ('OH', 'America/New_York', 'America/New_York'),
  ('OK', 'America/Chicago', 'America/Chicago'),
  ('OR', 'America/Boise', 'America/Los_Angeles'),
  ('PA', 'America/New_York', 'America/New_York'),
  ('PR', 'America/Puerto_Rico', 'America/Puerto_Rico'),
  ('RI', 'America/New_York', 'America/New_York'),
  ('SC', 'America/New_York', 'America/New_York'),
  ('SD', 'America/Chicago', 'America/Denver'),
  ('TN', 'America/New_York', 'America/Chicago'),
  ('TX', 'America/Chicago', 'America/Denver'),
  ('UT', 'America/Denver', 'America/Denver'),
  ('VA', 'America/New_York', 'America/New_York'),
  ('VI', 'America/St_Thomas', 'America/St_Thomas'),
  ('VT', 'America/New_York', 'America/New_York'),
  ('WA', 'America/Los_Angeles', 'America/Los_Angeles'),
  ('WI', 'America/Chicago', 'America/Chicago'),
  ('WV', 'America/New_York', 'America/New_York'),
  ('WY', 'America/Denver', 'America/Denver')
on conflict (state) do update set tz_east = excluded.tz_east, tz_west = excluded.tz_west;
alter table public.us_state_timezones enable row level security;
revoke all on public.us_state_timezones from public, anon, authenticated;
grant select on public.us_state_timezones to service_role;

create or replace function public.lead_calling_window(p_state text, p_phone10 text, p_at timestamptz default now())
returns table(callable boolean, opens_at timestamptz, tz_east text, tz_west text, located_by text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with loc as (
    select coalesce(
             (select z.state from public.us_state_timezones z where z.state = upper(nullif(btrim(p_state), ''))),
             (select z.state from public.us_area_codes a join public.us_state_timezones z on z.state = upper(a.state)
               where a.area_code = left(regexp_replace(coalesce(p_phone10, ''), '[^0-9]', '', 'g'), 3) limit 1)
           ) as st,
           case when exists (select 1 from public.us_state_timezones z where z.state = upper(nullif(btrim(p_state), ''))) then 'state'
                when exists (select 1 from public.us_area_codes a where a.area_code = left(regexp_replace(coalesce(p_phone10, ''), '[^0-9]', '', 'g'), 3)) then 'area_code'
                else 'unknown' end as how
  ),
  z as (
    select coalesce(t.tz_east, 'America/New_York') as e, coalesce(t.tz_west, 'America/Los_Angeles') as w, loc.how
    from loc left join public.us_state_timezones t on t.state = loc.st
  ),
  t as (
    select z.*, (p_at at time zone z.e) as le, (p_at at time zone z.w) as lw from z
  )
  select (t.le::time < time '19:00' and t.lw::time >= time '08:00') as callable,
         case when (t.le::time < time '19:00' and t.lw::time >= time '08:00') then null
              when t.lw::time < time '08:00' then (t.lw::date + time '08:00') at time zone t.w
              else ((t.lw::date + 1) + time '08:00') at time zone t.w end as opens_at,
         t.e, t.w, t.how
  from t
$function$;
revoke all on function public.lead_calling_window(text, text, timestamptz) from public, anon;
grant execute on function public.lead_calling_window(text, text, timestamptz) to authenticated, service_role;

-- Return type changes (two new columns), so drop + recreate; same body, same order, same DNC rule.
drop function if exists public.my_lead_bundles();
create function public.my_lead_bundles()
returns table(item_id uuid, bundle_id uuid, bundle_name text, bundle_note text, format text, phone10 text,
              first_name text, last_name text, email text, state text, age integer, quality_tier text,
              quality_reason text, attrs jsonb, attempts integer, last_dialed_at timestamptz,
              last_disposition text, status text, status_note text, status_at timestamptz,
              granted_at timestamptz, callable_now boolean, callable_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.id, b.id, b.name, b.note, b.format, i.phone10, i.first_name, i.last_name, i.email,
         i.state, i.age, i.quality_tier, i.quality_reason, coalesce(i.attrs, '{}'::jsonb), i.attempts,
         i.last_dialed_at, i.last_disposition, i.status, i.status_note, i.status_at, g.granted_at,
         w.callable, w.opens_at
  from public.lead_bundle_grants g
  join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
  join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
  cross join lateral public.lead_calling_window(i.state, i.phone10) w
  where g.user_id = auth.uid() and g.revoked_at is null
    and not exists (select 1 from public.readymode_dialer_calls c where c.lead_phone10 = i.phone10 and c.disposition = 'Do Not Call')
  order by b.created_at desc, array_position(array['pos', 'A', 'B', 'C', 'D'], i.quality_tier), i.last_dialed_at desc nulls last
$function$;
revoke all on function public.my_lead_bundles() from public, anon;
grant execute on function public.my_lead_bundles() to authenticated, service_role;
