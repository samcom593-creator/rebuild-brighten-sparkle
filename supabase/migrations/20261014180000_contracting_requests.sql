-- Contracting requests: the 14-column carrier/IMO contracting template, filled from verified records, plus the
-- "who opened the contracting link" screen for My Team (Sam, 2026-10-14).
--
-- What this adds, and why each piece exists:
--   agent_contract_profile.dob / address_*   the only honest source for DOB and residential address is the agent.
--                                            They are entered once on /dashboard/contracting-profile; nothing else
--                                            in the system holds them (no column anywhere did before this).
--   contracting_link_opens                   one row per agent who opened the contracting link; the My Team screen
--                                            lists openers in order and the active agents who never opened it.
--   contracting_requests (+ events)          one immutable snapshot per submitted request; the application is the
--                                            record, the Google Sheet is a destination. Status and sheet-sync state
--                                            are separate columns on purpose: a queued write is not a synced one.
--   fn_contracting_request_row / _eval       ONE mapping used by the dashboard, the export and the submit path, so
--                                            they cannot drift. Every value carries its source; missing fields name
--                                            an owner and a next action. No value is invented: no agency fields are
--                                            assumed, no names are split from a display name, and the advance is
--                                            unresolved until an admin approves the default or sets it per request.
--   Level is a percentage text ("130%") built from a numeric; it is never the advance and never scaled.

-- ── 1. The agent's own details (DOB, residential address) ────────────────────────────────────────────────────
alter table public.agent_contract_profile
  add column if not exists dob date,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists zip text;
alter table public.agent_contract_profile drop constraint if exists agent_contract_profile_zip_check;
alter table public.agent_contract_profile add constraint agent_contract_profile_zip_check
  check (zip is null or zip ~ '^[0-9]{5}(-[0-9]{4})?$');
alter table public.agent_contract_profile drop constraint if exists agent_contract_profile_dob_check;
alter table public.agent_contract_profile add constraint agent_contract_profile_dob_check
  check (dob is null or dob > date '1900-01-01');

alter table public.contract_review_events drop constraint if exists contract_review_events_event_type_check;
alter table public.contract_review_events add constraint contract_review_events_event_type_check
  check (event_type = any (array['marked','cleared','level_set','level_cleared','intake_saved','details_saved']));

create or replace function public.save_my_contracting_details(p_dob date, p_address1 text, p_address2 text, p_city text, p_zip text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_agent uuid;
  v_a1 text := nullif(btrim(coalesce(p_address1, '')), '');
  v_a2 text := nullif(btrim(coalesce(p_address2, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_zip text := nullif(btrim(coalesce(p_zip, '')), '');
  v_version integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  begin
    v_agent := public.fn_contract_review_my_agent();
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'field', 'agent', 'error', 'More than one profile is linked to your login. Ask staff to merge them first.');
  end;
  if v_agent is null then return jsonb_build_object('ok', false, 'field', 'agent', 'error', 'No agent profile is linked to your login yet.'); end if;
  if p_dob is not null and (p_dob <= date '1900-01-01' or p_dob > (current_date - interval '16 years')::date) then
    return jsonb_build_object('ok', false, 'field', 'dob', 'error', 'Enter your real date of birth.');
  end if;
  if v_zip is not null and v_zip !~ '^[0-9]{5}(-[0-9]{4})?$' then
    return jsonb_build_object('ok', false, 'field', 'zip', 'error', 'ZIP is 5 digits (or ZIP+4).');
  end if;
  if (v_a1 is not null and char_length(v_a1) > 120) or (v_a2 is not null and char_length(v_a2) > 120) or (v_city is not null and char_length(v_city) > 80) then
    return jsonb_build_object('ok', false, 'field', 'address', 'error', 'That address is too long.');
  end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;
  perform pg_advisory_xact_lock(hashtextextended(v_agent::text || ':profile', 7));
  insert into public.agent_contract_profile (agent_id, source, updated_by, updated_at, dob, address_line1, address_line2, city, zip)
    values (v_agent, 'self', auth.uid(), now(), p_dob, v_a1, v_a2, v_city, v_zip)
    on conflict (agent_id) do update
      set dob = excluded.dob, address_line1 = excluded.address_line1, address_line2 = excluded.address_line2,
          city = excluded.city, zip = excluded.zip, updated_by = excluded.updated_by, updated_at = now();
  -- The event records WHAT changed, never the values: DOB and address are restricted fields.
  insert into public.contract_review_events (agent_id, version, event_type, detail, acted_by)
    values (v_agent, v_version, 'details_saved',
            jsonb_build_object('dob_set', p_dob is not null, 'address_set', v_a1 is not null and v_city is not null and v_zip is not null, 'source', 'self'), auth.uid());
  return jsonb_build_object('ok', true, 'agent_id', v_agent);
end;
$$;
revoke all on function public.save_my_contracting_details(date, text, text, text, text) from public, anon;
grant execute on function public.save_my_contracting_details(date, text, text, text, text) to authenticated;

create or replace function public.get_my_contracting_profile()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_agent uuid; v jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  begin
    v_agent := public.fn_contract_review_my_agent();
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'error', 'More than one profile is linked to your login. Ask staff to merge them first.');
  end;
  if v_agent is null then return jsonb_build_object('ok', false, 'error', 'No agent profile is linked to your login yet.'); end if;
  select jsonb_build_object('ok', true, 'agent_id', a.id,
           'npn', a.nipr_number,
           'first_name', coalesce(cp.first_name, nullif(split_part(coalesce(pu.full_name, pp.full_name, a.display_name, ''), ' ', 1), '')),
           'last_name', coalesce(cp.last_name, nullif(btrim(substr(coalesce(pu.full_name, pp.full_name, a.display_name, ''), length(split_part(coalesce(pu.full_name, pp.full_name, a.display_name, ''), ' ', 1)) + 1)), '')),
           'email', coalesce(cp.email, pu.email, pp.email),
           'resident_state', coalesce(cp.resident_state, case when length(btrim(coalesce(pu.state, pp.state, ''))) = 2 then upper(btrim(coalesce(pu.state, pp.state))) end),
           'saved', cp.agent_id is not null,
           'dob', cp.dob, 'address_line1', cp.address_line1, 'address_line2', cp.address_line2, 'city', cp.city, 'zip', cp.zip,
           'details_saved', cp.dob is not null and cp.address_line1 is not null and cp.city is not null and cp.zip is not null)
    into v from public.agents a
    left join public.agent_contract_profile cp on cp.agent_id = a.id
    left join public.profiles pu on pu.user_id = a.user_id
    left join public.profiles pp on pp.id = a.profile_id
   where a.id = v_agent;
  return v;
end;
$$;

-- ── 2. Who opened the contracting link ───────────────────────────────────────────────────────────────────────
create table if not exists public.contracting_link_opens (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  opens integer not null default 1
);
alter table public.contracting_link_opens enable row level security;

create or replace function public.record_contracting_link_open()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_agent uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  begin
    v_agent := public.fn_contract_review_my_agent();
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false);
  end;
  if v_agent is null then return jsonb_build_object('ok', false); end if;
  insert into public.contracting_link_opens (agent_id) values (v_agent)
    on conflict (agent_id) do update set last_opened_at = now(), opens = public.contracting_link_opens.opens + 1;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.record_contracting_link_open() from public, anon;
grant execute on function public.record_contracting_link_open() to authenticated;

-- ── 3. Requests: immutable snapshots, lifecycle separate from sheet sync ──────────────────────────────────────
create table if not exists public.contracting_requests (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  request_type text not null default 'contracting' check (request_type in ('contracting')),
  status text not null check (status in ('draft','missing_information','needs_review','ready_to_submit','submitted','approved','declined','archived')),
  advance text,
  batch text,
  version integer not null default 1,
  snapshot jsonb not null,
  submitted_at timestamptz,
  submitted_by uuid,
  sheet_status text not null default 'queued' check (sheet_status in ('queued','processing','synced','failed','not_configured')),
  sheet_row integer,
  sheet_range text,
  sheet_error text,
  sheet_attempts integer not null default 0,
  sheet_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open request per agent per request type. Declined and archived ones leave the way clear for a new version.
create unique index if not exists contracting_requests_one_open_per_agent
  on public.contracting_requests (agent_id, request_type) where status in ('draft','missing_information','needs_review','ready_to_submit','submitted','approved');
create index if not exists contracting_requests_sheet_queue on public.contracting_requests (sheet_status, updated_at);
alter table public.contracting_requests enable row level security;

create table if not exists public.contracting_request_events (
  id bigserial primary key,
  request_id uuid references public.contracting_requests(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  acted_by uuid,
  created_at timestamptz not null default now()
);
alter table public.contracting_request_events enable row level security;
drop trigger if exists trg_contracting_request_events_append_only on public.contracting_request_events;
create trigger trg_contracting_request_events_append_only before update or delete on public.contracting_request_events
  for each row execute function public.fn_append_only_guard();

insert into public.system_settings (key, value) values ('contracting_requests_sheet', '1TWXfq57Dm9yal-H0YXoDVF60aiFluOV0EuBlH7VSeS8') on conflict (key) do nothing;
insert into public.system_settings (key, value) values ('contracting_requests_sheet_tab', 'Sheet1') on conflict (key) do nothing;

-- ── 4. The one mapping ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_contracting_request_row(p_agent uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with a as (
    select a.id, a.display_name, a.nipr_number, a.nipr_verified, a.manager_id, a.start_date, a.user_id, a.profile_id, a.source_application_id
      from public.agents a where a.id = p_agent
  ),
  cp as (select * from public.agent_contract_profile where agent_id = p_agent),
  pu as (select p.full_name, p.email, p.phone from public.profiles p, a where p.user_id = a.user_id),
  pp as (select p.full_name, p.email, p.phone from public.profiles p, a where p.id = a.profile_id),
  app as (select ap.first_name, ap.last_name, ap.email, ap.phone, ap.nipr_number from public.applications ap, a where ap.id = a.source_application_id),
  lvl as (select l.pct, l.provenance from public.fn_agent_contract_pct(p_agent) l),
  mgr as (select m.id, coalesce(mp.full_name, m.display_name) as name
            from a join public.agents m on m.id = a.manager_id left join public.profiles mp on mp.id = m.profile_id),
  req as (select r.* from public.contracting_requests r
           where r.agent_id = p_agent and r.status not in ('archived','declined') order by r.created_at desc limit 1),
  adv as (select nullif(btrim(s.value), '') as v from public.system_settings s where s.key = 'contracting_default_advance'),
  ph as (select regexp_replace(coalesce((select phone from pu), (select phone from pp), (select phone from app), ''), '\D', '', 'g') as digits,
                case when (select phone from pu) is not null or (select phone from pp) is not null then 'profile'
                     when (select phone from app) is not null then 'application' end as src),
  ten as (select case when length(digits) = 11 and left(digits, 1) = '1' then substr(digits, 2) when length(digits) = 10 then digits end as d, src from ph)
  select jsonb_build_object(
    'agent_id', a.id,
    'display_name', coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)'),
    'start_date', a.start_date,
    'request_type', 'contracting',
    'first_name', coalesce(cp.first_name, app.first_name),
    'first_name_source', case when cp.first_name is not null then 'agent' when app.first_name is not null then 'application' end,
    'last_name', coalesce(cp.last_name, app.last_name),
    'last_name_source', case when cp.last_name is not null then 'agent' when app.last_name is not null then 'application' end,
    'npn', coalesce(nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(app.nipr_number, ''), '\D', '', 'g'), '')),
    'npn_source', case when nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), '') is not null then (case when a.nipr_verified then 'agent record (verified)' else 'agent record' end)
                       when nullif(regexp_replace(coalesce(app.nipr_number, ''), '\D', '', 'g'), '') is not null then 'application' end,
    'email', coalesce(cp.email, pu.email, pp.email, app.email),
    'email_source', case when cp.email is not null then 'agent' when coalesce(pu.email, pp.email) is not null then 'profile' when app.email is not null then 'application' end,
    'agency_name', null, 'agency_tin', null, 'agency_npn', null, 'agency_applicability', 'not_established',
    'direct_upline', mgr.name, 'direct_upline_id', mgr.id, 'direct_upline_source', case when mgr.id is not null then 'agent record (manager)' end,
    'commission_level_pct', lvl.pct,
    'commission_level', case when lvl.pct is not null then rtrim(rtrim(lvl.pct::text, '0'), '.') || '%' end,
    'commission_level_source', lvl.provenance,
    'advance', coalesce(req.advance, adv.v),
    'advance_source', case when req.advance is not null then 'request' when adv.v is not null then 'approved default' end,
    'dob', cp.dob,
    'residential_address', case when cp.address_line1 is not null and cp.city is not null and cp.resident_state is not null and cp.zip is not null
                                then concat_ws(', ', cp.address_line1, cp.address_line2, cp.city, cp.resident_state || ' ' || cp.zip) end,
    'residential_state', cp.resident_state,
    'phone', case when ten.d is not null then '(' || substr(ten.d, 1, 3) || ') ' || substr(ten.d, 4, 3) || '-' || substr(ten.d, 7, 4) end,
    'phone_source', case when ten.d is not null then ten.src end,
    'request_id', req.id, 'request_status', req.status, 'request_version', req.version, 'submitted_at', req.submitted_at,
    'sheet_status', req.sheet_status, 'sheet_synced_at', req.sheet_synced_at, 'sheet_error', req.sheet_error, 'sheet_row', req.sheet_row,
    'snapshot', req.snapshot
  )
  from a
  left join cp on true left join pu on true left join pp on true left join app on true
  left join lvl on true left join mgr on true left join req on true left join adv on true left join ten on true;
$$;
revoke all on function public.fn_contracting_request_row(uuid) from public, anon, authenticated;

create or replace function public.fn_contracting_request_eval(p_agent uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  r jsonb; m text[] := '{}'; st text; na text; own text; k text;
begin
  r := public.fn_contracting_request_row(p_agent);
  if r is null then return null; end if;
  foreach k in array array['first_name','last_name','npn','email','direct_upline','commission_level','advance','dob','residential_address','phone'] loop
    if nullif(r->>k, '') is null then m := m || k; end if;
  end loop;
  if r->>'request_status' is not null then
    st := r->>'request_status';
  else
    st := case when cardinality(m) = 0 then 'ready_to_submit' else 'missing_information' end;
  end if;
  if st = 'submitted' then na := 'Waiting on the contracting team'; own := 'imo';
  elsif st = 'approved' then na := 'Approved. Nothing to do.'; own := 'none';
  elsif cardinality(m) = 0 then na := 'Submit the request'; own := 'admin';
  else
    k := m[1];
    na := case k
      when 'first_name' then 'Agent enters their legal name on the contracting link'
      when 'last_name' then 'Agent enters their legal name on the contracting link'
      when 'npn' then 'Agent adds their NPN on the contracting link'
      when 'email' then 'Agent confirms their email on the contracting link'
      when 'dob' then 'Agent adds their date of birth on the contracting link'
      when 'residential_address' then 'Agent adds their residential address on the contracting link'
      when 'phone' then 'Agent adds a phone number'
      when 'direct_upline' then 'Admin sets the manager on the agent record'
      when 'commission_level' then 'Admin sets the contract level on the review'
      when 'advance' then 'Admin approves the advance (default 6 month) on the Requests tab'
      else 'Resolve ' || k end;
    own := case when k in ('direct_upline','commission_level','advance') then 'admin' else 'agent' end;
  end if;
  return r || jsonb_build_object('missing', to_jsonb(m), 'status', st, 'next_action', na, 'owner', own);
end;
$$;
revoke all on function public.fn_contracting_request_eval(uuid) from public, anon, authenticated;

create or replace function public.contracting_request_rows()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_all boolean; v_rows jsonb; v_n integer;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  if not (v_all or public.has_role(v_uid, 'manager')) then raise exception 'not authorized' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x.e order by x.e->>'display_name'), '[]'::jsonb), count(*)
    into v_rows, v_n
    from (select public.fn_contracting_request_eval(p.agent_id) as e
            from public.fn_contract_review_population() p
           where v_all or public.apex_can_read_agent(p.agent_id)) x
   where x.e is not null;
  return jsonb_build_object(
    'ok', true, 'agents', v_n, 'rows', v_rows,
    'requests', (select count(*) from public.contracting_requests r where r.status not in ('archived','declined')
                   and exists (select 1 from public.fn_contract_review_population() p where p.agent_id = r.agent_id and (v_all or public.apex_can_read_agent(p.agent_id)))),
    'default_advance', (select nullif(btrim(value), '') from public.system_settings where key = 'contracting_default_advance'),
    'sheet', jsonb_build_object(
      'id', (select value from public.system_settings where key = 'contracting_requests_sheet'),
      'last_synced_at', (select max(sheet_synced_at) from public.contracting_requests),
      'queued', (select count(*) from public.contracting_requests where status = 'submitted' and sheet_status in ('queued','processing')),
      'failed', (select count(*) from public.contracting_requests where status = 'submitted' and sheet_status in ('failed','not_configured')),
      'last_error', (select sheet_error from public.contracting_requests where sheet_status in ('failed','not_configured') order by updated_at desc limit 1)));
end;
$$;
revoke all on function public.contracting_request_rows() from public, anon;
grant execute on function public.contracting_request_rows() to authenticated;

-- Submit: snapshot the 14 values as they are now. Readiness is checked here, not trusted from the screen.
create or replace function public.submit_contracting_request(p_agent_id uuid, p_advance text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_canon uuid; e jsonb; v_adv text; v_id uuid; v_existing record; v_snap jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not (public.apex_is_admin() or public.has_role(v_uid, 'manager')) then raise exception 'not authorized' using errcode = '42501'; end if;
  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not (public.apex_is_admin() or public.apex_can_read_agent(v_canon)) then raise exception 'not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.fn_contract_review_population() p where p.agent_id = v_canon) then
    return jsonb_build_object('ok', false, 'error', 'That person is not an active agent.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_canon::text || ':contracting_request', 7));
  select id, status into v_existing from public.contracting_requests
   where agent_id = v_canon and request_type = 'contracting' and status in ('submitted','approved') limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', 'A request is already ' || v_existing.status || ' for this agent.', 'request_id', v_existing.id);
  end if;
  v_adv := nullif(btrim(coalesce(p_advance, '')), '');
  if v_adv is not null and char_length(v_adv) > 40 then return jsonb_build_object('ok', false, 'field', 'advance', 'error', 'That advance text is too long.'); end if;
  e := public.fn_contracting_request_eval(v_canon);
  if v_adv is not null then e := e || jsonb_build_object('advance', v_adv, 'advance_source', 'request'); end if;
  if nullif(e->>'advance', '') is null then
    return jsonb_build_object('ok', false, 'missing', (e->'missing') || '["advance"]'::jsonb, 'error', 'The advance is not approved: approve the default or set it for this request.');
  end if;
  if jsonb_array_length(e->'missing') > 0 and not (jsonb_array_length(e->'missing') = 1 and e->'missing'->>0 = 'advance') then
    return jsonb_build_object('ok', false, 'missing', e->'missing', 'error', 'Not ready: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(e->'missing') x));
  end if;
  v_snap := jsonb_build_object(
    'request_type', 'contracting',
    'first_name', e->>'first_name', 'last_name', e->>'last_name', 'npn', e->>'npn', 'email', e->>'email',
    'agency_name', '', 'agency_tin', '', 'agency_npn', '',
    'direct_upline', e->>'direct_upline', 'commission_level', e->>'commission_level', 'advance', e->>'advance',
    'dob', e->>'dob', 'residential_address', e->>'residential_address', 'phone', e->>'phone',
    'sources', jsonb_build_object('first_name', e->>'first_name_source', 'last_name', e->>'last_name_source', 'npn', e->>'npn_source', 'email', e->>'email_source',
                                  'direct_upline', e->>'direct_upline_source', 'commission_level', e->>'commission_level_source', 'advance', e->>'advance_source', 'phone', e->>'phone_source'),
    'direct_upline_id', e->>'direct_upline_id', 'commission_level_pct', e->'commission_level_pct');
  insert into public.contracting_requests (agent_id, status, advance, snapshot, submitted_at, submitted_by, sheet_status)
    values (v_canon, 'submitted', e->>'advance', v_snap, now(), v_uid, 'queued')
    returning id into v_id;
  insert into public.contracting_request_events (request_id, event_type, detail, acted_by)
    values (v_id, 'submitted', jsonb_build_object('fields', 14, 'advance_source', e->>'advance_source'), v_uid);
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;
revoke all on function public.submit_contracting_request(uuid, text) from public, anon;
grant execute on function public.submit_contracting_request(uuid, text) to authenticated;

create or replace function public.set_contracting_request_status(p_request_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_row record;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_status not in ('approved','declined','archived') then return jsonb_build_object('ok', false, 'error', 'Status must be approved, declined or archived.'); end if;
  select * into v_row from public.contracting_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'No such request.'); end if;
  if v_row.status not in ('submitted','approved') then return jsonb_build_object('ok', false, 'error', 'Only a submitted request can change to ' || p_status || '.'); end if;
  update public.contracting_requests set status = p_status, updated_at = now() where id = p_request_id;
  insert into public.contracting_request_events (request_id, event_type, detail, acted_by)
    values (p_request_id, 'status_' || p_status, jsonb_build_object('from', v_row.status, 'note', left(coalesce(p_note, ''), 300)), v_uid);
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;
revoke all on function public.set_contracting_request_status(uuid, text, text) from public, anon;
grant execute on function public.set_contracting_request_status(uuid, text, text) to authenticated;

create or replace function public.set_contracting_default_advance(p_value text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.apex_is_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v is not null and char_length(v) > 40 then return jsonb_build_object('ok', false, 'error', 'Too long.'); end if;
  if v is null then
    delete from public.system_settings where key = 'contracting_default_advance';
  else
    insert into public.system_settings (key, value) values ('contracting_default_advance', v)
      on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  insert into public.contracting_request_events (request_id, event_type, detail, acted_by)
    values (null, 'default_advance_set', jsonb_build_object('value', v), v_uid);
  return jsonb_build_object('ok', true, 'default_advance', v);
end;
$$;
revoke all on function public.set_contracting_default_advance(text) from public, anon;
grant execute on function public.set_contracting_default_advance(text) to authenticated;

-- ── 5. My Team: who opened the link, in order, and who never did ─────────────────────────────────────────────
create or replace function public.contracting_link_activity()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_all boolean; v_version integer; v_rows jsonb; v_n integer; v_opened integer;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  if not (v_all or public.has_role(v_uid, 'manager')) then raise exception 'not authorized' using errcode = '42501'; end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;
  with pop as (
    select a.id, coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') as display_name, a.start_date
      from public.agents a
      join public.fn_contract_review_population() p on p.agent_id = a.id
      left join public.profiles pu on pu.user_id = a.user_id
      left join public.profiles pp on pp.id = a.profile_id
     where v_all or public.apex_can_read_agent(a.id)
  ), rows_ as (
    select jsonb_build_object(
      'agent_id', p.id, 'display_name', p.display_name, 'start_date', p.start_date,
      'opened', o.agent_id is not null, 'first_opened_at', o.first_opened_at, 'last_opened_at', o.last_opened_at, 'opens', coalesce(o.opens, 0),
      'profile_saved', cp.agent_id is not null and cp.first_name is not null and cp.last_name is not null and cp.email is not null and cp.resident_state is not null
                       and nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), '') is not null,
      'details_saved', cp.dob is not null and cp.address_line1 is not null and cp.city is not null and cp.zip is not null,
      'marked_count', (select count(*) from public.contract_review_marks m where m.agent_id = p.id and m.version = v_version),
      'request_status', (select r.status from public.contracting_requests r where r.agent_id = p.id and r.status not in ('archived','declined') order by r.created_at desc limit 1)
    ) as j, o.last_opened_at, p.start_date, p.display_name
    from pop p
    join public.agents a on a.id = p.id
    left join public.contracting_link_opens o on o.agent_id = p.id
    left join public.agent_contract_profile cp on cp.agent_id = p.id
  )
  select coalesce(jsonb_agg(j order by last_opened_at desc nulls last, start_date asc nulls last, display_name), '[]'::jsonb), count(*), count(*) filter (where last_opened_at is not null)
    into v_rows, v_n, v_opened from rows_;
  return jsonb_build_object('ok', true, 'count', v_n, 'opened', v_opened, 'rows', v_rows);
end;
$$;
revoke all on function public.contracting_link_activity() from public, anon;
grant execute on function public.contracting_link_activity() to authenticated;

-- ── 6. Reconciliation: the sheet sync runs every 15 minutes even if nobody presses Sync ──────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'contracting-sheet-sync-15m') then
      perform cron.schedule('contracting-sheet-sync-15m', '*/15 * * * *', $j$
        select net.http_post(
          url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/contracting-sheet-sync',
          headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'apex_bot_token' limit 1), 'Content-Type', 'application/json'),
          body := '{"source":"cron"}'::jsonb)
      $j$);
    end if;
  end if;
end $$;
