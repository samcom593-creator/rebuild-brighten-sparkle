-- APEX is the contracting source of truth. AgentLink remains a production-book
-- mirror only; contracting uses the agent profile, Ethos sheet and private
-- contracting Discord.

alter table public.agents
  add column if not exists eo_certificate_url text,
  add column if not exists eo_policy_number text,
  add column if not exists eo_expires_at date,
  add column if not exists eo_per_claim_limit numeric,
  add column if not exists eo_aggregate_limit numeric,
  add column if not exists eo_deductible numeric,
  add column if not exists eft_ready boolean not null default false,
  add column if not exists contracting_contact_name text;

alter table public.contracting_intakes
  add column if not exists agent_id uuid references public.agents(id) on delete set null,
  add column if not exists comp_percentage numeric,
  add column if not exists license_status text,
  add column if not exists license_states text[],
  add column if not exists eo_certificate_url text,
  add column if not exists eo_policy_number text,
  add column if not exists eo_expires_at date,
  add column if not exists eo_per_claim_limit numeric,
  add column if not exists eo_aggregate_limit numeric,
  add column if not exists eo_deductible numeric,
  add column if not exists eft_ready boolean,
  add column if not exists contracting_contact_name text;

create or replace function public.fn_enrich_contracting_intake()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_agent public.agents%rowtype;
begin
  select a.* into v_agent
  from public.agents a
  left join public.profiles p on p.id = a.profile_id or p.user_id = a.user_id
  where (nullif(regexp_replace(coalesce(new.npn,''), '\D', '', 'g'), '') is not null
         and regexp_replace(coalesce(a.nipr_number,''), '\D', '', 'g') = regexp_replace(new.npn, '\D', '', 'g'))
     or lower(trim(coalesce(p.email,''))) = lower(trim(new.email))
  order by
    case when regexp_replace(coalesce(a.nipr_number,''), '\D', '', 'g') = regexp_replace(new.npn, '\D', '', 'g') then 0 else 1 end,
    case when a.status = 'active' then 0 else 1 end,
    a.updated_at desc
  limit 1;

  if v_agent.id is not null then
    new.agent_id := v_agent.id;
    new.comp_percentage := v_agent.comp_percentage;
    new.license_status := v_agent.license_status::text;
    new.license_states := v_agent.license_states;
    new.eo_certificate_url := v_agent.eo_certificate_url;
    new.eo_policy_number := v_agent.eo_policy_number;
    new.eo_expires_at := v_agent.eo_expires_at;
    new.eo_per_claim_limit := v_agent.eo_per_claim_limit;
    new.eo_aggregate_limit := v_agent.eo_aggregate_limit;
    new.eo_deductible := v_agent.eo_deductible;
    new.eft_ready := v_agent.eft_ready;
    new.contracting_contact_name := v_agent.contracting_contact_name;
  end if;
  return new;
end;
$$;

drop trigger if exists contracting_intakes_enrich_profile on public.contracting_intakes;
create trigger contracting_intakes_enrich_profile
before insert or update of npn,email on public.contracting_intakes
for each row execute function public.fn_enrich_contracting_intake();

update public.contracting_intakes set email = email;

-- Current owner E&O evidence, verified from the uploaded certificate.
update public.agents
set eo_certificate_url = 'https://drive.google.com/file/d/1A1eipR1iaA4Nv7S4ky2X4qPoZYZEcTr4/view?usp=drivesdk',
    eo_policy_number = 'NXTF9FLWXJ-00-PL',
    eo_expires_at = date '2027-07-05',
    eo_per_claim_limit = 1000000,
    eo_aggregate_limit = 1000000,
    eo_deductible = 2000,
    contracting_contact_name = 'Jontay Taylor',
    updated_at = now()
where id = '7c3c5581-3544-437f-bfe2-91391afb217d';

-- Local carrier catalog: copied once, then maintained by APEX.
alter table public.carriers
  add column if not exists website text,
  add column if not exists phone text,
  add column if not exists logo_url text;

update public.carriers c
set website = coalesce(c.website, al.website),
    phone = coalesce(c.phone, al.phone),
    logo_url = coalesce(c.logo_url, al.logo_url)
from public.agentlink_carriers al
where lower(trim(c.name)) = lower(trim(al.name));

alter table public.apex_carrier_contracts
  add column if not exists carrier_uuid uuid references public.carriers(id) on delete set null,
  add column if not exists requested_at timestamptz,
  add column if not exists commission_level text;

update public.apex_carrier_contracts ac
set carrier_uuid = coalesce(ac.carrier_uuid, (
      select c.id
      from public.agentlink_carriers al
      join public.carriers c on lower(trim(c.name)) = lower(trim(al.name))
      where al.id = ac.carrier_id
      limit 1
    )),
    requested_at = coalesce(ac.requested_at, ac.synced_at),
    commission_level = coalesce(ac.commission_level, (
      select a.comp_percentage::text || '%' from public.agents a where a.id = ac.agent_id
    ));

drop function if exists public.apex_contracts_list(text,text,text,int,int);
create function public.apex_contracts_list(
  p_scope text default 'agency', p_status text default 'all', p_search text default null,
  p_limit int default 100, p_offset int default 0
)
returns table (
  id uuid, carrier_name text, agent_name text, agent_id uuid, status text,
  commission_level text, writing_number text, contract_number text,
  requested_at timestamptz, activated_date timestamptz
)
language sql stable security definer set search_path to 'public'
as $$
  select
    md5('apex-contract-' || c.id::text)::uuid,
    ca.name,
    a.display_name,
    c.agent_id,
    c.status,
    coalesce(nullif(c.commission_level,''), a.comp_percentage::text || '%'),
    c.writing_number,
    c.contract_number,
    c.requested_at,
    c.activated_date
  from public.apex_carrier_contracts c
  left join public.carriers ca on ca.id = c.carrier_uuid
  left join public.agents a on a.id = c.agent_id
  where c.agent_id in (select s.agent_id from public.apex_contract_scope_agents(p_scope) s)
    and not public.fn_agent_is_roster_excluded(c.agent_id)
    and (coalesce(nullif(lower(p_status),''),'all') = 'all' or lower(c.status) = lower(p_status))
    and (p_search is null or btrim(p_search) = ''
      or coalesce(ca.name,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(a.display_name,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(c.writing_number,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(c.contract_number,'') ilike '%' || btrim(p_search) || '%')
  order by case lower(c.status) when 'issue' then 0 when 'jail' then 1 else 2 end,
           c.requested_at desc nulls last, c.id
  limit greatest(1, least(coalesce(p_limit,100),500))
  offset greatest(0,coalesce(p_offset,0));
$$;

create or replace function public.apex_contracts_summary(p_scope text default 'agency', p_search text default null)
returns jsonb language sql stable security definer set search_path to 'public'
as $$
  with scoped as (
    select c.status,c.id
    from public.apex_carrier_contracts c
    left join public.carriers ca on ca.id=c.carrier_uuid
    left join public.agents a on a.id=c.agent_id
    where c.agent_id in (select s.agent_id from public.apex_contract_scope_agents(p_scope) s)
      and not public.fn_agent_is_roster_excluded(c.agent_id)
      and (p_search is null or btrim(p_search)=''
        or coalesce(ca.name,'') ilike '%'||btrim(p_search)||'%'
        or coalesce(a.display_name,'') ilike '%'||btrim(p_search)||'%'
        or coalesce(c.writing_number,'') ilike '%'||btrim(p_search)||'%'
        or coalesce(c.contract_number,'') ilike '%'||btrim(p_search)||'%')
  )
  select jsonb_build_object(
    'total',(select count(*) from scoped),
    'active',(select count(*) from scoped where lower(status)='active'),
    'requested',(select count(*) from scoped where lower(status) in ('requested','ready_to_contract')),
    'issues',(select count(*) from scoped where lower(status) in ('issue','jail','rejected')),
    'by_status',coalesce((select jsonb_object_agg(k,n) from
      (select coalesce(lower(status),'unknown') k,count(*) n from scoped group by 1) x),'{}'::jsonb)
  );
$$;

create or replace function public.apex_agent_contract_checklist(p_agent_id uuid)
returns table (
  carrier_id uuid, carrier_name text, workflow_status text, sent_at timestamptz,
  sent_by_name text, completed_at timestamptz, status_note text,
  contract_pct numeric, effective_pct numeric, override_pct numeric,
  live_status text, writing_number text, contract_number text, updated_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null or not public.apex_can_read_agent(p_agent_id) then
    raise exception 'Not permitted to view this agent' using errcode='42501';
  end if;
  return query
  select c.id,c.name,coalesce(acc.contract_status,'not_started'),acc.contract_sent_at,
    coalesce(nullif(trim(actor.full_name),''),nullif(trim(actor.display_name),'')),
    acc.contract_completed_at,acc.contract_status_note,acc.contract_pct,acc.effective_pct,acc.override_pct,
    live.status,live.writing_number,live.contract_number,acc.updated_at
  from public.carriers c
  left join public.agent_carrier_comp acc on acc.agent_id=p_agent_id and lower(trim(acc.carrier_name))=lower(trim(c.name))
  left join lateral (
    select (select pr.full_name from public.profiles pr where pr.user_id=acc.contract_sent_by order by pr.updated_at desc nulls last limit 1) full_name,
           (select ax.display_name from public.agents ax where ax.user_id=acc.contract_sent_by order by ax.updated_at desc nulls last limit 1) display_name
  ) actor on true
  left join lateral (
    select ac.status,ac.writing_number,ac.contract_number
    from public.apex_carrier_contracts ac
    where ac.agent_id=p_agent_id and ac.carrier_uuid=c.id
    order by case lower(coalesce(ac.status,'')) when 'active' then 0 when 'submitted' then 1 else 2 end,
             ac.synced_at desc nulls last,ac.id limit 1
  ) live on true
  where coalesce(c.is_active,true)
  order by c.name;
end;
$$;

revoke all on function public.apex_contracts_list(text,text,text,int,int) from public,anon,authenticated;
revoke all on function public.apex_contracts_summary(text,text) from public,anon,authenticated;
grant execute on function public.apex_contracts_list(text,text,text,int,int) to authenticated;
grant execute on function public.apex_contracts_summary(text,text) to authenticated;
grant select on public.carriers to authenticated;

comment on function public.apex_contracts_list(text,text,text,int,int) is
  'APEX-native contracting rows. No AgentLink runtime dependency.';
comment on function public.apex_agent_contract_checklist(uuid) is
  'APEX-native per-agent carrier checklist plus APEX appointment records.';

-- Keep the historical r2_agentlink column name for API compatibility, but its
-- meaning is now the native contracting profile: NPN + saved comp.
create or replace view public.v_onboarding_sequence
with (security_invoker=true)
as
with a as (
  select ag.id agent_id,
    coalesce(ag.display_name,p.full_name,'(agent '||left(ag.id::text,8)||')') agent_name,
    coalesce(m.display_name,'unassigned') manager,
    ag.license_status::text license_status, ag.onboarding_stage::text onboarding_stage,
    ag.created_at hired_at, coalesce(ag.profile_id,p.id) profile_id, ag.al_user_id, ag.insuracloud_user_id,
    ag.nipr_number, ag.comp_percentage,
    ag.contracted_at, ag.first_appointment_at, ag.has_discord_access,
    ag.has_training_course, ag.field_training_started_at, ag.onboarding_completed_at,
    ag.first_deal_at, ag.stage_changed_at, ag.next_action_text, ag.next_action_due_at
  from public.agents ag
  left join public.profiles p on p.id=ag.profile_id or p.user_id=ag.user_id
  left join public.agents m on m.id=ag.manager_id
  where ag.is_deactivated is not true and ag.is_inactive is not true and ag.canonical_agent_id is null
), flags as (
  select a.*,
    profile_id is not null r1,
    nullif(regexp_replace(coalesce(nipr_number,''),'\D','','g'),'') is not null
      and comp_percentage between 50 and 200 r2,
    contracted_at is not null r3,
    first_appointment_at is not null r4,
    has_discord_access is true r5,
    has_training_course is true or field_training_started_at is not null r6,
    onboarding_completed_at is not null or onboarding_stage='live' r7,
    first_deal_at is not null r8
  from a
)
select agent_id,agent_name,manager,license_status,onboarding_stage,hired_at,profile_id,
  al_user_id,insuracloud_user_id,contracted_at,first_appointment_at,has_discord_access,
  has_training_course,field_training_started_at,onboarding_completed_at,first_deal_at,
  stage_changed_at,next_action_text,next_action_due_at,
  r1 r1_intake,r2 r2_agentlink,r3 r3_contracted,r4 r4_appointment,r5 r5_discord,
  r6 r6_training,r7 r7_launch_ready,r8 r8_first_sale,
  case when not r1 then '1. Complete intake / profile'
       when not r2 then '2. Add NPN + comp to contracting profile'
       when not r3 then '3. Carrier contracting'
       when not r4 then '4. Set first appointment'
       when not r5 then '5. Discord / GCR access'
       when not r6 then '6. Start training'
       when not r7 then '7. Launch-ready sign-off'
       when not r8 then '8. First deal'
       else 'COMPLETE — active producer' end next_missing_step,
  (r1::int+r2::int+r3::int+r4::int+r5::int+r6::int+r7::int+r8::int) rungs_complete,
  (extract(epoch from now()-coalesce(stage_changed_at,hired_at))/86400)::numeric(8,1) days_since_progress
from flags
order by rungs_complete,days_since_progress desc;
