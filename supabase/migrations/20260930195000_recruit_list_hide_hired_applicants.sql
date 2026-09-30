-- Recruit Stages: hide applicants who already became agents (Tyler Krejcha showed twice).
drop function if exists public.recruit_pipeline_list();
create or replace function public.recruit_pipeline_list()
returns table(
  person_type text, application_id uuid, agent_id uuid, display_name text, phone text, email text, state text,
  stage_key text, stage_name text, order_index integer, entered_at timestamptz, days_in_stage numeric,
  is_stalled boolean, sla_due_at timestamptz, next_action_label text, manager_name text,
  license_status text, license_progress text, npn text, last_contacted_at timestamptz, manual_stage_key text, status text)
language sql stable security definer set search_path to 'public' as $$
  with staff as (select public.apex_is_admin() or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'va') ok),
  mgr as (select public.has_role(auth.uid(),'manager') ok),
  mine as (select array_agg(id) ids from public.agents where user_id = auth.uid() and coalesce(is_deactivated,false) = false)
  select p.person_type, p.application_id, p.agent_id,
         coalesce(g.display_name, nullif(btrim(concat_ws(' ', a.first_name, a.last_name)),''), '(no name)'),
         coalesce(nullif(pr.phone,''), nullif(a.phone,'')), coalesce(pr.email, a.email), a.state,
         p.current_stage_key, s.display_name, s.order_index, p.entered_at,
         round(extract(epoch from now() - p.entered_at) / 86400.0, 1), coalesce(p.is_stalled,false), p.sla_due_at, s.next_action_label,
         coalesce(mg.display_name, hm.display_name),
         coalesce(g.license_status::text, a.license_status::text),
         coalesce(g.license_progress::text, a.license_progress::text),
         coalesce(nullif(g.nipr_number,''), nullif(a.nipr_number,'')),
         coalesce(a.last_contacted_at, g.updated_at), p.manual_stage_key, p.status
  from public.next_step_progress p
  join public.next_step_stages s on s.stage_key = p.current_stage_key
  left join public.applications a on a.id = p.application_id
  left join public.agents g on g.id = p.agent_id
  left join public.profiles pr on pr.id = g.profile_id
  left join public.agents mg on mg.id = g.manager_id
  left join public.agents hm on hm.user_id = a.hiring_manager_user_id and hm.canonical_agent_id is null
  where auth.uid() is not null
    and (p.application_id is not null or (g.id is not null and g.canonical_agent_id is null and coalesce(g.agent_code,'') not like 'GHOST_%'))
    and (a.id is null or coalesce(a.is_duplicate,false) = false)
    -- A person who already has an agent row is tracked as that agent; never show
    -- them a second time as an applicant stuck at "Applied".
    and (a.id is null or not exists (
          select 1 from public.agents ag
          left join public.profiles pr on pr.id = ag.profile_id
          where ag.canonical_agent_id is null
            and (ag.source_application_id = a.id
                 or (a.email is not null and pr.email is not null and lower(pr.email) = lower(a.email)))))
    and ( (select ok from staff)
          or ((select ok from mgr) and (
                (p.agent_id is not null and exists (select 1 from public.fn_contracting_checkin_scope() sc where sc.agent_id = p.agent_id))
             or (p.application_id is not null and (a.hiring_manager_user_id = auth.uid() or a.recruiter_id = auth.uid()
                  or a.assigned_agent_id = any(coalesce((select ids from mine),'{}')) or a.referral_manager_id = any(coalesce((select ids from mine),'{}'))))))
        );
$$;
revoke all on function public.recruit_pipeline_list() from public, anon;
grant execute on function public.recruit_pipeline_list() to authenticated;
