-- Repair Quick Add Agent's producer identifier without losing the one legacy
-- PA-number row already in production.
--
-- Forward compatibility:
--   * npn is the only identifier accepted by the active RPC.
--   * pa_number remains nullable and untouched for historical display/audit.
--   * the existing five-argument PA RPC remains available only during the web
--     rollout; the follow-up contract migration renames and revokes it after
--     the NPN bundle is live.
--
-- Rollback (if the web release must be reverted): revoke/drop the six-argument
-- overload and leave the original five-argument function in place. The additive
-- npn column requires no row rewrite or data deletion.

alter table public.apex_toolkit_agents
  add column if not exists npn text;

alter table public.apex_toolkit_agents
  alter column pa_number drop not null;

alter table public.apex_toolkit_agents
  drop constraint if exists apex_toolkit_agents_npn_check;

alter table public.apex_toolkit_agents
  add constraint apex_toolkit_agents_npn_check
  check (npn is null or npn ~ '^[0-9]{5,10}$');

create unique index if not exists apex_toolkit_agents_npn_unique
  on public.apex_toolkit_agents (npn)
  where npn is not null;

comment on column public.apex_toolkit_agents.npn is
  'NPN (National Producer Number), normalized to 5-10 digits. Self-reported at Add Agent time; not proof of NIPR verification.';

comment on column public.apex_toolkit_agents.pa_number is
  'Legacy APEX PA identifier retained only for pre-NPN rows and rollback safety. New Add Agent writes leave this column NULL.';

-- Keep the original five-text-argument PA function during propagation. This
-- NPN overload has one trailing defaulted contract marker, so PostgREST can
-- route the new named p_npn payload to it while old p_pa_number bundles still
-- route to the five-argument function. The marker is intentionally not sent by
-- clients; it only gives PostgreSQL a distinct function identity.
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

revoke all on function public.create_apex_toolkit_agent(text, text, text, text, text, text) from public;
revoke all on function public.create_apex_toolkit_agent(text, text, text, text, text, text) from anon;
grant execute on function public.create_apex_toolkit_agent(text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
