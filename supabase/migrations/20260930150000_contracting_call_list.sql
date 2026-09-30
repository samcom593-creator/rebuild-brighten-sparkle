-- Contracting call list v2 (2026-09-30). v1 (20260930120000) keyed check-ins on
-- agents.id, but Sam's "no contracts" list includes licensed applicants and
-- people who only have a portal profile. One table now holds every person on
-- the list; agents still derive name/phone/production live.
drop function if exists public.set_contracting_checkin(uuid,text,boolean,text);
drop function if exists public.contracting_checkin_list();
drop table if exists public.agent_contracting_checkin_log;
drop table if exists public.agent_contracting_checkins;

create table public.contracting_checkins (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid unique references public.agents(id) on delete cascade,
  application_id uuid,
  profile_id uuid,
  display_name text,
  phone text,
  email text,
  flagged_no_contracts boolean not null default false,
  flagged_at timestamptz,
  contracts_sent_at timestamptz, contracts_sent_by uuid,
  contracts_confirmed_at timestamptz, contracts_confirmed_by uuid,
  training_ready_at timestamptz, training_ready_by uuid,
  last_call_at timestamptz, last_call_outcome text, call_count int not null default 0,
  last_checkin_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (agent_id is not null or display_name is not null)
);
create table public.contracting_checkin_log (
  id bigserial primary key,
  checkin_id uuid not null references public.contracting_checkins(id) on delete cascade,
  step text not null, done boolean, note text,
  changed_by uuid, changed_at timestamptz not null default now()
);
alter table public.contracting_checkins enable row level security;
alter table public.contracting_checkin_log enable row level security;

create or replace function public.fn_contracting_is_staff()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (public.apex_is_admin()
    or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'va'));
$$;

create or replace function public.contracting_checkin_list()
returns table(
  checkin_id uuid, agent_id uuid, display_name text, manager_name text, phone text, email text,
  agent_status text, license_status text, npn text, is_agent boolean, source text,
  intake_received boolean, deals_30d integer, producing boolean, flagged boolean,
  contracts_sent_at timestamptz, contracts_confirmed_at timestamptz, training_ready_at timestamptz,
  last_call_at timestamptz, last_call_outcome text, call_count integer,
  last_checkin_at timestamptz, note text, stage text
)
language sql stable security definer set search_path to 'public' as $$
  with scope as (select * from public.fn_contracting_checkin_scope()),
  prod as (
    select coalesce(m.canonical_agent_id, p.agent_id) aid, count(*)::int n
    from public.v_production_canonical p
    left join public.v_agent_canonical_map m on m.agent_id = p.agent_id
    where p.posted_date >= (now() at time zone 'America/Phoenix')::date - 30
    group by 1
  ),
  agent_rows as (
    select a.id aid, c.*
    from public.agents a
    join scope s on s.agent_id = a.id
    left join public.contracting_checkins c on c.agent_id = a.id
    where a.canonical_agent_id is null
      and coalesce(a.agent_code,'') not like 'GHOST_%'
      and ( (a.status = 'active' and not coalesce(a.is_deactivated,false) and not coalesce(a.is_inactive,false))
            or coalesce(c.flagged_no_contracts,false) )
  )
  select r.id, a.id, a.display_name, mg.display_name,
         coalesce(nullif(pr.phone,''), nullif(ci.phone_e164,''), nullif(ap.phone,'')),
         coalesce(pr.email, ci.email, ap.email),
         case when coalesce(a.is_deactivated,false) or a.status='terminated' then 'terminated'
              when coalesce(a.is_inactive,false) or a.status='inactive' then 'inactive' else 'active' end,
         a.license_status::text, coalesce(nullif(a.nipr_number,''), ci.npn), true, 'agent',
         (ci.id is not null or a.contracted_at is not null),
         coalesce(pd.n,0), coalesce(pd.n,0) > 0, coalesce(r.flagged_no_contracts,false),
         r.contracts_sent_at, r.contracts_confirmed_at, r.training_ready_at,
         r.last_call_at, r.last_call_outcome, coalesce(r.call_count,0), r.last_checkin_at, r.note,
         case
           when r.training_ready_at is not null then 'ready_for_training'
           when r.contracts_confirmed_at is not null then 'contracts_confirmed'
           when r.contracts_sent_at is not null then 'contracts_sent'
           when coalesce(pd.n,0) > 0 and not coalesce(r.flagged_no_contracts,false) then 'producing'
           else 'needs_contracts'
         end
  from agent_rows r
  join public.agents a on a.id = r.aid
  left join public.agents mg on mg.id = a.manager_id
  left join public.profiles pr on pr.id = a.profile_id
  left join public.applications ap on ap.id = a.source_application_id
  left join lateral (select * from public.contracting_intakes x where x.agent_id = a.id
                     order by x.created_at desc limit 1) ci on true
  left join prod pd on pd.aid = a.id
  union all
  -- people on the list who are not agents yet (applicants, portal-only, name-only)
  select c.id, null, c.display_name, null,
         coalesce(nullif(c.phone,''), nullif(ap.phone,''), nullif(pr.phone,'')),
         coalesce(c.email, ap.email, pr.email),
         'not_an_agent', ap.license_status::text, ap.nipr_number, false,
         case when c.application_id is not null then 'applicant'
              when c.profile_id is not null then 'portal account' else 'name only' end,
         false, 0, false, c.flagged_no_contracts,
         c.contracts_sent_at, c.contracts_confirmed_at, c.training_ready_at,
         c.last_call_at, c.last_call_outcome, c.call_count, c.last_checkin_at, c.note,
         case
           when c.training_ready_at is not null then 'ready_for_training'
           when c.contracts_confirmed_at is not null then 'contracts_confirmed'
           when c.contracts_sent_at is not null then 'contracts_sent'
           else 'needs_contracts'
         end
  from public.contracting_checkins c
  left join public.applications ap on ap.id = c.application_id
  left join public.profiles pr on pr.id = c.profile_id
  where c.agent_id is null and public.fn_contracting_is_staff();
$$;

create or replace function public.set_contracting_checkin(
  p_checkin_id uuid, p_agent_id uuid, p_step text, p_done boolean default true, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_now timestamptz := now(); v_id uuid; v_note text := nullif(btrim(p_note),'');
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_step not in ('contracts_sent','contracts_confirmed','training_ready','note','call','flag','phone') then
    raise exception 'unknown step %', p_step;
  end if;
  if p_step = 'call' and coalesce(v_note,'') not in ('talked','no_answer','voicemail','wrong_number','texted') then
    raise exception 'unknown call outcome %', p_note;
  end if;

  if p_agent_id is not null then
    if not exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id = p_agent_id) then
      raise exception 'not allowed to update this agent' using errcode='42501';
    end if;
    insert into public.contracting_checkins(agent_id) values (p_agent_id) on conflict (agent_id) do nothing;
    select id into v_id from public.contracting_checkins where agent_id = p_agent_id;
  else
    if not public.fn_contracting_is_staff() then
      raise exception 'not allowed' using errcode='42501';
    end if;
    select id into v_id from public.contracting_checkins where id = p_checkin_id and agent_id is null;
    if v_id is null then raise exception 'unknown check-in row'; end if;
  end if;

  update public.contracting_checkins set
    contracts_sent_at = case
        when p_step='contracts_sent' then case when p_done then coalesce(contracts_sent_at, v_now) end
        when p_done and p_step in ('contracts_confirmed','training_ready') then coalesce(contracts_sent_at, v_now)
        else contracts_sent_at end,
    contracts_sent_by = case when p_step='contracts_sent' then case when p_done then v_uid end else contracts_sent_by end,
    contracts_confirmed_at = case
        when p_step='contracts_confirmed' then case when p_done then coalesce(contracts_confirmed_at, v_now) end
        when p_done and p_step='training_ready' then coalesce(contracts_confirmed_at, v_now)
        else contracts_confirmed_at end,
    contracts_confirmed_by = case when p_step='contracts_confirmed' then case when p_done then v_uid end else contracts_confirmed_by end,
    training_ready_at = case when p_step='training_ready' then case when p_done then coalesce(training_ready_at, v_now) end else training_ready_at end,
    training_ready_by = case when p_step='training_ready' then case when p_done then v_uid end else training_ready_by end,
    flagged_no_contracts = case when p_step='flag' then p_done else flagged_no_contracts end,
    flagged_at = case when p_step='flag' and p_done then coalesce(flagged_at, v_now) else flagged_at end,
    last_call_at = case when p_step='call' then v_now else last_call_at end,
    last_call_outcome = case when p_step='call' then v_note else last_call_outcome end,
    call_count = case when p_step='call' then call_count + 1 else call_count end,
    phone = case when p_step='phone' and agent_id is null then v_note else phone end,
    note = case when p_step='note' then v_note else note end,
    last_checkin_at = v_now, updated_at = v_now, updated_by = v_uid
  where id = v_id;

  insert into public.contracting_checkin_log(checkin_id, step, done, note, changed_by)
  values (v_id, p_step, p_done, v_note, v_uid);

  return (select to_jsonb(c) from public.contracting_checkins c where c.id = v_id);
end;
$$;

revoke all on function public.fn_contracting_is_staff() from public, anon;
revoke all on function public.contracting_checkin_list() from public, anon;
revoke all on function public.set_contracting_checkin(uuid,uuid,text,boolean,text) from public, anon;
grant execute on function public.contracting_checkin_list() to authenticated;
grant execute on function public.set_contracting_checkin(uuid,uuid,text,boolean,text) to authenticated;
