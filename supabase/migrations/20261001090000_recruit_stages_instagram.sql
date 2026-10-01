-- Recruit Stages: Instagram on every row (2026-10-01). Sam: "ADD instagram to
-- recruit stages." Handles live on applications.instagram_handle (406 of 722
-- active applicants) and profiles.instagram_handle (31 of 142 agents), in loose
-- formats: bare, @-prefixed, full URLs, and the odd plain name. Normalised to
-- the bare handle; anything that is not a handle comes back null.
create or replace function public.fn_normalize_instagram_handle(p text)
returns text language sql immutable as $$
  select case
    when p is null then null
    else (select case when h ~ '^[a-z0-9._]{1,30}$' then h end
            from (select nullif(regexp_replace(regexp_replace(lower(btrim(p)), '^(https?://)?(www\.)?instagram\.com/', ''), '^@|/.*$|\?.*$', '', 'g'), '') h) x)
  end
$$;

-- Save a handle from the row. Applicants: applications.instagram_handle.
-- Agents: their profile row, falling back to the source application.
create or replace function public.set_recruit_instagram(p_application_id uuid, p_agent_id uuid, p_handle text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_h text := public.fn_normalize_instagram_handle(p_handle); v_profile uuid; v_app uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_application_id is null) = (p_agent_id is null) then raise exception 'pass exactly one of application or agent'; end if;
  if not public.fn_recruit_scope_ok(p_application_id, p_agent_id) then raise exception 'not allowed to edit this person' using errcode='42501'; end if;
  -- Empty input clears the handle; anything non-empty that does not normalise to a
  -- handle is refused rather than silently clearing what was there.
  if nullif(btrim(coalesce(p_handle,'')),'') is not null and v_h is null then raise exception 'that is not an Instagram handle'; end if;
  if p_application_id is not null then
    update public.applications set instagram_handle = v_h, updated_at = now() where id = p_application_id;
  else
    select profile_id, source_application_id into v_profile, v_app from public.agents where id = p_agent_id;
    if v_profile is not null then
      update public.profiles set instagram_handle = v_h where id = v_profile;
    elsif v_app is not null then
      update public.applications set instagram_handle = v_h, updated_at = now() where id = v_app;
    else
      raise exception 'this agent has no profile or application to hold a handle';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'instagram', v_h);
end;
$$;
revoke all on function public.set_recruit_instagram(uuid,uuid,text) from public, anon;
grant execute on function public.set_recruit_instagram(uuid,uuid,text) to authenticated;

drop function if exists public.recruit_pipeline_list();
create or replace function public.recruit_pipeline_list()
returns table(
  person_type text, application_id uuid, agent_id uuid, display_name text, phone text, email text, state text,
  stage_key text, stage_name text, order_index integer, entered_at timestamptz, days_in_stage numeric,
  is_stalled boolean, sla_due_at timestamptz, next_action_label text, manager_name text,
  license_status text, license_progress text, npn text, last_contacted_at timestamptz, manual_stage_key text, status text,
  instagram text)
language sql stable security definer set search_path to 'public' as $$
  with staff as (select public.apex_is_admin() or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'va') ok),
  mgr as (select public.has_role(auth.uid(),'manager') ok),
  mine as (select array_agg(id) ids from public.agents where user_id = auth.uid() and coalesce(is_deactivated,false) = false)
  select p.person_type, p.application_id, p.agent_id,
         coalesce(g.display_name, nullif(regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g'),''), '(no name)'),
         coalesce(nullif(pr.phone,''), nullif(a.phone,'')), coalesce(pr.email, a.email), a.state,
         p.current_stage_key, s.display_name, s.order_index, p.entered_at,
         round(extract(epoch from now() - p.entered_at) / 86400.0, 1), coalesce(p.is_stalled,false), p.sla_due_at, s.next_action_label,
         coalesce(mg.display_name, hm.display_name),
         coalesce(g.license_status::text, a.license_status::text),
         coalesce(g.license_progress::text, a.license_progress::text),
         coalesce(nullif(g.nipr_number,''), nullif(a.nipr_number,'')),
         coalesce(a.last_contacted_at, g.updated_at), p.manual_stage_key, p.status,
         public.fn_normalize_instagram_handle(coalesce(nullif(btrim(pr.instagram_handle),''), nullif(btrim(a.instagram_handle),''), nullif(btrim(sa.instagram_handle),'')))
  from public.next_step_progress p
  join public.next_step_stages s on s.stage_key = p.current_stage_key
  left join public.applications a on a.id = p.application_id
  left join public.agents g on g.id = p.agent_id
  left join public.profiles pr on pr.id = g.profile_id
  left join public.agents mg on mg.id = g.manager_id
  left join public.agents hm on hm.user_id = a.hiring_manager_user_id and hm.canonical_agent_id is null
  left join public.applications sa on sa.id = g.source_application_id
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
