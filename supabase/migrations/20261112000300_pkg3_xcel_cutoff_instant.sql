-- MP-ONBOARD-ANCHOR-PKG3 (2026-11-12) 1/9: the Xcel forward-only cutoff compares INSTANTS, not dates.
--
-- WHAT: fn_xcel_progress_plan() decided "fresh" (a person hears about it) versus "history" (applied
-- silently) by comparing the Xcel event DATE with the cutoff DATE:
--     completed_on > cutoff_on
-- and fn_apply_xcel_progress() pre-wrote 'suppressed:' placeholder rows for a stage entered from
-- history when
--     (entered_at at time zone 'America/Phoenix')::date <= cutoff_on
-- system_settings.xcel_writeback_messages_from is an INSTANT (2026-11-10 21:19:51Z = 14:19 Phoenix).
-- Cooper (application 307a0955) applied 11-10 09:01 Phoenix and bought and finished the course the
-- same day. The 11-11 report was the first that showed him at all, so the system could not have known
-- before the cutoff. The date test called his completion history: no milestone note, no exam message,
-- and three placeholder rows (finished_prelicense hour24/48/72, failed_at set) that block his exam
-- nudges for good. (timeline_forensics D1; funnel_now section 5.)
--
-- WHY THIS RULE: an Xcel row only carries a date, so the event instant is known to lie in
--   [event day 00:00 Phoenix, min(event day 24:00 Phoenix, first report row that showed it)].
-- An event is fresh when that upper bound is after the cutoff instant:
--   * dated after the cutoff day          -> fresh (unchanged)
--   * dated before the cutoff day         -> history (unchanged)
--   * dated ON the cutoff day             -> fresh only if no report received before the cutoff
--                                            showed it (it was not knowable at deploy, so it is not
--                                            a replay). Cooper: first seen 11-11 12:00Z -> fresh.
-- The 14-day staleness rule is unchanged. A missing or garbled cutoff still means nothing is fresh.
--
-- OBJECTS (all PKG3-owned Xcel objects; nothing else is redefined):
--   fn_xcel_cutoff_ts()                    the cutoff instant (NULL when missing/garbled)
--   fn_xcel_event_upper_bound(date, ts)    the instant rule above (immutable)
--   v_xcel_identity_rollup                 + enrolled_first_seen_at, started_first_seen_at,
--                                            completed_first_seen_at (appended at the end)
--   fn_xcel_progress_plan()                same signature/columns; freshness uses the instant rule
--   fn_apply_xcel_progress(uuid)           same signature; the placeholder test compares instants
--   fn_course_lane_wrong_xcel_suppressions()          read-only list of placeholders that the
--                                                     instant rule says were wrong
--   fn_course_lane_clear_wrong_xcel_suppressions(bool) the data fix, dry_run by default. It voids
--                                                     the dedupe key (keeps the row and failed_at, so
--                                                     nothing ever sends from it). Applied by
--                                                     20261112000390.
--
-- ROLLBACK: re-apply the two function bodies and the view from 20261111100000_wp1_xcel_writeback.sql
-- (the appended view columns can stay; nothing else reads them before PKG3). Voided placeholders are
-- restored by: update next_step_messages set dedupe_key = metadata->>'voided_dedupe_key'
--   where metadata ? 'voided_dedupe_key';

-- ---------------------------------------------------------------------------
-- 1. The cutoff instant and the instant rule
-- ---------------------------------------------------------------------------
create or replace function public.fn_xcel_cutoff_ts()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Same parse as the plan always used: a value that does not start with a date is "no cutoff",
  -- and no cutoff means nothing is fresh (fail closed).
  select case when s.value ~ '^\d{4}-\d{2}-\d{2}' then s.value::timestamptz end
    from public.system_settings s
   where s.key = 'xcel_writeback_messages_from'
$$;

comment on function public.fn_xcel_cutoff_ts() is
  'PKG3: the Xcel forward-only cutoff INSTANT (system_settings.xcel_writeback_messages_from). NULL when missing or garbled; callers treat NULL as "nothing is fresh".';

create or replace function public.fn_xcel_event_upper_bound(p_event_on date, p_seen_at timestamptz)
returns timestamptz
language sql
immutable
set search_path to 'public'
as $$
  -- An Xcel event dated p_event_on happened no later than the end of that Phoenix day and no later
  -- than the first report row that showed it.
  select case when p_event_on is null then null
              else least(((p_event_on + 1)::timestamp at time zone 'America/Phoenix'),
                         coalesce(p_seen_at, 'infinity'::timestamptz)) end
$$;

comment on function public.fn_xcel_event_upper_bound(date, timestamptz) is
  'PKG3: latest instant an Xcel event dated p_event_on can have happened: min(end of that Phoenix day, first report row that showed it). Fresh = this is after fn_xcel_cutoff_ts().';

-- ---------------------------------------------------------------------------
-- 2. Identity rollup: when was each event FIRST seen. Columns appended at the end.
-- ---------------------------------------------------------------------------
create or replace view public.v_xcel_identity_rollup as
with r as (
  select lower(btrim(s.email)) as email_key, s.id, s.first_name, s.last_name,
         s.application_id, s.matched_agent_id, s.match_method,
         s.date_enrolled, s.last_log_in, s.date_completed, s.pct_complete, s.time_spent_minutes,
         s.hiring_manager_name, s.course_name, s.created_at, rep.report_date
    from public.xcel_pre_licensing_students s
    join public.xcel_pre_licensing_reports rep on rep.id = s.report_id
   where nullif(btrim(s.email), '') is not null
), g as (
  select email_key,
         (array_agg(id order by report_date desc, created_at desc))[1] as student_id,
         (array_agg(btrim(first_name) order by report_date desc, created_at desc)
            filter (where nullif(btrim(first_name), '') is not null))[1] as first_name,
         (array_agg(upper(left(btrim(last_name), 1)) order by report_date desc, created_at desc)
            filter (where nullif(btrim(last_name), '') is not null))[1] as last_initial,
         (array_agg(application_id order by report_date desc, created_at desc)
            filter (where application_id is not null))[1] as application_id,
         (array_agg(matched_agent_id order by report_date desc, created_at desc)
            filter (where matched_agent_id is not null))[1] as matched_agent_id,
         (array_agg(match_method order by report_date desc, created_at desc)
            filter (where match_method is not null))[1] as match_method,
         coalesce(bool_or(match_method = 'staff_unlinked'), false) as staff_unlinked,
         min(date_enrolled) as enrolled_on,
         min(coalesce(last_log_in, date_enrolled))
           filter (where coalesce(pct_complete, 0) > 0 or coalesce(time_spent_minutes, 0) > 0) as started_on,
         min(coalesce(date_completed, last_log_in, report_date))
           filter (where coalesce(pct_complete, 0) >= 100 or date_completed is not null) as completed_on,
         max(last_log_in) as last_log_in,
         max(greatest(date_enrolled, last_log_in, date_completed)) as last_activity_on,
         (array_agg(pct_complete order by report_date desc, pct_complete desc nulls last))[1] as latest_pct,
         (array_agg(btrim(hiring_manager_name) order by report_date desc, created_at desc)
            filter (where nullif(btrim(hiring_manager_name), '') is not null))[1] as hiring_manager_name,
         (array_agg(course_name order by report_date desc, created_at desc)
            filter (where course_name is not null))[1] as course_name,
         max(report_date) as last_seen_report,
         min(created_at) as first_seen_at,
         -- PKG3: first ingest of a row that showed each event (the "could the system know" bound)
         min(created_at) filter (where date_enrolled is not null) as enrolled_first_seen_at,
         min(created_at) filter (where coalesce(pct_complete, 0) > 0 or coalesce(time_spent_minutes, 0) > 0)
           as started_first_seen_at,
         min(created_at) filter (where coalesce(pct_complete, 0) >= 100 or date_completed is not null)
           as completed_first_seen_at
    from r
   group by email_key
)
select g.email_key, g.student_id, g.first_name, g.last_initial, g.application_id, g.matched_agent_id,
       g.match_method, g.staff_unlinked, g.enrolled_on, g.started_on, g.completed_on, g.last_log_in,
       g.last_activity_on, g.latest_pct, g.hiring_manager_name, g.course_name, g.last_seen_report,
       g.first_seen_at,
       (g.application_id is not null or g.matched_agent_id is not null) as is_linked,
       (g.last_activity_on >= (now() at time zone 'America/Phoenix')::date - 60
        or g.last_seen_report >= (now() at time zone 'America/Phoenix')::date - 14) as is_active,
       g.enrolled_first_seen_at,
       g.started_first_seen_at,
       g.completed_first_seen_at
  from g;

comment on view public.v_xcel_identity_rollup is
  'WP1 internal: one row per Xcel student identity (lower(btrim(email))). Holds contact-free progress facts. PKG3 appended *_first_seen_at: the first ingested row that showed each event (fn_xcel_event_upper_bound). Not granted to anon/authenticated; staff read it through gated views.';
revoke all on public.v_xcel_identity_rollup from anon, authenticated, public;
grant select on public.v_xcel_identity_rollup to service_role;

-- ---------------------------------------------------------------------------
-- 3. The plan: same columns, freshness by instant.
-- ---------------------------------------------------------------------------
create or replace function public.fn_xcel_progress_plan()
returns table (
  email_key text, student_id uuid, first_name text,
  application_id uuid, agent_id uuid,
  enrolled_on date, started_on date, completed_on date, latest_pct numeric,
  target_progress text, target_on date,
  purchased_fresh boolean, started_fresh boolean, target_fresh boolean,
  cutoff_on date)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- fresh(event) = the event's latest possible instant is after the cutoff instant, and the event is
  -- no older than 14 days. No cutoff configured -> cutoff_ts NULL -> nothing is fresh.
  with cfg as (
    select public.fn_xcel_cutoff_ts() as cutoff_ts,
           (public.fn_xcel_cutoff_ts() at time zone 'America/Phoenix')::date as cutoff_on,
           (now() at time zone 'America/Phoenix')::date as today
  )
  select x.email_key, x.student_id, x.first_name,
         case when a.id is null then null
              when coalesce(a.is_duplicate, false) then d.id
              else a.id end,
         x.matched_agent_id,
         x.enrolled_on, x.started_on, x.completed_on, x.latest_pct,
         case when x.completed_on is not null then 'finished_course'
              when x.enrolled_on is not null then 'course_purchased' end,
         coalesce(x.completed_on, x.enrolled_on),
         (x.enrolled_on is not null and cfg.cutoff_ts is not null
            and x.enrolled_on >= cfg.today - 14
            and public.fn_xcel_event_upper_bound(x.enrolled_on, x.enrolled_first_seen_at) > cfg.cutoff_ts),
         (x.started_on is not null and cfg.cutoff_ts is not null
            and x.started_on >= cfg.today - 14
            and public.fn_xcel_event_upper_bound(x.started_on, x.started_first_seen_at) > cfg.cutoff_ts),
         (coalesce(x.completed_on, x.enrolled_on) is not null and cfg.cutoff_ts is not null
            and coalesce(x.completed_on, x.enrolled_on) >= cfg.today - 14
            and case when x.completed_on is not null
                     then public.fn_xcel_event_upper_bound(x.completed_on, x.completed_first_seen_at)
                     else public.fn_xcel_event_upper_bound(x.enrolled_on, x.enrolled_first_seen_at)
                end > cfg.cutoff_ts),
         cfg.cutoff_on
    from public.v_xcel_identity_rollup x
    cross join cfg
    left join public.applications a on a.id = x.application_id
    left join public.applications d on d.id = a.duplicate_of and coalesce(d.is_duplicate, false) = false
   where x.application_id is not null or x.matched_agent_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- 4. Apply: identical to WP1 except the placeholder test compares the stage's entered_at INSTANT
--    with the cutoff instant (it compared Phoenix dates).
-- ---------------------------------------------------------------------------
create or replace function public.fn_apply_xcel_progress(p_report_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p record;
  v_app record;
  v_agent record;
  v_started timestamptz := clock_timestamp();
  v_prev_guc text := coalesce(nullif(current_setting('apex.xcel_backfill', true), ''), 'off');
  v_silent boolean;
  v_cp timestamptz;
  v_cs timestamptz;
  v_lp text;
  v_target text;
  v_milestone text;
  v_stage_before text;
  v_entered_before timestamptz;
  v_stage_after text;
  v_entered_after timestamptz;
  v_cadence text;
  v_did_backfill boolean;
  v_phase text;
  v_n int;
  v_cutoff date;
  v_cutoff_ts timestamptz := public.fn_xcel_cutoff_ts();
  c_identities int := 0;
  c_app_backfill int := 0;
  c_app_fresh int := 0;
  c_app_licensed_skip int := 0;
  c_agent int := 0;
  c_events int := 0;
  c_proofs int := 0;
  c_suppressed int := 0;
  c_errors int := 0;
  v_first_error text;
  v_result jsonb;
begin
  v_silent := (v_prev_guc = 'on');

  for p in select * from public.fn_xcel_progress_plan() loop
    c_identities := c_identities + 1;
    v_cutoff := p.cutoff_on;

    -- One identity per subtransaction: a bad row is logged and skipped, it does
    -- not roll back everybody else's write-back (and its GUC change unwinds).
    begin

    if p.application_id is not null then
      select a.id, a.first_name, a.last_name, a.state,
             a.license_status::text as ls, a.licensed_at,
             coalesce(a.license_progress::text, 'unlicensed') as lp,
             a.course_purchased_at, a.course_started_at
        into v_app
        from public.applications a
       where a.id = p.application_id
         for update;

      if found then
        select np.current_stage_key, np.entered_at
          into v_stage_before, v_entered_before
          from public.next_step_progress np
         where np.application_id = p.application_id;
        v_did_backfill := false;

        -- An already-licensed application is left alone: course stamps would move
        -- it into the 'started_prelicense' next-step stage (v_next_step_current
        -- ranks course timestamps above licence fields), and a progress write
        -- would be dragged to 'licensed' by fn_reconcile_licensing_vocabularies.
        if v_app.ls = 'licensed' or v_app.licensed_at is not null then
          c_app_licensed_skip := c_app_licensed_skip + 1;
        else
        foreach v_phase in array array['backfill', 'fresh'] loop
          v_cp := case when v_app.course_purchased_at is null and p.enrolled_on is not null
                        and (p.purchased_fresh = (v_phase = 'fresh'))
                       then (p.enrolled_on::timestamp + interval '12 hours') at time zone 'America/Phoenix' end;
          v_cs := case when v_app.course_started_at is null and p.started_on is not null
                        and (p.started_fresh = (v_phase = 'fresh'))
                       then (p.started_on::timestamp + interval '12 hours') at time zone 'America/Phoenix' end;
          v_target := case
                        when p.completed_on is not null and (p.target_fresh = (v_phase = 'fresh')) then 'finished_course'
                        when p.enrolled_on is not null and (p.purchased_fresh = (v_phase = 'fresh')) then 'course_purchased'
                      end;
          -- Never on a licensed application (fn_reconcile_licensing_vocabularies
          -- would drag it to 'licensed' and fire the hire reactions); never back.
          v_lp := case when v_target is not null
                         and v_app.ls is distinct from 'licensed' and v_app.licensed_at is null
                         and public.fn_license_stage_rank(v_target::license_progress)
                             > public.fn_license_stage_rank(v_app.lp::license_progress)
                       then v_target end;

          continue when v_cp is null and v_cs is null and v_lp is null;

          perform set_config('apex.xcel_backfill',
                             case when v_phase = 'backfill' or v_silent then 'on' else 'off' end, true);

          if v_phase = 'fresh' and v_lp is not null and not v_silent then
            v_milestone := case v_lp when 'course_purchased' then 'enrolled_course'
                                     when 'finished_course' then 'completed_course' end;
            if not exists (select 1 from public.licensing_milestone_events e
                            where e.application_id = p.application_id and e.milestone_type = v_milestone) then
              insert into public.licensing_milestone_events
                (application_id, agent_id, candidate_name, milestone_type, state, source)
              values (p.application_id, p.agent_id,
                      coalesce(nullif(btrim(concat_ws(' ', v_app.first_name, v_app.last_name)), ''), 'Applicant'),
                      v_milestone,
                      case when upper(btrim(coalesce(v_app.state, ''))) ~ '^[A-Z]{2}$'
                           then upper(btrim(v_app.state)) end,
                      'xcel');
              c_events := c_events + 1;
            end if;
          end if;

          -- One column per statement, in this order: track_license_milestones
          -- stamps course_purchased_at := now() if progress moves first.
          if v_cp is not null then
            update public.applications set course_purchased_at = v_cp
             where id = p.application_id and course_purchased_at is null;
          end if;
          if v_cs is not null then
            update public.applications set course_started_at = v_cs
             where id = p.application_id and course_started_at is null;
          end if;
          if v_lp is not null then
            update public.applications set license_progress = v_lp::license_progress
             where id = p.application_id;
          end if;

          perform set_config('apex.xcel_backfill', v_prev_guc, true);

          insert into public.xcel_writeback_log
            (report_id, application_id, agent_id, field, old_value, new_value, mode, event_on)
          select p_report_id, p.application_id, null, f.field, f.old_v, f.new_v, v_phase, f.ev
            from (values ('course_purchased_at', v_app.course_purchased_at::text, v_cp::text, p.enrolled_on),
                         ('course_started_at', v_app.course_started_at::text, v_cs::text, p.started_on),
                         ('license_progress', v_app.lp, v_lp,
                          case when v_lp = 'finished_course' then p.completed_on else p.enrolled_on end)
                 ) as f(field, old_v, new_v, ev)
           where f.new_v is not null;

          if v_phase = 'backfill' then
            v_did_backfill := true;
            c_app_backfill := c_app_backfill + 1;
          else
            c_app_fresh := c_app_fresh + 1;
          end if;

          -- re-read for the next phase
          select a.id, a.first_name, a.last_name, a.state,
                 a.license_status::text as ls, a.licensed_at,
                 coalesce(a.license_progress::text, 'unlicensed') as lp,
                 a.course_purchased_at, a.course_started_at
            into v_app
            from public.applications a
           where a.id = p.application_id;
        end loop;

        -- A stage entered because of history must not start a nudge cadence.
        -- fn_next_step_nudge_sweep (WP3) skips any (person, stage, step) whose
        -- dedupe key exists; next-step-dispatch skips rows with failed_at set.
        -- PKG3: the test compares the entered_at INSTANT with the cutoff INSTANT (it compared
        -- Phoenix dates, which called a same-day completion after the cutoff history).
        if v_did_backfill then
          select np.current_stage_key, np.entered_at
            into v_stage_after, v_entered_after
            from public.next_step_progress np
           where np.application_id = p.application_id;
          if v_stage_after in ('started_prelicense', 'finished_prelicense')
             and (v_stage_after is distinct from v_stage_before
                  or v_entered_after is distinct from v_entered_before)
             and (v_cutoff_ts is null or v_entered_after is null
                  or v_entered_after <= v_cutoff_ts) then
            select s.reminder_cadence into v_cadence
              from public.next_step_stages s where s.stage_key = v_stage_after;
            if coalesce(v_cadence, '') like '%:%' then
              insert into public.next_step_messages
                (application_id, stage_key, channel, template_key, dedupe_key, failed_at, error, metadata)
              select p.application_id, v_stage_after, 'telegram',
                     v_stage_after || ':' || k.unit || k.n,
                     p.application_id::text || ':' || v_stage_after || ':' || k.unit || k.n,
                     now(),
                     'suppressed: stage entered from historic Xcel data before the forward-only cutoff (WP1); not sent',
                     jsonb_build_object('suppressed_by', 'wp1_xcel_backfill', 'entered_at', v_entered_after,
                                        'cutoff_on', v_cutoff, 'cutoff_at', v_cutoff_ts)
                from (select lower(btrim(split_part(v_cadence, ':', 1))) as unit, btrim(s) as n
                        from unnest(string_to_array(split_part(v_cadence, ':', 2), ',')) s
                       where btrim(s) ~ '^-?\d+$') k
               -- only steps whose send window is still ahead: a day step fires on
               -- that exact elapsed day, an hour step at most ~20h after its hour
               where v_entered_after is null
                  or (k.unit = 'day' and v_entered_after + make_interval(days => k.n::int + 1) > now())
                  or (k.unit = 'hour' and v_entered_after + make_interval(hours => k.n::int + 21) > now())
              on conflict (dedupe_key) where dedupe_key is not null do nothing;
              get diagnostics v_n = row_count;
              c_suppressed := c_suppressed + v_n;
            end if;
          end if;
        end if;
        end if;  -- not licensed

        -- A course-proof screenshot whose applicant is in the Xcel feed is proven.
        update public.licensing_course_proofs
           set status = 'verified_xcel', reviewed_at = now(),
               note = coalesce(note, 'Auto-verified: applicant matched an Xcel enrollment (WP1)')
         where application_id = p.application_id
           and coalesce(status, 'submitted') in ('submitted', 'pending');
        get diagnostics v_n = row_count;
        c_proofs := c_proofs + v_n;
      end if;
    end if;

    -- Agent mirror (forward-only, finished_course at most, never on licensed).
    if p.agent_id is not null then
      select g.id, g.display_name, g.license_status::text as ls, g.licensed_at,
             coalesce(g.license_progress::text, 'unlicensed') as lp
        into v_agent
        from public.agents g
       where g.id = p.agent_id
         for update;
      if found and v_agent.ls is distinct from 'licensed' and v_agent.licensed_at is null
         and p.target_progress is not null
         and public.fn_license_stage_rank(p.target_progress::license_progress)
             > public.fn_license_stage_rank(v_agent.lp::license_progress) then
        perform set_config('apex.xcel_backfill',
                           case when p.target_fresh and not v_silent then 'off' else 'on' end, true);
        update public.agents set license_progress = p.target_progress::license_progress
         where id = p.agent_id;
        perform set_config('apex.xcel_backfill', v_prev_guc, true);
        insert into public.xcel_writeback_log
          (report_id, application_id, agent_id, field, old_value, new_value, mode, event_on)
        values (p_report_id, null, p.agent_id, 'agents.license_progress', v_agent.lp, p.target_progress,
                case when p.target_fresh then 'fresh' else 'backfill' end, p.target_on);
        c_agent := c_agent + 1;

        -- An agent-only identity has no application trigger to record the milestone.
        if p.application_id is null and p.target_fresh and not v_silent then
          v_milestone := case p.target_progress when 'course_purchased' then 'enrolled_course'
                                                when 'finished_course' then 'completed_course' end;
          if not exists (select 1 from public.licensing_milestone_events e
                          where e.agent_id = p.agent_id and e.milestone_type = v_milestone) then
            insert into public.licensing_milestone_events
              (application_id, agent_id, candidate_name, milestone_type, source)
            values (null, p.agent_id, coalesce(nullif(btrim(v_agent.display_name), ''), 'Agent'), v_milestone, 'xcel');
            c_events := c_events + 1;
          end if;
        end if;
      end if;
    end if;

    exception when others then
      c_errors := c_errors + 1;
      v_first_error := coalesce(v_first_error, left(sqlerrm, 300));
      insert into public.automation_run_log (job_name, triggered_at, completed_at, status, error, response_body)
      values ('xcel-writeback', clock_timestamp(), clock_timestamp(), 'error', left(sqlerrm, 500),
              jsonb_build_object('application_id', p.application_id, 'agent_id', p.agent_id, 'report_id', p_report_id));
    end;
  end loop;

  perform set_config('apex.xcel_backfill', v_prev_guc, true);

  v_result := jsonb_build_object(
    'report_id', p_report_id, 'cutoff_on', v_cutoff, 'cutoff_at', v_cutoff_ts, 'silent', v_silent,
    'identities', c_identities, 'apps_backfill', c_app_backfill, 'apps_fresh', c_app_fresh,
    'apps_licensed_progress_skipped', c_app_licensed_skip, 'agents_mirrored', c_agent,
    'milestone_events', c_events, 'proofs_verified', c_proofs, 'nudges_suppressed', c_suppressed,
    'identity_errors', c_errors, 'first_error', v_first_error);

  insert into public.automation_run_log (job_name, triggered_at, completed_at, status, response_body, duration_ms)
  values ('xcel-writeback', v_started, clock_timestamp(), 'success', v_result,
          (extract(epoch from (clock_timestamp() - v_started)) * 1000)::int);

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The wrong placeholders. A WP1 placeholder is wrong when the milestone behind its stage was
--    after the cutoff instant (no 14-day staleness here: the question is "was this history?").
--      finished_prelicense -> the identity's completion
--      started_prelicense  -> the identity's enrolment or first progress
-- ---------------------------------------------------------------------------
create or replace function public.fn_course_lane_wrong_xcel_suppressions()
returns table (
  message_id uuid, application_id uuid, first_name text, stage_key text, template_key text,
  dedupe_key text, entered_at timestamptz, event_on date, event_upper_bound timestamptz,
  cutoff_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  with cfg as (select public.fn_xcel_cutoff_ts() as cutoff_ts),
  ident as (
    select x.application_id,
           x.completed_on, public.fn_xcel_event_upper_bound(x.completed_on, x.completed_first_seen_at) as completed_ub,
           least(public.fn_xcel_event_upper_bound(x.enrolled_on, x.enrolled_first_seen_at),
                 public.fn_xcel_event_upper_bound(x.started_on, x.started_first_seen_at)) as started_ub,
           x.enrolled_on
      from public.v_xcel_identity_rollup x
     where x.application_id is not null
  )
  select m.id, m.application_id, split_part(coalesce(nullif(btrim(a.first_name), ''), ''), ' ', 1),
         m.stage_key, m.template_key, m.dedupe_key,
         nullif(m.metadata ->> 'entered_at', '')::timestamptz,
         case when m.stage_key = 'finished_prelicense' then i.completed_on else i.enrolled_on end,
         case when m.stage_key = 'finished_prelicense' then i.completed_ub else i.started_ub end,
         cfg.cutoff_ts
    from public.next_step_messages m
    cross join cfg
    join ident i on i.application_id = m.application_id
    left join public.applications a on a.id = m.application_id
   where m.metadata ->> 'suppressed_by' = 'wp1_xcel_backfill'
     and m.sent_at is null
     and m.failed_at is not null
     and m.dedupe_key is not null
     and cfg.cutoff_ts is not null
     and case when m.stage_key = 'finished_prelicense' then i.completed_ub else i.started_ub end > cfg.cutoff_ts
$$;

comment on function public.fn_course_lane_wrong_xcel_suppressions() is
  'PKG3 read-only: WP1 ''suppressed:'' placeholder rows whose milestone happened after the Xcel cutoff instant (so they were never history). The data fix is fn_course_lane_clear_wrong_xcel_suppressions.';

create or replace function public.fn_course_lane_clear_wrong_xcel_suppressions(
  p_dry_run boolean default true, p_max integer default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows jsonb;
  v_n int;
  v_done int := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'message_id', w.message_id, 'application_id', w.application_id, 'first_name', w.first_name,
           'stage_key', w.stage_key, 'template_key', w.template_key,
           'event_on', w.event_on, 'event_upper_bound', w.event_upper_bound) order by w.application_id, w.template_key), '[]'::jsonb),
         count(*)
    into v_rows, v_n
    from public.fn_course_lane_wrong_xcel_suppressions() w;

  if p_dry_run then
    return jsonb_build_object('dry_run', true, 'would_void', v_n, 'rows', v_rows);
  end if;

  -- A data fix that suddenly matches far more than the measured set is a symptom, not a fix.
  if v_n > coalesce(p_max, 10) then
    raise exception 'fn_course_lane_clear_wrong_xcel_suppressions: % rows match, above p_max %; refusing (review the dry run)', v_n, p_max;
  end if;

  -- Void the dedupe key, keep the row: failed_at stays set, so next-step-dispatch never sends it,
  -- and the original key is kept in metadata for rollback.
  update public.next_step_messages m
     set dedupe_key = m.dedupe_key || ':void-pkg3',
         error = left('voided by MP-ONBOARD-ANCHOR-PKG3: the milestone was after the Xcel cutoff instant, so this placeholder was never history. Was: ' || coalesce(m.error, ''), 500),
         metadata = m.metadata || jsonb_build_object('voided_by', 'pkg3_cutoff_instant', 'voided_at', now(),
                                                    'voided_dedupe_key', m.dedupe_key)
   where m.id in (select w.message_id from public.fn_course_lane_wrong_xcel_suppressions() w);
  get diagnostics v_done = row_count;

  return jsonb_build_object('dry_run', false, 'voided', v_done, 'rows', v_rows);
end;
$$;

comment on function public.fn_course_lane_clear_wrong_xcel_suppressions(boolean, integer) is
  'PKG3 data fix (dry_run by default): voids the dedupe key of WP1 placeholders whose milestone was after the cutoff instant. Rows stay (failed_at set, never sent). Rollback: dedupe_key := metadata->>''voided_dedupe_key''.';

-- ---------------------------------------------------------------------------
-- 6. Privileges: engine functions are internal (service role / bot-sql only).
-- ---------------------------------------------------------------------------
revoke all on function public.fn_xcel_cutoff_ts() from public, anon, authenticated;
revoke all on function public.fn_xcel_event_upper_bound(date, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_xcel_progress_plan() from public, anon, authenticated;
revoke all on function public.fn_apply_xcel_progress(uuid) from public, anon, authenticated;
revoke all on function public.fn_course_lane_wrong_xcel_suppressions() from public, anon, authenticated;
revoke all on function public.fn_course_lane_clear_wrong_xcel_suppressions(boolean, integer) from public, anon, authenticated;
grant execute on function public.fn_xcel_cutoff_ts() to service_role;
grant execute on function public.fn_xcel_event_upper_bound(date, timestamptz) to service_role;
grant execute on function public.fn_xcel_progress_plan() to service_role;
grant execute on function public.fn_apply_xcel_progress(uuid) to service_role;
grant execute on function public.fn_course_lane_wrong_xcel_suppressions() to service_role;
grant execute on function public.fn_course_lane_clear_wrong_xcel_suppressions(boolean, integer) to service_role;
