-- MP-ETHOS-CALLSHEET part 4 (2026-11-19)
-- A few people have two agent records in this app (same phone number, or same name and NPN). Each record
-- became its own card, so one person could be called twice and a result logged on one card would leave
-- the other sitting in Call now. Keep one card per person.
--
-- The kept card is the one on the Ethos export, else the one that already has a call logged, else the
-- active record, else the one with more carrier contracts. A hidden row is never deleted, an Ethos row is
-- never hidden, and a row with a logged call is never hidden.
--
-- Same wrapper pattern as the resolver: the existing sync keeps its body under a new name.

do $$
begin
  if to_regprocedure('public.ethos_callsheet_sync_roster_core()') is null then
    alter function public.ethos_callsheet_sync_roster() rename to ethos_callsheet_sync_roster_core;
  end if;
end;
$$;

create or replace function public.ethos_callsheet_sync_roster()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_hidden int := 0;
begin
  v_result := public.ethos_callsheet_sync_roster_core();

  -- Some agent records were created with the owner's own phone number as a stand-in. Showing it would
  -- have a leader dial the owner. Blank it on the sheet; the card then asks for a real number.
  update public.ethos_callsheet_people p
     set phone = null, updated_at = now()
   where p.phone is not null
     and right(regexp_replace(p.phone, '\D', '', 'g'), 10) in (
       select right(regexp_replace(o.phone, '\D', '', 'g'), 10)
         from public.ethos_callsheet_people o
         join public.agents a on coalesce(a.canonical_agent_id, a.id) = o.agent_id
         join public.user_roles ur on ur.user_id = a.user_id and ur.role = 'admin'::app_role
        where o.phone is not null
     )
     and not exists (
       select 1
         from public.agents a
         join public.user_roles ur on ur.user_id = a.user_id and ur.role = 'admin'::app_role
        where coalesce(a.canonical_agent_id, a.id) = p.agent_id
     );

  -- One card per phone number (a second record under a misspelled name is the same person); people with
  -- no phone are matched on name and NPN.
  with ranked as (
    select p.id,
           row_number() over (
             partition by coalesce(
                            'ph:' || nullif(right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10), ''),
                            'id:' || p.name_key || ':' || p.npn
                          )
             order by p.on_ethos desc,
                      (exists (select 1 from public.ethos_callsheet_calls c where c.person_id = p.id)) desc,
                      (a.status = 'active') desc nulls last,
                      coalesce(p.contracts_active, 0) desc,
                      (p.agent_id is not null) desc,
                      p.created_at asc,
                      p.id asc
           ) as rn
      from public.ethos_callsheet_people p
      left join public.agents a on a.id = p.agent_id
     where p.in_latest_snapshot
       and (p.phone is not null or p.npn is not null)
  )
  update public.ethos_callsheet_people p
     set in_latest_snapshot = false, updated_at = now()
    from ranked r
   where r.id = p.id
     and r.rn > 1
     and not p.on_ethos
     and not exists (select 1 from public.ethos_callsheet_calls c where c.person_id = p.id);
  get diagnostics v_hidden = row_count;

  return v_result || jsonb_build_object(
    'hidden_duplicates', v_hidden,
    'people', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot),
    'with_phone', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot and phone is not null)
  );
end;
$$;

revoke all on function public.ethos_callsheet_sync_roster() from public, anon, authenticated;
revoke all on function public.ethos_callsheet_sync_roster_core() from public, anon, authenticated;
