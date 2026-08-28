-- The headhunter backlog contains recruit email addresses, phone numbers, and
-- Instagram handles. It is intentionally owner-run so staff can reconcile a
-- table with no client RLS policies, but it therefore needs an explicit staff
-- predicate. Without this guard any authenticated user could read the backlog.

create or replace view public.v_hh_hires_not_in_apex as
select h.id as hh_id, h.name, h.email, h.phone, h.instagram, h.appointment_at, h.updated_at
from public.hh_applicants h
where (public.is_agency_staff() or auth.uid() is null)
  and h.stage = 'hired'
  and coalesce(h.archived, false) = false
  and nullif(btrim(coalesce(h.email, '')), '') is not null
  and not exists (
    select 1
    from public.agents a
    join public.profiles p on p.user_id = a.user_id
    where lower(p.email) = lower(h.email)
  )
  and not exists (
    select 1
    from public.agents a
    join public.applications ap on ap.id = a.source_application_id
    where lower(ap.email) = lower(h.email)
  );

revoke all on public.v_hh_hires_not_in_apex from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on public.v_hh_hires_not_in_apex from authenticated;
grant select on public.v_hh_hires_not_in_apex to authenticated, service_role;

comment on view public.v_hh_hires_not_in_apex is
  'Staff-only reconciliation backlog. Contains recruit contact data and returns zero rows to non-staff callers.';
