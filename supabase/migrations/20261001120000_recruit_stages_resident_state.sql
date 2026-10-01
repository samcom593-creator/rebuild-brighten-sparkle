-- Resident state on every recruit row (2026-10-01). Sam: "add state so I can
-- track that, for possible lock-ins." Applicants carry it from the apply form
-- (677 of 722). Agents mostly do not (6 of 133 had any source), so the list
-- falls back through the agent's source application, an application matching
-- their profile email, the AgentLink roster mirror's residence state, and
-- license_states[1]. A hand-entered state lives in agents.metadata.
-- NPN -> resident state via NIPR was NOT built: no NIPR API key exists on this
-- machine and the public lookups are per-state scrapes. Not worth the burn.
create or replace function public.fn_normalize_us_state(p text)
returns text language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when upper(btrim(p)) ~ '^[A-Z]{2}$' then upper(btrim(p))
    else initcap(btrim(p))
  end
$$;

create or replace function public.set_recruit_state(p_application_id uuid, p_agent_id uuid, p_state text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_s text := public.fn_normalize_us_state(p_state);
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_application_id is null) = (p_agent_id is null) then raise exception 'pass exactly one of application or agent'; end if;
  if not public.fn_recruit_scope_ok(p_application_id, p_agent_id) then raise exception 'not allowed to edit this person' using errcode='42501'; end if;
  if v_s is not null and v_s !~ '^[A-Z]{2}$' then raise exception 'use the two-letter state code'; end if;
  if p_application_id is not null then
    update public.applications set state = v_s, updated_at = now() where id = p_application_id;
  else
    update public.agents set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('resident_state', v_s), updated_at = now() where id = p_agent_id;
  end if;
  return jsonb_build_object('ok', true, 'state', v_s);
end;
$$;
revoke all on function public.set_recruit_state(uuid,uuid,text) from public, anon;
grant execute on function public.set_recruit_state(uuid,uuid,text) to authenticated;

drop function if exists public.recruit_pipeline_list();
create or replace function public.recruit_pipeline_list()
returns table(
  person_type text, application_id uuid, agent_id uuid, display_name text, phone text, email text, state text,
  stage_key text, stage_name text, order_index integer, entered_at timestamptz, days_in_stage numeric,
  is_stalled boolean, sla_due_at timestamptz, next_action_label text, manager_name text,
  license_status text, license_progress text, npn text, last_contacted_at timestamptz, manual_stage_key text, status text,
  instagram text, link_sent_at timestamptz, link_used_at timestamptz, last_sign_in_at timestamptz, resident_state text)
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
         public.fn_normalize_instagram_handle(coalesce(nullif(btrim(pr.instagram_handle),''), nullif(btrim(a.instagram_handle),''), nullif(btrim(sa.instagram_handle),''))),
         lk.link_sent_at, lk.link_used_at, u.last_sign_in_at,
         public.fn_normalize_us_state(coalesce(
           nullif(btrim(g.metadata->>'resident_state'),''),
           nullif(btrim(sa.state),''),
           nullif(btrim(ea.state),''),
           nullif(btrim(ala.residence_state),''), nullif(btrim(ala.state),''),
           (g.license_states)[1],
           nullif(btrim(a.state),'')))
  from public.next_step_progress p
  join public.next_step_stages s on s.stage_key = p.current_stage_key
  left join public.applications a on a.id = p.application_id
  left join public.agents g on g.id = p.agent_id
  left join public.profiles pr on pr.id = g.profile_id
  left join public.agents mg on mg.id = g.manager_id
  left join public.agents hm on hm.user_id = a.hiring_manager_user_id and hm.canonical_agent_id is null
  left join public.applications sa on sa.id = g.source_application_id
  left join lateral (select max(t.created_at) link_sent_at, max(t.used_at) link_used_at from public.magic_login_tokens t where t.agent_id = g.id) lk on true
  left join auth.users u on u.id = g.user_id
  left join lateral (select x.state from public.applications x where g.id is not null and pr.email is not null and lower(x.email) = lower(pr.email) and coalesce(x.is_duplicate,false) = false order by x.created_at desc limit 1) ea on true
  left join lateral (select x.residence_state, x.state from public.agentlink_agents x
                      where g.id is not null and (x.local_agent_id = g.id
                         or (g.insuracloud_user_id is not null and x.insuracloud_user_id = g.insuracloud_user_id)
                         or (g.al_user_id is not null and x.insuracloud_user_id = g.al_user_id)
                         or (pr.email is not null and lower(x.email) = lower(pr.email)))
                      order by x.updated_at desc nulls last limit 1) ala on true
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

