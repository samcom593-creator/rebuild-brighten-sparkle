-- MP-304 · Contracting intake & comp control — the Ethos lane (2026-11-23)
--
-- Sam, 2026-11-23: Ethos only (fastest carrier to appoint). Advance Pay Tier is "6 Month Advance" for
-- everyone; the ONLY thing a manager may vary is the comp (payment) tier, default 60% = Level 12; a manager
-- never sets a downline above their own level. Everything here was measured against the live Ethos sheet
-- (173 rows: upline NPN 21346366 on 170, Level 12 on 161, "6 Month Advance" on 167).
--
-- Part 1: settings, schema, history, validators, scope helpers, and the shared intake core.

-- ── A. Settings ────────────────────────────────────────────────────────────────────────────────────────
insert into public.system_settings (key, value)
select 'contracting_default_comp_level', '60'
where not exists (select 1 from public.system_settings where key = 'contracting_default_comp_level');

create or replace function public.fn_contracting_default_comp_pct()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(value), '')::numeric from public.system_settings where key = 'contracting_default_comp_level' limit 1),
    60);
$$;
revoke all on function public.fn_contracting_default_comp_pct() from public, anon;
grant execute on function public.fn_contracting_default_comp_pct() to authenticated, service_role;

-- Ethos speaks LEVELS. public.fn_ethos_level_for_pct(pct numeric) already exists in prod (60% = Level 12, one level
-- per 5 points, clamped 12..27 — the same mapping as ethosLevelForPct() in _shared/ethos.ts) and v_contracting_audit
-- depends on it, so it is NOT redefined here; it is only made callable by the forms.
grant execute on function public.fn_ethos_level_for_pct(numeric) to authenticated, service_role;

create or replace function public.fn_ethos_principal_npn()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim((value::jsonb) ->> 'principal_npn'), '') from public.system_settings
      where key = 'ethos_agents_sheet' and value ~ '^\s*\{' limit 1),
    '21346366');
$$;
revoke all on function public.fn_ethos_principal_npn() from public, anon;
grant execute on function public.fn_ethos_principal_npn() to authenticated, service_role;

create or replace function public.set_contracting_default_comp_level(p_value text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v numeric; v_uid uuid := auth.uid();
begin
  if not public.apex_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Admin only.');
  end if;
  begin v := nullif(btrim(coalesce(p_value, '')), '')::numeric; exception when others then v := null; end;
  if v is null or v < 60 or v > 135 or v <> round(v / 5) * 5 then
    return jsonb_build_object('ok', false, 'error', 'The default must be a multiple of 5 between 60 and 135 (Ethos Level 12..27).');
  end if;
  delete from public.system_settings where key = 'contracting_default_comp_level';
  insert into public.system_settings (key, value) values ('contracting_default_comp_level', v::text);
  insert into public.contracting_request_events (request_id, event_type, detail, acted_by)
    values (null, 'default_comp_level_set', jsonb_build_object('value', v, 'level', public.fn_ethos_level_for_pct(v)), v_uid);
  return jsonb_build_object('ok', true, 'default_comp_level', v, 'level', public.fn_ethos_level_for_pct(v));
end $$;
revoke all on function public.set_contracting_default_comp_level(text) from public, anon;
grant execute on function public.set_contracting_default_comp_level(text) to authenticated;

-- ── B. Schema ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.contracting_intakes
  add column if not exists upline_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists request_type text not null default 'contracting',
  add column if not exists sub_agency_name text;
alter table public.contracting_intakes drop constraint if exists contracting_intakes_request_type_check;
alter table public.contracting_intakes add constraint contracting_intakes_request_type_check
  check (request_type in ('contracting', 'transfer'));
create index if not exists contracting_intakes_upline_idx on public.contracting_intakes (upline_agent_id);

-- Evidence can be VERIFIED (NIPR/certificate, the Oct-3 gate) or ATTESTED by the manager who is putting the
-- person on their own downline. Attested is reported as review on the receipt, never laundered into verified.
alter table public.contracting_ethos_approvals
  add column if not exists evidence_mode text not null default 'verified',
  add column if not exists attested_by uuid references auth.users(id) on delete set null,
  add column if not exists attested_at timestamptz,
  add column if not exists license_attested boolean,
  add column if not exists eo_attested boolean;
alter table public.contracting_ethos_approvals drop constraint if exists contracting_ethos_approvals_evidence_mode_check;
alter table public.contracting_ethos_approvals add constraint contracting_ethos_approvals_evidence_mode_check
  check (evidence_mode in ('verified', 'attested'));

-- One MGN link per manager, by name. The table existed with no uniqueness, so a second paste would have
-- silently created a second row and the resolver would have picked one at random.
create unique index if not exists contracting_links_manager_name_key on public.contracting_links (manager_id, name);

-- Sub-Agency Name on the Ethos sheet carries the MANAGER (Direct Upline NPN is the principal on 170/173 rows).
-- The label is the sheet's canonical spelling, which is not always the roster's ("Chudi" vs "Chukwudi").
create table if not exists public.contracting_sub_agency_labels (
  manager_agent_id uuid primary key references public.agents(id) on delete cascade,
  label text not null check (btrim(label) <> '' and length(label) <= 80),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.contracting_sub_agency_labels enable row level security;
insert into public.contracting_sub_agency_labels (manager_agent_id, label) values
  ('7c3c5581-3544-437f-bfe2-91391afb217d', 'Apex Financial Empire'),
  ('cde14d07-2366-444a-80cc-58a8f7da6f95', 'Apex Financial Empire'),
  ('bc2216a9-e269-4202-bba0-5fc25b87da1c', 'Aisha Kebbeh'),
  ('136ee983-afa8-45a6-8ba4-8a88104b8b09', 'Obiajulu Ifediora'),
  ('a60e70c5-f2d4-4a3d-bcdb-0002327f8e3f', 'Chukwudi Ifediora')
on conflict (manager_agent_id) do nothing;

-- agent_contract_levels is keyed on agent_id: a CURRENT value, not a history. Every change is now recorded
-- with before/after, actor and reason, so the "second batch silently cut three agents from 85/78/74 to 60"
-- defect on the IMO sheet cannot repeat here unrecorded.
create table if not exists public.agent_contract_level_history (
  id bigserial primary key,
  agent_id uuid not null,
  old_pct numeric,
  new_pct numeric,
  old_source text,
  new_source text,
  set_by uuid,
  note text,
  changed_at timestamptz not null default now()
);
alter table public.agent_contract_level_history enable row level security;
create index if not exists agent_contract_level_history_agent_idx on public.agent_contract_level_history (agent_id, changed_at desc);

create or replace function public.trg_fn_agent_contract_level_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.contract_pct is distinct from new.contract_pct or old.source is distinct from new.source then
    insert into public.agent_contract_level_history (agent_id, old_pct, new_pct, old_source, new_source, set_by, note)
    values (new.agent_id, case when tg_op = 'INSERT' then null else old.contract_pct end, new.contract_pct,
            case when tg_op = 'INSERT' then null else old.source end, new.source, new.set_by, new.note);
  end if;
  return new;
end $$;
drop trigger if exists trg_agent_contract_level_history on public.agent_contract_levels;
create trigger trg_agent_contract_level_history
  after insert or update on public.agent_contract_levels
  for each row execute function public.trg_fn_agent_contract_level_history();

-- Update requests bound for the "Agent Updates" tab (A:H agency block; I is the sheet's own; J:L are Ethos').
create table if not exists public.contracting_agent_updates (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete set null,
  intake_id uuid references public.contracting_intakes(id) on delete set null,
  npn text not null check (npn ~ '^[0-9]{5,10}$'),
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  change_upline_npn text check (change_upline_npn is null or change_upline_npn ~ '^[0-9]*[1-9][0-9]*$'),
  change_comp_level text check (change_comp_level is null or change_comp_level ~ '^Level [0-9]{2}( \(LOA\))?$'),
  change_advance_tier text check (change_advance_tier is null or change_advance_tier in ('As Earned', '6 Month Advance', '9 Month Advance')),
  change_pii text,
  termination_requested boolean not null default false,
  termination_authorized_by uuid,
  termination_authorized_at timestamptz,
  reason text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'attempting', 'delivered', 'manual_review', 'failed', 'not_configured', 'unknown_outcome', 'dead_letter')),
  sheet_row integer,
  receipt jsonb,
  last_error_redacted text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracting_agent_updates_receipt_required check (status <> 'delivered' or (receipt is not null and delivered_at is not null))
);
alter table public.contracting_agent_updates enable row level security;
create index if not exists contracting_agent_updates_agent_idx on public.contracting_agent_updates (agent_id, created_at desc);
create index if not exists contracting_agent_updates_status_idx on public.contracting_agent_updates (status, created_at);

-- ── C. Validators ──────────────────────────────────────────────────────────────────────────────────────
-- Damerau edit distance <= 1 on digit strings: one substitution (Dylan Harvey 21756683 vs 21755683), one
-- insertion/deletion, or one adjacent transposition. Anything within 1 of an existing NPN is held for a
-- person, not accepted as a new producer.
create or replace function public.fn_digits_edit_distance_le1(a text, b text)
returns boolean language plpgsql immutable as $$
declare la int; lb int; i int; diff int := 0; s text; l text; k int := 1; m int := 1; skipped boolean := false; p int := 0;
begin
  if a is null or b is null then return false; end if;
  if a = b then return true; end if;
  la := length(a); lb := length(b);
  if la = lb then
    for i in 1..la loop
      if substr(a, i, 1) <> substr(b, i, 1) then
        diff := diff + 1;
        if diff = 1 then p := i; end if;
        if diff > 2 then return false; end if;
      end if;
    end loop;
    if diff = 1 then return true; end if;
    -- two differences count only as an adjacent swap
    return diff = 2 and substr(a, p, 1) <> substr(b, p, 1) and substr(a, p + 1, 1) <> substr(b, p + 1, 1)
       and substr(a, p, 1) = substr(b, p + 1, 1) and substr(a, p + 1, 1) = substr(b, p, 1);
  elsif abs(la - lb) = 1 then
    if la < lb then s := a; l := b; else s := b; l := a; end if;
    while k <= length(s) and m <= length(l) loop
      if substr(s, k, 1) = substr(l, m, 1) then k := k + 1; m := m + 1;
      else
        if skipped then return false; end if;
        skipped := true; m := m + 1;
      end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

-- Mirrors DOMAIN_FIXES in src/lib/emailValidation.ts (measured on the Ethos sheet: gmai.com, gmil.com, yahoo.con).
create or replace function public.fn_email_typo_suggestion(p_email text)
returns text language sql immutable as $$
  with e as (select lower(btrim(coalesce(p_email, ''))) as v),
  parts as (select split_part(v, '@', 1) as lp, split_part(v, '@', 2) as dom from e),
  fixes(bad, good) as (values
    ('gmai.com','gmail.com'),('gmial.com','gmail.com'),('gamil.com','gmail.com'),('gmal.com','gmail.com'),
    ('gnail.com','gmail.com'),('gmil.com','gmail.com'),('gmaill.com','gmail.com'),('gmail.co','gmail.com'),
    ('gmail.cm','gmail.com'),('gmail.om','gmail.com'),('gmail.con','gmail.com'),('gmali.com','gmail.com'),
    ('yaho.com','yahoo.com'),('yahooo.com','yahoo.com'),('yhoo.com','yahoo.com'),('yahoo.co','yahoo.com'),
    ('yahoo.con','yahoo.com'),('hotmial.com','hotmail.com'),('hotmal.com','hotmail.com'),('hotmail.co','hotmail.com'),
    ('hotmail.con','hotmail.com'),('outlok.com','outlook.com'),('outloook.com','outlook.com'),('outlook.con','outlook.com'),
    ('iclould.com','icloud.com'),('icloud.co','icloud.com'),('icloud.con','icloud.com'),('aol.co','aol.com'),('aol.con','aol.com'))
  select case
    when parts.lp = '' or parts.dom = '' then null
    when f.good is not null then parts.lp || '@' || f.good
    when parts.dom ~ '\.(con|cmo|coom|ocm|comm|cim|vom|xom)$' then parts.lp || '@' || regexp_replace(parts.dom, '\.(con|cmo|coom|ocm|comm|cim|vom|xom)$', '.com')
    else null end
  from parts left join fixes f on f.bad = parts.dom;
$$;
grant execute on function public.fn_email_typo_suggestion(text) to authenticated, service_role;

-- ── D. Scope helpers ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_contracting_caller_agent()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(public.fn_canonical_agent_id(a.id), a.id)
  from public.agents a
  where a.user_id = auth.uid() and not coalesce(a.is_deactivated, false)
  order by (a.status = 'active') desc, a.created_at
  limit 1;
$$;
revoke all on function public.fn_contracting_caller_agent() from public, anon;
grant execute on function public.fn_contracting_caller_agent() to authenticated, service_role;

-- Admin sees the roster; a manager sees exactly their downline (every depth), the same scope
-- my_agents_missing_comp_level() already uses.
create or replace function public.fn_contracting_scope_ok(p_agent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_agent is not null and (
    public.apex_is_admin()
    or exists (
      select 1 from public.fn_contracting_caller_agent() c, lateral public.fn_hierarchy_first_hops(array[c]) h
      where h.member = p_agent));
$$;
revoke all on function public.fn_contracting_scope_ok(uuid) from public, anon;
grant execute on function public.fn_contracting_scope_ok(uuid) to authenticated, service_role;

create or replace function public.fn_contracting_sub_agency_label(p_manager uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select label from public.contracting_sub_agency_labels where manager_agent_id = p_manager),
    (select case when a.nipr_number = public.fn_ethos_principal_npn() then 'Apex Financial Empire' else a.display_name end
       from public.agents a where a.id = p_manager));
$$;
revoke all on function public.fn_contracting_sub_agency_label(uuid) from public, anon;
grant execute on function public.fn_contracting_sub_agency_label(uuid) to authenticated, service_role;

-- A manager's cap is their own resolved level; an admin has none. A manager with no recorded level cannot
-- give more than the default.
create or replace function public.fn_contracting_comp_cap(p_caller uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when public.apex_is_admin() then null
              else coalesce((select pct from public.fn_agent_contract_pct(p_caller)), public.fn_contracting_default_comp_pct()) end;
$$;
revoke all on function public.fn_contracting_comp_cap(uuid) from public, anon;
grant execute on function public.fn_contracting_comp_cap(uuid) to authenticated, service_role;

-- ── D2. NPN near-duplicates (needs the scope helper above) ──────────────────────────────────────────────
-- Every active agent or contracting intake whose NPN is the same (distance 0) or one edit away (distance 1).
-- in_scope says whether the caller may act on that agent; the verdict treats an exact match in scope as "the same
-- person, update", an exact match out of scope as "a person decides", and any distance-1 match as "hold".
create or replace function public.fn_npn_near_duplicates(p_npn text, p_exclude_agent uuid default null, p_exclude_intake uuid default null)
returns table (kind text, id uuid, display text, npn text, distance int, in_scope boolean)
language sql stable security definer set search_path = public as $$
  with n as (select public.fn_normalize_contracting_npn(p_npn) as v)
  select 'agent'::text, a.id, a.display_name, a.nipr_number,
         case when a.nipr_number = n.v then 0 else 1 end, public.fn_contracting_scope_ok(a.id)
  from public.agents a, n
  where n.v is not null and a.nipr_number ~ '^[0-9]{5,10}$'
    and a.status <> 'terminated' and not coalesce(a.is_deactivated, false)
    and (p_exclude_agent is null or a.id <> p_exclude_agent)
    and public.fn_digits_edit_distance_le1(a.nipr_number, n.v)
  union all
  select 'intake'::text, i.id, i.first_name || ' ' || i.last_name, i.npn,
         case when i.npn = n.v then 0 else 1 end, true
  from public.contracting_intakes i, n
  where n.v is not null and i.npn is not null
    and (p_exclude_intake is null or i.id <> p_exclude_intake)
    and i.agent_id is null
    and public.fn_digits_edit_distance_le1(i.npn, n.v);
$$;
revoke all on function public.fn_npn_near_duplicates(text, uuid, uuid) from public, anon;
grant execute on function public.fn_npn_near_duplicates(text, uuid, uuid) to authenticated, service_role;


-- ── E. Shared intake core (generated from the live submit_contracting_intake body) ──────────────────
CREATE OR REPLACE FUNCTION public.fn_contracting_intake_core(p_first_name text, p_last_name text, p_email text, p_phone text, p_npn text, p_source text DEFAULT 'apex_contracting_page'::text, p_submitted_by uuid DEFAULT NULL::uuid, p_license_status text DEFAULT 'licensed'::text, p_destinations text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text;
  v_phone text;
  v_npn   text;
  v_first text;
  v_last  text;
  v_license text;
  v_intake public.contracting_intakes%rowtype;
  v_prelicense public.contracting_intakes%rowtype;
  v_existing_by_email uuid;
  v_replay boolean := false;
  v_upgraded boolean := false;
  v_review_reason text := null;
  v_dest text;
  v_destinations text[] := coalesce(p_destinations, array[
    'contracting_email', 'contracting_discord', 'contracting_workbook', 'ethos_sheet'
  ]);
  v_source text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'apex_contracting_page');
begin
  -- Internal core: no caller check here. submit_contracting_intake (service role) and
  -- submit_downline_contracting (authenticated, scoped) are the two callers; each checks its own caller.
  v_first := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last  := nullif(btrim(coalesce(p_last_name, '')), '');
  v_email := public.fn_normalize_contracting_email(p_email);
  v_phone := public.fn_normalize_contracting_phone(p_phone);
  v_npn   := public.fn_normalize_contracting_npn(p_npn);
  -- Anything that is not an explicit pre-license claim is treated as licensed,
  -- which keeps every existing caller on the strict path.
  v_license := case
    when lower(btrim(coalesce(p_license_status, ''))) in ('unlicensed', 'pending')
      then lower(btrim(p_license_status))
    else 'licensed'
  end;

  -- Field-specific rejections. A single "invalid input" would make the form
  -- unusable on a phone, which is where most of these are filled in.
  if v_first is null then
    return jsonb_build_object('ok', false, 'error', 'first_name_required', 'field', 'first_name');
  end if;
  if v_last is null then
    return jsonb_build_object('ok', false, 'error', 'last_name_required', 'field', 'last_name');
  end if;
  if v_email is null or v_email not like '%_@_%.__%' then
    return jsonb_build_object('ok', false, 'error', 'email_invalid', 'field', 'email');
  end if;
  if v_phone is null then
    return jsonb_build_object('ok', false, 'error', 'phone_invalid', 'field', 'phone');
  end if;
  -- Licensed => NPN required. Pre-license => optional, but if one was typed it
  -- still has to be a real NPN shape; a malformed value is never silently
  -- dropped into "no NPN".
  if v_license = 'licensed' and (v_npn is null or v_npn !~ '^[0-9]{5,10}$') then
    return jsonb_build_object('ok', false, 'error', 'npn_invalid', 'field', 'npn');
  end if;
  if v_npn is not null and v_npn !~ '^[0-9]{5,10}$' then
    return jsonb_build_object('ok', false, 'error', 'npn_invalid', 'field', 'npn');
  end if;

  -- ── Pre-license path: no NPN. Identity is the email until the NPN arrives. ──
  if v_npn is null then
    perform pg_advisory_xact_lock(hashtext('contracting_intake:email:' || v_email));

    -- Prefer a row that already carries an NPN: a pre-license replay must never
    -- downgrade a producer who has since been contracted.
    select * into v_intake
      from public.contracting_intakes
     where email = v_email
     order by (npn is not null) desc, created_at
     limit 1;

    if found then
      v_replay := true;
      if v_intake.npn is null then
        update public.contracting_intakes
           set first_name = v_first,
               last_name  = v_last,
               phone_e164 = v_phone,
               license_status = v_license
         where id = v_intake.id
         returning * into v_intake;
      end if;
      return jsonb_build_object(
        'ok', true,
        'intake_id', v_intake.id,
        'status', v_intake.status,
        'review_reason', v_intake.review_reason,
        'replay', true,
        'upgraded', false,
        'license_status', v_intake.license_status,
        'npn_on_file', v_intake.npn is not null,
        'contracting', case when v_intake.npn is null then 'awaiting_license'
                            when v_intake.status = 'needs_review' then 'needs_review'
                            else 'queued' end
      );
    end if;

    insert into public.contracting_intakes (
      first_name, last_name, email, phone_e164, npn,
      status, review_reason, idempotency_key, source, submitted_by, license_status
    ) values (
      v_first, v_last, v_email, v_phone, null,
      'accepted', null,
      'contracting-intake-prelicense-' || v_email,
      v_source, p_submitted_by, v_license
    )
    returning * into v_intake;

    -- Parked, not queued. No outbox event exists, so nothing can be delivered
    -- and nothing can be reported as delivered. The NPN upgrade below releases
    -- these rows to 'queued' and creates the events.
    foreach v_dest in array v_destinations loop
      insert into public.contracting_intake_deliveries (intake_id, destination, state, last_error_redacted)
      values (
        v_intake.id, v_dest, 'awaiting_license',
        'Parked: no NPN yet. Queues automatically when the producer is licensed and submits their NPN.'
      )
      on conflict (intake_id, destination) do nothing;
    end loop;

    return jsonb_build_object(
      'ok', true,
      'intake_id', v_intake.id,
      'status', v_intake.status,
      'review_reason', null,
      'replay', false,
      'upgraded', false,
      'license_status', v_license,
      'npn_on_file', false,
      'contracting', 'awaiting_license'
    );
  end if;

  -- ── Licensed path: NPN present. Identity is the NPN. ──
  -- Serialize every submission for this NPN before reading. Without this, two
  -- first-time submissions of the same NPN both see no row, both INSERT, and one
  -- dies on contracting_intakes_npn_key — so a producer who double-taps Submit
  -- on a slow phone connection gets an error on the request that was about to
  -- succeed. The lock is transaction-scoped and released at commit or rollback,
  -- and because READ COMMITTED takes a fresh snapshot per statement, the waiter
  -- sees the winner's committed row when it proceeds.
  perform pg_advisory_xact_lock(hashtext('contracting_intake:' || v_npn));

  -- A replay returns the SAME intake id, so the caller can retry a dropped
  -- connection without producing a second producer downstream.
  select * into v_intake from public.contracting_intakes where npn = v_npn;

  if found then
    v_replay := true;

    -- A replay may carry a corrected email. That is legitimate, but it is NOT
    -- automatically safe: the new address may already belong to a DIFFERENT
    -- producer's intake, and silently taking it would let one submission
    -- redirect another producer's contracting correspondence. Re-run the
    -- collision check on every replay, not only on first insert. Only rows
    -- that carry an NPN count: a parked pre-license row is not a producer.
    if v_email is distinct from v_intake.email then
      select id into v_existing_by_email
        from public.contracting_intakes
       where email = v_email
         and npn is not null
         and npn <> v_npn
       limit 1;
      if v_existing_by_email is not null then
        v_review_reason := 'email_matches_a_different_npn';
      end if;
    end if;

    -- When a replay is ambiguous, DISCARD ITS CONTACT FIELDS ENTIRELY.
    --
    -- NPN is the only credential this public endpoint has. Anyone holding a
    -- producer's NPN can submit under it, so a submission we have just judged
    -- suspect must not be allowed to rewrite how that producer is reached.
    -- The whole contact block is held at its last trusted values until a
    -- person adjudicates; the review row records that a change was attempted.
    update public.contracting_intakes
       set first_name = case when v_review_reason is not null then v_intake.first_name else v_first end,
           last_name  = case when v_review_reason is not null then v_intake.last_name  else v_last  end,
           email      = case when v_review_reason is not null then v_intake.email      else v_email end,
           phone_e164 = case when v_review_reason is not null then v_intake.phone_e164 else v_phone end,
           license_status = 'licensed',
           -- A review, once raised, belongs to a human. Never downgrade an
           -- existing needs_review back to accepted on a later submission.
           status = case
             when v_review_reason is not null then 'needs_review'
             else v_intake.status
           end,
           review_reason = coalesce(v_review_reason, v_intake.review_reason)
     where id = v_intake.id
     returning * into v_intake;

    -- If this replay is what made the record ambiguous, pull the Ethos write
    -- back before it can run. Anything already delivered stays delivered —
    -- that is a fact about the past, not a claim about the present — but a
    -- queued or retrying write is stopped and handed to a person.
    if v_review_reason is not null then
      update public.contracting_intake_deliveries
         set state = 'manual_review',
             last_error_redacted = 'Held: the submitted email is already on a different NPN.'
       where intake_id = v_intake.id
         and destination = 'ethos_sheet'
         and state in ('queued', 'failed');

      update public.outbox_events
         set status = 'manual_action_required',
             processed_at = now(),
             locked_at = null,
             last_error_redacted = 'Held: the submitted email is already on a different NPN.'
       where aggregate_type = 'contracting_intake'
         and aggregate_id = v_intake.id
         and destination = 'ethos_sheet'
         and status in ('pending', 'failed');
    end if;
  else
    -- The NPN is new. Is this the licensing moment for a parked pre-license
    -- intake under the same address? Then it is the SAME person: upgrade that
    -- row in place, keep its id and history, and release its deliveries.
    perform pg_advisory_xact_lock(hashtext('contracting_intake:email:' || v_email));

    select * into v_prelicense
      from public.contracting_intakes
     where email = v_email
       and npn is null
     limit 1;

    if found then
      update public.contracting_intakes
         set npn = v_npn,
             first_name = v_first,
             last_name  = v_last,
             phone_e164 = v_phone,
             license_status = 'licensed',
             source = v_source,
             submitted_by = coalesce(p_submitted_by, submitted_by)
       where id = v_prelicense.id
       returning * into v_intake;
      v_upgraded := true;

      update public.contracting_intake_deliveries
         set state = 'queued',
             last_error_redacted = null
       where intake_id = v_intake.id
         and state = 'awaiting_license';
    else
      -- Same email under a DIFFERENT NPN. Could be a household address, could be
      -- one producer mistyping their NPN. A machine must not decide which, so the
      -- intake is accepted and flagged; Ethos is held at manual_review so we
      -- cannot overwrite somebody else's row on a guess.
      select id into v_existing_by_email
        from public.contracting_intakes
       where email = v_email
         and npn is not null
       limit 1;
      if v_existing_by_email is not null then
        v_review_reason := 'email_matches_a_different_npn';
      end if;

      begin
        insert into public.contracting_intakes (
          first_name, last_name, email, phone_e164, npn,
          status, review_reason, idempotency_key, source, submitted_by, license_status
        ) values (
          v_first, v_last, v_email, v_phone, v_npn,
          case when v_review_reason is null then 'accepted' else 'needs_review' end,
          v_review_reason,
          'contracting-intake-' || v_npn,
          v_source, p_submitted_by, 'licensed'
        )
        returning * into v_intake;
      exception when unique_violation then
        -- Belt and braces behind the advisory lock. A caller that reaches this
        -- table by some other path can still race us; losing that race is a
        -- replay, not an error, so resolve to the winner's row rather than
        -- failing a producer's submission.
        select * into v_intake from public.contracting_intakes where npn = v_npn;
        if not found then raise; end if;
        v_replay := true;
      end;
    end if;
  end if;

  -- Enqueue exactly one job per destination, in this same transaction. Both
  -- inserts are ON CONFLICT DO NOTHING against unique keys, so a replay adds
  -- nothing: the delivery row already exists and the outbox idempotency key is
  -- already taken. That is what makes a retry safe rather than duplicative.
  -- On an upgrade the delivery rows already exist (just released to 'queued')
  -- and only the outbox events are new.
  foreach v_dest in array v_destinations loop
    insert into public.contracting_intake_deliveries (intake_id, destination, state)
    values (
      v_intake.id,
      v_dest,
      -- An email collision must not be auto-upserted into the shared Ethos
      -- sheet. It parks at manual_review and no outbox job is created for it.
      case when v_dest = 'ethos_sheet' and v_intake.status = 'needs_review'
           then 'manual_review' else 'queued' end
    )
    on conflict (intake_id, destination) do nothing;

    if not (v_dest = 'ethos_sheet' and v_intake.status = 'needs_review') then
      insert into public.outbox_events (
        aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key
      ) values (
        'contracting_intake',
        v_intake.id,
        'contracting_intake_submitted',
        v_dest,
        jsonb_build_object('intake_id', v_intake.id, 'destination', v_dest),
        'contracting-' || v_intake.id::text || '-' || v_dest
      )
      on conflict (idempotency_key) do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'intake_id', v_intake.id,
    'status', v_intake.status,
    'review_reason', v_intake.review_reason,
    'replay', v_replay,
    'upgraded', v_upgraded,
    'license_status', 'licensed',
    'npn_on_file', true,
    'contracting', case when v_intake.status = 'needs_review' then 'needs_review' else 'queued' end
  );
end;
$function$;

revoke all on function public.fn_contracting_intake_core(text, text, text, text, text, text, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.fn_contracting_intake_core(text, text, text, text, text, text, uuid, text, text[]) to service_role;

-- The public entry keeps its exact signature and its service-role check; it now delegates to the core with the
-- legacy four destinations, so every existing caller behaves byte-for-byte as before.
CREATE OR REPLACE FUNCTION public.submit_contracting_intake(p_first_name text, p_last_name text, p_email text, p_phone text, p_npn text, p_source text DEFAULT 'apex_contracting_page'::text, p_submitted_by uuid DEFAULT NULL::uuid, p_license_status text DEFAULT 'licensed'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return public.fn_contracting_intake_core(p_first_name, p_last_name, p_email, p_phone, p_npn, p_source, p_submitted_by, p_license_status, null);
end;
$function$;

-- ── F. Actor ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.contracting_actor()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_agent uuid; a record; v_admin boolean := public.apex_is_admin(); v_cap numeric; v_def numeric := public.fn_contracting_default_comp_pct();
begin
  v_agent := public.fn_contracting_caller_agent();
  select ag.id, ag.display_name, ag.is_manager, ag.ref_slug, ag.nipr_number into a from public.agents ag where ag.id = v_agent;
  if a.id is null and not v_admin then
    return jsonb_build_object('ok', false, 'error', 'No agent record is linked to your login.');
  end if;
  v_cap := public.fn_contracting_comp_cap(a.id);
  return jsonb_build_object(
    'ok', true,
    'user_id', auth.uid(),
    'agent_id', a.id,
    'display_name', a.display_name,
    'is_admin', v_admin,
    'is_manager', coalesce(a.is_manager, false) or v_admin,
    'ref_slug', a.ref_slug,
    'npn', a.nipr_number,
    'cap_pct', v_cap,
    'cap_level', case when v_cap is null then null else public.fn_ethos_level_for_pct(v_cap) end,
    'default_pct', v_def,
    'default_level', public.fn_ethos_level_for_pct(v_def),
    'advance_tier', '6 Month Advance',
    'sub_agency_label', public.fn_contracting_sub_agency_label(a.id),
    'mgn_url', (select url from public.contracting_links l where l.manager_id = a.id and l.name = 'mgn_referral' limit 1),
    'join_path', case when a.ref_slug is not null then '/contract/' || a.ref_slug end,
    'writes_enabled', coalesce((select value = 'true' from public.system_settings where key = 'ethos_sheet_writes_enabled' limit 1), false));
end $$;
revoke all on function public.contracting_actor() from public, anon;
grant execute on function public.contracting_actor() to authenticated;

-- ── G. Submit a downline (verdict first, then commit) ──────────────────────────────────────────────────
-- One write path for the manager form, the bulk grid and the public one-link (service role passes actor_agent_id).
-- p_dry_run=true returns the verdict and writes nothing; the grid shows every row's verdict before anything moves.
create or replace function public.submit_downline_contracting(p jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_service boolean := (auth.role() = 'service_role');
  v_admin boolean := false;
  v_actor uuid; v_actor_name text; v_actor_is_mgr boolean;
  v_upline uuid; v_upline_name text; v_upline_npn text;
  v_first text; v_last text; v_email text; v_phone text; v_npn text; v_rt text; v_source text;
  v_lic boolean; v_eo boolean; v_pct numeric; v_cap numeric; v_def numeric := public.fn_contracting_default_comp_pct();
  v_label text; v_level text; v_sugg text;
  v_existing uuid; v_existing_name text; v_existing_pct numeric; v_existing_mgr uuid;
  v_near jsonb := '[]'::jsonb; v_near_n int := 0; v_other_team jsonb := '[]'::jsonb; v_email_other text;
  v_core jsonb; v_intake uuid; v_reason text; v_confirm_down boolean; v_confirm_near boolean; v_head boolean;
  v_review jsonb := '[]'::jsonb; v_uid uuid := auth.uid();
  r record;
begin
  -- Who is acting. The public one-link path is the service role naming the slug's manager; everyone else is
  -- their own login, and must be a manager or an admin.
  if v_service and nullif(p->>'actor_agent_id', '') is not null then
    v_actor := (p->>'actor_agent_id')::uuid;
  else
    if v_service then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'actor', 'message', 'actor_agent_id is required on the service path.'); end if;
    v_admin := public.apex_is_admin();
    v_actor := public.fn_contracting_caller_agent();
  end if;
  select a.display_name, coalesce(a.is_manager, false) into v_actor_name, v_actor_is_mgr
    from public.agents a where a.id = v_actor and a.status = 'active' and not coalesce(a.is_deactivated, false);
  if v_actor_name is null and not v_admin then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'actor', 'message', 'Your login is not linked to an active agent record.');
  end if;
  if not (v_admin or v_actor_is_mgr) then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'actor', 'message', 'Only a manager or an admin can submit a downline.');
  end if;

  -- Normalize exactly as the intake does (same functions), so the verdict and the write cannot disagree.
  v_first := nullif(btrim(coalesce(p->>'first_name', '')), '');
  v_last  := nullif(btrim(coalesce(p->>'last_name', '')), '');
  v_email := public.fn_normalize_contracting_email(p->>'email');
  v_phone := public.fn_normalize_contracting_phone(p->>'phone');
  v_npn   := public.fn_normalize_contracting_npn(p->>'npn');
  v_rt    := case when lower(btrim(coalesce(p->>'request_type', ''))) = 'transfer' then 'transfer' else 'contracting' end;
  v_source := coalesce(nullif(btrim(p->>'source'), ''), 'manager_portal');
  v_lic := coalesce((p->>'license_attested')::boolean, false);
  v_eo  := coalesce((p->>'eo_attested')::boolean, false);
  v_reason := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_confirm_down := coalesce((p->>'confirm_downgrade')::boolean, false);
  v_confirm_near := v_admin and coalesce((p->>'confirm_near_duplicate')::boolean, false);
  v_head := v_admin and coalesce((p->>'sub_agent_head')::boolean, false);

  if v_first is null then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'first_name', 'message', 'Legal first name is needed.'); end if;
  if v_last is null then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'last_name', 'message', 'Legal last name is needed.'); end if;
  if length(v_first) > 100 or length(v_last) > 100 then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'last_name', 'message', 'Name is too long.'); end if;
  if v_email is null or v_email not like '%_@_%.__%' or length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'email', 'message', 'Enter a valid email address.');
  end if;
  v_sugg := public.fn_email_typo_suggestion(v_email);
  if v_sugg is not null then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'email', 'message', 'That email domain looks mistyped.', 'suggestion', v_sugg);
  end if;
  if v_phone is null then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'phone', 'message', 'Enter a 10-digit US mobile number.'); end if;
  if v_npn is null or v_npn !~ '^[0-9]{5,10}$' then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'npn', 'message', 'An NPN is 5 to 10 digits.'); end if;
  if v_npn ~ '^0+$' or v_npn = '12345678' then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'npn', 'message', 'That is a placeholder, not an NPN.'); end if;
  if right(regexp_replace(v_phone, '\D', '', 'g'), 10) = v_npn then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'npn', 'message', 'The NPN equals the phone number.'); end if;
  if not v_lic then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'license', 'message', 'Ethos contracts licensed agents only. Confirm the life license, or send them the licensing link first.');
  end if;

  -- Upline: the actor, unless an admin (or a manager, within their own downline) places the person under a sub-manager.
  v_upline := coalesce(nullif(p->>'upline_agent_id', '')::uuid, v_actor);
  if v_upline is null then return jsonb_build_object('ok', false, 'verdict', 'ambiguous_upline', 'field', 'upline', 'message', 'No upline. An admin must pick the manager.'); end if;
  select a.display_name, a.nipr_number into v_upline_name, v_upline_npn
    from public.agents a where a.id = v_upline and a.status = 'active' and not coalesce(a.is_deactivated, false)
      and (coalesce(a.is_manager, false) or a.id = v_actor);
  if v_upline_name is null then return jsonb_build_object('ok', false, 'verdict', 'ambiguous_upline', 'field', 'upline', 'message', 'That upline is not an active manager.'); end if;
  if v_upline <> v_actor and not v_admin and not v_service and not public.fn_contracting_scope_ok(v_upline) then
    return jsonb_build_object('ok', false, 'verdict', 'ambiguous_upline', 'field', 'upline', 'message', 'That manager is not in your downline.');
  end if;
  v_label := public.fn_contracting_sub_agency_label(v_upline);

  -- NPN identity. Exact match in scope = the same person, we update. Exact match on another team = a person
  -- decides. Within one edit = held: Dylan Harvey is on the IMO sheet as 21756683 AND 21755683.
  for r in select * from public.fn_npn_near_duplicates(v_npn, null, null) loop
    if r.distance = 0 and r.kind = 'agent' then
      if v_admin or v_service or r.in_scope then
        if v_existing is null then v_existing := r.id; v_existing_name := r.display; end if;
      else
        v_other_team := v_other_team || jsonb_build_object('display', r.display, 'npn', r.npn);
      end if;
    elsif r.distance = 1 then
      v_near_n := v_near_n + 1;
      v_near := v_near || jsonb_build_object('kind', r.kind, 'display', r.display, 'npn', r.npn);
    end if;
  end loop;
  if jsonb_array_length(v_other_team) > 0 and v_existing is null then
    return jsonb_build_object('ok', false, 'verdict', 'npn_belongs_to_other_team', 'field', 'npn',
      'message', 'This NPN is already an active agent on another team. An admin has to move them.', 'matches', v_other_team);
  end if;
  if v_near_n > 0 and not v_confirm_near then
    return jsonb_build_object('ok', false, 'verdict', 'npn_near_duplicate', 'field', 'npn',
      'message', 'This NPN is one digit away from an existing one. Check it against the licence before it goes to the carrier.', 'matches', v_near);
  end if;
  if v_existing is not null then
    select l.contract_pct, a.manager_id into v_existing_pct, v_existing_mgr
      from public.agents a left join public.agent_contract_levels l on l.agent_id = a.id where a.id = v_existing;
    if v_existing_mgr is not null and v_existing_mgr <> v_upline then
      v_review := v_review || jsonb_build_object('code', 'upline_differs_from_roster', 'message', 'The roster has a different manager; the roster is not changed by this submission.');
    end if;
  end if;

  -- An email that already belongs to a different active agent (different NPN) is a different person or a typo;
  -- either way it does not get written through.
  select a.display_name into v_email_other
    from public.agents a
    left join public.profiles pu on pu.user_id = a.user_id
    left join public.profiles pp on pp.id = a.profile_id
    where a.status <> 'terminated' and not coalesce(a.is_deactivated, false)
      and (lower(pu.email) = v_email or lower(pp.email) = v_email)
      and a.nipr_number ~ '^[0-9]{5,10}$' and a.nipr_number <> v_npn
      and (v_existing is null or a.id <> v_existing)
    limit 1;
  if v_email_other is not null then
    return jsonb_build_object('ok', false, 'verdict', 'email_belongs_to_other', 'field', 'email', 'message', 'This email is on file for ' || v_email_other || ' under a different NPN.');
  end if;

  -- Comp: default unless the manager says otherwise; on the Ethos grid; never above the manager's own level.
  v_pct := coalesce(nullif(p->>'comp_pct', '')::numeric, v_def);
  if v_pct < 60 or v_pct > 135 or v_pct <> round(v_pct / 5) * 5 then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'comp_pct', 'message', 'Comp must be a multiple of 5 between 60 and 135 (Level 12 to Level 27).');
  end if;
  -- Service path: the public one-link form can never set comp above the default. The hire link (consume-invite-token)
  -- passes trusted_comp: its comp is the offer the link's creator approved, capped at THAT person's own level.
  v_cap := case when v_admin then null
                when v_service and coalesce((p->>'trusted_comp')::boolean, false) then public.fn_contracting_comp_cap(v_actor)
                when v_service then v_def
                else public.fn_contracting_comp_cap(v_actor) end;
  if v_cap is not null and v_pct > v_cap then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'comp_pct', 'message', 'You can set up to ' || v_cap::text || '% (your own level).', 'cap_pct', v_cap);
  end if;
  if v_existing_pct is not null and v_pct < v_existing_pct then
    if not v_confirm_down then
      return jsonb_build_object('ok', false, 'verdict', 'would_downgrade_comp', 'field', 'comp_pct',
        'message', v_existing_name || ' is on ' || v_existing_pct::text || '% today; this would lower them to ' || v_pct::text || '%. Confirm with a reason or keep the current level.',
        'current_pct', v_existing_pct, 'proposed_pct', v_pct);
    end if;
    if v_reason is null then return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', 'reason', 'message', 'A reason is required to lower a comp level.'); end if;
  end if;
  v_level := public.fn_ethos_level_for_pct(v_pct);

  if p_dry_run then
    return jsonb_build_object('ok', true, 'verdict', 'ok', 'dry_run', true,
      'existing_agent_id', v_existing, 'existing_name', v_existing_name, 'existing_pct', v_existing_pct,
      'upline_id', v_upline, 'upline_name', v_upline_name, 'sub_agency', v_label,
      'comp_pct', v_pct, 'level', v_level, 'advance', '6 Month Advance', 'request_type', v_rt,
      'email', v_email, 'phone', v_phone, 'npn', v_npn, 'review', v_review);
  end if;

  -- Commit: the proven intake core (NPN identity, replay-safe, email-collision review), Ethos leg only.
  v_core := public.fn_contracting_intake_core(v_first, v_last, v_email, v_phone, v_npn, v_source, v_uid, 'licensed', array['ethos_sheet']);
  if not coalesce((v_core->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'verdict', 'needs_fix', 'field', coalesce(v_core->>'field', 'form'), 'message', coalesce(v_core->>'error', 'Not saved.'));
  end if;
  v_intake := (v_core->>'intake_id')::uuid;

  update public.contracting_intakes
     set upline_agent_id = v_upline, request_type = v_rt, sub_agency_name = v_label, comp_percentage = v_pct,
         agent_id = coalesce(agent_id, v_existing), updated_at = now()
   where id = v_intake;

  -- A replay lands on an intake whose Ethos leg may be DORMANT: parked 'not_configured' from the months with no
  -- credential, or 'delivered' with written=false (a Level-8-era "already present" that says nothing about MGN's
  -- sheet). The core's ON CONFLICT DO NOTHING keeps those as they are, so a manager's fresh submission would never
  -- reach the sheet. Revive the leg and its outbox event; a needs_review intake stays held for a person.
  if (v_core->>'status') <> 'needs_review' then
    update public.contracting_intake_deliveries d
       set state = 'queued', last_error_redacted = null, updated_at = now()
     where d.intake_id = v_intake and d.destination = 'ethos_sheet'
       and (d.state in ('not_configured', 'failed', 'dead_letter')
            or (d.state = 'delivered' and coalesce(d.receipt->>'written', '') <> 'true'));
    if found then
      -- Never reset an old event: delivery_attempts is keyed on the event, so a reset event collides with the
      -- attempt it already made (proven live 2026-11-23: 16 revived legs failed on that unique key). Retire the
      -- old event and queue a FRESH one; one live pending event per leg.
      update public.outbox_events o
         set status = 'cancelled_retired', processed_at = now(), locked_at = null, last_error_redacted = 'superseded by a fresh event (MP-304 revive)', updated_at = now()
       where o.aggregate_type = 'contracting_intake' and o.aggregate_id = v_intake and o.destination = 'ethos_sheet'
         and o.status in ('failed', 'manual_action_required', 'dead_letter', 'delivered', 'skipped_destination_dead');
      if not exists (select 1 from public.outbox_events o where o.aggregate_type = 'contracting_intake' and o.aggregate_id = v_intake and o.destination = 'ethos_sheet' and o.status in ('pending', 'processing')) then
        insert into public.outbox_events (aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key)
        values ('contracting_intake', v_intake, 'contracting_intake_submitted', 'ethos_sheet',
                jsonb_build_object('intake_id', v_intake, 'destination', 'ethos_sheet', 'revived', true),
                'contracting-' || v_intake::text || '-ethos_sheet-r' || extract(epoch from clock_timestamp())::bigint::text);
      end if;
    end if;
  end if;

  -- Leadership approval + manager attestation. Verified_at fields are never touched here: attested is attested.
  insert into public.contracting_ethos_approvals (
      intake_id, legal_first_name, legal_last_name, contact_confirmed_at, contact_confirmed_by, owner_name,
      approved_comp_level, approved_advance_tier, approved_upline_npn, approved_sub_agency, approved_sub_agent_head,
      comp_grid_version, approved_by, approved_at, note, evidence_mode, attested_by, attested_at, license_attested, eo_attested, updated_by)
  values (
      v_intake, v_first, v_last, now(), v_uid, coalesce(v_actor_name, 'Galaxy'),
      -- Direct Upline's Personal NPN on MGN's "Apex financial / Ethos" sheet is the MANAGER's own NPN (there is no
      -- sub-agency column to carry the manager); the principal is only the fallback for a manager without one.
      v_level, '6 Month Advance', coalesce(nullif(regexp_replace(coalesce(v_upline_npn, ''), '\D', '', 'g'), ''), public.fn_ethos_principal_npn()), v_label, v_head,
      'Comp grid as of 7/8/26', coalesce(v_uid, '00000000-0000-0000-0000-000000000000'::uuid), now(),
      'MP-304 ' || v_source || ' by ' || coalesce(v_actor_name, 'service') || coalesce(' · ' || v_reason, ''),
      'attested', v_uid, now(), true, v_eo, v_uid)
  on conflict (intake_id) do update set
      legal_first_name = excluded.legal_first_name, legal_last_name = excluded.legal_last_name,
      contact_confirmed_at = now(), contact_confirmed_by = excluded.contact_confirmed_by, owner_name = excluded.owner_name,
      approved_comp_level = excluded.approved_comp_level, approved_advance_tier = excluded.approved_advance_tier,
      approved_upline_npn = excluded.approved_upline_npn, approved_sub_agency = excluded.approved_sub_agency,
      approved_sub_agent_head = excluded.approved_sub_agent_head, comp_grid_version = excluded.comp_grid_version,
      approved_by = excluded.approved_by, approved_at = now(), note = excluded.note,
      evidence_mode = case when public.contracting_ethos_approvals.evidence_mode = 'verified' and public.contracting_ethos_approvals.npn_verified_at is not null then 'verified' else 'attested' end,
      attested_by = excluded.attested_by, attested_at = now(), license_attested = true, eo_attested = excluded.eo_attested,
      updated_at = now(), updated_by = excluded.updated_by;
  if v_existing is not null then
    update public.contracting_ethos_approvals set agent_id = v_existing
     where intake_id = v_intake and agent_id is null
       and not exists (select 1 from public.contracting_ethos_approvals x where x.agent_id = v_existing and x.intake_id is distinct from v_intake);
    -- Comp on the roster, recorded with actor and reason (history trigger captures before/after).
    insert into public.agent_contract_levels (agent_id, contract_pct, source, note, set_by, effective_from, updated_at)
    values (v_existing, v_pct, case when v_admin then 'admin_ui' else 'manager_ui' end,
            coalesce(v_reason, 'MP-304 downline contracting (' || v_source || ')'), v_uid, current_date, now())
    on conflict (agent_id) do update set
      contract_pct = excluded.contract_pct, source = excluded.source, note = excluded.note, set_by = excluded.set_by,
      effective_from = excluded.effective_from, updated_at = now()
    where public.agent_contract_levels.contract_pct is distinct from excluded.contract_pct;
    update public.agents set nipr_number = v_npn, nipr_verified = false, nipr_verified_at = null
     where id = v_existing and (nipr_number is null or btrim(nipr_number) = '');
    insert into public.contracting_case_events (agent_id, carrier_name, action, before, after, actor, source)
    values (v_existing, 'Ethos', 'update', jsonb_build_object('pct', v_existing_pct),
            jsonb_build_object('kind', 'downline_submitted', 'via', v_source, 'pct', v_pct, 'level', v_level, 'intake_id', v_intake, 'upline', v_upline), v_uid, 'staff');
  end if;

  return jsonb_build_object('ok', true, 'verdict', 'ok', 'dry_run', false,
    'intake_id', v_intake, 'agent_id', v_existing, 'replay', v_core->'replay', 'intake_status', v_core->>'status',
    'delivery', coalesce((select d.state from public.contracting_intake_deliveries d where d.intake_id = v_intake and d.destination = 'ethos_sheet'), case when (v_core->>'status') = 'needs_review' then 'manual_review' else 'queued' end),
    'upline_id', v_upline, 'upline_name', v_upline_name, 'sub_agency', v_label,
    'comp_pct', v_pct, 'level', v_level, 'advance', '6 Month Advance', 'request_type', v_rt,
    'email', v_email, 'phone', v_phone, 'npn', v_npn, 'review', v_review);
end $$;
revoke all on function public.submit_downline_contracting(jsonb, boolean) from public, anon;
grant execute on function public.submit_downline_contracting(jsonb, boolean) to authenticated, service_role;

-- ── H. After the edge function provisions the login/agent for a NEW person ─────────────────────────────
create or replace function public.fn_contracting_after_provision(p_intake uuid, p_agent uuid, p_source text default 'one_link')
returns jsonb language plpgsql security definer set search_path = public as $$
declare i record; v_cur numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select * into i from public.contracting_intakes where id = p_intake;
  if i.id is null then return jsonb_build_object('ok', false, 'error', 'intake_missing'); end if;
  update public.contracting_intakes set agent_id = coalesce(agent_id, p_agent), updated_at = now() where id = p_intake;
  update public.contracting_ethos_approvals set agent_id = p_agent
   where intake_id = p_intake and agent_id is null
     and not exists (select 1 from public.contracting_ethos_approvals x where x.agent_id = p_agent and x.intake_id is distinct from p_intake);
  select contract_pct into v_cur from public.agent_contract_levels where agent_id = p_agent;
  if i.comp_percentage is not null and (v_cur is null or v_cur is distinct from i.comp_percentage) then
    insert into public.agent_contract_levels (agent_id, contract_pct, source, note, set_by, effective_from, updated_at)
    values (p_agent, i.comp_percentage, 'manager_ui', 'MP-304 ' || p_source || ' (intake ' || p_intake::text || ')', i.submitted_by, current_date, now())
    on conflict (agent_id) do update set contract_pct = excluded.contract_pct, source = excluded.source, note = excluded.note,
      set_by = excluded.set_by, effective_from = excluded.effective_from, updated_at = now();
  end if;
  -- A brand-new agent goes under the upline that submitted them. An agent who already has a manager keeps it.
  if i.upline_agent_id is not null then
    update public.agents set manager_id = i.upline_agent_id, invited_by_manager_id = coalesce(invited_by_manager_id, i.upline_agent_id)
     where id = p_agent and (manager_id is null or manager_id = '7c3c5581-3544-437f-bfe2-91391afb217d') and manager_id is distinct from i.upline_agent_id
       and created_at > now() - interval '10 minutes';
  end if;
  insert into public.contracting_case_events (agent_id, carrier_name, action, before, after, actor, source)
  values (p_agent, 'Ethos', 'update', '{}'::jsonb, jsonb_build_object('kind', 'downline_provisioned', 'via', p_source, 'intake_id', p_intake, 'pct', i.comp_percentage, 'upline', i.upline_agent_id), i.submitted_by, 'staff');
  return jsonb_build_object('ok', true, 'agent_id', p_agent, 'comp_pct', i.comp_percentage);
end $$;
revoke all on function public.fn_contracting_after_provision(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fn_contracting_after_provision(uuid, uuid, text) to service_role;

-- ── I. Update an agent (identity, comp) → Agent Updates tab ────────────────────────────────────────────
create or replace function public.update_downline_contracting(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.apex_is_admin(); v_actor uuid := public.fn_contracting_caller_agent(); v_uid uuid := auth.uid();
  v_agent uuid; a record; i record; cp record;
  v_first text; v_last text; v_email text; v_phone text; v_npn text; v_pct numeric; v_reason text; v_term boolean;
  v_cur_pct numeric; v_cap numeric; v_sugg text; v_changes text[] := '{}'; v_pii text[] := '{}';
  v_cur_first text; v_cur_last text; v_cur_npn text; v_cur_email text; v_cur_phone text;
  v_level text; v_update uuid; v_other text; v_review jsonb := '[]'::jsonb;
begin
  v_agent := nullif(p->>'agent_id', '')::uuid;
  if v_agent is null then return jsonb_build_object('ok', false, 'field', 'agent_id', 'message', 'agent_id is required.'); end if;
  if not public.fn_contracting_scope_ok(v_agent) then return jsonb_build_object('ok', false, 'field', 'agent_id', 'message', 'That agent is not in your downline.'); end if;
  select ag.* into a from public.agents ag where ag.id = v_agent;
  if a.id is null then return jsonb_build_object('ok', false, 'field', 'agent_id', 'message', 'No such agent.'); end if;
  select * into i from public.contracting_intakes ci where ci.agent_id = v_agent order by created_at desc limit 1;
  select * into cp from public.agent_contract_profile where agent_id = v_agent;

  v_cur_first := coalesce(cp.first_name, i.first_name, split_part(a.display_name, ' ', 1));
  v_cur_last  := coalesce(cp.last_name, i.last_name, nullif(regexp_replace(a.display_name, '^\S+\s*', ''), ''));
  v_cur_npn   := coalesce(nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), ''), i.npn);
  v_cur_email := coalesce(cp.email, i.email, (select lower(email) from public.profiles where user_id = a.user_id limit 1), (select lower(email) from public.profiles where id = a.profile_id limit 1));
  v_cur_phone := coalesce(i.phone_e164, public.fn_normalize_contracting_phone((select phone from public.profiles where user_id = a.user_id limit 1)));
  select contract_pct into v_cur_pct from public.agent_contract_levels where agent_id = v_agent;

  v_first := nullif(btrim(coalesce(p->>'first_name', '')), '');
  v_last  := nullif(btrim(coalesce(p->>'last_name', '')), '');
  v_email := case when nullif(btrim(coalesce(p->>'email', '')), '') is null then null else public.fn_normalize_contracting_email(p->>'email') end;
  v_phone := case when nullif(btrim(coalesce(p->>'phone', '')), '') is null then null else public.fn_normalize_contracting_phone(p->>'phone') end;
  v_npn   := case when nullif(btrim(coalesce(p->>'npn', '')), '') is null then null else public.fn_normalize_contracting_npn(p->>'npn') end;
  v_pct   := nullif(p->>'comp_pct', '')::numeric;
  v_reason := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_term := v_admin and coalesce((p->>'terminate')::boolean, false);

  if nullif(btrim(coalesce(p->>'email', '')), '') is not null and (v_email is null or v_email not like '%_@_%.__%') then
    return jsonb_build_object('ok', false, 'field', 'email', 'message', 'Enter a valid email address.');
  end if;
  if v_email is not null then
    v_sugg := public.fn_email_typo_suggestion(v_email);
    if v_sugg is not null then return jsonb_build_object('ok', false, 'field', 'email', 'message', 'That email domain looks mistyped.', 'suggestion', v_sugg); end if;
  end if;
  if nullif(btrim(coalesce(p->>'phone', '')), '') is not null and v_phone is null then
    return jsonb_build_object('ok', false, 'field', 'phone', 'message', 'Enter a 10-digit US mobile number.');
  end if;
  if nullif(btrim(coalesce(p->>'npn', '')), '') is not null and (v_npn is null or v_npn !~ '^[0-9]{5,10}$') then
    return jsonb_build_object('ok', false, 'field', 'npn', 'message', 'An NPN is 5 to 10 digits.');
  end if;
  if v_npn is not null and v_npn is distinct from v_cur_npn then
    select display_name into v_other from public.agents x where x.nipr_number = v_npn and x.id <> v_agent and x.status <> 'terminated' and not coalesce(x.is_deactivated, false) limit 1;
    if v_other is not null then return jsonb_build_object('ok', false, 'field', 'npn', 'message', 'That NPN already belongs to ' || v_other || '.'); end if;
    if exists (select 1 from public.contracting_intakes x where x.npn = v_npn and x.agent_id is distinct from v_agent) then
      return jsonb_build_object('ok', false, 'field', 'npn', 'message', 'That NPN is already on another contracting record.');
    end if;
  end if;
  if v_pct is not null then
    if v_pct < 60 or v_pct > 135 or v_pct <> round(v_pct / 5) * 5 then
      return jsonb_build_object('ok', false, 'field', 'comp_pct', 'message', 'Comp must be a multiple of 5 between 60 and 135 (Level 12 to Level 27).');
    end if;
    v_cap := public.fn_contracting_comp_cap(v_actor);
    if v_cap is not null and v_pct > v_cap then
      return jsonb_build_object('ok', false, 'field', 'comp_pct', 'message', 'You can set up to ' || v_cap::text || '% (your own level).', 'cap_pct', v_cap);
    end if;
    if v_pct is distinct from v_cur_pct and v_reason is null then
      return jsonb_build_object('ok', false, 'field', 'reason', 'message', 'A reason is required to change a comp level.');
    end if;
  end if;
  if v_term and v_reason is null then return jsonb_build_object('ok', false, 'field', 'reason', 'message', 'A reason is required for a termination.'); end if;

  -- Apply identity changes to the contracting truth (never to the login email).
  if (v_first is not null and v_first is distinct from v_cur_first) or (v_last is not null and v_last is distinct from v_cur_last) then
    v_changes := array_append(v_changes, 'name');
    v_pii := array_append(v_pii, ('Name: ' || coalesce(v_first, v_cur_first) || ' ' || coalesce(v_last, v_cur_last)));
  end if;
  if v_email is not null and v_email is distinct from v_cur_email then v_changes := array_append(v_changes, 'email'); v_pii := array_append(v_pii, ('Email: ' || v_email)); end if;
  if v_phone is not null and v_phone is distinct from v_cur_phone then v_changes := array_append(v_changes, 'phone'); v_pii := array_append(v_pii, ('Mobile: ' || '(' || substr(v_phone, 3, 3) || ') ' || substr(v_phone, 6, 3) || '-' || substr(v_phone, 9, 4))); end if;
  if v_npn is not null and v_npn is distinct from v_cur_npn then v_changes := array_append(v_changes, 'npn'); v_pii := array_append(v_pii, ('NPN: ' || v_npn || ' (was ' || coalesce(v_cur_npn, 'blank') || ')')); end if;
  if v_pct is not null and v_pct is distinct from v_cur_pct then v_changes := array_append(v_changes, 'comp'); end if;
  if v_term then v_changes := array_append(v_changes, 'termination'); end if;
  if array_length(v_changes, 1) is null then return jsonb_build_object('ok', false, 'field', 'form', 'message', 'Nothing changed.'); end if;

  insert into public.agent_contract_profile (agent_id, first_name, last_name, email, source, updated_by, updated_at)
  values (v_agent, coalesce(v_first, v_cur_first), coalesce(v_last, v_cur_last), coalesce(v_email, v_cur_email), 'staff', v_uid, now())
  on conflict (agent_id) do update set
    first_name = coalesce(v_first, public.agent_contract_profile.first_name),
    last_name = coalesce(v_last, public.agent_contract_profile.last_name),
    email = coalesce(v_email, public.agent_contract_profile.email),
    updated_by = v_uid, updated_at = now();
  if i.id is not null then
    update public.contracting_intakes set
      first_name = coalesce(v_first, first_name), last_name = coalesce(v_last, last_name),
      email = coalesce(v_email, email), phone_e164 = coalesce(v_phone, phone_e164),
      npn = coalesce(v_npn, npn), updated_at = now()
    where id = i.id;
  end if;
  if v_npn is not null and v_npn is distinct from v_cur_npn then
    update public.agents set nipr_number = v_npn, nipr_verified = false, nipr_verified_at = null where id = v_agent;
  end if;
  if v_pct is not null and v_pct is distinct from v_cur_pct then
    insert into public.agent_contract_levels (agent_id, contract_pct, source, note, set_by, effective_from, updated_at)
    values (v_agent, v_pct, case when v_admin then 'admin_ui' else 'manager_ui' end, v_reason, v_uid, current_date, now())
    on conflict (agent_id) do update set contract_pct = excluded.contract_pct, source = excluded.source, note = excluded.note,
      set_by = excluded.set_by, effective_from = excluded.effective_from, updated_at = now();
    v_level := public.fn_ethos_level_for_pct(v_pct);
  end if;

  -- Queue the Agent Updates row (A:C identity after the change; D:H only the changes).
  v_cur_npn := coalesce(v_npn, v_cur_npn);
  if v_cur_npn is null then
    return jsonb_build_object('ok', true, 'update_id', null, 'changes', to_jsonb(v_changes), 'queued', false,
      'message', 'Saved on the roster. Not sent to Ethos: the agent has no NPN on file yet.');
  end if;
  insert into public.contracting_agent_updates (agent_id, intake_id, npn, first_name, last_name, change_comp_level, change_pii,
      termination_requested, termination_authorized_by, termination_authorized_at, reason, requested_by)
  values (v_agent, i.id, v_cur_npn, coalesce(v_first, v_cur_first), coalesce(v_last, v_cur_last), v_level,
      nullif(array_to_string(v_pii, '; '), ''), v_term, case when v_term then v_uid end, case when v_term then now() end, v_reason, v_uid)
  returning id into v_update;
  insert into public.outbox_events (aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key)
  values ('contracting_update', v_update, 'contracting_update_requested', 'ethos_updates',
          jsonb_build_object('update_id', v_update, 'agent_id', v_agent), 'contracting-update-' || v_update::text)
  on conflict (idempotency_key) do nothing;
  insert into public.contracting_case_events (agent_id, carrier_name, action, before, after, actor, source)
  values (v_agent, 'Ethos', 'update',
          jsonb_build_object('pct', v_cur_pct, 'npn', nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), ''), 'email', v_cur_email, 'phone', v_cur_phone),
          jsonb_build_object('kind', 'downline_updated', 'pct', coalesce(v_pct, v_cur_pct), 'npn', v_cur_npn, 'email', coalesce(v_email, v_cur_email), 'phone', coalesce(v_phone, v_cur_phone), 'changes', v_changes, 'update_id', v_update, 'via', 'manager_portal'),
          v_uid, 'staff');
  return jsonb_build_object('ok', true, 'update_id', v_update, 'changes', to_jsonb(v_changes), 'queued', true, 'level', v_level);
end $$;
revoke all on function public.update_downline_contracting(jsonb) from public, anon;
grant execute on function public.update_downline_contracting(jsonb) to authenticated;

-- ── J. The one link: a manager's MGN referral URL, host-allowlisted ────────────────────────────────────
create or replace function public.set_my_mgn_link(p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.fn_contracting_caller_agent(); v_url text := btrim(coalesce(p_url, '')); v_slug text; v_mgr boolean;
begin
  select coalesce(is_manager, false), ref_slug into v_mgr, v_slug from public.agents where id = v_actor;
  if v_actor is null or not (v_mgr or public.apex_is_admin()) then return jsonb_build_object('ok', false, 'error', 'Managers only.'); end if;
  if v_url = '' then
    delete from public.contracting_links where manager_id = v_actor and name = 'mgn_referral';
    return jsonb_build_object('ok', true, 'url', null, 'join_path', '/contract/' || v_slug);
  end if;
  -- Only MGN. Anything else would make the join page an open redirector wearing our domain.
  if v_url !~ '^https://(www\.)?mgnagenthub\.com(/[^\s]*)?$' or length(v_url) > 500 then
    return jsonb_build_object('ok', false, 'field', 'url', 'error', 'Paste your MGN Agent Hub link (it starts with https://mgnagenthub.com/).');
  end if;
  insert into public.contracting_links (manager_id, name, url) values (v_actor, 'mgn_referral', v_url)
  on conflict (manager_id, name) do update set url = excluded.url;
  return jsonb_build_object('ok', true, 'url', v_url, 'join_path', '/contract/' || v_slug);
end $$;
revoke all on function public.set_my_mgn_link(text) from public, anon;
grant execute on function public.set_my_mgn_link(text) to authenticated;

create or replace function public.fn_contract_link_target(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_url text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  select ag.id, ag.display_name, ag.ref_slug, ag.nipr_number into a from public.agents ag
   where ag.ref_slug = lower(btrim(coalesce(p_slug, ''))) and ag.status = 'active' and not coalesce(ag.is_deactivated, false)
     and (coalesce(ag.is_manager, false) or exists (select 1 from public.user_roles ur where ur.user_id = ag.user_id and ur.role::text in ('admin', 'super_admin', 'owner')));
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'no_such_link'); end if;
  select url into v_url from public.contracting_links where manager_id = a.id and name = 'mgn_referral' limit 1;
  if v_url is not null and v_url !~ '^https://(www\.)?mgnagenthub\.com(/[^\s]*)?$' then v_url := null; end if;
  return jsonb_build_object('ok', true, 'manager_agent_id', a.id, 'manager_name', a.display_name, 'slug', a.ref_slug,
    'sub_agency', public.fn_contracting_sub_agency_label(a.id),
    'redirect_url', coalesce(v_url, 'https://mgnagenthub.com/dashboard'), 'custom_link', v_url is not null);
end $$;
revoke all on function public.fn_contract_link_target(text) from public, anon, authenticated;
grant execute on function public.fn_contract_link_target(text) to service_role;

-- ── K. The downline board ──────────────────────────────────────────────────────────────────────────────
create or replace function public.my_contracting_downlines()
returns table (
  agent_id uuid, intake_id uuid, display_name text, first_name text, last_name text, email text, phone text, npn text,
  agent_status text, manager_id uuid, manager_name text, comp_pct numeric, comp_source text, ethos_level text,
  intake_status text, ethos_state text, ethos_note text, ethos_delivered_at timestamptz,
  on_sheet boolean, sheet_level text, sheet_sub_agency text, sheet_row integer,
  last_update_status text, last_update_at timestamptz
) language sql stable security definer set search_path = public as $$
  with caller as (select public.fn_contracting_caller_agent() as id, public.apex_is_admin() as admin),
  scope as (
    select a.id from public.agents a, caller c where c.admin and a.status = 'active' and not coalesce(a.is_deactivated, false)
    union
    select h.member from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h where c.id is not null
  ),
  snap as (select id from public.ethos_sheet_snapshots where status = 'complete' order by fetched_at desc limit 1),
  lvl as (select s.id as agent_id, l.pct, l.provenance from scope s cross join lateral public.fn_agent_contract_pct(s.id) l),
  ik as (select distinct on (ci.agent_id) ci.* from public.contracting_intakes ci where ci.agent_id is not null order by ci.agent_id, ci.created_at desc),
  upd as (select distinct on (u.agent_id) u.agent_id, u.status, u.created_at from public.contracting_agent_updates u order by u.agent_id, u.created_at desc)
  select
    a.id, ik.id, a.display_name,
    coalesce(cp.first_name, ik.first_name), coalesce(cp.last_name, ik.last_name),
    coalesce(cp.email, ik.email, lower(pu.email), lower(pp.email)),
    coalesce(ik.phone_e164, pu.phone, pp.phone),
    coalesce(nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), ''), ik.npn),
    a.status::text, a.manager_id, coalesce(mp.full_name, m.display_name),
    lvl.pct, lvl.provenance, case when lvl.pct is null then null else public.fn_ethos_level_for_pct(lvl.pct) end,
    ik.status, d.state, d.last_error_redacted, d.delivered_at,
    -- on_sheet = WE wrote it to MGN's sheet and read it back (receipt written=true); the Level 8 mirror is history.
    coalesce((d.receipt->>'written') = 'true', false) or (r.row_number is not null), coalesce((d.receipt->>'layout'), r.comp_level), r.sub_agency, coalesce((d.receipt->>'row')::int, r.row_number),
    upd.status, upd.created_at
  from scope s
  join public.agents a on a.id = s.id and a.status <> 'terminated' and not coalesce(a.is_deactivated, false)
  left join lvl on lvl.agent_id = a.id
  left join ik on ik.agent_id = a.id
  left join public.contracting_intake_deliveries d on d.intake_id = ik.id and d.destination = 'ethos_sheet'
  left join public.agent_contract_profile cp on cp.agent_id = a.id
  left join public.profiles pu on pu.user_id = a.user_id
  left join public.profiles pp on pp.id = a.profile_id
  left join public.agents m on m.id = a.manager_id
  left join public.profiles mp on mp.id = m.profile_id
  left join snap on true
  left join lateral (
    select er.row_number, er.comp_level, er.sub_agency from public.ethos_sheet_rows er
    where er.snapshot_id = snap.id and er.npn = coalesce(nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), ''), ik.npn)
    order by er.row_number limit 1) r on true
  left join upd on upd.agent_id = a.id
  union all
  -- Intakes submitted under a manager in scope that have no agent row yet (a provisioning failure to look at).
  select null, ci.id, ci.first_name || ' ' || ci.last_name, ci.first_name, ci.last_name, ci.email, ci.phone_e164, ci.npn,
    'intake_only', ci.upline_agent_id, u.display_name, ci.comp_percentage, 'intake',
    case when ci.comp_percentage is null then null else public.fn_ethos_level_for_pct(ci.comp_percentage) end,
    ci.status, d.state, d.last_error_redacted, d.delivered_at, false, null, null, null, null, null
  from public.contracting_intakes ci
  join scope s on s.id = ci.upline_agent_id
  join public.agents u on u.id = ci.upline_agent_id
  left join public.contracting_intake_deliveries d on d.intake_id = ci.id and d.destination = 'ethos_sheet'
  where ci.agent_id is null and ci.upline_agent_id is not null
  order by 3;
$$;
revoke all on function public.my_contracting_downlines() from public, anon;
grant execute on function public.my_contracting_downlines() to authenticated;

-- ── L. Lane health: exactly one row in every state (never blank-green) ─────────────────────────────────
create or replace view public.v_contracting_ethos_lane_health as
select
  coalesce((select value = 'true' from public.system_settings where key = 'ethos_sheet_writes_enabled' limit 1), false) as writes_enabled,
  public.fn_contracting_default_comp_pct() as default_comp_pct,
  public.fn_ethos_level_for_pct(public.fn_contracting_default_comp_pct()) as default_level,
  (select nullif(btrim(value), '') from public.system_settings where key = 'contracting_default_advance' limit 1) as default_advance_setting,
  (select count(*) from public.contracting_intake_deliveries where destination = 'ethos_sheet' and state = 'queued') as signup_queued,
  (select count(*) from public.contracting_intake_deliveries where destination = 'ethos_sheet' and state = 'attempting') as signup_attempting,
  (select count(*) from public.contracting_intake_deliveries where destination = 'ethos_sheet' and state = 'manual_review') as signup_manual_review,
  (select count(*) from public.contracting_intake_deliveries where destination = 'ethos_sheet' and state = 'not_configured' and updated_at > now() - interval '7 days') as signup_not_configured_7d,
  (select count(*) from public.contracting_intake_deliveries where destination = 'ethos_sheet' and state = 'delivered' and delivered_at > now() - interval '7 days') as signup_delivered_7d,
  (select count(*) from public.contracting_intake_deliveries where destination = 'ethos_sheet' and state = 'delivered' and delivered_at > now() - interval '7 days' and (receipt->>'written') = 'true') as signup_written_7d,
  (select count(*) from public.contracting_agent_updates where status = 'queued') as updates_queued,
  (select count(*) from public.contracting_agent_updates where status in ('manual_review', 'not_configured', 'failed', 'dead_letter', 'unknown_outcome')) as updates_needing_attention,
  (select count(*) from public.contracting_agent_updates where status = 'delivered' and delivered_at > now() - interval '7 days') as updates_delivered_7d,
  (select max(fetched_at) from public.ethos_sheet_snapshots where status = 'complete') as sheet_mirror_at,
  (select count(*) from public.contracting_links where name = 'mgn_referral') as managers_with_mgn_link,
  (select count(*) from public.agents where is_manager and status = 'active' and not coalesce(is_deactivated, false)) as active_managers,
  (select bool_or(last_error_redacted ilike '%No Google service credential%') from public.contracting_intake_deliveries where destination = 'ethos_sheet' and updated_at > now() - interval '7 days') as credential_missing_seen_7d,
  now() as measured_at;
revoke all on public.v_contracting_ethos_lane_health from public, anon;
grant select on public.v_contracting_ethos_lane_health to authenticated, service_role;
