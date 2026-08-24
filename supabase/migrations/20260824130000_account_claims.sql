-- wave-claim-link — one public link the whole team can use to create their
-- login and have it attached to the record that already exists for them.
--
-- Sam has 183 agent records and 20 of them have no login at all (11 active).
-- Today the only self-serve path is /agent-signup, which requires a manager's
-- ?ref= code and CREATES A NEW record — the opposite of what's needed. Everyone
-- who already exists has to be wired up by hand, one at a time.
--
-- This table is the audit trail for the new /claim flow. Every attempt lands
-- here, matched or not, because the unmatched ones are the actual work queue:
-- 9 of those 11 active agents have no email and no phone anywhere in the
-- database (no profile row, no source application), so no matcher can find
-- them from typed input. Those people WILL land in here as 'unmatched', and
-- that is the point — Sam gets a list to resolve instead of silence.
--
-- Security posture, since this endpoint is public and writes auth users:
--   * a record is only ever claimable while agents.user_id IS NULL. A linked
--     account cannot be re-claimed, so this is not a takeover path.
--   * a name alone never matches. Name must be corroborated by phone or agent
--     code, because display_name is public on the leaderboard.
--   * manager/admin records are refused outright and flagged for Sam. Note
--     that "Samuel James" (SJAMES02) is one of the 11 unlinked active rows —
--     an unguarded matcher would happily hand Sam's own agent row to whoever
--     typed the name off the leaderboard.
--   * every attempt is logged with IP + user agent whether it succeeds or not.

begin;

create table if not exists public.account_claims (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),

  -- what they typed
  typed_name     text,
  typed_email    text,
  typed_phone    text,
  typed_code     text,

  -- what we did about it
  outcome        text not null check (outcome in (
                   'linked',              -- account created + attached
                   'unmatched',           -- nothing found: Sam must resolve
                   'ambiguous',           -- >1 candidate: refused on purpose
                   'already_linked',      -- record already has a login
                   'email_in_use',        -- auth user already exists
                   'refused_privileged',  -- manager/admin record: needs Sam
                   'error'
                 )),
  matched_agent_id       uuid references public.agents(id) on delete set null,
  matched_application_id uuid references public.applications(id) on delete set null,
  created_user_id        uuid,
  match_basis    text,   -- 'agent_code' | 'phone' | 'email' | 'name+phone' ...
  detail         text,

  -- provenance
  ip             text,
  user_agent     text
);

create index if not exists account_claims_created_idx on public.account_claims (created_at desc);
create index if not exists account_claims_outcome_idx on public.account_claims (outcome, created_at desc);

alter table public.account_claims enable row level security;

-- Only staff can read the claim log; the edge function writes via service_role,
-- which bypasses RLS. No policy grants INSERT to anon/authenticated on purpose:
-- the public path must go through the function, never straight at the table.
drop policy if exists account_claims_staff_read on public.account_claims;
create policy account_claims_staff_read
  on public.account_claims for select
  to authenticated
  using (public.is_agency_staff());

comment on table public.account_claims is
  'Audit trail for the public /claim self-service account link. Rows with '
  'outcome=''unmatched'' are a work queue: someone on the team tried to claim '
  'an account and no existing record could be matched from what they typed.';

-- ─── Claimability, decided in the database ───────────────────────────────────
-- The edge function asks this rather than reimplementing the rules, so the
-- refusal reasons cannot drift between the two.
create or replace function public.agent_claim_state(p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a.id is null                       then 'not_found'
    when a.user_id is not null              then 'already_linked'
    when coalesce(a.is_manager, false)      then 'refused_privileged'
    when a.status is distinct from 'active' then 'refused_inactive'
    else 'claimable'
  end
  from public.agents a
  where a.id = p_agent_id;
$$;

revoke all on function public.agent_claim_state(uuid) from public, anon;
grant execute on function public.agent_claim_state(uuid) to service_role;

commit;
