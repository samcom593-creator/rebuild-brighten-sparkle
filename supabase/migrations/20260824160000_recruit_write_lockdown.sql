-- wave-recruit-writes — "anyone can call anyone's recruits", the write half.
--
-- Part 1 closed the READ path (v_unlicensed_all handed every logged-in agent
-- 1,037 recruits with names, emails and phone numbers; it now returns 0 to a
-- non-staff caller). This closes the WRITE path, which was worse, because it
-- was reachable without logging in at all.
--
-- MEASURED against prod:
--
--   log_contact_attempt(p_application_id, p_channel, p_outcome, p_notes)
--     SECURITY DEFINER, EXECUTE granted to anon AND authenticated, and its body
--     performs ZERO ownership checks — it INSERTs into application_contact_log
--     for whatever application id it is handed, stamping auth.uid() as
--     logged_by (null for anon). Any agent could log calls against another
--     agent's recruits; anyone on the internet holding the public anon key
--     could log calls against all of them.
--
--   unified_mark_phone_bad(p_id, p_source, p_reason)
--     SECURITY DEFINER, EXECUTE granted to anon, no caller check of any kind,
--     and it WRITES: sets phone_bad_at on any applications or aged_leads row by
--     id. An anonymous caller could mark every recruit in the agency
--     un-callable. This one is destructive, not just nosy.
--
-- Both keep SECURITY DEFINER — they legitimately need to write tables the
-- caller cannot write directly — but they now establish who is calling before
-- they do it, and anon loses EXECUTE on both. Neither is called from a public,
-- logged-out surface: both are invoked from CallCenter.tsx, which sits behind
-- ProtectedRoute.

begin;

-- ─── Who may touch this recruit? ─────────────────────────────────────────────
-- Mirrors the SELECT policy on applications rather than inventing a second
-- rulebook: attribution on any of the three columns, or manager downline, or
-- staff. Kept as its own function so the two RPCs cannot drift apart.
create or replace function public.can_work_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_agency_staff()
    or exists (
      select 1
      from public.applications ap
      where ap.id = p_application_id
        and (
          ap.assigned_agent_id   in (select a.id from public.agents a where a.user_id = auth.uid())
          or ap.referral_manager_id in (select a.id from public.agents a where a.user_id = auth.uid())
          or ap.recruiter_id     in (select a.id from public.agents a where a.user_id = auth.uid())
        )
    );
$$;

revoke all on function public.can_work_application(uuid) from public, anon;
grant execute on function public.can_work_application(uuid) to authenticated, service_role;

-- ─── log_contact_attempt ─────────────────────────────────────────────────────
create or replace function public.log_contact_attempt(
  p_application_id uuid,
  p_channel        text,
  p_outcome        text,
  p_notes          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated: sign in before logging contact'
      using errcode = '42501';
  end if;

  if not public.can_work_application(p_application_id) then
    raise exception 'not_authorized: that recruit is not assigned to you'
      using errcode = '42501';
  end if;

  insert into public.application_contact_log (application_id, channel, outcome, notes, logged_by)
  values (p_application_id, p_channel, p_outcome, p_notes, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.log_contact_attempt(uuid, text, text, text) from anon, public;
grant execute on function public.log_contact_attempt(uuid, text, text, text) to authenticated, service_role;

-- ─── unified_mark_phone_bad ──────────────────────────────────────────────────
-- aged_leads are worked by VAs and managers, and their RLS grants no per-agent
-- ownership at all, so the aged_lead branch is staff-only. The application
-- branch uses the same ownership test as the contact log.
create or replace function public.unified_mark_phone_bad(
  p_id     uuid,
  p_source text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated: sign in first'
      using errcode = '42501';
  end if;

  if p_source = 'aged_lead' then
    if not public.is_agency_staff() then
      raise exception 'not_authorized: aged leads are worked by managers and VAs'
        using errcode = '42501';
    end if;
    update public.aged_leads
       set phone_bad_at = coalesce(phone_bad_at, now())
     where id = p_id;
  else
    if not public.can_work_application(p_id) then
      raise exception 'not_authorized: that recruit is not assigned to you'
        using errcode = '42501';
    end if;
    update public.applications
       set phone_bad_at     = coalesce(phone_bad_at, now()),
           phone_bad_reason = coalesce(p_reason, phone_bad_reason)
     where id = p_id;
  end if;
end;
$$;

revoke execute on function public.unified_mark_phone_bad(uuid, text, text) from anon, public;
grant execute on function public.unified_mark_phone_bad(uuid, text, text) to authenticated, service_role;

commit;
