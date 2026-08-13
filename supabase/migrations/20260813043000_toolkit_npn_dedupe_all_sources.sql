-- Widen the Quick Add Agent NPN dedupe to every table that already carries a
-- producer number.
--
-- 20260813041000 deduped the new NPN only against apex_toolkit_agents.npn.
-- But applications.nipr_number holds 105 live values and agents.nipr_number
-- exists (empty today, populated by future NIPR syncs). A person already in
-- the pipeline under a different email could therefore be re-added as a
-- toolkit twin — the same identity-collision disease as the 2026-08-07
-- agent-duplicate waves, one column over.
--
-- nipr_number is not format-guaranteed (live data holds '' x79 and one
-- 's'-prefixed 14-char value), so comparison is digit-normalized on both
-- sides. An empty or >10-digit normalization can never equal a valid
-- 5-10 digit NPN, so junk rows cannot false-positive.
--
-- Non-destructive: CREATE OR REPLACE of the six-argument NPN function only.
-- No table, column, grant, or legacy-row change. Rollback = re-run the
-- function body from 20260813041000.

create or replace function public.create_apex_toolkit_agent(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_npn text,
  p_contract_version text default 'npn-v1'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_first_name text := btrim(coalesce(p_first_name, ''));
  v_last_name text := btrim(coalesce(p_last_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone_input text := btrim(coalesce(p_phone, ''));
  v_phone_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone text;
  v_npn text := regexp_replace(coalesce(p_npn, ''), '[^0-9]', '', 'g');
  v_toolkit_agent_id uuid;
  v_journey_id uuid;
begin
  if p_contract_version is distinct from 'npn-v1' then
    raise exception using errcode = '22023', message = 'Unknown Add Agent contract version.';
  end if;

  if not public.apex_toolkit_is_staff(v_user_id) then
    raise exception using errcode = '42501', message = 'Admin, manager, or recruiting-operations access is required.';
  end if;

  if char_length(v_first_name) not between 1 and 80
     or v_first_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Enter a valid first name.';
  end if;
  if char_length(v_last_name) not between 1 and 80
     or v_last_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Enter a valid last name.';
  end if;
  if char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid email address.';
  end if;

  if char_length(v_phone_digits) = 10 then
    v_phone := '+1' || v_phone_digits;
  elsif char_length(v_phone_digits) = 11 and left(v_phone_digits, 1) = '1' then
    v_phone := '+' || v_phone_digits;
  elsif left(v_phone_input, 1) = '+' and char_length(v_phone_digits) between 8 and 15 then
    v_phone := '+' || v_phone_digits;
  else
    raise exception using errcode = '22023', message = 'Enter a valid US or international phone number.';
  end if;

  if v_npn !~ '^[0-9]{5,10}$' then
    raise exception using errcode = '22023', message = 'Enter an NPN with 5 to 10 digits.';
  end if;

  if exists (select 1 from public.apex_toolkit_agents where lower(email) = v_email) then
    raise exception using errcode = '23505', message = 'An agent with this email already exists.';
  end if;
  if exists (select 1 from public.applications where lower(email) = v_email) then
    raise exception using errcode = '23505', message = 'An applicant with this email already exists.';
  end if;
  if exists (select 1 from public.apex_toolkit_agents where npn = v_npn) then
    raise exception using errcode = '23505', message = 'An agent with this NPN already exists.';
  end if;
  if exists (
    select 1 from public.applications
     where nipr_number is not null
       and regexp_replace(nipr_number, '[^0-9]', '', 'g') = v_npn
  ) then
    raise exception using errcode = '23505', message = 'An applicant with this NPN already exists in the pipeline.';
  end if;
  if exists (
    select 1 from public.agents
     where nipr_number is not null
       and regexp_replace(nipr_number, '[^0-9]', '', 'g') = v_npn
  ) then
    raise exception using errcode = '23505', message = 'An agent with this NPN already exists on the roster.';
  end if;

  insert into public.apex_toolkit_agents (
    first_name,
    last_name,
    email,
    phone,
    npn,
    created_by
  ) values (
    v_first_name,
    v_last_name,
    v_email,
    v_phone,
    v_npn,
    v_user_id
  )
  returning id into v_toolkit_agent_id;

  insert into public.apex_agent_journeys (toolkit_agent_id, path, updated_by)
  values (v_toolkit_agent_id, 'licensed', v_user_id)
  returning id into v_journey_id;

  insert into public.apex_agent_journey_steps (
    journey_id,
    step_key,
    completed_by
  ) values (
    v_journey_id,
    'welcome',
    v_user_id
  );

  return jsonb_build_object(
    'agentId', v_toolkit_agent_id,
    'subjectType', 'toolkit_agent',
    'path', 'licensed',
    'message', format('%s %s was added to the licensed journey.', v_first_name, v_last_name)
  );
end;
$fn$;

-- CREATE OR REPLACE preserves existing grants (authenticated EXECUTE from
-- 20260813041000); re-asserted here so a fresh replay is self-contained.
revoke all on function public.create_apex_toolkit_agent(text, text, text, text, text, text) from public;
revoke all on function public.create_apex_toolkit_agent(text, text, text, text, text, text) from anon;
grant execute on function public.create_apex_toolkit_agent(text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
