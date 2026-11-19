-- MP-ETHOS-CALLSHEET part 5 (2026-11-19)
-- Driving the live page as each leader showed cards for records that are not people to call: ten
-- placeholder agent records (XAGENT01 to XAGENT10), a test record, and a staff account that sits on the
-- AgentLink roster. The roster sync now takes those off the sheet. The wrapper from part 4 is restated in
-- full with the one new step; the core it calls is unchanged.

create or replace function public.ethos_callsheet_sync_roster()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_hidden int := 0;
  v_placeholders int := 0;
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

  -- Not people to call: a placeholder record (no phone, no email, no NPN, and a name that is a code or a
  -- single word), and staff accounts that sit on the AgentLink roster. Never an Ethos row, never a row with
  -- a logged call.
  update public.ethos_callsheet_people p
     set in_latest_snapshot = false, updated_at = now()
   where p.in_latest_snapshot
     and not p.on_ethos
     and not exists (select 1 from public.ethos_callsheet_calls c where c.person_id = p.id)
     and (
       (p.phone is null and p.email is null and p.npn is null
        and (p.full_name ~ '[0-9_]' or p.full_name !~ '\s'))
       or exists (
         select 1
           from public.profiles pr
           join public.user_roles ur on ur.user_id = pr.user_id and ur.role in ('va'::app_role, 'va_manager'::app_role)
          where (p.email is not null and lower(pr.email) = p.email)
             or (length(p.name_key) >= 5
                 and lower(regexp_replace(coalesce(pr.full_name, ''), '[^a-zA-Z]', '', 'g')) = p.name_key)
             or (p.agent_id is not null and exists (select 1 from public.agents a where a.id = p.agent_id and a.user_id = pr.user_id))
       )
     );
  get diagnostics v_placeholders = row_count;

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
    'hidden_placeholders', v_placeholders,
    'people', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot),
    'with_phone', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot and phone is not null)
  );
end;
$$;

revoke all on function public.ethos_callsheet_sync_roster() from public, anon, authenticated;
