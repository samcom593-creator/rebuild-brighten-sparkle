-- Recruit stages, editable in place (2026-09-30). Sam: "fix the licensing
-- tracking so I can see where recruits are at ... make it way easier to change
-- and edit stages on that page, I shouldn't have to go to the agent's profile."
--
-- The Next Step Engine already models the whole recruit ladder (19 stages,
-- applied -> first $10K week) and derives each stage from evidence columns.
-- Two gaps made hand edits unreliable: (1) fn_next_step_manual_advance stamped
-- contacted_at while the derivation reads last_contacted_at, so "Contacted"
-- never stuck; (2) nothing could move a person BACKWARD, and a stage the
-- derivation cannot produce (e.g. Application Complete, In Contracting for an
-- applicant) was overwritten by the nightly recompute.
--
-- Fix: a manual override on next_step_progress that recompute honours unless
-- real evidence outranks it (a posted deal always beats a hand-set stage), and
-- set_recruit_stage() which stamps or clears the evidence columns so the
-- derived stage lands where the operator put it.

alter table public.next_step_progress
  add column if not exists manual_stage_key text,
  add column if not exists manual_stage_at timestamptz,
  add column if not exists manual_by uuid;

create or replace function public.fn_next_step_rank(p_stage text)
returns integer language sql stable set search_path to 'public' as $$
  select coalesce((select order_index from public.next_step_stages where stage_key = p_stage), 0);
$$;

create or replace function public.fn_next_step_recompute_one(p_application_id uuid default null, p_agent_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_row record; v_prior text; v_status text;
  v_manual text; v_manual_at timestamptz;
  v_final text; v_entered timestamptz; v_sla_hours numeric; v_sla timestamptz; v_stalled boolean; v_terminal boolean;
begin
  if p_application_id is null and p_agent_id is null then return; end if;

  select * into v_row from public.v_next_step_current
  where (application_id = p_application_id and p_application_id is not null)
     or (agent_id = p_agent_id and p_agent_id is not null)
  limit 1;
  if not found then return; end if;

  select current_stage_key, manual_stage_key, manual_stage_at into v_prior, v_manual, v_manual_at
  from public.next_step_progress
  where (application_id = p_application_id and p_application_id is not null)
     or (agent_id = p_agent_id and p_agent_id is not null)
  limit 1;

  -- Manual override wins while it is at or beyond what the evidence shows.
  -- Evidence that moves the person PAST the hand-set stage retires it.
  if v_manual is not null and public.fn_next_step_rank(v_manual) >= public.fn_next_step_rank(v_row.derived_stage_key) then
    v_final := v_manual;
    v_entered := case when v_manual = v_row.derived_stage_key then v_row.stage_entered_at else coalesce(v_manual_at, now()) end;
  else
    v_final := v_row.derived_stage_key;
    v_entered := v_row.stage_entered_at;
    v_manual := null; v_manual_at := null;
  end if;

  select sla_hours, coalesce(is_terminal,false) into v_sla_hours, v_terminal from public.next_step_stages where stage_key = v_final;
  v_sla := case when v_sla_hours is null then null else v_entered + (v_sla_hours || ' hours')::interval end;
  v_stalled := case when v_sla is null then false else now() > v_sla end;
  v_status := case when v_final = 'closed_lost' then 'closed_lost' when v_terminal then 'completed' else 'active' end;

  if p_application_id is not null then
    if exists (select 1 from public.next_step_progress where application_id = p_application_id) then
      update public.next_step_progress
        set current_stage_key = v_final, entered_at = v_entered, sla_due_at = v_sla,
            owner_user_id = v_row.owner_user_id, owner_role = v_row.owner_role, status = v_status,
            prior_stage_key = case when current_stage_key <> v_final then current_stage_key else prior_stage_key end,
            is_stalled = v_stalled, manual_stage_key = v_manual, manual_stage_at = v_manual_at,
            manual_by = case when v_manual is null then null else manual_by end, updated_at = now()
        where application_id = p_application_id;
    else
      insert into public.next_step_progress
        (person_type, application_id, current_stage_key, entered_at, sla_due_at, owner_user_id, owner_role, status, prior_stage_key, is_stalled, updated_at)
      values (v_row.person_type, p_application_id, v_final, v_entered, v_sla, v_row.owner_user_id, v_row.owner_role, v_status, v_prior, v_stalled, now());
    end if;
    update public.applications set next_step_stage_key = v_final, next_step_due_at = v_sla where id = p_application_id;
  end if;

  if p_agent_id is not null then
    if exists (select 1 from public.next_step_progress where agent_id = p_agent_id) then
      update public.next_step_progress
        set current_stage_key = v_final, entered_at = v_entered, sla_due_at = v_sla,
            owner_user_id = v_row.owner_user_id, owner_role = v_row.owner_role, status = v_status,
            prior_stage_key = case when current_stage_key <> v_final then current_stage_key else prior_stage_key end,
            is_stalled = v_stalled, manual_stage_key = v_manual, manual_stage_at = v_manual_at,
            manual_by = case when v_manual is null then null else manual_by end, updated_at = now()
        where agent_id = p_agent_id;
    else
      insert into public.next_step_progress
        (person_type, agent_id, current_stage_key, entered_at, sla_due_at, owner_user_id, owner_role, status, prior_stage_key, is_stalled, updated_at)
      values (v_row.person_type, p_agent_id, v_final, v_entered, v_sla, v_row.owner_user_id, v_row.owner_role, v_status, v_prior, v_stalled, now());
    end if;
    update public.agents set next_step_stage_key = v_final, next_step_due_at = v_sla where id = p_agent_id;
  end if;

  if v_prior is null or v_prior <> v_final then
    insert into public.next_step_events (application_id, agent_id, from_stage, to_stage, event_type, source, payload)
    values (p_application_id, p_agent_id, v_prior, v_final,
            case when v_prior is null then 'seed' else 'advance' end, 'recompute',
            jsonb_build_object('triggered_by','fn_next_step_recompute_one','sla_due_at',v_sla,'derived',v_row.derived_stage_key,'manual',v_manual));
  end if;
end;
$function$;

-- Who may edit which recruit. Admin/VA: everyone. Manager: applicants routed
-- to them and agents in their direct reports.
create or replace function public.fn_recruit_scope_ok(p_application_id uuid, p_agent_id uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_mine uuid[];
begin
  if v_uid is null then return false; end if;
  if public.apex_is_admin() or public.has_role(v_uid,'va_manager') or public.has_role(v_uid,'va') then return true; end if;
  if not public.has_role(v_uid,'manager') then return false; end if;
  if p_agent_id is not null then
    return exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id = p_agent_id);
  end if;
  select array_agg(id) into v_mine from public.agents where user_id = v_uid and coalesce(is_deactivated,false) = false;
  return exists (
    select 1 from public.applications a where a.id = p_application_id
      and (a.hiring_manager_user_id = v_uid or a.recruiter_id = v_uid
           or a.assigned_agent_id = any(coalesce(v_mine,'{}')) or a.referral_manager_id = any(coalesce(v_mine,'{}'))));
end;
$$;

create or replace function public.set_recruit_stage(
  p_application_id uuid, p_agent_id uuid, p_to_stage text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid(); v_now timestamptz := now();
  v_to int; v_cur text; v_cur_rank int; v_final text; v_hired int := public.fn_next_step_rank('hired');
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_application_id is null) = (p_agent_id is null) then raise exception 'pass exactly one of application or agent'; end if;
  if not exists (select 1 from public.next_step_stages where stage_key = p_to_stage) then raise exception 'unknown stage %', p_to_stage; end if;
  if not public.fn_recruit_scope_ok(p_application_id, p_agent_id) then raise exception 'not allowed to edit this person' using errcode='42501'; end if;

  v_to := public.fn_next_step_rank(p_to_stage);
  if p_application_id is not null and v_to >= v_hired and p_to_stage <> 'closed_lost' then
    return jsonb_build_object('ok', false, 'reason', 'not_an_agent',
      'message', 'They are not an agent yet. Hire them (Add Agent) and the later stages open up.');
  end if;
  if p_agent_id is not null and v_to < v_hired then
    return jsonb_build_object('ok', false, 'reason', 'agent_before_hired',
      'message', 'They are already hired, so the applicant stages do not apply. Their licensing shows on the row.');
  end if;
  if p_agent_id is not null and p_to_stage = 'closed_lost' then
    return jsonb_build_object('ok', false, 'reason', 'use_no_longer_with_us',
      'message', 'For an agent, use "No longer with us" so they are removed properly and get the re-engagement email.');
  end if;

  select current_stage_key into v_cur from public.next_step_progress
   where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null) limit 1;
  v_cur_rank := public.fn_next_step_rank(coalesce(v_cur,'applied'));

  if p_application_id is not null then
    update public.applications set
      updated_at = v_now,
      -- forward evidence: stamp only what the target implies
      vsl_watched_at         = case when v_to >= 2  then coalesce(vsl_watched_at, v_now) else null end,
      last_contacted_at      = case when v_to >= 4  then coalesce(last_contacted_at, v_now) else null end,
      contacted_at           = case when v_to >= 4  then coalesce(contacted_at, v_now) else null end,
      seminar_registered_at  = case when v_to >= 5  then coalesce(seminar_registered_at, v_now) else null end,
      seminar_date           = case when v_to >= 5  then seminar_date else null end,
      seminar_attended_at    = case when v_to >= 6  then coalesce(seminar_attended_at, v_now) else null end,
      course_purchased_at    = case when v_to >= 7  then coalesce(course_purchased_at, v_now) else null end,
      course_started_at      = case when v_to >= 7  then coalesce(course_started_at, v_now) else null end,
      license_progress       = case when v_to >= 8 and v_to <= 11 then 'finished_course'::license_progress
                                    when v_to = 7 then 'course_purchased'::license_progress
                                    when v_to < 7 then 'unlicensed'::license_progress
                                    else license_progress end,
      exam_scheduled_at      = case when v_to >= 9  then coalesce(exam_scheduled_at, v_now) else null end,
      exam_passed_at         = case when v_to >= 10 then coalesce(exam_passed_at, v_now) else null end,
      fingerprints_submitted_at = case when v_to >= 10 then fingerprints_submitted_at else null end,
      fingerprint_done       = case when v_to >= 10 then fingerprint_done else false end,
      contracted_at          = case when v_to >= 11 then coalesce(contracted_at, v_now) else null end,
      status                 = case when p_to_stage = 'closed_lost' then 'lapsed'::application_status
                                    when v_to = 11 then 'contracting'::application_status
                                    when status in ('lapsed','rejected','disqualified','contracting') then 'new'::application_status
                                    else status end
    where id = p_application_id;
  else
    update public.agents set
      updated_at = v_now,
      has_training_course       = case when v_to >= 13 then true else false end,
      onboarding_completed_at   = case when v_to >= 14 then coalesce(onboarding_completed_at, v_now) else null end,
      field_training_started_at = case when v_to >= 15 then coalesce(field_training_started_at, v_now) else null end,
      onboarding_stage          = case when v_to = 15 then 'in_field_training'::onboarding_stage
                                       when v_to < 15 and onboarding_stage = 'in_field_training' then 'onboarding'::onboarding_stage
                                       else onboarding_stage end,
      first_appointment_at      = case when v_to >= 16 then coalesce(first_appointment_at, v_now) else null end,
      first_deal_at             = case when v_to >= 17 then coalesce(first_deal_at, v_now) else null end,
      first_10k_at              = case when v_to >= 18 then coalesce(first_10k_at, v_now) else null end,
      weekly_10k_badges         = case when v_to >= 18 then greatest(coalesce(weekly_10k_badges,0),1) else 0 end
    where id = p_agent_id;
  end if;

  -- Hand-set stage, honoured by recompute until evidence outranks it.
  update public.next_step_progress
     set manual_stage_key = p_to_stage, manual_stage_at = v_now, manual_by = v_uid, updated_at = v_now
   where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null);
  if not found then
    insert into public.next_step_progress (person_type, application_id, agent_id, current_stage_key, entered_at, status, manual_stage_key, manual_stage_at, manual_by)
    values (case when p_application_id is not null then 'applicant' else 'agent' end, p_application_id, p_agent_id, p_to_stage, v_now, 'active', p_to_stage, v_now, v_uid);
  end if;

  perform public.fn_next_step_recompute_one(p_application_id, p_agent_id);

  select current_stage_key into v_final from public.next_step_progress
   where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null) limit 1;

  insert into public.next_step_events (application_id, agent_id, from_stage, to_stage, event_type, actor_user_id, source, payload)
  values (p_application_id, p_agent_id, v_cur, v_final, 'manual_override', v_uid, 'manual',
          jsonb_build_object('requested', p_to_stage, 'reason', nullif(btrim(p_reason),'')));

  return jsonb_build_object('ok', true, 'requested', p_to_stage, 'final', v_final, 'matched', v_final = p_to_stage,
    'message', case when v_final = p_to_stage then null
                    else 'Evidence on file puts them at ' || coalesce((select display_name from public.next_step_stages where stage_key = v_final), v_final) || ', so they stay there.' end);
end;
$function$;

create or replace function public.recruit_pipeline_list()
returns table(
  person_type text, application_id uuid, agent_id uuid, display_name text, phone text, email text, state text,
  stage_key text, stage_name text, order_index integer, entered_at timestamptz, days_in_stage numeric,
  is_stalled boolean, sla_due_at timestamptz, next_action_label text, manager_name text,
  license_status text, npn text, last_contacted_at timestamptz, manual_stage_key text, status text)
language sql stable security definer set search_path to 'public' as $$
  with me as (select auth.uid() uid),
  staff as (select public.apex_is_admin() or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'va') ok),
  mgr as (select public.has_role(auth.uid(),'manager') ok),
  mine as (select array_agg(id) ids from public.agents where user_id = auth.uid() and coalesce(is_deactivated,false) = false)
  select p.person_type, p.application_id, p.agent_id,
         coalesce(g.display_name, nullif(btrim(concat_ws(' ', a.first_name, a.last_name)),''), '(no name)'),
         coalesce(nullif(pr.phone,''), nullif(a.phone,'')), coalesce(pr.email, a.email), a.state,
         p.current_stage_key, s.display_name, s.order_index, p.entered_at,
         round(extract(epoch from now() - p.entered_at) / 86400.0, 1), coalesce(p.is_stalled,false), p.sla_due_at, s.next_action_label,
         coalesce(mg.display_name, hm.display_name),
         coalesce(g.license_status::text, a.license_status::text),
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
    and ( (select ok from staff)
          or ((select ok from mgr) and (
                (p.agent_id is not null and exists (select 1 from public.fn_contracting_checkin_scope() sc where sc.agent_id = p.agent_id))
             or (p.application_id is not null and (a.hiring_manager_user_id = auth.uid() or a.recruiter_id = auth.uid()
                  or a.assigned_agent_id = any(coalesce((select ids from mine),'{}')) or a.referral_manager_id = any(coalesce((select ids from mine),'{}'))))))
        );
$$;

revoke all on function public.fn_next_step_rank(text) from public, anon;
revoke all on function public.fn_recruit_scope_ok(uuid,uuid) from public, anon;
revoke all on function public.set_recruit_stage(uuid,uuid,text,text) from public, anon;
revoke all on function public.recruit_pipeline_list() from public, anon;
grant execute on function public.set_recruit_stage(uuid,uuid,text,text) to authenticated;
grant execute on function public.recruit_pipeline_list() to authenticated;
