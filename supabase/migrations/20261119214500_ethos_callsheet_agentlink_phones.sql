-- MP-ETHOS-CALLSHEET follow-up (2026-11-19)
-- Seven people on the first Ethos export had no phone number in the Ethos signup sheet, the older roster
-- pull or their profile. Four of them (one a $15K producer with nothing written on Ethos) are in the
-- AgentLink agent roster, which holds each agent's own contact record. Add it as the last phone source.
--
-- The first resolver keeps its body under a new name and the public name becomes a thin wrapper, so the
-- 150-line body is not restated here.

do $$
begin
  if to_regprocedure('public.ethos_callsheet_resolve_core()') is null then
    alter function public.ethos_callsheet_resolve() rename to ethos_callsheet_resolve_core;
  end if;
end;
$$;

create or replace function public.ethos_callsheet_resolve()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.ethos_callsheet_resolve_core();

  -- AgentLink roster, by NPN.
  with al as (
    select distinct on (r.npn)
           r.npn,
           nullif(btrim(r.phone), '') as phone,
           nullif(lower(btrim(r.email)), '') as email
      from public.agentlink_roster r
     where nullif(btrim(r.npn), '') is not null
       and nullif(btrim(r.phone), '') is not null
     order by r.npn, r.synced_at desc nulls last
  )
  update public.ethos_callsheet_people p
     set phone = al.phone,
         email = coalesce(p.email, al.email),
         updated_at = now()
    from al
   where p.phone is null
     and al.npn = p.npn;

  -- AgentLink roster, by exact full name, only when that name points at one phone number.
  with byname as (
    select lower(regexp_replace(coalesce(r.first_name, '') || coalesce(r.last_name, ''), '[^a-zA-Z]', '', 'g')) as k,
           min(nullif(btrim(r.phone), '')) as phone,
           min(nullif(lower(btrim(r.email)), '')) as email
      from public.agentlink_roster r
     where nullif(btrim(r.phone), '') is not null
     group by 1
    having count(distinct right(regexp_replace(r.phone, '\D', '', 'g'), 10)) = 1
  )
  update public.ethos_callsheet_people p
     set phone = b.phone,
         email = coalesce(p.email, b.email),
         updated_at = now()
    from byname b
   where p.phone is null
     and b.k = p.name_key
     and length(b.k) >= 8;
end;
$$;

revoke all on function public.ethos_callsheet_resolve() from public, anon, authenticated;
revoke all on function public.ethos_callsheet_resolve_core() from public, anon, authenticated;
