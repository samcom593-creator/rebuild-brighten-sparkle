-- APEX OS redesign · Ethos contracting gate (2026-10-06)
--
-- Why: the only paste path into the carrier's "Agent Portal Signup" sheet (v_ethos_paste_rows /
-- v_ethos_agent_updates, copied from /dashboard/contracting/audit) emitted rows built from DEFAULTS:
-- every upline = the principal NPN, comp level inferred from the internal percentage (60% -> Level 12),
-- '6 Month Advance' for everyone, Life Licensed TRUE from self-report, a bare invite URL and a
-- carrier-owned Comments cell. Pasting them would have submitted unapproved compensation and hierarchy
-- to Ethos. The automated writer (contracting-delivery.ts) carried the same defaults and only stayed
-- harmless because no Google credential was ever installed.
--
-- This migration (additive; no table dropped, no row deleted):
--   1. contracting_ethos_approvals (+ log): evidence and leadership approvals per producer. Requested
--      or internal comp never lives here and never feeds column G.
--   2. ethos_sheet_snapshots / ethos_sheet_rows: read-only mirror of the live sheet, written by the
--      ethos-sheet-sync edge function through the shared validator (supabase/functions/_shared/ethos-contract.ts).
--   3. v_ethos_roster_current: latest complete snapshot, falling back to the 2026-09-24 ethos_roster
--      copy until the first sync; v_contracting_audit now reads it instead of the stale table.
--   4. v_ethos_paste_rows / v_ethos_agent_updates rebuilt to emit APPROVED values only (A:L and A:H).
--   5. contracting_save_ethos_review(): the one write path. VAs/admins record evidence; only admins approve.
--   6. ethos_sheet_writes_enabled = 'false': the production write flag, OFF.

begin;

create table if not exists public.contracting_ethos_approvals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid unique references public.agents(id) on delete set null,
  intake_id uuid unique references public.contracting_intakes(id) on delete set null,
  legal_first_name text,
  legal_last_name text,
  npn_verified_at timestamptz,
  npn_verified_source text,
  npn_verified_by uuid,
  license_verified_at timestamptz,
  license_evidence_ref text,
  license_verified_by uuid,
  eo_verified_at timestamptz,
  eo_expires_at date,
  eo_evidence_ref text,
  eo_verified_by uuid,
  contact_confirmed_at timestamptz,
  contact_confirmed_by uuid,
  owner_name text,
  approved_comp_level text check (approved_comp_level is null or approved_comp_level ~ '^Level [0-9]{2}( \(LOA\))?$'),
  approved_advance_tier text check (approved_advance_tier is null or approved_advance_tier in ('As Earned', '6 Month Advance', '9 Month Advance')),
  approved_upline_npn text check (approved_upline_npn is null or approved_upline_npn ~ '^[0-9]*[1-9][0-9]*$'),
  approved_sub_agency text,
  approved_sub_agent_head boolean,
  comp_grid_version text,
  approved_by uuid,
  approved_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint contracting_ethos_approvals_identity check (agent_id is not null or intake_id is not null)
);

create table if not exists public.contracting_ethos_approval_log (
  id bigserial primary key,
  approval_id uuid not null,
  actor uuid,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create table if not exists public.ethos_sheet_snapshots (
  id uuid primary key default gen_random_uuid(),
  fetched_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed')),
  source text not null default 'public_csv_export',
  header_ok boolean,
  allocated_rows integer,
  populated_rows integer,
  counts jsonb,
  updates_counts jsonb,
  duplicates jsonb,
  update_rows jsonb,
  error text,
  triggered_by uuid
);
create index if not exists ethos_sheet_snapshots_complete_idx on public.ethos_sheet_snapshots (fetched_at desc) where status = 'complete';

create table if not exists public.ethos_sheet_rows (
  snapshot_id uuid not null references public.ethos_sheet_snapshots(id) on delete cascade,
  row_number integer not null,
  first_name text,
  last_name text,
  npn text,
  upline_npn text,
  mobile text,
  email text,
  comp_level text,
  advance_tier text,
  sub_agency text,
  sub_agent_head text,
  life_licensed text,
  eo text,
  portal_created text,
  portal_date_raw text,
  partner_id text,
  partner_code text,
  invite_unique boolean,
  blockers text[] not null default '{}',
  review text[] not null default '{}',
  primary key (snapshot_id, row_number)
);
create index if not exists ethos_sheet_rows_npn_idx on public.ethos_sheet_rows (npn);

alter table public.contracting_ethos_approvals enable row level security;
alter table public.contracting_ethos_approval_log enable row level security;
alter table public.ethos_sheet_snapshots enable row level security;
alter table public.ethos_sheet_rows enable row level security;

-- Reads: admins and contracting staff (VAs collect evidence). No write policies: writes go through
-- contracting_save_ethos_review() and the service-role sync only.
drop policy if exists contracting_ethos_approvals_staff_read on public.contracting_ethos_approvals;
create policy contracting_ethos_approvals_staff_read on public.contracting_ethos_approvals for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va'));
drop policy if exists contracting_ethos_approval_log_staff_read on public.contracting_ethos_approval_log;
create policy contracting_ethos_approval_log_staff_read on public.contracting_ethos_approval_log for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va'));
drop policy if exists ethos_sheet_snapshots_staff_read on public.ethos_sheet_snapshots;
create policy ethos_sheet_snapshots_staff_read on public.ethos_sheet_snapshots for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va'));
drop policy if exists ethos_sheet_rows_staff_read on public.ethos_sheet_rows;
create policy ethos_sheet_rows_staff_read on public.ethos_sheet_rows for select
  using (public.apex_is_admin() or public.has_role(auth.uid(), 'manager') or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va'));

-- Same columns and types as public.ethos_roster, so v_contracting_audit can read it unchanged.
create or replace view public.v_ethos_roster_current
with (security_invoker = true) as
with latest as (
  select s.id, s.fetched_at
  from public.ethos_sheet_snapshots s
  where s.status = 'complete'
  order by s.fetched_at desc
  limit 1
)
select r.row_number::bigint as id,
       r.first_name, r.last_name, r.npn, r.upline_npn,
       r.mobile as phone, r.email, r.comp_level,
       r.advance_tier as advance, r.sub_agency as subagency,
       nullif(btrim(r.portal_date_raw), '') as portal,
       nullif(btrim(r.partner_id), '') as partner_id,
       nullif(btrim(r.partner_code), '') as partner_code,
       null::text as comment,
       'sheet_csv'::text as source,
       l.fetched_at as synced_at
from latest l
join public.ethos_sheet_rows r on r.snapshot_id = l.id
union all
select e.id, e.first_name, e.last_name, e.npn, e.upline_npn, e.phone, e.email, e.comp_level,
       e.advance, e.subagency, e.portal, e.partner_id, e.partner_code, e.comment, e.source, e.synced_at
from public.ethos_roster e
where not exists (select 1 from public.ethos_sheet_snapshots s where s.status = 'complete');

grant select on public.v_ethos_roster_current to authenticated;

-- Repoint the audit's Ethos leg at the live mirror. Exactly one reference is expected; anything else
-- means the view drifted and a human should look rather than this block guessing.
do $$
declare
  d text;
  n integer;
begin
  d := pg_get_viewdef('public.v_contracting_audit'::regclass, true);
  n := (length(d) - length(replace(d, 'FROM ethos_roster e_1', ''))) / length('FROM ethos_roster e_1');
  if n <> 1 then
    raise exception 'v_contracting_audit: expected exactly one "FROM ethos_roster e_1", found %', n;
  end if;
  d := replace(d, 'FROM ethos_roster e_1', 'FROM public.v_ethos_roster_current e_1');
  d := regexp_replace(d, ';\s*$', '');
  execute 'create or replace view public.v_contracting_audit with (security_invoker = true) as ' || d;
end;
$$;

drop view if exists public.v_ethos_paste_rows;
create view public.v_ethos_paste_rows
with (security_invoker = true) as
select a.agent_id,
       a.display_name,
       coalesce(nullif(btrim(ap.legal_first_name), ''), split_part(a.display_name, ' ', 1)) as "Agent First Name",
       coalesce(nullif(btrim(ap.legal_last_name), ''), nullif(btrim(substr(a.display_name, length(split_part(a.display_name, ' ', 1)) + 1)), '')) as "Agent Last Name",
       coalesce(a.npn_db, a.npn_al) as "Agent NPN",
       ap.approved_upline_npn as "Direct Upline NPN",
       a.phone as "Agent Mobile Number",
       a.email as "Agent Email",
       ap.approved_comp_level as "Comp Level",
       ap.approved_advance_tier as "Advance Pay Tier",
       ap.approved_sub_agency as "Sub-Agency Name",
       case when ap.approved_sub_agent_head then 'TRUE' else 'FALSE' end as "Sub-Agent Head?",
       'TRUE'::text as "Life Licensed?",
       'TRUE'::text as "$1M in E&O coverage?"
from public.v_contracting_audit a
join public.contracting_ethos_approvals ap on ap.agent_id = a.agent_id
where a.license_status = 'licensed'
  and a.ethos_status = 'not_on_sheet'
  and a.dup_npn_with is null
  and ap.npn_verified_at is not null
  and ap.license_verified_at is not null
  and ap.eo_verified_at is not null
  and ap.eo_expires_at >= current_date
  and ap.approved_comp_level is not null
  and ap.approved_advance_tier is not null
  and ap.approved_upline_npn is not null
  and ap.approved_sub_agency is not null
  and ap.approved_sub_agent_head is not null
  and ap.approved_by is not null
order by a.display_name;

drop view if exists public.v_ethos_agent_updates;
create view public.v_ethos_agent_updates
with (security_invoker = true) as
select a.agent_id,
       a.display_name,
       r.first_name as "Agent First Name",
       r.last_name as "Agent Last Name",
       r.npn as "Agent NPN",
       case when ap.approved_upline_npn is distinct from r.upline_npn then ap.approved_upline_npn end as "Direct Upline's NPN",
       case when ap.approved_comp_level is distinct from r.comp_level then ap.approved_comp_level end as "Comp Level",
       case when ap.approved_advance_tier is distinct from r.advance then ap.approved_advance_tier end as "Advanced Payments",
       r.comp_level as current_sheet_level,
       ap.approved_by,
       ap.approved_at
from public.v_contracting_audit a
join public.contracting_ethos_approvals ap on ap.agent_id = a.agent_id and ap.approved_by is not null
join public.v_ethos_roster_current r on r.npn = coalesce(a.npn_db, a.npn_al)
where (ap.approved_upline_npn is not null and ap.approved_upline_npn is distinct from r.upline_npn)
   or (ap.approved_comp_level is not null and ap.approved_comp_level is distinct from r.comp_level)
   or (ap.approved_advance_tier is not null and ap.approved_advance_tier is distinct from r.advance)
order by a.display_name;

grant select on public.v_ethos_paste_rows, public.v_ethos_agent_updates to authenticated;

create or replace function public.contracting_save_ethos_review(
  p_agent_id uuid,
  p_intake_id uuid,
  p_evidence jsonb default '{}'::jsonb,
  p_approval jsonb default null
) returns public.contracting_ethos_approvals
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.apex_is_admin();
  v_staff boolean := v_is_admin or public.has_role(auth.uid(), 'va_manager') or public.has_role(auth.uid(), 'va');
  v_row public.contracting_ethos_approvals;
  v_before jsonb;
  v_now timestamptz := now();
  e jsonb := coalesce(p_evidence, '{}'::jsonb);
  ap jsonb := p_approval;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not v_staff then raise exception 'contracting staff only' using errcode = '42501'; end if;
  if ap is not null and not v_is_admin then
    raise exception 'only an admin can approve comp, advance, upline, sub-agency or head designation' using errcode = '42501';
  end if;
  if p_agent_id is null and p_intake_id is null then raise exception 'agent or intake required'; end if;

  select * into v_row from public.contracting_ethos_approvals
   where (p_agent_id is not null and agent_id = p_agent_id)
      or (p_agent_id is null and intake_id = p_intake_id)
   limit 1;
  if not found then
    insert into public.contracting_ethos_approvals (agent_id, intake_id, updated_by)
    values (p_agent_id, p_intake_id, v_uid)
    returning * into v_row;
  end if;
  v_before := to_jsonb(v_row);

  update public.contracting_ethos_approvals set
    legal_first_name = case when e ? 'legal_first_name' then nullif(btrim(e->>'legal_first_name'), '') else legal_first_name end,
    legal_last_name = case when e ? 'legal_last_name' then nullif(btrim(e->>'legal_last_name'), '') else legal_last_name end,
    npn_verified_at = case when e ? 'npn_verified' then (case when (e->>'npn_verified')::boolean then coalesce(npn_verified_at, v_now) end) else npn_verified_at end,
    npn_verified_by = case when e ? 'npn_verified' then (case when (e->>'npn_verified')::boolean then coalesce(npn_verified_by, v_uid) end) else npn_verified_by end,
    npn_verified_source = case when e ? 'npn_verified_source' then nullif(btrim(e->>'npn_verified_source'), '') else npn_verified_source end,
    license_verified_at = case when e ? 'license_verified' then (case when (e->>'license_verified')::boolean then coalesce(license_verified_at, v_now) end) else license_verified_at end,
    license_verified_by = case when e ? 'license_verified' then (case when (e->>'license_verified')::boolean then coalesce(license_verified_by, v_uid) end) else license_verified_by end,
    license_evidence_ref = case when e ? 'license_evidence_ref' then nullif(btrim(e->>'license_evidence_ref'), '') else license_evidence_ref end,
    eo_verified_at = case when e ? 'eo_verified' then (case when (e->>'eo_verified')::boolean then coalesce(eo_verified_at, v_now) end) else eo_verified_at end,
    eo_verified_by = case when e ? 'eo_verified' then (case when (e->>'eo_verified')::boolean then coalesce(eo_verified_by, v_uid) end) else eo_verified_by end,
    eo_expires_at = case when e ? 'eo_expires_at' then nullif(e->>'eo_expires_at', '')::date else eo_expires_at end,
    eo_evidence_ref = case when e ? 'eo_evidence_ref' then nullif(btrim(e->>'eo_evidence_ref'), '') else eo_evidence_ref end,
    contact_confirmed_at = case when e ? 'contact_confirmed' then (case when (e->>'contact_confirmed')::boolean then coalesce(contact_confirmed_at, v_now) end) else contact_confirmed_at end,
    contact_confirmed_by = case when e ? 'contact_confirmed' then (case when (e->>'contact_confirmed')::boolean then coalesce(contact_confirmed_by, v_uid) end) else contact_confirmed_by end,
    owner_name = case when e ? 'owner_name' then nullif(btrim(e->>'owner_name'), '') else owner_name end,
    note = case when e ? 'note' then nullif(btrim(e->>'note'), '') else note end,
    approved_comp_level = case when ap is not null and ap ? 'approved_comp_level' then nullif(btrim(ap->>'approved_comp_level'), '') else approved_comp_level end,
    approved_advance_tier = case when ap is not null and ap ? 'approved_advance_tier' then nullif(btrim(ap->>'approved_advance_tier'), '') else approved_advance_tier end,
    approved_upline_npn = case when ap is not null and ap ? 'approved_upline_npn' then nullif(regexp_replace(ap->>'approved_upline_npn', '\s', '', 'g'), '') else approved_upline_npn end,
    approved_sub_agency = case when ap is not null and ap ? 'approved_sub_agency' then nullif(btrim(ap->>'approved_sub_agency'), '') else approved_sub_agency end,
    approved_sub_agent_head = case when ap is not null and ap ? 'approved_sub_agent_head' then (ap->>'approved_sub_agent_head')::boolean else approved_sub_agent_head end,
    comp_grid_version = case when ap is not null and ap ? 'comp_grid_version' then nullif(btrim(ap->>'comp_grid_version'), '') else comp_grid_version end,
    approved_by = case when ap is not null then v_uid else approved_by end,
    approved_at = case when ap is not null then v_now else approved_at end,
    updated_at = v_now,
    updated_by = v_uid
  where id = v_row.id
  returning * into v_row;

  insert into public.contracting_ethos_approval_log (approval_id, actor, action, before, after)
  values (v_row.id, v_uid, case when ap is not null then 'approve' else 'evidence' end, v_before, to_jsonb(v_row));

  return v_row;
end;
$$;

revoke all on function public.contracting_save_ethos_review(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.contracting_save_ethos_review(uuid, uuid, jsonb, jsonb) to authenticated;

insert into public.system_settings (key, value)
values ('ethos_sheet_writes_enabled', 'false')
on conflict (key) do nothing;

commit;
