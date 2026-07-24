-- MP-264 part 2 — invitee identity, Instagram matching, VA access
-- 2026-07-24
--
-- WHY: pulling the real Calendly invitee records exposed why email matching
-- could never have worked. On the high-volume "Leader Call" form the VAs enter
-- the literal placeholder `name@noname.com` for every single booking. The real
-- identity key is the Instagram handle, which every booking collects and which
-- applications.instagram_handle already stores.
--
-- Two form versions are live:
--   "Leader Call "  -> question "instagram",        email = name@noname.com
--   "Licensed Call" -> question "Instagram Handle" (@-prefixed) + "Status"
--                      ("Just Licensed" / "Licensed Leader with a team"),
--                      real email, sometimes text_reminder_number
--
-- Also: Sam's VAs (Milver et al, roles va + va_manager) could not see any of
-- this. Granting them read access to the interview log and applicant names.

-- ---------------------------------------------------------------------------
-- 1. Columns for the identity + action data Calendly actually gives us
-- ---------------------------------------------------------------------------
alter table public.interview_events
  add column if not exists instagram_handle text,
  add column if not exists invitee_status    text,   -- "Just Licensed" etc
  add column if not exists prep_notes        text,   -- free-text prep answer
  add column if not exists reschedule_url    text,   -- one-click reschedule
  add column if not exists cancel_url        text,
  add column if not exists was_rescheduled   boolean not null default false;

create index if not exists interview_events_ig_idx
  on public.interview_events (lower(instagram_handle));

comment on column public.interview_events.instagram_handle is
  'MP-264: the real identity key for Calendly bookings. Email is a placeholder '
  '(name@noname.com) on the high-volume VA booking form.';

-- ---------------------------------------------------------------------------
-- 2. Resolver v2 — Instagram first, then phone, then real email.
--    Placeholder emails are explicitly rejected so they can never match.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_application_for_invitee(
  p_email text,
  p_phone text,
  p_instagram text default null
) returns table (application_id uuid, match_method text)
language plpgsql stable
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_digits text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
  v_ig     text := lower(trim(both from regexp_replace(coalesce(p_instagram,''), '^@+|\s+', '', 'g')));
  v_email  text := lower(trim(coalesce(p_email,'')));
begin
  -- Placeholder emails the VA booking form injects. Never match on these.
  if v_email in ('name@noname.com','noname@noname.com','test@test.com','') then
    v_email := null;
  end if;

  -- 1. Instagram handle — the only identifier reliably present on every booking
  if v_ig <> '' then
    select a.id into v_id from public.applications a
     where lower(regexp_replace(coalesce(a.instagram_handle,''), '^@+', '', 'g')) = v_ig
     order by a.created_at desc limit 1;
    if v_id is not null then
      return query select v_id, 'instagram'::text;
      return;
    end if;
  end if;

  -- 2. last-10-digit phone
  if length(v_digits) = 10 then
    select a.id into v_id from public.applications a
     where right(regexp_replace(coalesce(a.phone,''), '\D', '', 'g'), 10) = v_digits
     order by a.created_at desc limit 1;
    if v_id is not null then
      return query select v_id, 'phone'::text;
      return;
    end if;
  end if;

  -- 3. real email
  if v_email is not null then
    select a.id into v_id from public.applications a
     where lower(a.email) = v_email
     order by a.created_at desc limit 1;
    if v_id is not null then
      return query select v_id, 'email'::text;
      return;
    end if;
  end if;

  -- 4. no match — the row is still stored and surfaces in the Unmatched tab
  return query select null::uuid, 'none'::text;
end $$;

-- widen the check constraint to allow the new match method
alter table public.interview_events drop constraint if exists interview_events_match_method_check;
alter table public.interview_events add constraint interview_events_match_method_check
  check (match_method in ('instagram','email','phone','manual','none'));

grant execute on function public.resolve_application_for_invitee(text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. VA access — Sam directive 2026-07-24: "allow all, also VAs like Milver
--    can't see any unlicensed name". VAs book these calls; they must be able
--    to read the interview log and the applicant names behind it.
-- ---------------------------------------------------------------------------
drop policy if exists interview_events_admin_all on public.interview_events;
create policy interview_events_staff_write on public.interview_events
  for all to authenticated
  using (
    exists (select 1 from public.user_roles ur
             where ur.user_id = auth.uid()
               and ur.role::text in ('admin','manager','va_manager','va'))
  )
  with check (
    exists (select 1 from public.user_roles ur
             where ur.user_id = auth.uid()
               and ur.role::text in ('admin','manager','va_manager','va'))
  );

-- Applications: VAs could not see unlicensed applicant names. Add an explicit
-- read policy for the VA roles rather than widening an existing admin policy.
drop policy if exists applications_va_read on public.applications;
create policy applications_va_read on public.applications
  for select to authenticated
  using (
    exists (select 1 from public.user_roles ur
             where ur.user_id = auth.uid()
               and ur.role::text in ('va','va_manager'))
  );

-- ---------------------------------------------------------------------------
-- 4. Capture-health view v2 — now reports match-method breakdown so a
--    regression in identity matching is visible, not just a capture outage.
-- ---------------------------------------------------------------------------
-- dropped rather than replaced: column set changes, and Postgres refuses to
-- rename view columns in place.
drop view if exists public.v_interview_capture_health;
create view public.v_interview_capture_health as
select
  count(*)                                                                                   as total_rows,
  count(*) filter (where created_at > now() - interval '7 days')                              as stored_7d,
  count(*) filter (where match_method = 'instagram')                                          as matched_instagram,
  count(*) filter (where match_method = 'phone')                                              as matched_phone,
  count(*) filter (where match_method = 'email')                                              as matched_email,
  count(*) filter (where match_method = 'none')                                               as unmatched,
  count(*) filter (where invitee_name is null)                                                as missing_name,
  count(*) filter (where outcome is null and canceled_at is null and scheduled_at < now())    as undispositioned_backlog,
  count(*) filter (where scheduled_at > now() and canceled_at is null)                        as upcoming,
  max(scheduled_at)                                                                           as latest_scheduled_at,
  max(created_at)                                                                             as last_capture_at
from public.interview_events;
