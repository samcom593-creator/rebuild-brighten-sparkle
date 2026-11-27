-- MP-ETHOS-ROSTER (2026-11-27). Sam: "make sure all ethos agents there."
--
-- Measured first (ethos_callsheet_people, latest hierarchy snapshot 2026-11-19): 89 people hold Sam's Ethos
-- contract. 48 were linked to an agent record and only 25 of those showed on My Team (8 hidden by is_inactive,
-- 14 terminated, 1 deactivated); 41 had no agent record at all, so nothing on My Team, the call sheet's
-- "who has an account" view, Team recovery or the Commissions agent picker could reach them. Of the 41, two are
-- existing rows under a different spelling (same phone), 39 are producers with no seat here at all.
--
-- What this does, and keeps doing on every hourly roster sync and every hierarchy import:
--   1. links an export row to an existing agent record when exactly one record matches, in the order measured to
--      find the most without false joins: NPN digits, then email, then normalised name, then last-10 phone digits;
--      on a link it writes the export NPN onto the agent (46 of 108 agents had one) and the export phone onto the
--      profile when the profile has none;
--   2. creates an agent record for every Ethos contract holder with an NPN and no record: active, licensed,
--      onboarding_stage live, manager = nearest AgentLink upline with a live record here (else the owner),
--      agent_code ETHOS_<npn>, origin import, metadata.source ethos_hierarchy, no login;
--   3. keeps those records OUT of the new-hire machinery without deleting anything: they are inserted hidden
--      (every hire trigger gates on is_inactive) and shown after the insert; every onboarding-mail kind is parked
--      as a never-due queue row (target_send_at = infinity, meta says why) so the sender, the backfill sweep and
--      the hire triggers' ON CONFLICT DO NOTHING can never arm one; and v_next_step_current excludes
--      metadata.source = ethos_hierarchy so the Next Step engine never nudges a contracted producer about a
--      "first appointment" (its dispatcher falls back to agentlink_agents BY NAME, so no login would not have
--      protected them). If a hire broadcast is ever queued anyway the run raises and rolls back.
--   4. gives the roster their phone and email from the export when no profile exists.
-- Un-hiding people Sam hid is NOT recurring: ethos_callsheet_ensure_agents(p_unhide => true) is a one-time call
-- for the 4 non-fired Ethos holders found today; the hourly sync passes false so Hide from roster still holds.
-- People Sam let go (terminated, deactivated, banned, suspended) stay off, per his 24 Nov rule.

-- 1. The Next Step engine does not own contracted producers imported from a carrier hierarchy.
--    Same definition as live (pg_get_viewdef 2026-11-27) plus one predicate in agents_part; column list unchanged,
--    so the five dependent views (v_next_step_candidate, v_next_step_manager_board, v_next_step_stuck_pool,
--    v_next_step_funnel_health, v_applicant_lane_ladder_health) are untouched.
create or replace view public.v_next_step_current as
 WITH applicants AS (
         SELECT a.id AS application_id,
            NULL::uuid AS agent_id,
            'applicant'::text AS person_type,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            a.status::text AS legacy_status,
            a.license_progress::text AS license_progress,
            a.hiring_manager_user_id AS owner_user_id,
                CASE
                    WHEN a.status = ANY (ARRAY['rejected'::application_status, 'disqualified'::application_status, 'lapsed'::application_status]) THEN 'closed_lost'::text
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR (a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress]))) AND (EXISTS ( SELECT 1
                       FROM interview_events ie
                      WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN 'call_booked'::text
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR (a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress]))) THEN 'licensed_book_call'::text
                    WHEN a.exam_passed_at IS NOT NULL AND (a.fingerprint_done = true OR a.fingerprints_submitted_at IS NOT NULL) THEN 'passed_exam'::text
                    WHEN a.exam_passed_at IS NOT NULL THEN 'passed_exam'::text
                    WHEN a.exam_scheduled_at IS NOT NULL THEN 'exam_scheduled'::text
                    WHEN a.license_progress = 'finished_course'::license_progress OR a.license_progress = 'exam_passed'::license_progress OR a.license_progress = 'passed_test'::license_progress THEN 'finished_prelicense'::text
                    WHEN a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.license_progress = 'course_purchased'::license_progress THEN 'started_prelicense'::text
                    WHEN (EXISTS ( SELECT 1
                       FROM interview_events ie
                      WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN 'call_booked'::text
                    WHEN a.license_status::text = 'licensed'::text THEN 'licensed_book_call'::text
                    WHEN a.last_contacted_at IS NOT NULL THEN 'contacted'::text
                    WHEN a.vsl_watched_at IS NOT NULL THEN 'watched_vsl'::text
                    ELSE 'applied'::text
                END AS derived_stage_key,
            a.created_at AS person_created_at,
            a.next_action_at,
            a.next_action_due_at,
            a.last_contacted_at,
                CASE
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR (a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress]))) AND (EXISTS ( SELECT 1
                       FROM interview_events ie
                      WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN ( SELECT max(ie2.scheduled_at) AS max
                       FROM interview_events ie2
                      WHERE ie2.application_id = a.id AND ie2.canceled_at IS NULL AND NOT COALESCE(ie2.is_backfill_duplicate, false))
                    WHEN a.license_status::text = 'licensed'::text AND (a.course_started_at IS NOT NULL OR a.course_purchased_at IS NOT NULL OR a.exam_scheduled_at IS NOT NULL OR a.exam_passed_at IS NOT NULL OR (a.license_progress = ANY (ARRAY['course_purchased'::license_progress, 'finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress]))) THEN COALESCE(a.licensed_at, a.created_at)
                    WHEN a.exam_passed_at IS NOT NULL THEN a.exam_passed_at
                    WHEN a.exam_scheduled_at IS NOT NULL THEN a.exam_scheduled_at
                    WHEN a.license_progress = ANY (ARRAY['finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress]) THEN COALESCE(( SELECT max(o.created_at) AS max
                       FROM license_milestone_outbox o
                      WHERE o.application_id = a.id AND o.new_progress = a.license_progress::text), a.course_started_at, a.course_purchased_at, a.created_at)
                    WHEN a.course_started_at IS NOT NULL THEN a.course_started_at
                    WHEN a.course_purchased_at IS NOT NULL THEN a.course_purchased_at
                    WHEN (EXISTS ( SELECT 1
                       FROM interview_events ie
                      WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND NOT COALESCE(ie.is_backfill_duplicate, false) AND (COALESCE(ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text])) AND (ie.outcome IS NULL OR (ie.outcome <> ALL (ARRAY['no_answer'::text, 'no_show'::text, 'not_interested'::text]))))) THEN ( SELECT max(ie2.scheduled_at) AS max
                       FROM interview_events ie2
                      WHERE ie2.application_id = a.id AND ie2.canceled_at IS NULL AND NOT COALESCE(ie2.is_backfill_duplicate, false))
                    WHEN (a.license_status::text = 'licensed'::text OR a.last_contacted_at IS NULL AND a.vsl_watched_at IS NULL) AND (( SELECT
                            CASE
                                WHEN (pkg1_rearm_ie.outcome = ANY (ARRAY['no_answer'::text, 'no_show'::text])) AND to_char((pkg1_rearm_ie.scheduled_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) >= (( SELECT pkg1_ss.value
                                   FROM system_settings pkg1_ss
                                  WHERE pkg1_ss.key = 'anchor_pkg1_cutoff_at'::text AND pkg1_ss.value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'::text)) AND COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at) <= (pkg1_rearm_ie.scheduled_at + '72:00:00'::interval) THEN COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at)
                                ELSE NULL::timestamp with time zone
                            END AS "case"
                       FROM interview_events pkg1_rearm_ie
                      WHERE pkg1_rearm_ie.application_id = a.id AND pkg1_rearm_ie.canceled_at IS NULL AND NOT COALESCE(pkg1_rearm_ie.is_backfill_duplicate, false) AND (COALESCE(pkg1_rearm_ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text]))
                      ORDER BY pkg1_rearm_ie.scheduled_at DESC NULLS LAST, pkg1_rearm_ie.created_at DESC
                     LIMIT 1)) IS NOT NULL THEN ( SELECT
                            CASE
                                WHEN (pkg1_rearm_ie.outcome = ANY (ARRAY['no_answer'::text, 'no_show'::text])) AND to_char((pkg1_rearm_ie.scheduled_at AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'::text) >= (( SELECT pkg1_ss.value
                                   FROM system_settings pkg1_ss
                                  WHERE pkg1_ss.key = 'anchor_pkg1_cutoff_at'::text AND pkg1_ss.value ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'::text)) AND COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at) <= (pkg1_rearm_ie.scheduled_at + '72:00:00'::interval) THEN COALESCE(pkg1_rearm_ie.outcome_at, pkg1_rearm_ie.scheduled_at)
                                ELSE NULL::timestamp with time zone
                            END AS "case"
                       FROM interview_events pkg1_rearm_ie
                      WHERE pkg1_rearm_ie.application_id = a.id AND pkg1_rearm_ie.canceled_at IS NULL AND NOT COALESCE(pkg1_rearm_ie.is_backfill_duplicate, false) AND (COALESCE(pkg1_rearm_ie.call_track, ''::text) <> ALL (ARRAY['other'::text, 'onboarding'::text]))
                      ORDER BY pkg1_rearm_ie.scheduled_at DESC NULLS LAST, pkg1_rearm_ie.created_at DESC
                     LIMIT 1)
                    WHEN a.seminar_attended_at IS NOT NULL THEN a.seminar_attended_at
                    WHEN a.seminar_registered_at IS NOT NULL THEN a.seminar_registered_at
                    WHEN a.seminar_date IS NOT NULL THEN a.created_at
                    WHEN a.last_contacted_at IS NOT NULL THEN a.last_contacted_at
                    WHEN a.vsl_watched_at IS NOT NULL THEN a.vsl_watched_at
                    ELSE a.created_at
                END AS stage_entered_at
           FROM applications a
          WHERE COALESCE(a.is_duplicate, false) = false AND a.status <> 'approved'::application_status
        ), agents_part AS (
         SELECT NULL::uuid AS application_id,
            g.id AS agent_id,
            'agent'::text AS person_type,
            COALESCE(split_part(p.full_name, ' '::text, 1), split_part(g.display_name, ' '::text, 1)) AS first_name,
            COALESCE(NULLIF(regexp_replace(p.full_name, '^\S+\s*'::text, ''::text), ''::text), split_part(g.display_name, ' '::text, 2)) AS last_name,
            p.email,
            p.phone,
            g.status::text AS legacy_status,
            g.license_status::text AS license_progress,
            g.manager_id AS owner_user_id,
                CASE
                    WHEN g.is_deactivated = true OR g.status = 'terminated'::agent_status THEN 'closed_lost'::text
                    WHEN g.first_10k_at IS NOT NULL OR g.weekly_10k_badges > 0 THEN 'first_10k_week'::text
                    WHEN g.first_deal_at IS NOT NULL THEN 'first_deal'::text
                    WHEN g.first_appointment_at IS NOT NULL THEN 'first_appointment'::text
                    WHEN g.license_status IS DISTINCT FROM 'licensed'::license_status THEN 'hired_unlicensed'::text
                    WHEN g.field_training_started_at IS NOT NULL OR g.onboarding_stage::text = 'in_field_training'::text THEN 'infield_training'::text
                    WHEN g.onboarding_completed_at IS NOT NULL THEN 'course_completed'::text
                    WHEN (EXISTS ( SELECT 1
                       FROM onboarding_progress op
                      WHERE op.agent_id = g.id AND (op.started_at IS NOT NULL OR op.completed_at IS NOT NULL OR COALESCE(op.video_watched_percent, 0) > 0))) THEN 'course_started'::text
                    ELSE 'hired'::text
                END AS derived_stage_key,
            g.created_at AS person_created_at,
            NULL::timestamp with time zone AS next_action_at,
            NULL::timestamp with time zone AS next_action_due_at,
            NULL::timestamp with time zone AS last_contacted_at,
                CASE
                    WHEN g.first_10k_at IS NOT NULL THEN g.first_10k_at
                    WHEN g.first_deal_at IS NOT NULL THEN g.first_deal_at
                    WHEN g.first_appointment_at IS NOT NULL THEN g.first_appointment_at
                    WHEN g.field_training_started_at IS NOT NULL THEN g.field_training_started_at
                    WHEN g.onboarding_completed_at IS NOT NULL THEN g.onboarding_completed_at
                    WHEN g.has_training_course = true THEN COALESCE(g.production_unlocked_at, g.contracted_at, g.start_date::timestamp with time zone, g.created_at)
                    ELSE COALESCE(g.contracted_at, g.start_date::timestamp with time zone, g.created_at)
                END AS stage_entered_at
           FROM agents g
             LEFT JOIN profiles p ON p.user_id = g.user_id
          WHERE g.canonical_agent_id IS NULL
            -- MP-ETHOS-ROSTER: a contracted producer imported from the Ethos hierarchy is not a hire in this pipeline.
            AND COALESCE(g.metadata ->> 'source', ''::text) <> 'ethos_hierarchy'::text
            AND (EXISTS ( SELECT 1
                   FROM v_agent_canonical_map vc
                  WHERE vc.canonical_agent_id = g.id))
        )
 SELECT x.application_id,
    x.agent_id,
    x.person_type,
    x.first_name,
    x.last_name,
    x.email,
    x.phone,
    x.legacy_status,
    x.license_progress,
    x.owner_user_id,
    x.derived_stage_key,
    x.person_created_at,
    x.next_action_at,
    x.next_action_due_at,
    x.last_contacted_at,
    x.stage_entered_at,
    s.display_name AS stage_display_name,
    s.next_action_label,
    s.next_action_url,
    s.sla_hours,
    s.owner_role,
    s.color_hex,
    s.icon_name,
    s.dashboard_section,
    s.candidate_message_template,
    s.failure_label,
    s.is_terminal,
        CASE
            WHEN s.sla_hours IS NULL THEN NULL::timestamp with time zone
            ELSE x.stage_entered_at + ((s.sla_hours || ' hours'::text)::interval)
        END AS sla_due_at,
        CASE
            WHEN s.sla_hours IS NULL THEN NULL::boolean
            WHEN now() > (x.stage_entered_at + ((s.sla_hours || ' hours'::text)::interval)) THEN true
            ELSE false
        END AS is_stalled,
    EXTRACT(epoch FROM now() - x.stage_entered_at) / 86400.0 AS days_in_stage
   FROM ( SELECT applicants.application_id,
            applicants.agent_id,
            applicants.person_type,
            applicants.first_name,
            applicants.last_name,
            applicants.email,
            applicants.phone,
            applicants.legacy_status,
            applicants.license_progress,
            applicants.owner_user_id,
            applicants.derived_stage_key,
            applicants.person_created_at,
            applicants.next_action_at,
            applicants.next_action_due_at,
            applicants.last_contacted_at,
            applicants.stage_entered_at
           FROM applicants
        UNION ALL
         SELECT agents_part.application_id,
            agents_part.agent_id,
            agents_part.person_type,
            agents_part.first_name,
            agents_part.last_name,
            agents_part.email,
            agents_part.phone,
            agents_part.legacy_status,
            agents_part.license_progress,
            agents_part.owner_user_id,
            agents_part.derived_stage_key,
            agents_part.person_created_at,
            agents_part.next_action_at,
            agents_part.next_action_due_at,
            agents_part.last_contacted_at,
            agents_part.stage_entered_at
           FROM agents_part) x
     LEFT JOIN next_step_stages s ON s.stage_key = x.derived_stage_key;

-- 2. Link or create.
create or replace function public.ethos_callsheet_ensure_agents(p_unhide boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  SAM_AGENT_ID constant uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
  -- Every kind a hire trigger or sweep can enqueue (agent_onboarding_queue_email_kind_check).
  MAIL_KINDS constant text[] := array['course', 'discord', 'hired_whatsapp', 'onboarding_call', 'get_licensed', 'scripts_packet',
                                      'onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10'];
  r record;
  v_ids uuid[];
  v_agent uuid;
  v_manager uuid;
  v_match text;
  v_name text;
  v_code text;
  v_n int;
  v_linked int := 0;
  v_linked_by jsonb := '{}'::jsonb;
  v_created int := 0;
  v_created_names text[] := '{}';
  v_skipped_names text[] := '{}';
  v_mail_parked int := 0;
  v_nipr_backfilled int := 0;
  v_phone_backfilled int := 0;
  v_al_backfilled int := 0;
  v_unhidden_names text[] := '{}';
begin
  for r in
    select p.*,
           regexp_replace(coalesce(p.npn, ''), '[^0-9]', '', 'g') as npn_digits,
           right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10) as phone10
      from public.ethos_callsheet_people p
     where p.on_ethos and p.in_latest_snapshot and p.agent_id is null
     order by p.full_name
  loop
    v_agent := null;
    v_match := null;

    -- (a) NPN digits: one record, not a merged duplicate, not already the record of another Ethos row.
    if r.npn_digits <> '' then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
       where a.canonical_agent_id is null
         and regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g') = r.npn_digits
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'npn'; end if;
    end if;
    -- (b) email on the profile
    if v_agent is null and r.email is not null then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
        join public.profiles pr on pr.id = a.profile_id or pr.user_id = a.user_id
       where a.canonical_agent_id is null
         and lower(pr.email) = lower(r.email)
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'email'; end if;
    end if;
    -- (c) normalised name, letters only, at least 6 of them
    if v_agent is null and length(coalesce(r.name_key, '')) >= 6 then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
        left join public.profiles pr on pr.id = a.profile_id
       where a.canonical_agent_id is null
         and (lower(regexp_replace(coalesce(a.display_name, ''), '[^a-zA-Z]', '', 'g')) = r.name_key
              or lower(regexp_replace(coalesce(pr.full_name, ''), '[^a-zA-Z]', '', 'g')) = r.name_key)
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'name'; end if;
    end if;
    -- (d) last 10 digits of the phone on the profile
    if v_agent is null and length(r.phone10) = 10 then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
        join public.profiles pr on pr.id = a.profile_id or pr.user_id = a.user_id
       where a.canonical_agent_id is null
         and right(regexp_replace(coalesce(pr.phone, ''), '[^0-9]', '', 'g'), 10) = r.phone10
         and not exists (select 1 from public.ethos_callsheet_people x where x.agent_id = a.id and x.on_ethos);
      if coalesce(array_length(v_ids, 1), 0) = 1 then v_agent := v_ids[1]; v_match := 'phone'; end if;
    end if;

    if v_agent is not null then
      update public.ethos_callsheet_people set agent_id = v_agent, agent_match = v_match, updated_at = now() where id = r.id;
      -- The export is the better source for the NPN; every downstream match keys on it first.
      update public.agents a set nipr_number = r.npn_digits, updated_at = now()
       where a.id = v_agent and r.npn_digits <> ''
         and nullif(regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g'), '') is null;
      get diagnostics v_n = row_count; v_nipr_backfilled := v_nipr_backfilled + v_n;
      update public.profiles pr set phone = r.phone, updated_at = now()
        from public.agents a
       where a.id = v_agent and pr.id = a.profile_id and pr.phone is null and r.phone is not null;
      get diagnostics v_n = row_count; v_phone_backfilled := v_phone_backfilled + v_n;
      if r.al_user_id is not null then
        update public.agents a set al_user_id = r.al_user_id, updated_at = now()
         where a.id = v_agent and a.al_user_id is null
           and not exists (select 1 from public.agents o where o.al_user_id = r.al_user_id and o.canonical_agent_id is null and coalesce(o.is_deactivated, false) = false);
        get diagnostics v_n = row_count; v_al_backfilled := v_al_backfilled + v_n;
      end if;
      v_linked := v_linked + 1;
      v_linked_by := jsonb_set(v_linked_by, array[v_match], to_jsonb(coalesce((v_linked_by ->> v_match)::int, 0) + 1));
      continue;
    end if;

    -- No record anywhere: a contracted producer with no seat here. Without an NPN there is nothing to key the
    -- record on, so the person stays on the call sheet only and is named in the result.
    v_name := nullif(regexp_replace(initcap(lower(btrim(coalesce(r.full_name, '')))), '\s+', ' ', 'g'), '');
    if r.npn_digits = '' or v_name is null then
      v_skipped_names := v_skipped_names || coalesce(r.full_name, r.id::text);
      continue;
    end if;
    v_code := 'ETHOS_' || r.npn_digits;
    if exists (select 1 from public.agents where agent_code = v_code) then
      v_code := v_code || '_' || left(replace(r.id::text, '-', ''), 6);
    end if;
    -- Manager: the nearest AgentLink upline with a live record here, else the owner. A terminated upline (KJ) is
    -- never written as anyone's manager.
    v_manager := null;
    select a.id into v_manager
      from public.agents a
     where a.id = coalesce(public.fn_canonical_agent_id(r.sub_agency_agent_id), r.sub_agency_agent_id)
       and a.status = 'active' and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
       and a.canonical_agent_id is null;
    v_manager := coalesce(v_manager, SAM_AGENT_ID);

    insert into public.agents (
      display_name, agent_code, nipr_number, license_status, status, is_inactive, is_deactivated, onboarding_stage,
      manager_id, al_user_id, origin, account_mode, start_date, notes, metadata)
    values (
      v_name, v_code, r.npn_digits, 'licensed', 'active',
      true,   -- hidden at insert on purpose: every hire trigger (Discord/Slack/email hire events, course + call mail) gates on is_inactive; this is not a hire
      false, 'live',
      v_manager,
      case when r.al_user_id is not null
            and not exists (select 1 from public.agents o where o.al_user_id = r.al_user_id and o.canonical_agent_id is null and coalesce(o.is_deactivated, false) = false)
           then r.al_user_id end,
      'import', 'agent', r.first_seen_on,
      'Created from the Ethos hierarchy export (snapshot ' || coalesce(r.snapshot_on::text, 'unknown') || ') by ethos_callsheet_ensure_agents. No login; contact details are on the call sheet.',
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'ethos_hierarchy', 'origin', 'import', 'ethos_person_id', r.id,
        'comp_level', r.comp_level, 'sub_agency', r.sub_agency, 'snapshot_on', r.snapshot_on,
        'created_by', 'ethos_callsheet_ensure_agents')))
    returning id into v_agent;

    -- Park every onboarding-mail kind as never due. The ungated insert trigger has already queued course+discord;
    -- the rows stay, with target_send_at = infinity and the reason in meta, so the sender (target_send_at <= now()),
    -- the backfill sweep and any later trigger's ON CONFLICT DO NOTHING can never arm them. Nothing is deleted and
    -- nothing is marked sent.
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at, meta)
    select v_agent, k, 'infinity'::timestamptz,
           jsonb_build_object('parked', 'ethos_hierarchy_import', 'why', 'contracted producer imported from the Ethos hierarchy, not a hire', 'parked_at', now())
      from unnest(MAIL_KINDS) k
    on conflict (agent_id, email_kind) do update
      set target_send_at = 'infinity'::timestamptz,
          meta = coalesce(public.agent_onboarding_queue.meta, '{}'::jsonb)
                 || jsonb_build_object('parked', 'ethos_hierarchy_import', 'why', 'contracted producer imported from the Ethos hierarchy, not a hire', 'parked_at', now())
      where public.agent_onboarding_queue.sent_at is null;
    get diagnostics v_n = row_count; v_mail_parked := v_mail_parked + v_n;

    -- A hire broadcast or hire event for this row means a gate above has changed: stop and roll back the whole run.
    if exists (select 1 from public.telegram_scheduled_messages t where t.dedupe_key = 'wins_new_hire_' || v_agent::text and t.sent_at is null)
       or exists (select 1 from public.outbox_events o where o.aggregate_type = 'agent' and o.aggregate_id = v_agent and o.event_type = 'agent.hired' and o.processed_at is null) then
      raise exception 'ethos_callsheet_ensure_agents: a hire broadcast was queued for % (%); the is_inactive gate on the hire triggers has changed, refusing to continue', v_name, v_agent;
    end if;

    -- Training stage: in the field, not online training (the default for a new hire).
    -- (agent_stage_source_check allows staff | default | mapped; the dry run caught 'ethos_hierarchy' failing it.)
    update public.agent_stage s set stage = 'released_in_field', source = 'mapped', set_at = now()
     where s.agent_id = v_agent and s.stage is distinct from 'released_in_field';
    if found then
      insert into public.agent_stage_events (agent_id, from_stage, to_stage, source)
      values (v_agent, 'online_training', 'released_in_field', 'mapped');
    end if;

    -- Now visible on the roster.
    update public.agents set is_inactive = false, updated_at = now() where id = v_agent;
    update public.ethos_callsheet_people set agent_id = v_agent, agent_match = 'ethos_hierarchy_created', updated_at = now() where id = r.id;
    v_created := v_created + 1;
    v_created_names := v_created_names || v_name;
  end loop;

  -- One-time: un-hide Ethos holders who were hidden but never let go (status active, not deactivated, not banned,
  -- no open suspension, not excluded). Not run by the hourly sync, so a later Hide from roster holds.
  if p_unhide then
    with cand as (
      select distinct a.id, a.display_name
        from public.ethos_callsheet_people p
        join public.agents a on a.id = p.agent_id
       where p.on_ethos and p.in_latest_snapshot
         and coalesce(a.is_inactive, false)
         and a.status = 'active'
         and coalesce(a.is_deactivated, false) = false
         and a.canonical_agent_id is null
         and not public.fn_agent_is_roster_excluded(a.id)
         and not exists (select 1 from auth.users u where u.id = a.user_id and u.banned_until is not null and u.banned_until > now())
         and not exists (select 1 from public.agent_access_suspensions s where s.user_id = a.user_id and s.lifted_at is null)
    ), done as (
      update public.agents a set is_inactive = false, updated_at = now()
        from cand where a.id = cand.id
      returning cand.display_name
    )
    select coalesce(array_agg(display_name), '{}') into v_unhidden_names from done;
  end if;

  return jsonb_build_object(
    'ok', true,
    'linked', v_linked, 'linked_by', v_linked_by,
    'created', v_created, 'created_names', to_jsonb(v_created_names),
    'skipped_no_npn', to_jsonb(v_skipped_names),
    'onboarding_mail_rows_parked', v_mail_parked,
    'nipr_backfilled', v_nipr_backfilled, 'profile_phone_backfilled', v_phone_backfilled, 'al_user_id_backfilled', v_al_backfilled,
    'unhidden', to_jsonb(v_unhidden_names),
    'ethos_people', (select count(*) from public.ethos_callsheet_people where on_ethos and in_latest_snapshot),
    'ethos_people_without_record', (select count(*) from public.ethos_callsheet_people where on_ethos and in_latest_snapshot and agent_id is null));
end;
$function$;
revoke all on function public.ethos_callsheet_ensure_agents(boolean) from public, anon, authenticated;

-- 3. Every hourly roster sync (cron callsheet-roster-sync) and every hierarchy import runs it.
create or replace function public.ethos_callsheet_sync_roster()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_ensure jsonb;
  v_hidden int := 0;
  v_placeholders int := 0;
begin
  v_result := public.ethos_callsheet_sync_roster_core();

  -- MP-ETHOS-ROSTER: every Ethos contract holder has an agent record (linked or created) before the sheet is tidied.
  v_ensure := public.ethos_callsheet_ensure_agents(false);

  -- Some agent records were created with the owner's own phone number as a stand-in. Showing it would
  -- have a leader dial the owner. Blank it on the sheet; the card then asks for a real number.
  update public.ethos_callsheet_people p
     set phone = null, updated_at = now()
   where p.phone is not null
     and right(regexp_replace(p.phone, '\D', '', 'g'), 10) in (
       select right(regexp_replace(o.phone, '\D', '', 'g'), 10)
         from public.ethos_callsheet_people o
         join public.agents a on coalesce(a.canonical_agent_id, a.id) = o.agent_id
         join public.user_roles ur on ur.user_id = a.user_id and ur.role = 'admin'::app_role
        where o.phone is not null
     )
     and not exists (
       select 1
         from public.agents a
         join public.user_roles ur on ur.user_id = a.user_id and ur.role = 'admin'::app_role
        where coalesce(a.canonical_agent_id, a.id) = p.agent_id
     );

  -- Not people to call: a placeholder record (no phone, no email, no NPN, and a name that is a code or a
  -- single word), and staff accounts that sit on the AgentLink roster. Never an Ethos row, never a row with
  -- a logged call.
  update public.ethos_callsheet_people p
     set in_latest_snapshot = false, updated_at = now()
   where p.in_latest_snapshot
     and not p.on_ethos
     and not exists (select 1 from public.ethos_callsheet_calls c where c.person_id = p.id)
     and (
       (p.phone is null and p.email is null and p.npn is null
        and (p.full_name ~ '[0-9_]' or p.full_name !~ '\s'))
       or exists (
         select 1
           from public.profiles pr
           join public.user_roles ur on ur.user_id = pr.user_id and ur.role in ('va'::app_role, 'va_manager'::app_role)
          where (p.email is not null and lower(pr.email) = p.email)
             or (length(p.name_key) >= 5
                 and lower(regexp_replace(coalesce(pr.full_name, ''), '[^a-zA-Z]', '', 'g')) = p.name_key)
             or (p.agent_id is not null and exists (select 1 from public.agents a where a.id = p.agent_id and a.user_id = pr.user_id))
       )
     );
  get diagnostics v_placeholders = row_count;

  -- One card per phone number (a second record under a misspelled name is the same person); people with
  -- no phone are matched on name and NPN.
  with ranked as (
    select p.id,
           row_number() over (
             partition by coalesce(
                            'ph:' || nullif(right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10), ''),
                            'id:' || p.name_key || ':' || p.npn
                          )
             order by p.on_ethos desc,
                      (exists (select 1 from public.ethos_callsheet_calls c where c.person_id = p.id)) desc,
                      (a.status = 'active') desc nulls last,
                      coalesce(p.contracts_active, 0) desc,
                      (p.agent_id is not null) desc,
                      p.created_at asc,
                      p.id asc
           ) as rn
      from public.ethos_callsheet_people p
      left join public.agents a on a.id = p.agent_id
     where p.in_latest_snapshot
       and (p.phone is not null or p.npn is not null)
  )
  update public.ethos_callsheet_people p
     set in_latest_snapshot = false, updated_at = now()
    from ranked r
   where r.id = p.id
     and r.rn > 1
     and not p.on_ethos
     and not exists (select 1 from public.ethos_callsheet_calls c where c.person_id = p.id);
  get diagnostics v_hidden = row_count;

  return v_result || jsonb_build_object(
    'ensure_agents', v_ensure,
    'hidden_duplicates', v_hidden,
    'hidden_placeholders', v_placeholders,
    'people', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot),
    'with_phone', (select count(*) from public.ethos_callsheet_people where in_latest_snapshot and phone is not null)
  );
end;
$function$;

-- 4. The roster shows the export's phone and email for a record with no profile (no login).
create or replace function public.crm_agent_roster()
returns table(agent_id uuid, full_name text, email text, phone text, avatar_url text, agent_code text, status text, is_deactivated boolean, is_inactive boolean, is_sync_only boolean, license_status text, license_progress text, onboarding_stage text, training_stage text, manager_id uuid, manager_name text, downline_count integer, contracts_total integer, contracts_active integer, mtd_alp numeric, mtd_deals integer, l30_alp numeric, l30_deals integer, lifetime_alp numeric, lifetime_deals integer, first_posted_date date, last_posted_date date, last_contacted_at timestamp with time zone, created_at timestamp with time zone, tenure_days integer)
language sql
stable security definer
set search_path to 'public'
as $function$
with ph as (
  select (now() at time zone 'America/Phoenix')::date as today
),
win as (
  select today, date_trunc('month', today)::date as month_start,
         today - 29 as l30_start
  from ph
),
prod as (
  select b.agent_id,
         sum(b.annual_premium) filter (where b.posted_date >= w.month_start) as mtd_alp,
         count(*) filter (where b.posted_date >= w.month_start) as mtd_deals,
         sum(b.annual_premium) filter (where b.posted_date >= w.l30_start) as l30_alp,
         count(*) filter (where b.posted_date >= w.l30_start) as l30_deals,
         sum(b.annual_premium) as life_alp,
         count(*) as life_deals,
         min(b.posted_date) as first_posted,
         max(b.posted_date) as last_posted
  from public.mat_production_unified b
  cross join win w
  where b.agent_id is not null and b.posted_date is not null
  group by b.agent_id
),
ident as (
  select a.id,
         coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') as full_name,
         coalesce(pu.email, pp.email, ep.email) as email,
         coalesce(pu.phone, pp.phone, ep.phone) as phone,
         coalesce(pu.avatar_url, pp.avatar_url) as avatar_url
  from public.agents a
  left join public.profiles pu on pu.user_id = a.user_id
  left join public.profiles pp on pp.id = a.profile_id
  -- MP-ETHOS-ROSTER: a record created from the Ethos hierarchy has no profile; the export carries the contact details.
  left join lateral (
    select p.email, p.phone
      from public.ethos_callsheet_people p
     where p.agent_id = a.id and (p.email is not null or p.phone is not null)
     order by p.on_ethos desc, p.in_latest_snapshot desc, p.updated_at desc
     limit 1
  ) ep on true
),
prog as (
  select lower(btrim(ap.email)) as email_key,
         max(array_position(array[
           'unlicensed','course_purchased','finished_course','test_scheduled',
           'passed_test','fingerprints_done','waiting_fingerprints',
           'waiting_on_license','licensed'
         ], ap.license_progress::text)) as best_idx
  from public.applications ap
  where ap.email is not null and ap.terminated_at is null
  group by 1
),
contact as (
  select ap.assigned_agent_id as agent_id, max(ap.last_contacted_at) as last_contacted_at
  from public.applications ap
  where ap.assigned_agent_id is not null and ap.last_contacted_at is not null
  group by 1
),
downline as (
  select m.mid as agent_id, count(distinct m.child) as n
  from (
    select manager_id as mid, id as child from public.agents where manager_id is not null
    union
    select invited_by_manager_id, id from public.agents where invited_by_manager_id is not null
  ) m
  group by 1
),
contracts as (
  select c.agent_id, count(*)::int as total,
         count(*) filter (where lower(coalesce(c.status,'')) in ('active','approved','appointed'))::int as active
  from public.agentlink_contracts c
  where c.agent_id is not null
  group by 1
)
select
  a.id, i.full_name, i.email, i.phone, i.avatar_url, a.agent_code,
  a.status::text, coalesce(a.is_deactivated,false), coalesce(a.is_inactive,false),
  (a.agent_code like 'GHOST\_%' and a.user_id is null), a.license_status::text,
  case when a.license_status::text = 'licensed' then 'licensed'
       else (array[
         'unlicensed','course_purchased','finished_course','test_scheduled',
         'passed_test','fingerprints_done','waiting_fingerprints',
         'waiting_on_license','licensed'
       ])[pr.best_idx]
  end,
  a.onboarding_stage::text, ts.stage::text,
  coalesce(a.manager_id, a.invited_by_manager_id), mi.full_name,
  coalesce(dl.n,0)::int, coalesce(ct.total,0), coalesce(ct.active,0),
  coalesce(p.mtd_alp,0), coalesce(p.mtd_deals,0)::int,
  coalesce(p.l30_alp,0), coalesce(p.l30_deals,0)::int,
  coalesce(p.life_alp,0), coalesce(p.life_deals,0)::int,
  p.first_posted, p.last_posted, co.last_contacted_at, a.created_at,
  case when a.start_date is not null then ((select today from ph) - a.start_date)::int
       when a.created_at is not null then ((select today from ph) - (a.created_at at time zone 'America/Phoenix')::date)::int
       else null end
from public.agents a
join ident i on i.id = a.id
left join prod p on p.agent_id = a.id
left join prog pr on pr.email_key = lower(btrim(i.email))
left join contact co on co.agent_id = a.id
left join downline dl on dl.agent_id = a.id
left join contracts ct on ct.agent_id = a.id
left join public.v_agent_training_stage ts on ts.agent_id = a.id
left join ident mi on mi.id = coalesce(a.manager_id, a.invited_by_manager_id)
where public.crm_can_read_roster()
  and public.crm_can_read_agent_scope(a.id)
  and coalesce(a.is_inactive,false) = false
  and coalesce(a.is_deactivated,false) = false
  and not public.fn_agent_is_roster_excluded(a.id);
$function$;
