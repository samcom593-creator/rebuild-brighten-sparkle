-- CRM export (2026-09-30). Sam: "a button in CRM to download all agents:
-- first name, last name, email, NPN." Same audience as the roster
-- (crm_can_read_roster), every non-duplicate, non-placeholder agent, any status.
create or replace function public.crm_agents_export()
returns table(first_name text, last_name text, email text, npn text, phone text, status text, license_status text, manager_name text, agent_code text, start_date date)
language sql stable security definer set search_path to 'public' as $$
  select
    coalesce(nullif(split_part(coalesce(pr.full_name, g.display_name), ' ', 1),''), g.display_name),
    nullif(regexp_replace(coalesce(pr.full_name, g.display_name), '^\S+\s*', ''), ''),
    coalesce(nullif(pr.email,''), (select ci.email from public.contracting_intakes ci where ci.agent_id = g.id and ci.email <> '' order by ci.created_at desc limit 1), ap.email),
    coalesce(nullif(g.nipr_number,''), (select ci.npn from public.contracting_intakes ci where ci.agent_id = g.id and ci.npn <> '' order by ci.created_at desc limit 1), nullif(ap.nipr_number,'')),
    coalesce(nullif(pr.phone,''), (select ci.phone_e164 from public.contracting_intakes ci where ci.agent_id = g.id and ci.phone_e164 <> '' order by ci.created_at desc limit 1), ap.phone),
    case when coalesce(g.is_deactivated,false) or g.status = 'terminated' then 'terminated'
         when coalesce(g.is_inactive,false) or g.status = 'inactive' then 'inactive' else g.status::text end,
    g.license_status::text, mg.display_name, g.agent_code, g.start_date
  from public.agents g
  left join public.profiles pr on pr.id = g.profile_id
  left join public.applications ap on ap.id = g.source_application_id
  left join public.agents mg on mg.id = g.manager_id
  where public.crm_can_read_roster()
    and g.canonical_agent_id is null
    and coalesce(g.agent_code,'') not like 'GHOST_%'
  order by 2, 1;
$$;
revoke all on function public.crm_agents_export() from public, anon;
grant execute on function public.crm_agents_export() to authenticated;
