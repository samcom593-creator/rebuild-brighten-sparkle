-- MP-593 (2026-10-10). apex-doctor Check #90 flags any function that spells the placeholder-agent rule itself instead of
-- calling public.is_placeholder_agent(agent_code, user_id). Four functions from the 2026-10-09 waves wrote the rule inline as
-- `agent_code like 'GHOST\_%' and user_id is null` (semantically the same rule; it is still a second spelling, and the rule
-- has one home because it has already been written wrong twice). Each clause is routed through the function; nothing else
-- in these bodies changes. Bodies below are the live definitions (pg_get_functiondef) with only that substitution.

CREATE OR REPLACE FUNCTION public.fn_agents_default_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.is_placeholder_agent(new.agent_code, new.user_id) then return new; end if;     -- sync-only placeholder seats are not people
  if new.canonical_agent_id is not null and new.canonical_agent_id <> new.id then return new; end if;
  begin
    insert into public.agent_stage (agent_id, stage, source) values (new.id, 'online_training', 'default') on conflict (agent_id) do nothing;
    if found then
      insert into public.agent_stage_events (agent_id, from_stage, to_stage, source) values (new.id, null, 'online_training', 'default');
    end if;
  exception when others then
    raise warning 'fn_agents_default_stage: % (agent %)', sqlerrm, new.id;
  end;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_contract_review_population()
 RETURNS TABLE(agent_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id
  from public.agents a
  where a.status::text = 'active'
    and coalesce(a.is_deactivated, false) = false
    and coalesce(a.is_inactive, false) = false
    and not public.is_placeholder_agent(a.agent_code, a.user_id)           -- sync-only placeholder seats are not people
    and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)       -- a merged duplicate is its canonical row's
    and not public.fn_agent_is_roster_excluded(a.id)
$function$;

CREATE OR REPLACE FUNCTION public.search_people(p_q text, p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_all boolean;
  v_manager boolean;
  v_caller_agent uuid;
  v_tokens text[];
  v_q text := regexp_replace(btrim(coalesce(p_q, '')), '\s+', ' ', 'g');
  v_lim integer := greatest(1, least(coalesce(p_limit, 8), 25));
  v_agents jsonb;
  v_apps jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va') or public.has_role(v_uid, 'recruiter');
  v_manager := public.has_role(v_uid, 'manager');
  if not (v_all or v_manager) then return jsonb_build_object('ok', true, 'agents', '[]'::jsonb, 'applicants', '[]'::jsonb); end if;
  if char_length(v_q) < 2 then return jsonb_build_object('ok', true, 'agents', '[]'::jsonb, 'applicants', '[]'::jsonb); end if;
  select a.id into v_caller_agent from public.agents a where a.user_id = v_uid order by (a.canonical_agent_id is null) desc, a.created_at desc limit 1;
  v_tokens := (select array_agg('%' || public.fn_like_escape(t) || '%') from (select distinct lower(t) t from unnest(string_to_array(v_q, ' ')) t where t <> '' limit 6) x);

  with cand as (
    select a.id, coalesce(nullif(btrim(pr.full_name), ''), a.display_name, 'Name not on file') as name,
           coalesce(pr.email, '') as email, coalesce(pr.phone, '') as phone, coalesce(a.agent_code, '') as code,
           a.status::text as status, a.license_status::text as license, s.stage as stage,
           (select m.display_name from public.agents m where m.id = coalesce(a.manager_id, a.invited_by_manager_id)) as upline,
           lower(coalesce(nullif(btrim(pr.full_name), ''), a.display_name, '') || ' ' || coalesce(pr.email, '') || ' ' || regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g') || ' ' || coalesce(a.agent_code, '')) as hay
      from public.agents a
      left join public.profiles pr on pr.user_id = a.user_id
      left join public.agent_stage s on s.agent_id = a.id
     where (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and not public.is_placeholder_agent(a.agent_code, a.user_id)
       and (v_all or public.apex_can_read_agent(a.id))
  ), hit as (
    select c.*, case when lower(c.name) like public.fn_like_escape(lower(v_q)) || '%' then 0
                     when lower(c.name) like '%' || public.fn_like_escape(lower(split_part(v_q, ' ', 1))) || '%' then 1 else 2 end as rank
      from cand c
     where (select bool_and(c.hay like t) from unnest(v_tokens) t)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'email', nullif(h.email, ''), 'phone', nullif(h.phone, ''), 'code', nullif(h.code, ''),
           'status', h.status, 'license', h.license, 'stage', h.stage, 'upline', h.upline) order by h.rank, h.name), '[]'::jsonb)
    into v_agents from (select * from hit order by rank, name limit v_lim) h;

  with cand as (
    select ap.id, btrim(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, '')) as name, coalesce(ap.email, '') as email, coalesce(ap.phone, '') as phone,
           ap.status::text as status, ap.license_status::text as license, ap.created_at,
           lower(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, '') || ' ' || coalesce(ap.email, '') || ' ' || regexp_replace(coalesce(ap.phone, ''), '\D', '', 'g')) as hay
      from public.applications ap
     where v_all
        or (v_manager and (ap.hiring_manager_user_id = v_uid or ap.referral_manager_id = v_caller_agent
                           or (ap.assigned_agent_id is not null and public.apex_can_read_agent(ap.assigned_agent_id))
                           or (ap.referrer_agent_id is not null and public.apex_can_read_agent(ap.referrer_agent_id))))
  ), hit as (
    select c.*, case when lower(c.name) like public.fn_like_escape(lower(v_q)) || '%' then 0
                     when lower(c.name) like '%' || public.fn_like_escape(lower(split_part(v_q, ' ', 1))) || '%' then 1 else 2 end as rank
      from cand c
     where (select bool_and(c.hay like t) from unnest(v_tokens) t)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'email', nullif(h.email, ''), 'phone', nullif(h.phone, ''),
           'status', h.status, 'license', h.license, 'applied_at', h.created_at) order by h.rank, h.created_at desc), '[]'::jsonb)
    into v_apps from (select * from hit order by rank, created_at desc limit v_lim) h;

  return jsonb_build_object('ok', true, 'q', v_q, 'agents', v_agents, 'applicants', v_apps);
end $function$;

CREATE OR REPLACE FUNCTION public.team_contracting_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_cfg public.contracting_followup_config%rowtype;
  v_basis_label text;
  v_active boolean;
  v_people jsonb;
  v_counts jsonb;
  v_policy jsonb;
  v_events bigint;
  v_all boolean;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not (public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va') or public.has_role(v_uid, 'manager')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  select * into v_cfg from public.contracting_followup_config where singleton;
  v_active := v_cfg.clock_basis <> 'unset';
  v_basis_label := case v_cfg.clock_basis
    when 'hired' then 'Day hired (the agent record was created)'
    when 'hired_or_licensed' then 'Day hired, or the day they got licensed if later'
    when 'expected_start' then 'Expected start date set in Recruit Pipeline'
    when 'contracting_request' then 'Day the contracting request was filed'
    else 'Not confirmed yet' end;

  select coalesce(jsonb_object_agg(p.key, jsonb_build_object('label', k.label, 'amber_day', p.amber_day, 'deadline_day', p.deadline_day, 'red_day', p.deadline_day + 1)), '{}'::jsonb)
    into v_policy
  from public.contracting_milestone_policy p join public.contract_checkoff_keys k on k.key = p.key and k.active;

  select count(*) into v_events from public.agent_contract_checkoff_events;

  with recursive vis(id, path) as (
    -- Same rule as apex_can_read_agent / crm_can_read_agent_scope, computed ONCE for the whole set instead of once per
    -- person: from every agent row this login owns, walk down manager_id / invited_by_manager_id with a cycle guard.
    select a.id, array[a.id] from public.agents a where a.user_id = v_uid and not v_all
    union all
    select c.id, vis.path || c.id from vis join public.agents c on c.manager_id = vis.id or c.invited_by_manager_id = vis.id
    where not c.id = any(vis.path)
  ), scope as (
    select distinct id from vis
  ), alias as (
    select t.canonical_agent_id as canon, t.id as alias_id from public.agents t where t.canonical_agent_id is not null
  ), pop as (
    select a.id as agent_id, a.display_name, a.created_at, a.licensed_at, a.license_status::text as license_status,
           a.nipr_number, a.user_id, a.profile_id, a.manager_id, a.invited_by_manager_id,
           coalesce(a.manager_id, a.invited_by_manager_id) as mgr_id
    from public.agents a
    where a.status = 'active'
      and coalesce(a.is_inactive, false) = false
      and coalesce(a.is_deactivated, false) = false
      and a.canonical_agent_id is null
      and not public.is_placeholder_agent(a.agent_code, a.user_id)
      and not public.fn_agent_is_roster_excluded(a.id)
      and not exists (select 1 from auth.users u where u.id = a.user_id and u.banned_until > now())
      and not exists (select 1 from public.agent_access_suspensions s where s.user_id = a.user_id and s.lifted_at is null)
      and (v_all or a.id in (select id from scope))
  ), elig as (
    select p.*,
      (select pr.email from public.profiles pr where pr.user_id = p.user_id or pr.id = p.profile_id limit 1) as em,
      (select m.display_name from public.agents m where m.id = p.mgr_id) as manager_name
    from pop p
  ), cls as (
    select e.*,
      case
        when e.license_status is null then 'license_unknown'
        when e.license_status = 'licensed' then 'eligible'
        when (e.licensed_at is not null or nullif(btrim(e.nipr_number), '') is not null
              or exists (select 1 from public.mat_production_unified m where m.agent_id = e.agent_id)
              or exists (select 1 from public.contracting_intakes i where i.agent_id = e.agent_id and i.license_status = 'licensed')
              or exists (select 1 from public.applications ap where lower(btrim(ap.email)) = lower(btrim(e.em)) and ap.license_progress::text = 'licensed'))
          then 'license_conflict'
        else 'not_applicable'
      end as eligibility
    from elig e
  ), st as (
    select c.*,
      case v_cfg.clock_basis
        when 'hired' then (c.created_at at time zone 'America/Phoenix')::date
        when 'hired_or_licensed' then (greatest(c.created_at, c.licensed_at) at time zone 'America/Phoenix')::date
        when 'expected_start' then (select sp.expected_start_on from public.agent_start_plans sp where sp.agent_id = c.agent_id)
        when 'contracting_request' then (select (min(i.created_at) at time zone 'America/Phoenix')::date from public.contracting_intakes i where i.agent_id = c.agent_id)
        else null
      end as start_date
    from cls c
  ), val as (
    select s.*,
      case
        when not v_active then 'policy_pending'
        when s.start_date is null then 'missing'
        when s.start_date > v_today then 'future'
        when s.start_date < date '2020-01-01' then 'invalid'
        else 'ok'
      end as start_validity,
      (v_today - s.start_date) as elapsed
    from st s
  ), ck as (
    -- earliest tick per canonical person and key; a legacy row keyed on a twin id folds onto its canonical
    select distinct on (coalesce(al.canon, c.agent_id), c.contract_key)
           coalesce(al.canon, c.agent_id) as agent_id, c.contract_key, c.checked_at, c.checked_by
    from public.agent_contract_checkoffs c left join alias al on al.alias_id = c.agent_id
    order by coalesce(al.canon, c.agent_id), c.contract_key, c.checked_at
  ), ms as (
    select v.agent_id, k.key, k.label, k.sort, ck.checked_at, ck.checked_by, pol.amber_day, pol.deadline_day
    from val v
    cross join public.contract_checkoff_keys k
    join public.contracting_milestone_policy pol on pol.key = k.key
    left join ck on ck.agent_id = v.agent_id and ck.contract_key = k.key
    where k.active
  ), mj as (
    select m.agent_id, m.key, m.label, m.sort, m.checked_at, m.checked_by, m.amber_day, m.deadline_day,
      public.fn_milestone_state(
        v.eligibility = 'eligible', (v.start_validity = 'ok' and v.elapsed <= v_cfg.window_days) or v.start_validity <> 'ok',
        v_active, v.start_validity = 'ok', v.elapsed::int, m.checked_at is not null, m.amber_day, m.deadline_day) as ev
    from ms m join val v on v.agent_id = m.agent_id
  ), mrows as (
    select mj.agent_id,
      jsonb_agg(jsonb_build_object(
        'key', mj.key, 'label', mj.label, 'state', mj.ev->>'state',
        'done', mj.checked_at is not null, 'checked_at', mj.checked_at,
        'checked_by_name', (select coalesce(nullif(btrim(p.full_name), ''), 'Unnamed account') from public.profiles p where p.user_id = mj.checked_by limit 1),
        'days_late', (mj.ev->>'days_late')::int, 'days_until_overdue', (mj.ev->>'days_until_overdue')::int,
        'amber_day', mj.amber_day, 'deadline_day', mj.deadline_day, 'red_day', mj.deadline_day + 1
      ) order by mj.sort) as milestones,
      bool_or(mj.ev->>'state' = 'overdue') as any_overdue,
      bool_or(mj.ev->>'state' = 'due_soon') as any_due_soon,
      coalesce(max((mj.ev->>'days_late')::int), 0) as max_late,
      min((mj.ev->>'days_until_overdue')::int) filter (where mj.ev->>'state' = 'due_soon') as min_until,
      string_agg(mj.label, ' and ' order by mj.sort) filter (where mj.ev->>'state' = 'overdue') as overdue_labels,
      array_agg(mj.key order by mj.sort) filter (where mj.ev->>'state' = 'overdue') as overdue_keys,
      array_agg(mj.key order by mj.sort) filter (where mj.ev->>'state' = 'due_soon') as due_soon_keys
    from mj group by mj.agent_id
  ), fu as (
    select v.agent_id,
      ci.last_call_at, ci.last_call_outcome, ci.call_count, ci.follow_up_on, ci.next_action, ci.owner_user_id, ci.waiting_on, ci.blocker,
      case when ci.owner_user_id is null then null else coalesce(
        (select nullif(btrim(p.full_name), '') from public.profiles p where p.user_id = ci.owner_user_id limit 1),
        (select nullif(btrim(a2.display_name), '') from public.agents a2 where a2.user_id = ci.owner_user_id and a2.canonical_agent_id is null limit 1),
        'Unnamed account') end as owner_name
    from val v left join public.contracting_checkins ci on ci.agent_id = v.agent_id
  ), full_rows as (
    select v.*, mr.milestones, coalesce(mr.any_overdue, false) as p1, coalesce(mr.any_due_soon, false) as due_soon_any,
      coalesce(mr.max_late, 0) as max_late, mr.min_until, mr.overdue_labels, mr.overdue_keys, mr.due_soon_keys,
      f.last_call_at, f.last_call_outcome, f.call_count, f.follow_up_on, f.next_action, f.owner_user_id, f.waiting_on, f.blocker, f.owner_name,
      (f.follow_up_on is null or f.follow_up_on <= v_today) as followup_due_now,
      (v.eligibility = 'eligible' and v_active and v.start_validity in ('missing', 'future', 'invalid')) as needs_review,
      (v.eligibility in ('license_conflict', 'license_unknown')) as license_review
    from val v
    left join mrows mr on mr.agent_id = v.agent_id
    left join fu f on f.agent_id = v.agent_id
    where v.eligibility <> 'not_applicable'
  ), ranked as (
    select r.*,
      case when r.p1 then (row_number() over (partition by r.p1 order by r.followup_due_now desc, r.max_late desc, r.display_name, r.agent_id))::int end as p1_rank
    from full_rows r
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', r.agent_id,
      'alias_ids', coalesce((select jsonb_agg(al.alias_id) from alias al where al.canon = r.agent_id), '[]'::jsonb),
      'display_name', r.display_name,
      'manager_id', r.mgr_id,
      'manager_name', r.manager_name,
      'license_status', r.license_status,
      'eligibility', r.eligibility,
      'needs_review', r.needs_review,
      'license_review', r.license_review,
      'review_reason', case
          when r.eligibility = 'license_conflict' then 'Licence status conflicts with licence records'
          when r.eligibility = 'license_unknown' then 'Licence status is missing'
          when r.needs_review and r.start_validity = 'missing' then 'No start date for the chosen clock rule'
          when r.needs_review and r.start_validity = 'future' then 'Start date is in the future'
          when r.needs_review and r.start_validity = 'invalid' then 'Start date is not valid'
        end,
      'start', jsonb_build_object('date', r.start_date, 'validity', r.start_validity, 'elapsed_days', r.elapsed),
      'milestones', coalesce(r.milestones, '[]'::jsonb),
      'p1', r.p1, 'p1_rank', r.p1_rank,
      'due_soon', r.due_soon_any and not r.p1,
      'max_days_late', r.max_late,
      'overdue_keys', coalesce(to_jsonb(r.overdue_keys), '[]'::jsonb),
      'due_soon_keys', coalesce(to_jsonb(r.due_soon_keys), '[]'::jsonb),
      'overdue_labels', r.overdue_labels,
      'followup', jsonb_build_object(
        'last_at', r.last_call_at, 'last_outcome', r.last_call_outcome, 'call_count', coalesce(r.call_count, 0),
        'next_on', r.follow_up_on, 'next_action', r.next_action, 'waiting_on', r.waiting_on, 'blocker', r.blocker,
        'due_now', r.followup_due_now),
      'owner', jsonb_build_object(
        'user_id', r.owner_user_id,
        'name', coalesce(r.owner_name, r.manager_name, 'Unassigned'),
        'source', case when r.owner_user_id is not null then 'follow_up_owner' when r.mgr_id is not null then 'manager' else 'unassigned' end)
    ) order by (r.p1_rank is null), r.p1_rank, r.due_soon_any desc, r.min_until nulls last, r.display_name, r.agent_id), '[]'::jsonb),
    jsonb_build_object(
      'p1_people', count(*) filter (where r.p1),
      'due_soon_people', count(*) filter (where r.due_soon_any and not r.p1),
      'eligible_people', count(*) filter (where r.eligibility = 'eligible'),
      'timing_review_people', count(*) filter (where r.needs_review),
      'license_review_people', count(*) filter (where r.license_review),
      'followup_due_people', count(*) filter (where r.p1 and r.followup_due_now),
      'total_people', count(*)
    )
  into v_people, v_counts
  from ranked r;

  return jsonb_build_object(
    'ok', true,
    'as_of', v_today,
    'timezone', 'America/Phoenix',
    'basis', jsonb_build_object('key', v_cfg.clock_basis, 'label', v_basis_label, 'confirmed', v_active, 'confirmed_at', v_cfg.confirmed_at, 'window_days', v_cfg.window_days),
    'policy', v_policy,
    'checkoff_events_ever', v_events,
    'counts', coalesce(v_counts, '{}'::jsonb),
    'people', coalesce(v_people, '[]'::jsonb)
  );
end;
$function$;
