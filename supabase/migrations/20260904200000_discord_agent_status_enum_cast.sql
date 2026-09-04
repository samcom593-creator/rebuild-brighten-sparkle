-- MP-426: make the live Discord receipt RPC accept the agents.status enum.
--
-- MP-424 introduced an eligibility guard for newly resolved Discord writers,
-- but passed agents.status (agent_status) directly to lower(). PostgreSQL has
-- no lower(agent_status) overload, so every first-time deal failed before a
-- receipt or production row could be written. Repair the deployed definition
-- in place while preserving the exact RPC signature, grants, and behavior.

begin;

do $repair$
declare
  v_signature constant regprocedure :=
    'public.ingest_discord_production_deal(text,text,text,text,integer,uuid,text,text,text,text,numeric,numeric,numeric,timestamptz,date,text,jsonb)'::regprocedure;
  v_definition text;
  v_bad constant text := 'lower(coalesce(a.status, ''active''))';
  v_good constant text := 'lower(coalesce(a.status::text, ''active''))';
begin
  select pg_get_functiondef(v_signature) into v_definition;

  if position(v_good in v_definition) > 0 then
    return;
  end if;

  if position(v_bad in v_definition) = 0 then
    raise exception 'Discord ingestion RPC no longer matches the expected MP-424 definition';
  end if;

  execute replace(v_definition, v_bad, v_good);
end;
$repair$;

commit;
