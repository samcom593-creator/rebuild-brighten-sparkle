-- Contracting check-in: a per-agent audit Sam works through on check-in calls.
-- Three manual steps (contracts sent -> contracts confirmed/worked -> ready for
-- training) plus a derived "producing" flag from real posted production, so an
-- agent already writing business is never shown as blocked on paperwork.
create table if not exists public.agent_contracting_checkins (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  contracts_sent_at timestamptz,
  contracts_sent_by uuid,
  contracts_confirmed_at timestamptz,
  contracts_confirmed_by uuid,
  training_ready_at timestamptz,
  training_ready_by uuid,
  last_checkin_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table if not exists public.agent_contracting_checkin_log (
  id bigserial primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  step text not null,
  done boolean,
  note text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
alter table public.agent_contracting_checkins enable row level security;
alter table public.agent_contracting_checkin_log enable row level security;
-- No table policies: every read and write goes through the gated functions below.

create or replace function public.fn_contracting_checkin_scope()
returns table(agent_id uuid)
language sql stable security definer set search_path to 'public'
as $$
  with me as (select a.id from public.agents a where a.user_id = auth.uid()
               and coalesce(a.is_deactivated,false) = false order by a.created_at limit 1)
  select a.id from public.agents a
  where auth.uid() is not null
    and ( public.apex_is_admin()
       or public.has_role(auth.uid(),'va_manager')
       or public.has_role(auth.uid(),'va')
       or (public.has_role(auth.uid(),'manager')
           and exists (select 1 from me where me.id in (a.manager_id, a.invited_by_manager_id))) );
$$;

create or replace function public.contracting_checkin_list()
returns table(
  agent_id uuid, display_name text, manager_name text, email text, phone text,
  license_status text, onboarding_stage text, npn text, hired_on date,
  intake_received boolean, deals_30d integer, last_deal_date date, producing boolean,
  contracts_sent_at timestamptz, contracts_confirmed_at timestamptz, training_ready_at timestamptz,
  last_checkin_at timestamptz, note text, stage text
)
language sql stable security definer set search_path to 'public'
as $$
  with scope as (select * from public.fn_contracting_checkin_scope()),
  base as (
    select a.*
    from public.agents a join scope s on s.agent_id = a.id
    where a.status = 'active'
      and coalesce(a.is_deactivated,false) = false
      and coalesce(a.is_inactive,false) = false
      and a.canonical_agent_id is null
      and coalesce(a.agent_code,'') not like 'GHOST_%'
  ),
  prod as (
    select coalesce(m.canonical_agent_id, p.agent_id) aid,
           count(*)::int n, max(p.posted_date) last_d
    from public.v_production_canonical p
    left join public.v_agent_canonical_map m on m.agent_id = p.agent_id
    where p.posted_date >= (now() at time zone 'America/Phoenix')::date - 30
    group by 1
  )
  select b.id, b.display_name, mg.display_name,
         coalesce(pr.email, ci.email), coalesce(pr.phone, ci.phone_e164),
         b.license_status::text, b.onboarding_stage::text,
         coalesce(nullif(b.nipr_number,''), ci.npn),
         coalesce(b.start_date, b.created_at::date),
         (ci.id is not null or b.contracted_at is not null),
         coalesce(pd.n,0), pd.last_d, coalesce(pd.n,0) > 0,
         c.contracts_sent_at, c.contracts_confirmed_at, c.training_ready_at,
         c.last_checkin_at, c.note,
         case
           when coalesce(pd.n,0) > 0 then 'producing'
           when c.training_ready_at is not null then 'ready_for_training'
           when c.contracts_confirmed_at is not null then 'contracts_confirmed'
           when c.contracts_sent_at is not null then 'contracts_sent'
           else 'needs_contracts'
         end
  from base b
  left join public.agents mg on mg.id = b.manager_id
  left join public.profiles pr on pr.id = b.profile_id
  left join lateral (select * from public.contracting_intakes x where x.agent_id = b.id
                     order by x.created_at desc limit 1) ci on true
  left join prod pd on pd.aid = b.id
  left join public.agent_contracting_checkins c on c.agent_id = b.id;
$$;

create or replace function public.set_contracting_checkin(
  p_agent_id uuid, p_step text, p_done boolean default true, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_now timestamptz := now();
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id = p_agent_id) then
    raise exception 'not allowed to update this agent' using errcode='42501';
  end if;
  if p_step not in ('contracts_sent','contracts_confirmed','training_ready','checked_in','note') then
    raise exception 'unknown step %', p_step;
  end if;

  insert into public.agent_contracting_checkins(agent_id) values (p_agent_id)
  on conflict (agent_id) do nothing;

  update public.agent_contracting_checkins set
    contracts_sent_at      = case
                               when p_step='contracts_sent' then case when p_done then coalesce(contracts_sent_at, v_now) end
                               -- confirming or marking ready implies sent, so the list never shows an impossible state
                               when p_done and p_step in ('contracts_confirmed','training_ready') then coalesce(contracts_sent_at, v_now)
                               else contracts_sent_at end,
    contracts_sent_by      = case when p_step='contracts_sent' then case when p_done then v_uid end else contracts_sent_by end,
    contracts_confirmed_at = case when p_step='contracts_confirmed' then case when p_done then coalesce(contracts_confirmed_at, v_now) end else contracts_confirmed_at end,
    contracts_confirmed_by = case when p_step='contracts_confirmed' then case when p_done then v_uid end else contracts_confirmed_by end,
    training_ready_at      = case when p_step='training_ready' then case when p_done then coalesce(training_ready_at, v_now) end else training_ready_at end,
    training_ready_by      = case when p_step='training_ready' then case when p_done then v_uid end else training_ready_by end,
    last_checkin_at        = v_now,
    note                   = case when p_note is not null then nullif(btrim(p_note),'') else note end,
    updated_at = v_now, updated_by = v_uid
  where agent_id = p_agent_id;

  if p_done and p_step = 'training_ready' then
    update public.agent_contracting_checkins
       set contracts_confirmed_at = coalesce(contracts_confirmed_at, v_now)
     where agent_id = p_agent_id;
  end if;

  insert into public.agent_contracting_checkin_log(agent_id, step, done, note, changed_by)
  values (p_agent_id, p_step, p_done, nullif(btrim(p_note),''), v_uid);

  return (select to_jsonb(c) from public.agent_contracting_checkins c where c.agent_id = p_agent_id);
end;
$$;

revoke all on function public.fn_contracting_checkin_scope() from public, anon;
revoke all on function public.contracting_checkin_list() from public, anon;
revoke all on function public.set_contracting_checkin(uuid,text,boolean,text) from public, anon;
grant execute on function public.contracting_checkin_list() to authenticated;
grant execute on function public.set_contracting_checkin(uuid,text,boolean,text) to authenticated;
