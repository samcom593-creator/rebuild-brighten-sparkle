-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 5/9: an Xcel student who matches no record gets one, so they
-- have an owner.
--
-- WHAT: in the 11-11 Xcel report 8 active students match no application, profile, agent or booking
-- by email, phone or name (shipped_vs_live #42; funnel_now 3c): Obi, Jakara and Analynn FINISHED the
-- course, Clyde is at 96%, Kaleb, Michael, Leslie and Isaac are at 0%. Nothing can reach them and no
-- human owns them. apex-doctor #42 warns about them every run and its remedy ("link them") cannot
-- clear it, because there is nothing to link to.
--
-- HOW (existing pattern, not a new record type): an applications row with source = 'xcel_roster'
-- (3 such rows exist since 08-29). The funnel views exclude that source (v_recruit_funnel_applications),
-- so application counts do not move. record_type stays 'application' (the CHECK allows nothing else
-- that fits), so the SLA queue (v_recruit_sla_queue) shows them to the owner.
--   * Owner: fn_course_lane_owner_user_id(null, null) = the recruit owner roster
--     (system_settings.recruit_owner_roster, first member active in 7 days), else Sam.
--   * Inserted with session_replication_role = replica for that statement only: the ~25 AFTER INSERT
--     triggers on applications would otherwise post "NEW APPLICANT" to the Telegram chat, queue a Slack
--     post, queue a portal-login email (applicant_login_queue), send an inbox "call within 5 minutes",
--     and record licensing milestones. Every field those BEFORE triggers would set is set explicitly
--     here (owner, record_type, license fields; no manager is invented).
--   * Course progress is stamped silently from the Xcel facts (same stamps as fn_apply_xcel_progress,
--     logged in xcel_writeback_log mode 'backfill') and the Xcel rows are linked with
--     match_method = 'roster_record'.
--   * The next-step row is computed (fn_next_step_recompute_one). If the stage was entered from
--     HISTORY (the driving Xcel event is not fresh by fn_xcel_progress_plan), every step still ahead
--     gets a 'suppressed:' placeholder, exactly like WP1. A FRESH enrolment (Kaleb, Michael, Leslie:
--     enrolled 11-10, first seen 11-11) keeps only the FIRST step of its stage cadence (the day 3
--     course check-in from the shared ladder) and the rest are pre-suppressed: DECISIONS gives these
--     students one coach/exam message each, not a drip. Nobody here signed our form.
--   * One inbox task to the owner per record.
--   * Never: a suspended person, an email that matches any application/profile/login, a phone or
--     name+window that matches a record (a human should link those), a staff-unlinked identity.
--
-- The data change is 20261112000391 (explicit student ids); this file only defines the functions.
-- ROLLBACK (per record): delete from public.applications where source = 'xcel_roster'
--   and 'pkg3' = any(tags) and created_at >= '<apply time>';  (cascades next_step rows; then
--   update xcel_pre_licensing_students set application_id = null, match_method = null, matched_at = null
--   where match_method = 'roster_record';)

create or replace function public.fn_course_lane_xcel_roster_candidates()
returns table (
  student_id uuid, email_key text, first_name text, last_initial text, state text, course_name text,
  latest_pct numeric, enrolled_on date, started_on date, completed_on date, last_log_in date,
  hiring_manager_name text, would_create boolean, reason text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ident as (
    select x.*,
           (select right(regexp_replace(s.phone, '\D', '', 'g'), 10)
              from public.xcel_pre_licensing_students s
              join public.xcel_pre_licensing_reports rep on rep.id = s.report_id
             where lower(btrim(s.email)) = x.email_key
               and length(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g')) >= 10
             order by rep.report_date desc, s.created_at desc limit 1) as phone10,
           (select btrim(s.last_name)
              from public.xcel_pre_licensing_students s
              join public.xcel_pre_licensing_reports rep on rep.id = s.report_id
             where lower(btrim(s.email)) = x.email_key and nullif(btrim(s.last_name), '') is not null
             order by rep.report_date desc, s.created_at desc limit 1) as last_name
      from public.v_xcel_identity_rollup x
     where not x.is_linked and x.is_active and not x.staff_unlinked
  )
  select i.student_id, i.email_key, i.first_name, i.last_initial,
         public.fn_course_lane_course_state(i.course_name, null), i.course_name, i.latest_pct,
         i.enrolled_on, i.started_on, i.completed_on, i.last_log_in, i.hiring_manager_name,
         chk.reason is null, chk.reason
    from ident i
    cross join lateral (
      select case
        when public.fn_course_lane_email_suspended(i.email_key) then 'suspended'
        when exists (select 1 from public.applications a where lower(btrim(a.email)) = i.email_key) then 'application_exists_by_email'
        when exists (select 1 from public.profiles p where lower(btrim(p.email)) = i.email_key) then 'profile_exists_by_email'
        when exists (select 1 from auth.users u where lower(btrim(u.email)) = i.email_key) then 'login_exists_by_email'
        when i.phone10 is not null and (
               exists (select 1 from public.applications a where right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 10) = i.phone10)
            or exists (select 1 from public.profiles p where right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = i.phone10))
          then 'phone_matches_a_record'
        when i.first_name is not null and i.last_name is not null and i.enrolled_on is not null and exists (
               select 1 from public.applications a
                where lower(btrim(a.first_name)) = lower(i.first_name) and lower(btrim(a.last_name)) = lower(i.last_name)
                  and a.created_at between i.enrolled_on - interval '90 days' and i.enrolled_on + interval '90 days')
          then 'name_matches_a_record'
        when nullif(btrim(i.first_name), '') is null then 'no_first_name'
      end as reason
    ) chk
$$;

comment on function public.fn_course_lane_xcel_roster_candidates() is
  'PKG3 read-only: active Xcel students linked to no record, and whether a roster record may be created for them (reason NULL) or why not.';

create or replace function public.fn_course_lane_create_xcel_roster_records(
  p_dry_run boolean default true, p_student_ids uuid[] default null, p_max integer default 12)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_rows jsonb := '[]'::jsonb;
  v_last_name text;
  v_email text;
  v_phone text;
  v_hiring_manager text;
  v_course text;
  v_purchased_fresh boolean;
  v_started_fresh boolean;
  v_target_fresh boolean;
  v_id uuid;
  v_owner uuid;
  v_lp text;
  v_cp timestamptz;
  v_cs timestamptz;
  v_prev_srr text := current_setting('session_replication_role');
  v_stage text;
  v_entered timestamptz;
  v_cadence text;
  v_fresh boolean;
  v_n int;
  v_made int := 0;
  v_cutoff_ts timestamptz := public.fn_xcel_cutoff_ts();
begin
  for c in
    select * from public.fn_course_lane_xcel_roster_candidates() k
     -- any report row id of the identity selects it (a new daily report adds rows, so the newest id moves)
     where (p_student_ids is null
            or exists (select 1 from public.xcel_pre_licensing_students s
                        where s.id = any(p_student_ids) and lower(btrim(s.email)) = k.email_key))
     order by k.completed_on nulls last, k.enrolled_on
  loop
    if not c.would_create then
      v_rows := v_rows || jsonb_build_object('student_id', c.student_id, 'first_name', c.first_name, 'state', c.state,
                                             'pct', c.latest_pct, 'action', 'skip', 'reason', c.reason);
      continue;
    end if;
    if v_made >= greatest(coalesce(p_max, 12), 0) then
      v_rows := v_rows || jsonb_build_object('student_id', c.student_id, 'first_name', c.first_name, 'action', 'skip', 'reason', 'over_p_max');
      continue;
    end if;

    v_lp := case when c.completed_on is not null then 'finished_course'
                 when c.enrolled_on is not null then 'course_purchased' else 'unlicensed' end;
    v_cp := case when c.enrolled_on is not null then (c.enrolled_on::timestamp + interval '12 hours') at time zone 'America/Phoenix' end;
    v_cs := case when c.started_on is not null then (c.started_on::timestamp + interval '12 hours') at time zone 'America/Phoenix' end;
    v_owner := public.fn_course_lane_owner_user_id(null, null);

    if p_dry_run then
      v_rows := v_rows || jsonb_build_object('student_id', c.student_id, 'first_name', c.first_name, 'last_initial', c.last_initial,
                                             'state', c.state, 'pct', c.latest_pct, 'enrolled_on', c.enrolled_on,
                                             'completed_on', c.completed_on, 'license_progress', v_lp,
                                             'owner', public.fn_staff_first_name(v_owner), 'action', 'would_create');
      v_made := v_made + 1;
      continue;
    end if;

    begin
      select st.last_name, btrim(st.email), st.phone, st.hiring_manager_name, st.course_name
        into v_last_name, v_email, v_phone, v_hiring_manager, v_course
        from public.xcel_pre_licensing_students st
        join public.xcel_pre_licensing_reports rep on rep.id = st.report_id
       where lower(btrim(st.email)) = c.email_key
       order by rep.report_date desc, st.created_at desc
       limit 1;

      v_id := gen_random_uuid();

      -- No trigger may react to this insert (see header). Restored right after. A SET statement, not
      -- set_config(): on Supabase only the SET statement path may change this parameter.
      set local session_replication_role = replica;
      insert into public.applications (
        id, first_name, last_name, email, phone, state,
        license_status, license_progress, status, source, record_type, is_duplicate,
        recruiting_owner_user_id, recruiting_owner_set_at,
        email_consent_given, sms_consent_given, telegram_opt_out,
        course_purchased_at, course_started_at,
        hiring_scope_at_intake, referral_source, referral_source_detail, tags, notes,
        created_at, updated_at)
      values (
        v_id, btrim(c.first_name), coalesce(nullif(btrim(v_last_name), ''), ''), v_email,
        nullif(btrim(v_phone), ''), c.state,
        'unlicensed', v_lp::license_progress, 'new', 'xcel_roster', 'application', false,
        v_owner, now(),
        false, false, true,
        v_cp, v_cs,
        'unlicensed', 'Xcel roster', nullif('Xcel hiring manager: ' || nullif(btrim(coalesce(v_hiring_manager, '')), 'N/A'), 'Xcel hiring manager: '),
        array['xcel_roster', 'pkg3']::text[],
        'Created by MP-ONBOARD-ANCHOR-PKG3 from the Xcel pre-licensing report (' || coalesce(v_course, 'course unknown')
          || ', ' || coalesce(c.latest_pct::text, '?') || '%). This student matched no application, profile or login, so they had no owner. Not a website application: excluded from the funnel views by source.',
        now(), now());

      update public.xcel_pre_licensing_students
         set application_id = v_id, match_method = 'roster_record', matched_at = now()
       where lower(btrim(email)) = c.email_key
         and application_id is null and matched_agent_id is null;

      insert into public.xcel_writeback_log (report_id, application_id, agent_id, field, old_value, new_value, mode, event_on)
      select null, v_id, null, f.field, f.old_v, f.new_v, 'backfill', f.ev
        from (values ('course_purchased_at', null::text, v_cp::text, c.enrolled_on),
                     ('course_started_at', null::text, v_cs::text, c.started_on),
                     ('license_progress', 'unlicensed', case when v_lp <> 'unlicensed' then v_lp end,
                      coalesce(c.completed_on, c.enrolled_on))) as f(field, old_v, new_v, ev)
       where f.new_v is not null;

      perform public.fn_next_step_recompute_one(v_id, null);

      -- History stays history: a stage entered from an event that is not fresh starts no cadence.
      -- A fresh one keeps its first step only (one message each, see header).
      select np.current_stage_key, np.entered_at into v_stage, v_entered
        from public.next_step_progress np where np.application_id = v_id;
      select pp.purchased_fresh, pp.started_fresh, pp.target_fresh
        into v_purchased_fresh, v_started_fresh, v_target_fresh
        from public.fn_xcel_progress_plan() pp where pp.application_id = v_id limit 1;
      v_fresh := case v_stage
                   when 'finished_prelicense' then coalesce(v_target_fresh, false)
                   when 'started_prelicense' then coalesce(v_purchased_fresh, false) or coalesce(v_started_fresh, false)
                   else false end;
      v_n := 0;
      if v_stage in ('started_prelicense', 'finished_prelicense') then
        select st.reminder_cadence into v_cadence from public.next_step_stages st where st.stage_key = v_stage;
        if coalesce(v_cadence, '') like '%:%' then
          insert into public.next_step_messages
            (application_id, stage_key, channel, template_key, dedupe_key, failed_at, error, metadata)
          select v_id, v_stage, 'email', v_stage || ':' || k.unit || k.n,
                 v_id::text || ':' || v_stage || ':' || k.unit || k.n, now(),
                 case when v_fresh
                      then 'suppressed: Xcel roster record (PKG3) keeps one check-in, not a drip; not sent'
                      else 'suppressed: Xcel roster record created from historic course data (PKG3); not sent' end,
                 jsonb_build_object('suppressed_by', 'pkg3_xcel_roster_record', 'entered_at', v_entered,
                                    'cutoff_at', v_cutoff_ts, 'fresh_entry', v_fresh)
            from (select lower(btrim(split_part(v_cadence, ':', 1))) as unit, btrim(x.s) as n, x.ord
                    from unnest(string_to_array(split_part(v_cadence, ':', 2), ',')) with ordinality as x(s, ord)
                   where btrim(x.s) ~ '^-?\d+$') k
           where (not v_fresh or k.ord > 1)
             and (v_entered is null
              or (k.unit = 'day' and v_entered + make_interval(days => k.n::int + 1) > now())
              or (k.unit = 'hour' and v_entered + make_interval(hours => k.n::int + 21) > now()))
          on conflict (dedupe_key) where dedupe_key is not null do nothing;
          get diagnostics v_n = row_count;
        end if;
      end if;
      execute 'set local session_replication_role = ' || quote_literal(v_prev_srr);

      perform public.fn_emit_inbox_notification(
        v_owner, 'xcel_student_assigned',
        btrim(c.first_name) || coalesce(' ' || c.last_initial || '.', '') || ' (Xcel, ' || coalesce(c.state, 'state unknown') || ') is now yours',
        coalesce(c.latest_pct::text, '?') || '% through ' || coalesce(c.course_name, 'the course')
          || case when c.completed_on is not null then ', finished ' || to_char(c.completed_on, 'Mon DD') else '' end
          || '. No application was on file. Call to confirm their state and their next step.',
        '/dashboard/recruiting?lead=' || v_id::text, 'normal',
        jsonb_build_object('application_id', v_id, 'student_id', c.student_id, 'source', 'fn_course_lane_create_xcel_roster_records'));

      v_made := v_made + 1;
      v_rows := v_rows || jsonb_build_object('student_id', c.student_id, 'application_id', v_id, 'first_name', c.first_name,
                                             'state', c.state, 'pct', c.latest_pct, 'license_progress', v_lp,
                                             'stage', v_stage, 'placeholders', v_n, 'action', 'created');
    exception when others then
      -- the failed subtransaction already reverted its SET LOCAL; restate it to be certain
      execute 'set local session_replication_role = ' || quote_literal(v_prev_srr);
      v_rows := v_rows || jsonb_build_object('student_id', c.student_id, 'first_name', c.first_name,
                                             'action', 'error', 'reason', left(sqlerrm, 300));
    end;
  end loop;

  if not p_dry_run then
    execute 'set local session_replication_role = ' || quote_literal(v_prev_srr);
    insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body)
    values ('course-lane-xcel-roster-records', now(), clock_timestamp(), 'success',
            jsonb_build_object('created', v_made, 'rows', v_rows));
  end if;
  return jsonb_build_object('dry_run', p_dry_run, (case when p_dry_run then 'would_create' else 'created' end), v_made, 'rows', v_rows);
end;
$$;

comment on function public.fn_course_lane_create_xcel_roster_records(boolean, uuid[], integer) is
  'PKG3 (dry_run by default): give unmatched active Xcel students an xcel_roster application row with the recruit-roster owner, silent course stamps, a next-step row (history-entered cadence pre-suppressed) and one owner inbox task. Applied by 20261112000391 for an explicit list.';

comment on column public.xcel_pre_licensing_students.match_method is
  'WP1: how this identity was linked. email_ingest (legacy insert-time exact email), email_app, email_agent, phone_app, name_window (auto, unlinkable), staff_link / staff_unlinked (a human decided; the matcher never overrides), roster_record (PKG3: the application was created from this Xcel row).';

revoke all on function public.fn_course_lane_xcel_roster_candidates() from public, anon, authenticated;
revoke all on function public.fn_course_lane_create_xcel_roster_records(boolean, uuid[], integer) from public, anon, authenticated;
grant execute on function public.fn_course_lane_xcel_roster_candidates() to service_role;
grant execute on function public.fn_course_lane_create_xcel_roster_records(boolean, uuid[], integer) to service_role;
