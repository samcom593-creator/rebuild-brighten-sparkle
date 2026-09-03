-- MP-365: a leader can see the whole course, and can see where their own
-- people are sitting inside it.
--
-- Sam: "For managers, for MILVER and VA — isn't for me, of course — unlock all
-- training courses... to be able to properly see what the courses entail, but
-- to know what agents are sitting on their side."
--
-- WHAT WAS ACTUALLY WRONG, MEASURED ON LIVE PROD.
--
-- /dashboard/training/progress renders every agent carrying the course — 108
-- rows — for every leader who opens it. RLS on onboarding_progress then decides
-- how many of those rows carry real data:
--
--   * KJ Vaughn (manager):        18 of 108
--   * Milver     (va_manager):     0 of 108
--   * April      (va):             0 of 108
--
-- The page computes hasStarted as "did any progress row come back", so a row it
-- is not allowed to read is drawn identically to a person who has never opened
-- the course: 0%, "not started", sorted into the not-started bucket, with a
-- "Send reminder" button beside it. Milver's view of the company is 108 people
-- who have all done nothing. That is the 465-row fake-success shape pointed the
-- other way — absence rendered as fact — and it is one click from an outbound
-- consequence, because every one of those rows carries a per-agent reminder
-- button that will mail someone about a course they have already finished. The
-- bulk "remind stalled" action is not affected: a blanked row reports no
-- activity at all, so it fails the stalled test and is passed over.
--
-- WHY THE VA ROLES SAW NOTHING. onboarding_progress has SELECT policies for the
-- agent themselves, for admin, and for manager. No policy mentions va_manager or
-- va at all, while App.tsx explicitly opens the route to them. The route and the
-- data disagreed, and the data lost silently.
--
-- WHY THE MANAGER POLICY IS NARROW. It keys on agents.invited_by_manager_id
-- alone. Every other hierarchy question in this database — who a manager may
-- fire, whose override they are paid — goes through fn_hierarchy_first_hops,
-- which walks coalesce(manager_id, switched_to_manager_id, invited_by_manager_id)
-- over canonicalised ids. Keying one question on one column is how "who is mine"
-- drifts from "who is mine".
--
-- THE FIX IS TO SCOPE THE ROSTER SERVER-SIDE, not to widen the table. A row only
-- reaches the page if the caller is entitled to the truth about it, so a short
-- list can no longer be mistaken for an idle team, and 0% now means 0%.
--
-- Deliberately NOT done: backfilling or inventing progress for the rows nobody
-- can read, and adding va_manager/va policies to onboarding_progress itself —
-- the raw table stays as narrow as it is today and only this function, which
-- states its own scope, hands the data out.

begin;

create or replace function public.my_course_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_is_staff boolean;
  v_is_mgr   boolean;
  v_caller   uuid;
  v_scope    text;
  v_label    text;
  v_total    integer;
  v_agents   jsonb;
begin
  if v_uid is null then
    return jsonb_build_object(
      'scope', 'none', 'scope_label', 'Not signed in',
      'total_modules', 0, 'agents', jsonb_build_array());
  end if;

  select count(*) into v_total
    from public.onboarding_modules where is_active;

  v_is_admin := public.apex_is_admin();
  v_is_staff := public.is_agency_staff()
                or exists (select 1 from public.user_roles ur
                            where ur.user_id = v_uid and ur.role = 'recruiter');
  v_is_mgr   := exists (select 1 from public.user_roles ur
                         where ur.user_id = v_uid and ur.role = 'manager');

  if v_is_admin then
    v_scope := 'all';  v_label := 'Everyone on the course';
  elsif v_is_staff then
    -- is_agency_staff() is admin / va_manager / va, and recruiter is added here
    -- because App.tsx already routes recruiters to this page. These are support
    -- roles with no downline of their own; scoping them to a hierarchy they are
    -- not in would give them an empty page, which is the failure being fixed.
    v_scope := 'all';  v_label := 'Everyone on the course';
  elsif v_is_mgr then
    v_scope := 'downline'; v_label := 'Your team';
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) into v_caller
      from public.agents a
     where a.user_id = v_uid and coalesce(a.is_deactivated, false) = false
     order by a.created_at desc
     limit 1;
    if v_caller is null then
      return jsonb_build_object(
        'scope', 'none',
        'scope_label', 'No agent record is linked to this login, so no team could be resolved',
        'total_modules', v_total, 'agents', jsonb_build_array());
    end if;
  else
    return jsonb_build_object(
      'scope', 'none', 'scope_label', 'This login has no leader role',
      'total_modules', v_total, 'agents', jsonb_build_array());
  end if;

  with roster as (
    select a.id, a.onboarding_stage, a.display_name, a.profile_id,
           a.source_application_id,
           coalesce(a.manager_id, a.switched_to_manager_id, a.invited_by_manager_id) as parent_id
      from public.agents a
     where a.has_training_course
       and coalesce(a.is_deactivated, false) = false
       -- Merged duplicates are excluded, otherwise the same person appears
       -- twice and the copy holding no progress reads as "never started".
       and a.canonical_agent_id is null
       and not public.fn_agent_is_roster_excluded(a.id)
       and (
         v_scope = 'all'
         or exists (select 1 from public.fn_hierarchy_first_hops(array[v_caller]) h
                     where h.member = a.id)
       )
  ), detail as (
    select p.agent_id,
           jsonb_object_agg(p.module_id, jsonb_build_object(
             'passed',          coalesce(p.passed, false),
             'completed_at',    p.completed_at,
             'watched_percent', coalesce(p.video_watched_percent, 0),
             'score',           p.score)) as modules,
           max(p.completed_at) as last_activity,
           min(coalesce(p.started_at, p.completed_at)) as course_started_at
      from public.onboarding_progress p
      join roster r on r.id = p.agent_id
     group by p.agent_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id',          r.id,
           'display_name',      coalesce(nullif(btrim(pr.full_name), ''),
                                         nullif(btrim(r.display_name), ''),
                                         nullif(btrim(ap.first_name || ' ' || ap.last_name), ''),
                                         'Unnamed agent'),
           'email',             coalesce(nullif(btrim(pr.email), ''), nullif(btrim(ap.email), ''), ''),
           'manager_name',      coalesce(nullif(btrim(mg.display_name), ''), 'Unassigned'),
           'onboarding_stage',  coalesce(r.onboarding_stage, 'onboarding'),
           'modules',           coalesce(d.modules, '{}'::jsonb),
           'last_activity',     d.last_activity,
           'course_started_at', d.course_started_at
         ) order by r.display_name), '[]'::jsonb)
    into v_agents
    from roster r
    left join detail d       on d.agent_id = r.id
    left join public.profiles pr on pr.id = r.profile_id
    left join public.applications ap on ap.id = r.source_application_id
    left join public.agents mg on mg.id = r.parent_id;

  return jsonb_build_object(
    'scope', v_scope,
    'scope_label', v_label,
    'total_modules', v_total,
    'agents', v_agents);
end;
$function$;

comment on function public.my_course_progress() is
  'MP-365: the course roster the caller is entitled to the truth about. Admin, '
  'va_manager, va and recruiter get everyone; a manager gets their canonical '
  'downline via fn_hierarchy_first_hops, the same walk that decides who they may '
  'fire. Before this, /dashboard/training/progress showed all 108 course agents '
  'to every leader and let RLS blank the ones they could not read — 0 of 108 for '
  'Milver and April — which the page drew as "not started" beside a reminder '
  'button.';

revoke all on function public.my_course_progress() from public;
grant execute on function public.my_course_progress() to authenticated;

commit;
