-- WP3 recruit SLA proof. Run ONLY inside a transaction that is rolled back:
--   scripts/proofs/wp3-recruit-sla-proof.sh   (sends "begin; <this>" and the DO block
--   below ends by RAISING its result, which aborts and rolls back everything).
-- Nothing here can send: pg_net enqueues into net.http_request_queue, which a rolled
-- back transaction never commits, and the http extension is not installed.
-- Each check asserts its own slice landed; a FAIL names the slice.
do $proof$
declare
  res jsonb := '{}'::jsonb;
  fails text[] := '{}';
  v_sam uuid := public.fn_recruit_sam_user_id();
  v_va uuid;
  v_app_u uuid; v_app_l uuid; v_app_va uuid; v_app_c uuid;
  v_ev uuid;
  v_q0 bigint; v_q1 bigint;
  v_cnt int; v_cnt2 int;
  v_err text; v_state text;
  v_r jsonb; v_r2 jsonb;
  v_resp record;
  v_log bigint;
  v_tmp timestamptz;
  v_claims text;
begin
  if v_sam is null then raise exception 'WP3RESULT %', jsonb_build_object('fatal', 'no Sam user id'); end if;
  select count(*) into v_q0 from net.http_request_queue;
  v_tmp := public.fn_wp3_cutoff();  -- the REAL go-live instant, before the test moves it
  -- Pretend go-live was an hour ago so a 30-minute-old test recruit is post-cutoff.
  update public.system_settings set value = (now() - interval '1 hour')::text where key = 'wp3_recruit_sla_cutoff';

  -- [rr_skip_inactive] a VA who has not signed in for 7 days gets nothing; Sam does.
  select ur.user_id into v_va from public.user_roles ur where ur.role = 'va' order by ur.user_id limit 1;
  if v_va is not null then
    update auth.users set last_sign_in_at = now() - interval '30 days' where id = v_va;
  end if;
  insert into public.applications (first_name, last_name, email, state, license_status, record_type, created_at)
  values ('Wpthree', 'Proofone', 'wp3-proof-1@example.invalid', 'AZ', 'unlicensed', 'application', now() - interval '30 minutes')
  returning id into v_app_u;
  res := res || jsonb_build_object('rr_skip_inactive',
    (select recruiting_owner_user_id = v_sam from public.applications where id = v_app_u));
  if not coalesce((res ->> 'rr_skip_inactive')::boolean, false) then fails := array_append(fails, 'rr_skip_inactive'); end if;

  -- [rr_active_va] the same VA, signed in today, gets the next unlicensed recruit.
  if v_va is not null then
    update auth.users set last_sign_in_at = now() where id = v_va;
    insert into public.applications (first_name, last_name, email, state, license_status, record_type, created_at)
    values ('Wpthree', 'Prooftwo', 'wp3-proof-2@example.invalid', 'TX', 'unlicensed', 'application', now() - interval '30 minutes')
    returning id into v_app_va;
    res := res || jsonb_build_object('rr_active_va',
      (select recruiting_owner_user_id = v_va from public.applications where id = v_app_va));
    if not coalesce((res ->> 'rr_active_va')::boolean, false) then fails := array_append(fails, 'rr_active_va'); end if;
  else
    res := res || jsonb_build_object('rr_active_va', 'skipped_no_va_role_holder');
  end if;

  -- [licensed_to_sam] licensed recruits go to the closer even with an active VA.
  insert into public.applications (first_name, last_name, email, state, license_status, record_type, created_at)
  values ('Wpthree', 'Proofthree', 'wp3-proof-3@example.invalid', 'FL', 'licensed', 'application', now() - interval '30 minutes')
  returning id into v_app_l;
  res := res || jsonb_build_object('licensed_to_sam',
    (select recruiting_owner_user_id = v_sam from public.applications where id = v_app_l));
  if not coalesce((res ->> 'licensed_to_sam')::boolean, false) then fails := array_append(fails, 'licensed_to_sam'); end if;
  if v_va is not null then
    update auth.users set last_sign_in_at = now() - interval '30 days' where id = v_va;
  end if;

  -- [sla_new_untouched] the untouched post-cutoff recruits are NEW_UNTOUCHED in the queue.
  select count(*) into v_cnt from public.v_recruit_sla_queue
   where application_id in (v_app_u, v_app_l) and sla_state = 'NEW_UNTOUCHED' and post_deploy;
  res := res || jsonb_build_object('sla_new_untouched', v_cnt);
  if v_cnt <> 2 then fails := array_append(fails, 'sla_new_untouched'); end if;

  -- [human_writer] fn_log_human_contact stamps human_* (not only contacted_at) and status.
  perform public.fn_log_human_contact(v_app_u, 'call', 'no_answer', null, 'wp3_proof');
  select jsonb_build_object('human_first', human_first_contact_at is not null, 'human_last', human_last_contact_at is not null,
                            'last_contacted', last_contacted_at is not null, 'status', status::text)
    into v_r from public.applications where id = v_app_u;
  res := res || jsonb_build_object('human_writer', v_r);
  if not ((v_r ->> 'human_first')::boolean and (v_r ->> 'human_last')::boolean and (v_r ->> 'status') = 'no_pickup') then
    fails := array_append(fails, 'human_writer');
  end if;
  select count(*) into v_cnt from public.application_contact_log
   where application_id = v_app_u and is_manual and source_surface = 'wp3_proof' and logged_by is null;
  res := res || jsonb_build_object('human_writer_log_row', v_cnt);
  if v_cnt <> 1 then fails := array_append(fails, 'human_writer_log_row'); end if;
  -- ...and the contacted recruit has left NEW_UNTOUCHED.
  select count(*) into v_cnt from public.v_recruit_sla_queue where application_id = v_app_u and sla_state = 'NEW_UNTOUCHED';
  res := res || jsonb_build_object('contacted_leaves_new_untouched', v_cnt = 0);
  if v_cnt <> 0 then fails := array_append(fails, 'contacted_leaves_new_untouched'); end if;

  -- [pipeline_contacted_is_human] no 'Contacted' stage without a logged human touch.
  select count(*) into v_cnt from public.v_recruiting_pipeline
   where person_type = 'applicant' and stage = 'Contacted' and human_last_contact_at is null;
  res := res || jsonb_build_object('pipeline_contacted_without_human', v_cnt);
  if v_cnt <> 0 then fails := array_append(fails, 'pipeline_contacted_is_human'); end if;

  -- [cc_dispose_anon] anon cannot execute it at all.
  begin
    set local role anon;
    perform public.cc_dispose_interview(gen_random_uuid(), 'completed', null, null);
    v_err := 'no error';
  exception when others then
    v_err := sqlstate;
  end;
  reset role;
  res := res || jsonb_build_object('cc_dispose_anon_sqlstate', v_err);
  if v_err <> '42501' then fails := array_append(fails, 'cc_dispose_anon'); end if;

  -- [cc_dispose_nonstaff] a signed-in non-staff user is refused by the role guard.
  v_claims := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text;
  begin
    perform set_config('request.jwt.claims', v_claims, true);
    set local role authenticated;
    perform public.cc_dispose_interview(gen_random_uuid(), 'completed', null, null);
    v_err := 'no error';
  exception when others then
    v_err := sqlstate || ':' || left(sqlerrm, 60);
  end;
  reset role;
  res := res || jsonb_build_object('cc_dispose_nonstaff', v_err);
  if v_err not like '42501:%' then fails := array_append(fails, 'cc_dispose_nonstaff'); end if;

  -- [cc_dispose_service] the service role (interview-outcome one-tap edge fn) passes the guard.
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    perform public.cc_dispose_interview(gen_random_uuid(), 'completed', null, null);
    v_err := 'no error';
  exception when others then
    v_err := sqlstate || ':' || left(sqlerrm, 40);
  end;
  perform set_config('request.jwt.claims', '', true);
  res := res || jsonb_build_object('cc_dispose_service', v_err);
  if v_err like '42501:%' then fails := array_append(fails, 'cc_dispose_service_blocked'); end if;

  -- [outcome_ask_once] the ask selects a past call once; the second run selects 0, and the
  -- push body carries no phone digits or surname.
  insert into public.interview_events (source, call_track, invitee_name, invitee_phone, event_type_name, scheduled_at, ended_at, application_id)
  values ('manual', 'licensed', 'Wpthree Surnameproof', '+15555550123', 'Licensed Call', now() - interval '1 hour', now() - interval '30 minutes', v_app_l)
  returning id into v_ev;
  v_r := public.fn_interview_outcome_ask();
  v_r2 := public.fn_interview_outcome_ask();
  res := res || jsonb_build_object('outcome_ask_first', v_r -> 'asked', 'outcome_ask_second', v_r2 -> 'asked',
    'outcome_ask_stamped', (select raw_payload ? 'outcome_asked_at' and raw_payload ? 'outcome_ask_req' from public.interview_events where id = v_ev));
  if coalesce((v_r ->> 'asked')::int, 0) < 1 or coalesce((v_r2 ->> 'asked')::int, -1) <> 0
     or not coalesce((res ->> 'outcome_ask_stamped')::boolean, false) then
    fails := array_append(fails, 'outcome_ask_once');
  end if;
  select count(*) into v_cnt from net.http_request_queue q
   where q.id = (select (raw_payload ->> 'outcome_ask_req')::bigint from public.interview_events where id = v_ev)
     and convert_from(q.body, 'UTF8') !~ '5555550123' and convert_from(q.body, 'UTF8') !~ 'Surnameproof'
     and convert_from(q.body, 'UTF8') ~ 'Wpthree';
  res := res || jsonb_build_object('outcome_ask_body_first_name_only', v_cnt = 1);
  if v_cnt <> 1 then fails := array_append(fails, 'outcome_ask_body_first_name_only'); end if;

  -- [call_no_outcome] that call (ended >2h? no: 30 min) is not CALL_NO_OUTCOME yet; move it back 3h and it is.
  update public.interview_events set scheduled_at = now() - interval '4 hours', ended_at = now() - interval '3 hours 30 minutes' where id = v_ev;
  select sla_state into v_state from public.v_recruit_sla_queue where application_id = v_app_l;
  res := res || jsonb_build_object('call_no_outcome_state', v_state);
  if v_state is distinct from 'CALL_NO_OUTCOME' then fails := array_append(fails, 'call_no_outcome'); end if;

  -- [pager] only post-cutoff untouched recruits, first name/state/license only, then 0 on re-run.
  update public.interview_events set canceled_at = now(), cancel_reason = 'wp3 proof' where id = v_ev;
  if extract(hour from now() at time zone 'America/Phoenix') between 8 and 18 then
    v_r := public.fn_recruit_sla_pager();
    v_r2 := public.fn_recruit_sla_pager();
    select count(*) into v_cnt from public.recruit_sla_push_log l
     where l.kind in ('page', 'batch_page') and l.created_at = now()
       and (l.application_id is null or l.application_id in (v_app_l, v_app_va));
    res := res || jsonb_build_object('pager_first', v_r, 'pager_second_paged', v_r2 -> 'paged_ntfy', 'pager_log_rows', v_cnt);
    if coalesce((v_r2 ->> 'paged_ntfy')::int, -1) <> 0 then fails := array_append(fails, 'pager_idempotent'); end if;
    select count(*) into v_cnt from public.applications where id = v_app_l and owner_alerted_at is not null;
    if v_cnt <> 1 then fails := array_append(fails, 'pager_stamped_licensed'); end if;
    -- the pre-cutoff contacted recruit and anything older than the cutoff were not paged
    select count(*) into v_cnt from public.applications
     where owner_alerted_at = now() and created_at < public.fn_wp3_cutoff();
    res := res || jsonb_build_object('pager_paged_pre_cutoff_rows', v_cnt);
    if v_cnt <> 0 then fails := array_append(fails, 'pager_forward_only'); end if;
    select count(*) into v_cnt from net.http_request_queue q
      join public.recruit_sla_push_log l on l.req_id = q.id
     where l.created_at = now() and l.kind = 'page'
       and (convert_from(q.body, 'UTF8') ~* '(Proofthree|example\.invalid|\+?1?5555550123)');
    res := res || jsonb_build_object('pager_body_pii_hits', v_cnt);
    if v_cnt <> 0 then fails := array_append(fails, 'pager_body_pii'); end if;
  else
    res := res || jsonb_build_object('pager', 'skipped_outside_phoenix_hours');
  end if;

  -- [settle] a page whose request has a real response is settled from net._http_response.
  select h.id, h.status_code into v_resp from net._http_response h order by h.created desc limit 1;
  if v_resp.id is not null then
    insert into public.recruit_sla_push_log (kind, owner_user_id, channel, req_id, created_at)
    values ('digest', v_sam, 'ntfy', v_resp.id, now() - interval '10 minutes') returning id into v_log;
    perform public.fn_recruit_sla_pager_settle();
    select jsonb_build_object('settled', settled_at is not null, 'status_code', status_code) into v_r
      from public.recruit_sla_push_log where id = v_log;
    res := res || jsonb_build_object('settle', v_r);
    if not coalesce((v_r ->> 'settled')::boolean, false) or (v_r ->> 'status_code')::int is distinct from v_resp.status_code then
      fails := array_append(fails, 'settle');
    end if;
  else
    res := res || jsonb_build_object('settle', 'skipped_no_response_rows');
  end if;

  -- [digest] one push with counts (sent even at 0), and a second run the same day is skipped.
  delete from public.recruit_sla_push_log where id = v_log; -- the fake row above must not count as today's digest
  v_r := public.fn_recruit_sla_digest();
  v_r2 := public.fn_recruit_sla_digest();
  res := res || jsonb_build_object('digest_first', v_r, 'digest_second', v_r2 -> 'skipped');
  if (v_r ->> 'digest_log_id') is null or coalesce(v_r2 ->> 'skipped', '') <> 'already_sent_today' then
    fails := array_append(fails, 'digest_once');
  end if;

  -- [no_service_key_guc] nothing in public functions or active crons reads the unset GUC.
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%app.settings.service_role_key%';
  select count(*) into v_cnt2 from cron.job where active and command like '%app.settings.service_role_key%';
  res := res || jsonb_build_object('guc_readers_functions', v_cnt, 'guc_readers_active_crons', v_cnt2,
    'guc_active_cron_names', (select jsonb_agg(jobname) from cron.job where active and command like '%app.settings.service_role_key%'));
  if v_cnt <> 0 then fails := array_append(fails, 'guc_readers_functions'); end if;

  -- [nudge_longtail_gate] long-tail steps never fire for rows that entered before the cutoff.
  select count(*) into v_cnt
    from public.next_step_progress np join public.next_step_stages s on s.stage_key = np.current_stage_key
   where np.status = 'active' and np.entered_at < public.fn_wp3_cutoff()
     and np.current_stage_key in ('contacted', 'started_prelicense')
     and public.fn_next_step_cadence_due(s.reminder_cadence, now() - np.entered_at) in ('hour168','hour336','hour720','day30','day45','day60');
  v_r := (select to_jsonb(x) from public.fn_next_step_nudge_sweep() x);
  select count(*) into v_cnt2 from public.next_step_messages m
   where m.created_at = now() and (m.metadata ->> 'step') in ('hour168','hour336','hour720','day30','day45','day60');
  res := res || jsonb_build_object('longtail_due_pre_cutoff_rows', v_cnt, 'longtail_messages_queued', v_cnt2, 'nudge_sweep', v_r);
  if v_cnt2 <> 0 then fails := array_append(fails, 'nudge_longtail_gate'); end if;
  -- ...and every message the sweep queued carries a dedupe key.
  select count(*) into v_cnt from public.next_step_messages m where m.created_at = now() and m.dedupe_key is null;
  if v_cnt <> 0 then fails := array_append(fails, 'nudge_dedupe_key'); end if;

  -- [no_owner_post_cutoff] every application inserted since the trigger existed has an
  -- owner: the test rows, and every real row created after the REAL go-live instant.
  select count(*) into v_cnt from public.applications
   where recruiting_owner_user_id is null
     and (id in (v_app_u, v_app_l, v_app_va) or created_at >= v_tmp);
  res := res || jsonb_build_object('post_cutoff_without_owner', v_cnt, 'real_cutoff', v_tmp);
  if v_cnt <> 0 then fails := array_append(fails, 'no_owner_post_cutoff'); end if;

  select count(*) into v_q1 from net.http_request_queue;
  res := res || jsonb_build_object('pg_net_requests_enqueued_then_rolled_back', v_q1 - v_q0,
                                   'fails', to_jsonb(fails), 'verdict', case when cardinality(fails) = 0 then 'PASS' else 'FAIL' end);
  raise exception 'WP3RESULT %', res::text;
end
$proof$;
