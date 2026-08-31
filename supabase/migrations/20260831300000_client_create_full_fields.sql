begin;

-- MP-348: let the person on the phone actually write down the address.
--
-- Sam, mid-call: "not letting me input info like address or anything." The Add
-- Client dialog offered four fields — first name, last name, phone, email —
-- while agentlink_clients already has street_address, city, state, zip_code and
-- date_of_birth. The data model was never the limit; the create path was.
--
-- New params are all OPTIONAL and appended, so every existing 4-argument caller
-- keeps resolving against the same function without a signature break.
create or replace function public.fn_client_pipeline_create(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text default null::text,
  p_street_address text default null::text,
  p_city text default null::text,
  p_state text default null::text,
  p_zip_code text default null::text,
  p_date_of_birth date default null::date,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
set row_security to 'off'
as $function$
declare
  v_agent_id uuid;
  v_client_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if nullif(btrim(p_first_name), '') is null or nullif(btrim(p_last_name), '') is null then
    raise exception 'First and last name are required';
  end if;
  if length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 10 then
    raise exception 'A valid phone number is required';
  end if;

  v_agent_id := public.get_agent_id(auth.uid());
  if v_agent_id is null then
    -- Names the actual remedy. This fired on Sam's own info@ login because that
    -- auth user had no agents row at all, and the old text left the reader with
    -- nowhere to go.
    raise exception 'No agent record is linked to this login. An admin can link it on the agent profile, then retry.';
  end if;

  insert into public.agentlink_clients (
    agent_id, first_name, last_name, phone, email,
    street_address, city, state, zip_code, date_of_birth,
    communication_notes,
    pipeline_stage, external_source, created_at, updated_at
  ) values (
    v_agent_id,
    left(btrim(p_first_name), 120), left(btrim(p_last_name), 120),
    left(btrim(p_phone), 40), nullif(left(btrim(coalesce(p_email, '')), 254), ''),
    nullif(left(btrim(coalesce(p_street_address, '')), 200), ''),
    nullif(left(btrim(coalesce(p_city, '')), 100), ''),
    nullif(upper(left(btrim(coalesce(p_state, '')), 2)), ''),
    nullif(left(btrim(coalesce(p_zip_code, '')), 10), ''),
    p_date_of_birth,
    nullif(btrim(coalesce(p_notes, '')), ''),
    'NEW_INITIAL', 'apex', now(), now()
  ) returning id into v_client_id;

  insert into public.client_pipeline_activity(client_id, activity_type, body, created_by)
  values (v_client_id, 'client_created', 'Client added to pipeline', auth.uid());

  return v_client_id;
end;
$function$;

comment on function public.fn_client_pipeline_create(text,text,text,text,text,text,text,text,date,text) is
  'MP-348: creates a pipeline client. Address, DOB and notes are optional and '
  'appended so existing 4-arg callers keep working. The no-agent error now names '
  'the remedy instead of dead-ending the caller.';

commit;
