-- PL-WIB-NUDGE-CADENCE-EXACT: the next-step nudge sweep reads each stage's cadence
-- the way the stage spells it.
--
-- reminder_cadence is "<unit>:<n>,<n>,..." with unit day or hour. The sweep matched it as
-- a substring of the cadence text against the whole-day count, three LIKEs:
--   '%day:%' || days || '%'  |  '%,' || days || '%'  |  '%:' || days || ',%'
-- so day 2 matched "21"/"28", day 4 matched "14", and every hour cadence was read as days:
-- "hour:24,48,72" fired on days 4, 7, 24 and 48 (",48" ",72" ",24" ",48") and never on
-- hours 24/48/72. Measured 2026-10-16 over 30 days of next_step_messages (the sweep is
-- its only writer): 151 of 184 delivered hour-cadence nudges landed on a day the cadence
-- does not name, reaching 90 people, e.g. "You're hired, course unlocked" on day 72 and
-- "Welcome to Galaxy" on day 24; the hour 1 / 6 / 12 nudges have never fired. Day
-- cadences carried 8 off-day sends (first_deal days 2/4/8, first_10k_week day 3).
--
-- fn_next_step_cadence_due() is the one parser. Day steps fire on that whole day, as
-- before (the 20h throttle is kept for them). Hour steps fire once in [H, H+3) hours:
-- the sweep runs hourly at :07 and pg_cron drops fires ('job startup timeout', MP-366),
-- so a 3h window survives two dropped ticks, and it closes, so an old row is never
-- back-filled. Hour steps are throttled 6h, day steps 20h as before. Each step is its own
-- dedupe key (day keys keep their old spelling, so no day step re-sends); the counter
-- moves only when a row was actually inserted (it moved on a dedupe conflict before).
--
-- The parser is only as right as entered_at. finished_prelicense took its entry time from
-- applications.updated_at, and fn_next_step_recompute_one writes applications every night
-- at 03:00, so that stage's entry moved forward by a day every night (16 active rows read
-- "entered" 2026-10-15 03:00; their last nudge was 2026-08-04). Under an exact parser that
-- manufactured clock would have sent all 15 reachable people one "finished your course"
-- nudge at 03:07. Entry now comes from the recorded transition (license_milestone_outbox,
-- written by fn_license_milestone_emit on every license_progress change with an active
-- template, finished_course and passed_test both active), else a lower bound: they cannot
-- have finished before they started. A lower bound only ever makes the entry older, so it
-- can delay a nudge and never invent a fresh one. The rows are recomputed here so the fix
-- does not wait on the 03:00 cron.

CREATE OR REPLACE VIEW public.v_next_step_current AS
 WITH applicants AS (
         SELECT a.id AS application_id,
            NULL::uuid AS agent_id,
            'applicant'::text AS person_type,
            a.first_name,
            a.last_name,
            a.email,
            a.phone,
            (a.status)::text AS legacy_status,
            (a.license_progress)::text AS license_progress,
            a.hiring_manager_user_id AS owner_user_id,
                CASE
                    WHEN (a.status = ANY (ARRAY['rejected'::application_status, 'disqualified'::application_status, 'lapsed'::application_status])) THEN 'closed_lost'::text
                    WHEN ((a.exam_passed_at IS NOT NULL) AND ((a.fingerprint_done = true) OR (a.fingerprints_submitted_at IS NOT NULL))) THEN 'passed_exam'::text
                    WHEN (a.exam_passed_at IS NOT NULL) THEN 'passed_exam'::text
                    WHEN (a.exam_scheduled_at IS NOT NULL) THEN 'exam_scheduled'::text
                    WHEN ((a.license_progress = 'finished_course'::license_progress) OR (a.license_progress = 'exam_passed'::license_progress) OR (a.license_progress = 'passed_test'::license_progress)) THEN 'finished_prelicense'::text
                    WHEN ((a.course_started_at IS NOT NULL) OR (a.course_purchased_at IS NOT NULL) OR (a.license_progress = 'course_purchased'::license_progress)) THEN 'started_prelicense'::text
                    WHEN (a.last_contacted_at IS NOT NULL) THEN 'contacted'::text
                    WHEN (a.vsl_watched_at IS NOT NULL) THEN 'watched_vsl'::text
                    ELSE 'applied'::text
                END AS derived_stage_key,
            a.created_at AS person_created_at,
            a.next_action_at,
            a.next_action_due_at,
            a.last_contacted_at,
                CASE
                    WHEN (a.exam_passed_at IS NOT NULL) THEN a.exam_passed_at
                    WHEN (a.exam_scheduled_at IS NOT NULL) THEN a.exam_scheduled_at
                    WHEN (a.license_progress = ANY (ARRAY['finished_course'::license_progress, 'exam_passed'::license_progress, 'passed_test'::license_progress])) THEN COALESCE(( SELECT max(o.created_at) AS max
                       FROM license_milestone_outbox o
                      WHERE ((o.application_id = a.id) AND (o.new_progress = (a.license_progress)::text))), a.course_started_at, a.course_purchased_at, a.created_at)
                    WHEN (a.course_started_at IS NOT NULL) THEN a.course_started_at
                    WHEN (a.course_purchased_at IS NOT NULL) THEN a.course_purchased_at
                    WHEN (a.seminar_attended_at IS NOT NULL) THEN a.seminar_attended_at
                    WHEN (a.seminar_registered_at IS NOT NULL) THEN a.seminar_registered_at
                    WHEN (a.seminar_date IS NOT NULL) THEN a.created_at
                    WHEN (a.last_contacted_at IS NOT NULL) THEN a.last_contacted_at
                    WHEN (a.vsl_watched_at IS NOT NULL) THEN a.vsl_watched_at
                    ELSE a.created_at
                END AS stage_entered_at
           FROM applications a
          WHERE ((COALESCE(a.is_duplicate, false) = false) AND (a.status <> 'approved'::application_status))
        ), agents_part AS (
         SELECT NULL::uuid AS application_id,
            g.id AS agent_id,
            'agent'::text AS person_type,
            COALESCE(split_part(p.full_name, ' '::text, 1), split_part(g.display_name, ' '::text, 1)) AS first_name,
            COALESCE(NULLIF(regexp_replace(p.full_name, '^\S+\s*'::text, ''::text), ''::text), split_part(g.display_name, ' '::text, 2)) AS last_name,
            p.email,
            p.phone,
            (g.status)::text AS legacy_status,
            (g.license_status)::text AS license_progress,
            g.manager_id AS owner_user_id,
                CASE
                    WHEN ((g.is_deactivated = true) OR (g.status = 'terminated'::agent_status)) THEN 'closed_lost'::text
                    WHEN ((g.first_10k_at IS NOT NULL) OR (g.weekly_10k_badges > 0)) THEN 'first_10k_week'::text
                    WHEN (g.first_deal_at IS NOT NULL) THEN 'first_deal'::text
                    WHEN (g.first_appointment_at IS NOT NULL) THEN 'first_appointment'::text
                    WHEN (g.license_status IS DISTINCT FROM 'licensed'::license_status) THEN 'hired_unlicensed'::text
                    WHEN ((g.field_training_started_at IS NOT NULL) OR ((g.onboarding_stage)::text = 'in_field_training'::text)) THEN 'infield_training'::text
                    WHEN (g.onboarding_completed_at IS NOT NULL) THEN 'course_completed'::text
                    WHEN (EXISTS ( SELECT 1
                       FROM onboarding_progress op
                      WHERE ((op.agent_id = g.id) AND ((op.started_at IS NOT NULL) OR (op.completed_at IS NOT NULL) OR (COALESCE(op.video_watched_percent, 0) > 0))))) THEN 'course_started'::text
                    ELSE 'hired'::text
                END AS derived_stage_key,
            g.created_at AS person_created_at,
            NULL::timestamp with time zone AS next_action_at,
            NULL::timestamp with time zone AS next_action_due_at,
            NULL::timestamp with time zone AS last_contacted_at,
                CASE
                    WHEN (g.first_10k_at IS NOT NULL) THEN g.first_10k_at
                    WHEN (g.first_deal_at IS NOT NULL) THEN g.first_deal_at
                    WHEN (g.first_appointment_at IS NOT NULL) THEN g.first_appointment_at
                    WHEN (g.field_training_started_at IS NOT NULL) THEN g.field_training_started_at
                    WHEN (g.onboarding_completed_at IS NOT NULL) THEN g.onboarding_completed_at
                    WHEN (g.has_training_course = true) THEN COALESCE(g.production_unlocked_at, g.contracted_at, (g.start_date)::timestamp with time zone, g.created_at)
                    ELSE COALESCE(g.contracted_at, (g.start_date)::timestamp with time zone, g.created_at)
                END AS stage_entered_at
           FROM (agents g
             LEFT JOIN profiles p ON ((p.user_id = g.user_id)))
          WHERE ((g.canonical_agent_id IS NULL) AND (EXISTS ( SELECT 1
                   FROM v_agent_canonical_map vc
                  WHERE (vc.canonical_agent_id = g.id))))
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
            WHEN (s.sla_hours IS NULL) THEN NULL::timestamp with time zone
            ELSE (x.stage_entered_at + ((s.sla_hours || ' hours'::text))::interval)
        END AS sla_due_at,
        CASE
            WHEN (s.sla_hours IS NULL) THEN NULL::boolean
            WHEN (now() > (x.stage_entered_at + ((s.sla_hours || ' hours'::text))::interval)) THEN true
            ELSE false
        END AS is_stalled,
    (EXTRACT(epoch FROM (now() - x.stage_entered_at)) / 86400.0) AS days_in_stage
   FROM (( SELECT applicants.application_id,
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
     LEFT JOIN next_step_stages s ON ((s.stage_key = x.derived_stage_key)));


DO $m$
DECLARE r record;
BEGIN
  FOR r IN SELECT np.application_id FROM public.next_step_progress np
            WHERE np.status = 'active' AND np.current_stage_key = 'finished_prelicense'
              AND np.application_id IS NOT NULL
  LOOP
    PERFORM public.fn_next_step_recompute_one(r.application_id, NULL);
  END LOOP;
END
$m$;

CREATE OR REPLACE FUNCTION public.fn_next_step_cadence_due(p_cadence text, p_elapsed interval)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_unit text;
  v_steps int[];
  v_hours int;
  v_days int;
  v_step int;
BEGIN
  IF p_cadence IS NULL OR p_elapsed IS NULL OR p_elapsed < interval '0' OR position(':' in p_cadence) = 0 THEN
    RETURN NULL;
  END IF;
  v_unit := lower(btrim(split_part(p_cadence, ':', 1)));
  BEGIN
    SELECT array_agg(btrim(s)::int) INTO v_steps
      FROM unnest(string_to_array(split_part(p_cadence, ':', 2), ',')) s
     WHERE btrim(s) <> '';
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
  END;
  IF v_steps IS NULL THEN RETURN NULL; END IF;
  v_days := floor(extract(epoch from p_elapsed) / 86400.0)::int;
  v_hours := floor(extract(epoch from p_elapsed) / 3600.0)::int;
  IF v_unit = 'day' THEN
    IF v_days = ANY (v_steps) THEN RETURN 'day' || v_days; END IF;
  ELSIF v_unit = 'hour' THEN
    SELECT max(s) INTO v_step FROM unnest(v_steps) s WHERE s >= 0 AND s <= v_hours AND v_hours < s + 3;
    IF v_step IS NOT NULL THEN RETURN 'hour' || v_step; END IF;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_next_step_cadence_due(text, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_next_step_cadence_due(text, interval) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_next_step_nudge_sweep()
 RETURNS TABLE(queued integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_queued int := 0;
  r record;
  v_days int;
  v_key text;
  v_dedupe text;
  v_ins int;
begin
  for r in
    select np.application_id, np.agent_id, np.current_stage_key, np.entered_at, np.nudge_count, np.last_nudged_at,
           s.reminder_cadence
    from public.next_step_progress np
    join public.next_step_stages s on s.stage_key = np.current_stage_key
    where np.status = 'active' and s.reminder_cadence is not null
  loop
    v_key := public.fn_next_step_cadence_due(r.reminder_cadence, now() - r.entered_at);
    continue when v_key is null;
    -- day steps keep the 20h throttle. Hour steps take 6h: the tightest live gap is
    -- hour:1,12 (11h, nudge at most 2h late in its window), so 6h never holds a real
    -- step, and it stops a row the old sweep nudged as day1 this hour from getting
    -- hour24 again on the first tick after this migration
    continue when r.last_nudged_at is not null and r.last_nudged_at >= now() -
      case when v_key like 'day%' then interval '20 hours' else interval '6 hours' end;
    v_days := floor(extract(epoch from (now() - r.entered_at))/86400.0)::int;
    v_dedupe := coalesce(r.application_id::text, r.agent_id::text) || ':' || r.current_stage_key || ':' || v_key;
    insert into public.next_step_messages
      (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values
      (r.application_id, r.agent_id, r.current_stage_key, 'telegram',
       r.current_stage_key || ':' || v_key, v_dedupe,
       jsonb_build_object('day', v_days, 'step', v_key, 'cadence', r.reminder_cadence))
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_ins = row_count;
    continue when v_ins = 0;
    update public.next_step_progress
      set last_nudged_at = now(), nudge_count = nudge_count + 1
      where (application_id = r.application_id and r.application_id is not null)
         or (agent_id = r.agent_id and r.agent_id is not null);
    v_queued := v_queued + 1;
  end loop;
  return query select v_queued;
end;
$function$;
