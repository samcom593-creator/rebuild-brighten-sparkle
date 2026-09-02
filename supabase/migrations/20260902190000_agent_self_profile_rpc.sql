-- MP-391: agents control their own licensing record (NPN and all), admins control anyone's.
--
-- WHY AN RPC: MP-329 closed the agents read-leak by scoping the authenticated
-- role's SELECT to a column list that excludes nipr_number, license_number,
-- contract_percentage, comp_* and friends. Measured 2026-09-02 as a real agent
-- (apex-sql-as.sh): the agent cannot read their own NPN, and a direct
-- self-UPDATE fails with "permission denied for table agents". So the only
-- honest self-service path is a SECURITY DEFINER function with a column
-- whitelist — never a table grant that would re-open the leak.
--
-- Coverage that makes this matter: 23 of 113 active agents have an NPN on
-- file; 104 have a login. The other 90 can now type their own.

create or replace function public.my_agent_profile(p_agent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
  v_a     public.agents%rowtype;
  v_email text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  v_admin := public.is_owner();

  if p_agent_id is not null then
    if not v_admin then
      raise exception 'only an admin may read another agent''s licensing record' using errcode = '42501';
    end if;
    select * into v_a from public.agents where id = p_agent_id;
  else
    select * into v_a from public.agents
     where user_id = v_uid
     order by coalesce(is_deactivated, false) asc, created_at desc
     limit 1;
  end if;

  if v_a.id is null then
    return null;
  end if;

  select p.email into v_email from public.profiles p
   where p.user_id = v_a.user_id
   order by p.created_at desc nulls last limit 1;

  return jsonb_build_object(
    'agent_id',                 v_a.id,
    'display_name',             v_a.display_name,
    'email',                    v_email,
    'nipr_number',              v_a.nipr_number,
    'nipr_verified',            coalesce(v_a.nipr_verified, false),
    'nipr_verified_at',         v_a.nipr_verified_at,
    'license_number',           v_a.license_number,
    'license_status',           v_a.license_status,
    'license_states',           coalesce(to_jsonb(v_a.license_states), '[]'::jsonb),
    'license_expires_at',       v_a.license_expires_at,
    'licensed_at',              v_a.licensed_at,
    'contracting_contact_name', v_a.contracting_contact_name,
    'eo_policy_number',         v_a.eo_policy_number,
    'eo_expires_at',            v_a.eo_expires_at,
    'eo_certificate_url',       v_a.eo_certificate_url,
    'eft_ready',                coalesce(v_a.eft_ready, false),
    'can_edit_status',          v_admin,
    'is_admin_view',            (p_agent_id is not null)
  );
end;
$$;

revoke all on function public.my_agent_profile(uuid) from public, anon;
grant execute on function public.my_agent_profile(uuid) to authenticated, service_role;

comment on function public.my_agent_profile(uuid) is
  'MP-391. Owner-only read of the agents columns the column-scoped SELECT grant hides (NPN, license, E&O). Admins (is_owner) may pass p_agent_id for any agent.';


-- Whitelisted patch. Only keys PRESENT in p_patch are applied; an explicit
-- JSON null clears the field. Unknown keys are refused loudly rather than
-- silently dropped, so a client typo cannot look like a saved edit.
create or replace function public.update_my_agent_profile(p_patch jsonb, p_agent_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_admin      boolean;
  v_a          public.agents%rowtype;
  v_key        text;
  v_allowed    text[] := array['nipr_number','license_number','license_states','license_expires_at',
                               'contracting_contact_name','eo_policy_number','eo_expires_at',
                               'eo_certificate_url','display_name'];
  v_admin_only text[] := array['license_status'];
  v_npn        text;
  v_npn_changed boolean := false;
  v_states     text[];
  v_before     jsonb;
  v_after      jsonb;
  v_clash      uuid;
  v_email      text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a JSON object' using errcode = '22023';
  end if;
  v_admin := public.is_owner();

  if p_agent_id is not null then
    if not v_admin then
      raise exception 'only an admin may edit another agent''s licensing record' using errcode = '42501';
    end if;
    select * into v_a from public.agents where id = p_agent_id for update;
  else
    select * into v_a from public.agents
     where user_id = v_uid
     order by coalesce(is_deactivated, false) asc, created_at desc
     limit 1
     for update;
  end if;

  if v_a.id is null then
    raise exception 'no agent record is linked to this login yet — ask your manager to link it' using errcode = 'P0002';
  end if;

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = any(v_admin_only) then
      if not v_admin then
        raise exception 'only an admin may change %', v_key using errcode = '42501';
      end if;
    elsif not (v_key = any(v_allowed)) then
      raise exception 'field % is not editable here', v_key using errcode = '22023';
    end if;
  end loop;

  v_before := public.my_agent_profile(case when p_agent_id is not null then v_a.id else null end);

  -- NPN: digits only, 4-10 long, unique across live agents.
  if p_patch ? 'nipr_number' then
    v_npn := public.fn_normalize_contracting_npn(p_patch->>'nipr_number');
    if v_npn is not null and (length(v_npn) < 4 or length(v_npn) > 10) then
      raise exception 'an NPN is 4 to 10 digits — got % digit(s)', length(v_npn) using errcode = '22023';
    end if;
    if v_npn is not null then
      select id into v_clash from public.agents
       where nipr_number = v_npn and id <> v_a.id and coalesce(is_deactivated, false) = false
       limit 1;
      if v_clash is not null then
        raise exception 'that NPN is already on file for another agent — contact your manager so the records can be merged'
          using errcode = '23505';
      end if;
    end if;
    v_npn_changed := v_npn is distinct from v_a.nipr_number;
    v_a.nipr_number := v_npn;
    if v_npn_changed then
      -- A typed NPN is a claim, not a verification. NIPR verification re-runs on its own cadence.
      v_a.nipr_verified := false;
      v_a.nipr_verified_at := null;
    end if;
  end if;

  if p_patch ? 'license_number' then
    v_a.license_number := nullif(btrim(regexp_replace(coalesce(p_patch->>'license_number',''), '[[:space:]]+', '', 'g')), '');
  end if;

  if p_patch ? 'license_states' then
    if p_patch->'license_states' is null or jsonb_typeof(p_patch->'license_states') = 'null' then
      v_a.license_states := null;
    elsif jsonb_typeof(p_patch->'license_states') = 'array' then
      select coalesce(array_agg(distinct upper(btrim(x)) order by upper(btrim(x))), '{}')
        into v_states
        from jsonb_array_elements_text(p_patch->'license_states') x
       where btrim(x) <> '';
      if exists (select 1 from unnest(v_states) s where s !~ '^[A-Z]{2}$') then
        raise exception 'license_states must be two-letter state codes' using errcode = '22023';
      end if;
      v_a.license_states := v_states;
    else
      raise exception 'license_states must be a JSON array of state codes' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'license_expires_at' then
    v_a.license_expires_at := nullif(p_patch->>'license_expires_at','')::timestamptz;
  end if;
  if p_patch ? 'contracting_contact_name' then
    v_a.contracting_contact_name := nullif(btrim(coalesce(p_patch->>'contracting_contact_name','')), '');
  end if;
  if p_patch ? 'eo_policy_number' then
    v_a.eo_policy_number := nullif(btrim(coalesce(p_patch->>'eo_policy_number','')), '');
  end if;
  if p_patch ? 'eo_expires_at' then
    v_a.eo_expires_at := nullif(p_patch->>'eo_expires_at','')::date;
  end if;
  if p_patch ? 'eo_certificate_url' then
    v_a.eo_certificate_url := nullif(btrim(coalesce(p_patch->>'eo_certificate_url','')), '');
    if v_a.eo_certificate_url is not null and v_a.eo_certificate_url !~* '^https?://' then
      raise exception 'eo_certificate_url must start with http:// or https://' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'display_name' then
    v_a.display_name := nullif(btrim(coalesce(p_patch->>'display_name','')), '');
    if v_a.display_name is null then
      raise exception 'display_name cannot be blank' using errcode = '22023';
    end if;
  end if;
  if p_patch ? 'license_status' then
    v_a.license_status := (p_patch->>'license_status')::public.license_status;
  end if;

  update public.agents a set
    nipr_number              = v_a.nipr_number,
    nipr_verified            = v_a.nipr_verified,
    nipr_verified_at         = v_a.nipr_verified_at,
    license_number           = v_a.license_number,
    license_states           = v_a.license_states,
    license_expires_at       = v_a.license_expires_at,
    contracting_contact_name = v_a.contracting_contact_name,
    eo_policy_number         = v_a.eo_policy_number,
    eo_expires_at            = v_a.eo_expires_at,
    eo_certificate_url       = v_a.eo_certificate_url,
    display_name             = v_a.display_name,
    license_status           = v_a.license_status
  where a.id = v_a.id;

  -- Keep the contracting intake in step so the contracting board and the
  -- profile never disagree about the same person's NPN.
  if v_npn_changed then
    select p.email into v_email from public.profiles p
     where p.user_id = v_a.user_id order by p.created_at desc nulls last limit 1;
    update public.contracting_intakes ci
       set npn = v_a.nipr_number
     where (ci.agent_id = v_a.id or (v_email is not null and lower(ci.email) = lower(v_email)))
       and ci.npn is distinct from v_a.nipr_number;
  end if;

  v_after := public.my_agent_profile(case when p_agent_id is not null then v_a.id else null end);

  insert into public.audit_log (action, actor_role, actor_user_id, entity_type, entity_id, before_data, after_data)
  values (
    case when p_agent_id is not null then 'agent.profile.admin_update' else 'agent.profile.self_update' end,
    case when v_admin then 'admin' else 'agent' end,
    v_uid, 'agents', v_a.id::text,
    v_before - 'can_edit_status' - 'is_admin_view',
    v_after  - 'can_edit_status' - 'is_admin_view'
  );

  return v_after;
end;
$$;

revoke all on function public.update_my_agent_profile(jsonb, uuid) from public, anon;
grant execute on function public.update_my_agent_profile(jsonb, uuid) to authenticated, service_role;

comment on function public.update_my_agent_profile(jsonb, uuid) is
  'MP-391. Whitelisted self-service patch of an agent''s licensing record (NPN, license, states, expiry, E&O, display name). Admins may pass p_agent_id and additionally set license_status. NPN changes reset nipr_verified and propagate to contracting_intakes. Every call writes an audit_log row.';
