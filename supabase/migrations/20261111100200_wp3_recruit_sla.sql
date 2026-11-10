-- WP3 (2026-11-10 onboarding audit): recruit ownership, human SLA queue, contact truth,
-- interview outcomes. Applied live by WP3 first, then recorded in schema_migrations, so a
-- CI `db push --include-all` sees it as applied. Every statement is idempotent.
--
-- Forward-only rule: everything that pages a person or emails a recruit keys on
-- system_settings.wp3_recruit_sla_cutoff (set once, at first apply). Rows that existed
-- before that instant are never paged and never nudged; the pre-existing untouched
-- backlog appears as ONE count in the daily digest.
--
-- Full live preimages of every object redefined or dropped here are at the bottom of
-- this file (comment block) and in public.ops_preimage_snapshots
-- (reason = 'wp3_recruit_sla_2026_11_10').

-- ── 0. preimage snapshot (captured from the live catalog before anything changes) ──
insert into public.ops_preimage_snapshots (reason, payload)
select 'wp3_recruit_sla_2026_11_10', jsonb_build_object(
  'functions', (select jsonb_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                        jsonb_build_object('def', pg_get_functiondef(p.oid), 'acl', array_to_string(p.proacl, ',')))
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public'
                   and p.proname in ('cc_dispose_interview','fn_interview_outcome_ask','fn_run_applicant_nudges',
                     'fn_sweep_manager_followup_reminders','auto_nipr_verify_on_apply','run_automation_job',
                     'rp_pipeline_action','fn_contact_log_stamp_application','fn_next_step_nudge_sweep',
                     'check_speed_to_lead','fn_queue_high_value_applicant_alert','unified_mark_contacted',
                     'fn_recover_stale_applicant','set_recruit_stage')),
  'views', (select jsonb_object_agg(c.relname, jsonb_build_object('def', pg_get_viewdef(c.oid, true),
                     'acl', array_to_string(c.relacl, ','), 'options', c.reloptions))
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public'
               and c.relname in ('v_recruiting_pipeline','v_recruiting_inbox','v_va_call_queue','v_interview_outcome_truth')),
  'cron', (select jsonb_agg(jsonb_build_object('jobid', jobid, 'jobname', jobname, 'schedule', schedule,
                     'active', active, 'command', command))
             from cron.job where jobid in (40, 49, 52, 66, 144)),
  'constraints', (select jsonb_object_agg(conname, pg_get_constraintdef(oid)) from pg_constraint
                   where conrelid = 'public.interview_events'::regclass
                     and conname in ('interview_events_call_track_check','interview_events_match_method_check')),
  'stage_cadence', (select jsonb_object_agg(stage_key, reminder_cadence) from public.next_step_stages
                     where stage_key in ('contacted','started_prelicense')))
where not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp3_recruit_sla_2026_11_10');

-- ── 1. settings: the forward-only cutoff and the round-robin cursor ──────────────
insert into public.system_settings (key, value) values ('wp3_recruit_sla_cutoff', now()::text)
on conflict (key) do nothing;
insert into public.system_settings (key, value) values ('recruit_rr_cursor', '0')
on conflict (key) do nothing;

-- ── 2. columns ──────────────────────────────────────────────────────────────────
alter table public.applications add column if not exists human_first_contact_at timestamptz;
alter table public.applications add column if not exists human_last_contact_at timestamptz;
alter table public.applications add column if not exists owner_alerted_at timestamptz;
alter table public.applications add column if not exists owner_alert_meta jsonb;
alter table public.applications add column if not exists day1_nudge_sent_at timestamptz;
alter table public.applications add column if not exists day3_nudge_sent_at timestamptz;
comment on column public.applications.human_first_contact_at is
  'WP3: first application_contact_log row with is_manual. Written ONLY by fn_contact_log_stamp_application. Never backfilled from contacted_at.';
comment on column public.applications.human_last_contact_at is
  'WP3: latest application_contact_log row with is_manual. Written ONLY by fn_contact_log_stamp_application.';
comment on column public.applications.owner_alerted_at is
  'WP3: when fn_recruit_sla_pager paged the owner about this NEW_UNTOUCHED recruit. Receipt is recruit_sla_push_log (owner_alert_meta.log_id).';
comment on column public.applications.day1_nudge_sent_at is
  'WP3: send-followup-emails day-1 nudge, stamped only with a Resend message id. Forward-only (created after wp3_recruit_sla_cutoff).';
comment on column public.applications.day3_nudge_sent_at is
  'WP3: send-followup-emails day-3 nudge, stamped only with a Resend message id. Forward-only (created after wp3_recruit_sla_cutoff).';

alter table public.interview_events add column if not exists is_backfill_duplicate boolean not null default false;
comment on column public.interview_events.is_backfill_duplicate is
  'WP3: true for a second row of the same booking (same calendly_invitee_uri, or same lower(invitee_email)+scheduled_at). Measured 2026-11-10: 0 such rows; the 105 raw_payload.backfill rows are distinct bookings and are NOT flagged.';

-- call_track gains 'licensing' (Licensing Call bookings were filed as 'other');
-- match_method gains 'utm' (Calendly tracking.utm_content = application id).
alter table public.interview_events drop constraint if exists interview_events_call_track_check;
alter table public.interview_events add constraint interview_events_call_track_check
  check (call_track = any (array['licensed','leader','seminar','exam','other','onboarding','licensing']));
alter table public.interview_events drop constraint if exists interview_events_match_method_check;
alter table public.interview_events add constraint interview_events_match_method_check
  check (match_method = any (array['instagram','email','phone','manual','none','booking_backfill','utm']));

-- Flag true duplicates (keep the earliest row of each group), then enforce uniqueness.
update public.interview_events e set is_backfill_duplicate = true
 where not e.is_backfill_duplicate
   and exists (select 1 from public.interview_events o
                where o.id <> e.id
                  and ((o.calendly_invitee_uri is not null and o.calendly_invitee_uri = e.calendly_invitee_uri)
                       or (o.invitee_email is not null and lower(o.invitee_email) = lower(e.invitee_email)
                           and o.scheduled_at = e.scheduled_at))
                  and (o.created_at, o.id) < (e.created_at, e.id));
create unique index if not exists interview_events_invitee_uri_uniq
  on public.interview_events (calendly_invitee_uri)
  where calendly_invitee_uri is not null and not is_backfill_duplicate;

-- ── 3. small helpers ─────────────────────────────────────────────────────────────
create or replace function public.fn_wp3_cutoff()
returns timestamptz language sql stable security definer set search_path to 'public' as $$
  -- Missing or garbled setting reads as 'infinity': nothing pages, nothing nudges.
  select coalesce((select case when value ~ '^\d{4}-\d{2}-\d{2}' then value::timestamptz end
                     from public.system_settings where key = 'wp3_recruit_sla_cutoff'),
                  'infinity'::timestamptz)
$$;

create or replace function public.fn_recruit_sam_user_id()
returns uuid language sql stable security definer set search_path to 'public' as $$
  -- Same lookup and order as applications_auto_route_hiring_manager.
  select u.id from auth.users u join public.user_roles ur on ur.user_id = u.id
   where ur.role = 'admin' and u.email in ('info@kingofsales.net', 'sam.com593@gmail.com')
   order by (case u.email when 'sam.com593@gmail.com' then 0 else 1 end)
   limit 1
$$;

create or replace function public.fn_recruit_user_is_active(p_user_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  -- Signed in within 7 days and not banned. This is the gate that keeps work from
  -- being assigned to a seat nobody is sitting in (both VA seats went dark in Sept).
  select exists (select 1 from auth.users u
                  where u.id = p_user_id
                    and u.last_sign_in_at > now() - interval '7 days'
                    and (u.banned_until is null or u.banned_until < now())
                    and u.deleted_at is null)
$$;

create or replace function public.fn_pick_recruit_owner(p_license text, p_exclude uuid default null)
returns uuid language plpgsql volatile security definer set search_path to 'public' as $$
declare
  v_sam uuid := public.fn_recruit_sam_user_id();
  v_pool uuid[];
  v_cursor bigint;
  v_mgr uuid;
begin
  -- Licensed and pending recruits go to the closer.
  if coalesce(p_license, 'unlicensed') in ('licensed', 'pending') then
    return v_sam;
  end if;
  -- Unlicensed: round-robin over VAs who signed in within 7 days. Never agents;
  -- never the manager role (Aisha-only) - only 'va', then 'va_manager', then Sam.
  select array_agg(ur.user_id order by ur.user_id) into v_pool
    from public.user_roles ur
   where ur.role = 'va' and ur.user_id is distinct from p_exclude
     and public.fn_recruit_user_is_active(ur.user_id);
  if coalesce(array_length(v_pool, 1), 0) > 0 then
    insert into public.system_settings (key, value) values ('recruit_rr_cursor', '1')
    on conflict (key) do update
      set value = ((case when system_settings.value ~ '^\d+$' then system_settings.value::bigint else 0 end + 1) % 1000000)::text,
          updated_at = now()
    returning value::bigint into v_cursor;
    return v_pool[(v_cursor % array_length(v_pool, 1)) + 1];
  end if;
  select ur.user_id into v_mgr from public.user_roles ur
   where ur.role = 'va_manager' and ur.user_id is distinct from p_exclude
     and public.fn_recruit_user_is_active(ur.user_id)
   order by ur.user_id limit 1;
  return coalesce(v_mgr, v_sam);
end $$;

create or replace function public.fn_application_has_agent(p_application_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.agents g where g.source_application_id = p_application_id)
$$;

create or replace function public.fn_staff_first_name(p_user_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '')
    from public.profiles p where p.user_id = p_user_id
   order by p.created_at nulls last limit 1
$$;

create or replace function public.fn_phx_business_minutes(p_from timestamptz, p_to timestamptz)
returns integer language sql stable set search_path to 'public' as $$
  -- Minutes inside 08:00-19:00 America/Phoenix (no DST) between two instants.
  select coalesce(sum(greatest(0, extract(epoch from
           least(x.t, d + interval '19 hours') - greatest(x.f, d + interval '8 hours')) / 60)), 0)::int
    from (select p_from at time zone 'America/Phoenix' as f, p_to at time zone 'America/Phoenix' as t) x,
         generate_series(date_trunc('day', x.f), date_trunc('day', x.t), interval '1 day') d
   where p_from is not null and p_to is not null and p_to > p_from
$$;

create or replace function public.fn_edge_auth_header()
returns text language sql stable security definer set search_path to 'public' as $$
  -- The run_automation_job pattern: the app.settings service-role GUC is not set on
  -- this project (pg_db_role_setting holds only the jwt_exp setting), so every caller
  -- that read it sent a NULL Authorization header.
  select 'Bearer ' || (select value from public.system_settings where key = 'service_role_key')
$$;

create or replace function public.fn_wp3_ntfy_id(p_content text)
returns text language plpgsql immutable as $$
begin
  return coalesce((p_content::jsonb) ->> 'id', 'ok');
exception when others then
  return 'ok';
end $$;

revoke execute on function public.fn_wp3_cutoff() from public, anon;
revoke execute on function public.fn_recruit_sam_user_id() from public, anon, authenticated;
revoke execute on function public.fn_recruit_user_is_active(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pick_recruit_owner(text, uuid) from public, anon, authenticated;
revoke execute on function public.fn_application_has_agent(uuid) from public, anon;
revoke execute on function public.fn_staff_first_name(uuid) from public, anon;
revoke execute on function public.fn_edge_auth_header() from public, anon, authenticated;
grant execute on function public.fn_wp3_cutoff() to authenticated, service_role;
grant execute on function public.fn_application_has_agent(uuid) to authenticated, service_role;
grant execute on function public.fn_staff_first_name(uuid) to authenticated, service_role;
grant execute on function public.fn_recruit_sam_user_id() to service_role;
grant execute on function public.fn_recruit_user_is_active(uuid) to service_role;
grant execute on function public.fn_pick_recruit_owner(text, uuid) to service_role;
grant execute on function public.fn_edge_auth_header() to service_role;

-- ── 4. one human-contact stamper + one writer ────────────────────────────────────
-- The trigger on application_contact_log is the ONLY thing that writes human_*.
-- is_manual is GENERATED (provider_event_ref is null), so provider webhook rows never
-- count as a human touch. A 'dismiss' from stale recovery is not contact.
create or replace function public.fn_contact_log_stamp_application()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_human boolean := coalesce(new.is_manual, false) and coalesce(new.outcome, '') not in ('dismiss', 'dismissed');
begin
  update public.applications
     set last_contacted_at = greatest(coalesce(last_contacted_at, new.logged_at), new.logged_at),
         contacted_at      = coalesce(contacted_at, new.logged_at),
         human_first_contact_at = case when v_human
                                       then least(coalesce(human_first_contact_at, new.logged_at), new.logged_at)
                                       else human_first_contact_at end,
         human_last_contact_at  = case when v_human
                                       then greatest(coalesce(human_last_contact_at, new.logged_at), new.logged_at)
                                       else human_last_contact_at end
   where id = new.application_id;
  return new;
exception when others then
  -- Do not block the contact log write during a live call session, but do NOT swallow
  -- silently either.
  raise warning 'fn_contact_log_stamp_application failed for application_id=%: %',
    new.application_id, sqlerrm;
  return new;
end $$;

create or replace function public.fn_log_human_contact(
  p_application_id uuid, p_channel text, p_outcome text,
  p_actor uuid default null, p_surface text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
  v_actor uuid := coalesce(auth.uid(), p_actor);
  v_channel text := case when p_channel in ('call','sms','email','note','in_person','manual') then p_channel else 'manual' end;
  v_outcome text := coalesce(nullif(btrim(coalesce(p_outcome, '')), ''), 'contacted');
  v_surface text := coalesce(nullif(btrim(coalesce(p_surface, '')), ''),
                             case when auth.uid() is null then 'one_tap_link' else 'unspecified' end);
begin
  if p_application_id is null then
    raise exception 'fn_log_human_contact: application id is required' using errcode = '22023';
  end if;
  -- logged_by is an FK to auth.users; an unknown actor is recorded as null, never invented.
  if v_actor is not null and not exists (select 1 from auth.users where id = v_actor) then
    v_actor := null;
  end if;
  insert into public.application_contact_log (application_id, channel, outcome, notes, logged_by, source_surface)
  values (p_application_id, v_channel, v_outcome, p_notes, v_actor, v_surface)
  returning id into v_id;
  -- Status follows the outcome with cc_dispose_interview's mapping (the one rule set).
  update public.applications
     set status = case
                    when v_outcome in ('hired','contracted') then 'contracting'::application_status
                    when v_outcome = 'completed' then 'interview'::application_status
                    when v_outcome = 'no_show' then 'attended_no_show'::application_status
                    when v_outcome = 'no_answer' then 'no_pickup'::application_status
                    when v_outcome in ('not_interested','not_a_fit') then 'rejected'::application_status
                    else status
                  end
   where id = p_application_id
     and v_outcome in ('hired','contracted','completed','no_show','no_answer','not_interested','not_a_fit');
  return v_id;
end $$;
revoke execute on function public.fn_log_human_contact(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_log_human_contact(uuid, text, text, uuid, text, text) to service_role;
comment on function public.fn_log_human_contact(uuid, text, text, uuid, text, text) is
  'WP3: the one human-contact writer. Inserts application_contact_log (is_manual by construction); trg_contact_log_stamp_application stamps human_first/last_contact_at. Not callable by API roles; surface RPCs call it.';

-- ── 5. cc_dispose_interview: role guard, no anon, logs the human touch ──────────────
create or replace function public.cc_dispose_interview(
  p_id uuid, p_outcome text, p_notes text default null, p_followup_due_at timestamptz default null)
returns public.interview_events language plpgsql security definer set search_path to 'public' as $$
declare
  v_row public.interview_events;
  v_owner uuid;
begin
  -- Same gate as cancel_interview_event (which calls this nested), plus the service-role
  -- edge function (interview-outcome one-tap links). Anon could call this until WP3.
  select owner_user_id into v_owner from public.interview_events where id = p_id;
  if not (coalesce(auth.role(), '') = 'service_role'
          or public.calendar_is_scheduling_staff()
          or (v_owner is not null and v_owner = auth.uid())) then
    raise exception 'not authorized to record an interview outcome' using errcode = '42501';
  end if;

  update public.interview_events
     set outcome         = p_outcome,
         outcome_at      = now(),
         outcome_by      = auth.uid(),
         notes           = coalesce(p_notes, notes),
         followup_due_at = coalesce(p_followup_due_at, followup_due_at),
         contacted_at    = case when p_outcome = 'callback' then now() else contacted_at end
   where id = p_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'interview_events row % not found', p_id;
  end if;

  -- The linked application gets one human-contact row; the log trigger stamps
  -- last_contacted_at + human_*, and the helper moves status with the same mapping
  -- this function used to apply inline.
  if v_row.application_id is not null then
    perform public.fn_log_human_contact(
      v_row.application_id, 'call', p_outcome, auth.uid(),
      case when auth.uid() is null then 'one_tap_link' else 'interview_disposition' end,
      'interview ' || p_id::text);
  end if;

  return v_row;
end $$;
revoke execute on function public.cc_dispose_interview(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.cc_dispose_interview(uuid, text, text, timestamptz) to authenticated, service_role;

-- ── 6. surface RPCs route the human touch through fn_log_human_contact ─────────────
-- rp_pipeline_action('contacted') used to write bare timestamps with no audit row.
-- A hand-set stage of 'Contacted' is the same assertion, so it is logged too.
create or replace function public.rp_pipeline_action(p_person_key text, p_action text, p_value text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_kind text := split_part(p_person_key,':',1);
  v_id uuid := nullif(split_part(p_person_key,':',2),'')::uuid; v_stage text;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager')
          or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'recruiter')) then
    raise exception 'not authorized'; end if;
  if v_id is null then raise exception 'bad person_key'; end if;
  if v_kind='app' then
    if p_action='monday' then update applications set monday_status=nullif(p_value,'clear'), updated_at=now() where id=v_id;
    elsif p_action='stage' then
      update applications set pipeline_stage_override=nullif(p_value,'clear'), updated_at=now() where id=v_id;
      if p_value = 'Contacted' then
        perform public.fn_log_human_contact(v_id, 'manual', 'stage_contacted', auth.uid(), 'recruiting_pipeline_stage');
      end if;
    elsif p_action='intent' then update applications set intent_level=nullif(p_value,'clear'), updated_at=now() where id=v_id;
    elsif p_action='followup' then update applications set next_action_due_at=nullif(p_value,'')::timestamptz, updated_at=now() where id=v_id;
    elsif p_action='contacted' then
      perform public.fn_log_human_contact(v_id, 'manual', 'contacted', auth.uid(), 'recruiting_pipeline');
    elsif p_action='note' and coalesce(p_value,'')<>'' then update applications set notes=trim(coalesce(notes||E'\n','')||to_char(now(),'MM/DD')||': '||p_value), updated_at=now() where id=v_id;
    else raise exception 'unknown action %', p_action; end if;
  elsif v_kind='agent' then
    if p_action='stage' then update agents set pipeline_stage_override=nullif(p_value,'clear'), updated_at=now() where id=v_id;
    elsif p_action='intent' then update agents set intent_level=nullif(p_value,'clear'), updated_at=now() where id=v_id;
    elsif p_action='followup' then update agents set next_action_due_at=nullif(p_value,'')::timestamptz, updated_at=now() where id=v_id;
    elsif p_action='note' and coalesce(p_value,'')<>'' then update agents set notes=trim(coalesce(notes||E'\n','')||to_char(now(),'MM/DD')||': '||p_value), updated_at=now() where id=v_id;
    elsif p_action='monday' then null;
    else raise exception 'unknown action %', p_action; end if;
  else raise exception 'bad kind %', v_kind; end if;
  select stage into v_stage from v_recruiting_pipeline where person_key=p_person_key;
  return v_stage;
end $$;

create or replace function public.unified_mark_contacted(p_id uuid, p_source text, p_by_user_id uuid default auth.uid())
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.fn_require_caller_role(array['admin','manager','va_manager','va']::public.app_role[]);
  if p_source = 'aged_lead' or p_source = 'aged_leads' then
    update aged_leads
       set last_contacted_at = now(),
           contacted_at = coalesce(contacted_at, now())
     where id = p_id;
  else
    -- The log trigger stamps last_contacted_at / contacted_at / human_* exactly as the
    -- inline UPDATE did, and the row now records who and where.
    perform public.fn_log_human_contact(p_id, 'manual', 'marked_contacted', coalesce(auth.uid(), p_by_user_id),
                                        coalesce(nullif(p_source, ''), 'unified_mark_contacted'));
  end if;
end $$;

create or replace function public.fn_recover_stale_applicant(p_application_id uuid, p_action text, p_new_agent_id uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_allowed boolean := coalesce(public.has_role(auth.uid(), 'admin'::app_role), false)
                    or coalesce(public.has_role(auth.uid(), 'manager'::app_role), false);
begin
  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'Admins and managers only');
  end if;
  if p_action not in ('mark_contacted', 'ghost', 'dismiss') then
    return jsonb_build_object('ok', false, 'error', 'Unknown action: ' || coalesce(p_action, 'null'));
  end if;
  if not exists (select 1 from public.applications where id = p_application_id) then
    return jsonb_build_object('ok', false, 'error', 'Application not found');
  end if;

  if p_action = 'mark_contacted' then
    update public.applications
       set contacted_at = coalesce(contacted_at, now()),
           last_contacted_at = now(),
           assigned_agent_id = coalesce(p_new_agent_id, assigned_agent_id)
     where id = p_application_id;
  elsif p_action = 'ghost' then
    update public.applications
       set contacted_at = coalesce(contacted_at, now()),
           last_contacted_at = now(),
           status = 'no_pickup'
     where id = p_application_id;
  else
    update public.applications
       set contacted_at = coalesce(contacted_at, now())
     where id = p_application_id;
  end if;

  begin
    perform public.fn_log_human_contact(p_application_id, 'manual', p_action, auth.uid(), 'stale_recovery', p_note);
  exception when others then
    -- The applicant update above stands; the missing timeline entry is reported, not hidden.
    raise warning 'fn_recover_stale_applicant: contact log insert failed for %: %', p_application_id, sqlerrm;
    return jsonb_build_object('ok', true, 'action', p_action, 'logged', false, 'log_error', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'action', p_action, 'logged', true);
end $$;

-- set_recruit_stage is re-created from its LIVE definition with one inserted block
-- (marked WP3) after the application UPDATE. Generated by the WP3 build script.
CREATE OR REPLACE FUNCTION public.set_recruit_stage(p_application_id uuid, p_agent_id uuid, p_to_stage text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_now timestamptz := now();
  v_to int; v_cur text; v_cur_rank int; v_final text; v_floor int := public.fn_next_step_rank('hired_unlicensed'); v_hired int := public.fn_next_step_rank('hired'); v_lic text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  if (p_application_id is null) = (p_agent_id is null) then raise exception 'pass exactly one of application or agent'; end if;
  if not exists (select 1 from public.next_step_stages where stage_key = p_to_stage) then raise exception 'unknown stage %', p_to_stage; end if;
  if exists (select 1 from public.next_step_stages where stage_key = p_to_stage and retired_at is not null) then raise exception 'stage % is retired', p_to_stage; end if;
  if not public.fn_recruit_scope_ok(p_application_id, p_agent_id) then raise exception 'not allowed to edit this person' using errcode='42501'; end if;

  v_to := public.fn_next_step_rank(p_to_stage);
  if p_application_id is not null and v_to >= v_floor and p_to_stage <> 'closed_lost' then
    return jsonb_build_object('ok', false, 'reason', 'not_an_agent',
      'message', 'They are not an agent yet. Hire them (Add Agent) and the later stages open up.');
  end if;
  if p_agent_id is not null and v_to < v_floor then
    return jsonb_build_object('ok', false, 'reason', 'agent_before_hired',
      'message', 'They are already hired, so the applicant stages do not apply. Their licensing shows on the row.');
  end if;
  if p_agent_id is not null and v_to >= v_hired then
    select license_status::text into v_lic from public.agents where id = p_agent_id;
    if coalesce(v_lic,'') <> 'licensed' then
      return jsonb_build_object('ok', false, 'reason', 'not_licensed',
        'message', 'They are not licensed yet, so Hired and later stages do not apply. Set their license on the row first.');
    end if;
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
    -- WP3: a hand move into 'contacted' or later is a human touch. Log it through the
    -- one writer so human_last_contact_at agrees with the stage (closed_lost is not contact).
    if p_to_stage <> 'closed_lost' and v_to >= public.fn_next_step_rank('contacted')
       and coalesce(v_cur_rank, 0) < public.fn_next_step_rank('contacted') then
      perform public.fn_log_human_contact(p_application_id, 'manual', 'stage_' || p_to_stage, v_uid, 'set_recruit_stage');
    end if;
  else
    update public.agents set
      updated_at = v_now,
      has_training_course       = case when v_to >= public.fn_next_step_rank('course_started') then true else false end,
      onboarding_completed_at   = case when v_to >= public.fn_next_step_rank('course_completed') then coalesce(onboarding_completed_at, v_now) else null end,
      field_training_started_at = case when v_to >= public.fn_next_step_rank('infield_training') then coalesce(field_training_started_at, v_now) else null end,
      onboarding_stage          = case when v_to = public.fn_next_step_rank('infield_training') then 'in_field_training'::onboarding_stage
                                       when v_to < public.fn_next_step_rank('infield_training') and onboarding_stage = 'in_field_training' then 'onboarding'::onboarding_stage
                                       else onboarding_stage end,
      first_appointment_at      = case when v_to >= public.fn_next_step_rank('first_appointment') then coalesce(first_appointment_at, v_now) else null end,
      first_deal_at             = case when v_to >= public.fn_next_step_rank('first_deal') then coalesce(first_deal_at, v_now) else null end,
      first_10k_at              = case when v_to >= public.fn_next_step_rank('first_10k_week') then coalesce(first_10k_at, v_now) else null end,
      weekly_10k_badges         = case when v_to >= public.fn_next_step_rank('first_10k_week') then greatest(coalesce(weekly_10k_badges,0),1) else 0 end
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


-- ── 7. ownership: every new application gets a named owner ───────────────────────
create or replace function public.fn_assign_recruiting_owner()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.recruiting_owner_user_id is not null then
    return new;
  end if;
  new.recruiting_owner_user_id := public.fn_pick_recruit_owner(new.license_status::text, null);
  new.recruiting_owner_set_at := now();
  return new;
exception when others then
  -- Never block an application insert. A null owner is visible: the SLA queue
  -- defaults it to Sam and apex-doctor #44 counts post-cutoff rows with no owner.
  raise warning 'fn_assign_recruiting_owner failed: %', sqlerrm;
  return new;
end $$;
revoke execute on function public.fn_assign_recruiting_owner() from public, anon, authenticated;

drop trigger if exists trg_assign_recruiting_owner on public.applications;
create trigger trg_assign_recruiting_owner
  before insert on public.applications
  for each row execute function public.fn_assign_recruiting_owner();

-- ── 8. backfill human_* ONLY from evidence of a human touch ──────────────────────
-- Sources: manual application_contact_log rows and interview_events with an outcome.
-- Never from contacted_at (an automated 72h stamp wrote 133 of 184 of those).
with ev as (
  select l.application_id, min(l.logged_at) first_at, max(l.logged_at) last_at
    from public.application_contact_log l
   where coalesce(l.is_manual, false) and coalesce(l.outcome, '') not in ('dismiss', 'dismissed')
   group by 1
  union all
  select e.application_id, min(coalesce(e.outcome_at, e.scheduled_at)), max(coalesce(e.outcome_at, e.scheduled_at))
    from public.interview_events e
   where e.application_id is not null and e.outcome is not null
   group by 1
), agg as (
  select application_id, min(first_at) first_at, max(last_at) last_at from ev group by 1
)
update public.applications a
   set human_first_contact_at = least(coalesce(a.human_first_contact_at, agg.first_at), agg.first_at),
       human_last_contact_at  = greatest(coalesce(a.human_last_contact_at, agg.last_at), agg.last_at)
  from agg
 where a.id = agg.application_id
   and (a.human_first_contact_at is distinct from least(coalesce(a.human_first_contact_at, agg.first_at), agg.first_at)
        or a.human_last_contact_at is distinct from greatest(coalesce(a.human_last_contact_at, agg.last_at), agg.last_at));

-- ── 9. interview outcome ask: fire once, settle on a later tick ─────────────────
-- The old function polled net._http_response in the SAME transaction it enqueued in
-- (pg_net sends only after commit), so it never stamped outcome_asked_at and could
-- re-push the same 'Did X show?' every 15 minutes for 36h, with the invitee's full
-- name and phone on a public ntfy topic. Now: the enqueue and the stamp are one
-- UPDATE; the body carries the first name only; settle reads the response later.
create or replace function public.fn_interview_outcome_ask()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_tok text;
  v_base text := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/interview-outcome';
  v_asked integer := 0;
  v_failed integer := 0;
  v_first text;
  v_body text;
  k text;
begin
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'apex_bot_token' limit 1;
  if v_tok is null then return jsonb_build_object('error', 'no bot token'); end if;
  for r in
    select e.id, e.invitee_name, e.event_type_name, e.scheduled_at
      from public.interview_events e
     where e.canceled_at is null and e.outcome is null
       and not e.is_backfill_duplicate
       and e.call_track in ('licensed', 'leader', 'onboarding', 'licensing')
       and e.scheduled_at < now() - interval '20 minutes'
       and e.scheduled_at > now() - interval '36 hours'
       and (e.raw_payload ->> 'outcome_asked_at') is null
     order by e.scheduled_at
     limit 8
     for update skip locked
  loop
    v_first := nullif(split_part(btrim(coalesce(r.invitee_name, '')), ' ', 1), '');
    v_body := format('%s · %s · %s',
      coalesce(v_first, 'Someone'),
      to_char(r.scheduled_at at time zone 'America/Phoenix', 'Dy HH12:MI AM'),
      coalesce(r.event_type_name, 'call')) || E'\n\n';
    foreach k in array array['completed', 'no_show', 'hired', 'no_answer'] loop
      v_body := v_body || format('%s: %s?id=%s&o=%s&k=%s' || E'\n',
        case k when 'completed' then 'Showed' when 'no_show' then 'No-show' when 'hired' then 'Hired' else 'No answer' end,
        v_base, r.id, k,
        encode(extensions.hmac(convert_to(r.id::text || ':' || k, 'UTF8'), convert_to(v_tok, 'UTF8'), 'sha256'), 'hex'));
    end loop;
    begin
      -- Enqueue and stamp in ONE statement: the event is asked exactly once whether or
      -- not ntfy accepts it; settle records the receipt and re-asks once on failure.
      update public.interview_events
         set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
               'outcome_asked_at', now(),
               'outcome_ask_count', coalesce((raw_payload ->> 'outcome_ask_count')::int, 0) + 1,
               'outcome_ask_req', public.fn_ntfy_relay('Did ' || coalesce(v_first, 'they') || ' show?', v_body, '4', 'phone'))
       where id = r.id;
      v_asked := v_asked + 1;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'fn_interview_outcome_ask: event % not asked: %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('asked', v_asked, 'failed', v_failed, 'at', now());
end $$;

create or replace function public.fn_interview_outcome_ask_settle()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_status integer;
  v_content text;
  v_settled integer := 0;
  v_reask integer := 0;
  v_expired integer := 0;
begin
  for r in
    select e.id, e.raw_payload p
      from public.interview_events e
     where e.raw_payload ? 'outcome_ask_req'
       and not (e.raw_payload ? 'outcome_ask_settled_at')
       and (e.raw_payload ->> 'outcome_asked_at')::timestamptz < now() - interval '1 minute'
     for update skip locked
  loop
    select h.status_code, h.content into v_status, v_content
      from net._http_response h where h.id = (r.p ->> 'outcome_ask_req')::bigint;
    if found then
      update public.interview_events
         set raw_payload = raw_payload || jsonb_build_object(
               'outcome_ask_settled_at', now(),
               'outcome_ask_status', v_status,
               'outcome_ask_ntfy_id', case when v_status = 200 then public.fn_wp3_ntfy_id(v_content) end)
       where id = r.id;
      v_settled := v_settled + 1;
    elsif (r.p ->> 'outcome_asked_at')::timestamptz < now() - interval '6 hours' then
      -- pg_net keeps responses for hours, not days: past that, delivery is unprovable.
      update public.interview_events
         set raw_payload = raw_payload || jsonb_build_object('outcome_ask_settled_at', now(), 'outcome_ask_status', 'expired_unknown')
       where id = r.id;
      v_expired := v_expired + 1;
    end if;
  end loop;

  -- Re-ask at most once, 2h after a push that did not land, while the outcome is still open.
  for r in
    select e.id from public.interview_events e
     where e.outcome is null and e.canceled_at is null
       and e.raw_payload ? 'outcome_ask_settled_at'
       and coalesce(e.raw_payload ->> 'outcome_ask_status', '') <> '200'
       and coalesce((e.raw_payload ->> 'outcome_ask_count')::int, 0) < 2
       and (e.raw_payload ->> 'outcome_asked_at')::timestamptz < now() - interval '2 hours'
       and e.scheduled_at > now() - interval '34 hours'
     for update skip locked
  loop
    update public.interview_events
       set raw_payload = (raw_payload - 'outcome_asked_at' - 'outcome_ask_req' - 'outcome_ask_settled_at')
                         || jsonb_build_object('outcome_ask_first_status', raw_payload ->> 'outcome_ask_status')
     where id = r.id;
    v_reask := v_reask + 1;
  end loop;
  return jsonb_build_object('settled', v_settled, 'expired', v_expired, 'requeued_for_reask', v_reask, 'at', now());
end $$;
revoke execute on function public.fn_interview_outcome_ask() from public, anon, authenticated;
revoke execute on function public.fn_interview_outcome_ask_settle() from public, anon, authenticated;
grant execute on function public.fn_interview_outcome_ask_settle() to service_role;

-- ── 10. applicant nudges: retired here, moved to send-followup-emails ────────────
-- fn_run_applicant_nudges sent day-1/72h emails with a NULL Authorization header
-- (401 since 2026-09-06, MP-446) and stamped followup_sent_at / manual_followup_sent_at
-- regardless, put the raw email in a ?email= URL, and broadcast to an inactive
-- Telegram group. Its fake day-1 stamp also suppressed send-followup-emails' real
-- day-3 email. The day-1 and day-3 nudges now live in send-followup-emails with their
-- own receipt-gated columns; the staff-side escalation is the SLA pager below.
create or replace function public.fn_run_applicant_nudges()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  return jsonb_build_object('retired', true, 'by', 'wp3_recruit_sla',
    'replaced_by', 'send-followup-emails day1_nudge_sent_at/day3_nudge_sent_at + fn_recruit_sla_pager',
    'at', now());
end $$;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'apex-applicant-nudges-hourly') then
    perform cron.unschedule('apex-applicant-nudges-hourly');
  end if;
end $$;

-- ── 11. null-GUC class: one helper for the edge Authorization header ─────────────
create or replace function public.auto_nipr_verify_on_apply()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_url text;
  v_auth text;
begin
  -- Only attempt verification for a self-reported licensed applicant who gave an NPN.
  if new.license_status = 'licensed' and new.nipr_number is not null and btrim(new.nipr_number) <> '' then
    v_url := coalesce(nullif((select value from public.system_settings where key = 'supabase_url'), ''),
                      'https://xrzweoneiieddzxogewk.supabase.co');
    v_auth := public.fn_edge_auth_header();
    if v_auth is not null then
      -- verify-nipr expects camelCase {niprNumber, applicationId, firstName, lastName, state}.
      perform net.http_post(
        url := v_url || '/functions/v1/verify-nipr',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_auth),
        body := jsonb_build_object(
          'applicationId', new.id,
          'niprNumber', new.nipr_number,
          'firstName', coalesce(new.first_name, ''),
          'lastName', coalesce(new.last_name, ''),
          'state', coalesce(new.state, '')));
    end if;
  end if;
  return new;
exception when others then
  raise warning 'auto_nipr_verify_on_apply failed for %: %', new.id, sqlerrm;
  return new;
end $$;

-- run_automation_job: drop the GUC read (always NULL here); its system_settings
-- fallback was already the working source. Behaviour unchanged.
create or replace function public.run_automation_job(p_job_name text, p_function_name text, p_body jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_log_id uuid;
  v_url text;
  v_key text;
  v_start timestamptz;
  v_base_url text;
begin
  v_start := clock_timestamp();

  insert into public.automation_run_log (job_name, status)
  values (p_job_name, 'running')
  returning id into v_log_id;

  v_base_url := current_setting('app.settings.supabase_url', true);
  if v_base_url is null or v_base_url = '' then
    select value into v_base_url from public.system_settings where key = 'supabase_url';
  end if;
  if v_base_url is null or v_base_url = '' then
    v_base_url := 'https://xrzweoneiieddzxogewk.supabase.co';
  end if;

  v_url := v_base_url || '/functions/v1/' || p_function_name;

  select value into v_key from public.system_settings where key = 'service_role_key';
  if v_key is null or v_key = '' then
    select value into v_key from public.system_settings where key = 'supabase_anon_key';
  end if;

  if v_key is null or v_key = '' then
    update public.automation_run_log
    set status = 'error', error = 'No auth key available',
        completed_at = now(),
        duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
    where id = v_log_id;
    return v_log_id;
  end if;

  perform net.http_post(
    url := v_url,
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'x-automation-job', p_job_name,
      'x-automation-log-id', v_log_id::text
    ),
    timeout_milliseconds := 30000
  );

  update public.automation_run_log
  set status = 'success', completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  where id = v_log_id;

  return v_log_id;
exception when others then
  update public.automation_run_log
  set status = 'error', error = sqlerrm, completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  where id = v_log_id;
  return v_log_id;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobid = 40 and jobname = 'pl081_system_health_autopilot') then
    perform cron.alter_job(40, command := $c$
      SELECT net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/system-health-autopilot',
        headers := jsonb_build_object('Content-Type','application/json','Authorization', public.fn_edge_auth_header()),
        body := '{}'::jsonb
      ) AS request_id;
    $c$);
  end if;
  if exists (select 1 from cron.job where jobid = 66 and jobname = 'apex-postmark-approval-monitor-15min') then
    -- vault 'SUPABASE_SERVICE_ROLE_KEY' does not exist; this also sent a NULL header.
    perform cron.alter_job(66, command := $c$ SELECT net.http_post(url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/postmark-approval-monitor', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', public.fn_edge_auth_header()), body := '{}'::jsonb); $c$);
  end if;
end $$;

-- ── 12. dead alert paths ─────────────────────────────────────────────────────────
-- check_speed_to_lead: unscheduled, posts to a deleted Discord webhook, filters on the
-- abandoned status='new'. Superseded by fn_recruit_sla_pager. Preimage below.
drop function if exists public.check_speed_to_lead();
-- The high-value alert inserted name + phone into poke_queue for the retired Poke
-- runner (0 rows in 120d). The insert is removed; the trigger stays a no-op so nothing
-- that references it breaks.
create or replace function public.fn_queue_high_value_applicant_alert()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- WP3: poke_queue insert removed (dead sink, carried phone). High-value applicants
  -- surface in v_recruit_sla_queue like everyone else.
  return new;
end $$;

-- ── 13. next-step: email-first labels, forward-only long tail ───────────────────
create or replace function public.fn_next_step_nudge_sweep()
returns table(queued integer) language plpgsql security definer set search_path to 'public' as $$
declare
  v_queued int := 0;
  r record;
  v_days int;
  v_key text;
  v_dedupe text;
  v_ins int;
  v_cutoff timestamptz := public.fn_wp3_cutoff();
  v_channel text;
begin
  for r in
    select np.application_id, np.agent_id, np.current_stage_key, np.entered_at, np.nudge_count, np.last_nudged_at,
           s.reminder_cadence, public.fn_next_step_send_zones(np.application_id, np.agent_id) as zones
    from public.next_step_progress np
    join public.next_step_stages s on s.stage_key = np.current_stage_key
    where np.status = 'active' and s.reminder_cadence is not null
  loop
    -- NULL outside 08:00-21:00 in the recipient's zone(s); a held hour step stays due
    -- until it has had 3h of allowed time (20261016210500)
    v_key := public.fn_next_step_cadence_due_local(r.reminder_cadence, r.entered_at, now(), r.zones);
    continue when v_key is null;
    -- WP3 long-tail steps fire only for people who ENTERED the stage after the WP3
    -- cutoff. Without this gate every old row would get one message on the next sweep.
    continue when r.entered_at < v_cutoff
      and ((r.current_stage_key = 'contacted' and v_key in ('hour168', 'hour336', 'hour720'))
        or (r.current_stage_key = 'started_prelicense' and v_key in ('day30', 'day45', 'day60')));
    -- day steps keep the 20h throttle. Hour steps take 6h: the tightest live gap is
    -- hour:1,12 (11h, nudge at most 2h late in its window), so 6h never holds a real
    -- step, and it stops a row the old sweep nudged as day1 this hour from getting
    -- hour24 again on the first tick after this migration
    continue when r.last_nudged_at is not null and r.last_nudged_at >= now() -
      case when v_key like 'day%' then interval '20 hours' else interval '6 hours' end;
    v_days := floor(extract(epoch from (now() - r.entered_at))/86400.0)::int;
    v_dedupe := coalesce(r.application_id::text, r.agent_id::text) || ':' || r.current_stage_key || ':' || v_key;
    -- Label the parent with the channel next-step-dispatch will actually reach first:
    -- telegram only when the person has linked a chat (1 of 194 applicants), else email.
    v_channel := case
      when (r.application_id is not null and exists (select 1 from public.applications a where a.id = r.application_id and a.telegram_chat_id is not null))
        or (r.agent_id is not null and exists (select 1 from public.agents g where g.id = r.agent_id and g.telegram_chat_id is not null))
      then 'telegram' else 'email' end;
    insert into public.next_step_messages
      (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
    values
      (r.application_id, r.agent_id, r.current_stage_key, v_channel,
       r.current_stage_key || ':' || v_key, v_dedupe,
       jsonb_build_object('day', v_days, 'step', v_key, 'cadence', r.reminder_cadence,
                          'send_zones', coalesce(to_jsonb(r.zones), '"unknown: ET+PT"'::jsonb)))
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
end $$;

-- Long tail (same unit as each stage's existing cadence; the parser takes one unit).
-- hired_unlicensed stays '' until Sam answers N10. hired/course_started untouched:
-- WP6 owns the new-hire reminder cadence and two ladders would stack messages.
update public.next_step_stages set reminder_cadence = 'hour:24,48,72,168,336,720', updated_at = now()
 where stage_key = 'contacted' and reminder_cadence = 'hour:24,48,72';
update public.next_step_stages set reminder_cadence = 'day:3,7,14,21,30,45,60', updated_at = now()
 where stage_key = 'started_prelicense' and reminder_cadence = 'day:3,7,14,21';

-- ── 14. receipts for every page and digest ───────────────────────────────────────
create table if not exists public.recruit_sla_push_log (
  id bigserial primary key,
  kind text not null check (kind in ('page', 'batch_page', 'escalation', 'digest')),
  application_id uuid references public.applications(id) on delete set null,
  owner_user_id uuid,
  channel text not null check (channel in ('ntfy', 'inbox')),
  req_id bigint,
  notification_id uuid,
  counts jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  status_code integer,
  ntfy_id text,
  settle_note text
);
create index if not exists recruit_sla_push_log_unsettled_idx on public.recruit_sla_push_log (created_at) where settled_at is null;
create index if not exists recruit_sla_push_log_kind_idx on public.recruit_sla_push_log (kind, created_at desc);
alter table public.recruit_sla_push_log enable row level security;
revoke all on public.recruit_sla_push_log from public, anon, authenticated;
grant select on public.recruit_sla_push_log to service_role;
comment on table public.recruit_sla_push_log is
  'WP3: one row per SLA page/escalation/digest. ntfy rows hold the pg_net request id; fn_recruit_sla_pager_settle records the response on a later tick. Payloads carry first name/state/license only (public topic).';

-- ── 15. the one recruit SLA queue ────────────────────────────────────────────────
create or replace view public.v_recruit_sla_queue with (security_invoker = true) as
with cfg as (
  select public.fn_wp3_cutoff() as cutoff, public.fn_recruit_sam_user_id() as sam
), base as (
  select a.id as application_id,
         a.first_name, a.state, a.license_status::text as license_status, a.created_at,
         a.human_first_contact_at, a.human_last_contact_at,
         coalesce(a.recruiting_owner_user_id, cfg.sam) as owner_user_id,
         (a.recruiting_owner_user_id is null) as owner_defaulted,
         a.next_action, a.next_action_due_at, a.next_review_at,
         a.last_contact_outcome, a.last_contact_outcome_at, a.owner_alerted_at,
         (a.created_at >= cfg.cutoff) as post_deploy,
         nullif(to_jsonb(a) ->> 'email_bounced_at', '')::timestamptz as email_bounced_at,
         greatest(a.last_automated_email_at,
                  (select max(m.sent_at) from public.next_step_messages m where m.application_id = a.id)) as last_automated_touch_at,
         public.fn_phx_business_minutes(a.created_at, now()) as age_business_minutes,
         exists (select 1 from public.interview_events e
                  where e.application_id = a.id and e.canceled_at is null and e.outcome is null
                    and not e.is_backfill_duplicate and e.scheduled_at >= now() - interval '2 hours') as has_open_booking,
         (select max(e.scheduled_at) from public.interview_events e
           where e.application_id = a.id and e.canceled_at is null and e.outcome is null
             and not e.is_backfill_duplicate
             and e.call_track in ('licensed', 'leader', 'onboarding', 'licensing')
             and coalesce(e.ended_at, e.scheduled_at + interval '30 minutes') < now() - interval '2 hours') as call_no_outcome_at,
         exists (select 1 from public.interview_events e
                  where e.application_id = a.id and e.canceled_at is null and not e.is_backfill_duplicate) as ever_booked
    from public.applications a cross join cfg
   where coalesce(a.is_duplicate, false) = false
     and coalesce(a.record_type, 'application') = 'application'
     and a.do_not_contact_at is null
     and a.terminated_at is null
     and a.closed_at is null
     and (a.created_at >= now() - interval '45 days' or a.next_review_at <= now())
     and not public.fn_application_has_agent(a.id)
), staged as (
  select b.*,
         case
           when b.call_no_outcome_at is not null then 'CALL_NO_OUTCOME'
           when b.human_last_contact_at is null and not b.has_open_booking and b.age_business_minutes >= 15 then 'NEW_UNTOUCHED'
           when b.last_contact_outcome = 'callback' and coalesce(b.next_action_due_at, b.last_contact_outcome_at) <= now() then 'CALLBACK'
           when coalesce(b.next_action, '') <> 'MANAGER_CALL_72H_ESCALATION'
                and (b.next_action_due_at <= now() or b.next_review_at <= now()) then 'FOLLOWUP_DUE'
           when b.license_status = 'licensed' and not b.ever_booked then 'LICENSED_UNBOOKED'
         end as sla_state
    from base b
)
select s.application_id, s.first_name, s.state, s.license_status, s.created_at, s.age_business_minutes,
       s.sla_state, s.owner_user_id, public.fn_staff_first_name(s.owner_user_id) as owner_first_name,
       s.owner_defaulted, s.human_first_contact_at, s.human_last_contact_at, s.last_automated_touch_at,
       s.call_no_outcome_at, s.next_action, s.next_action_due_at, s.next_review_at, s.owner_alerted_at,
       s.post_deploy, s.email_bounced_at,
       case s.license_status when 'licensed' then 0 when 'pending' then 1 else 2 end as sort_rank
  from staged s
 where s.sla_state is not null
   and (public.api_is_staff() or public.calendar_is_scheduling_staff()
        or current_user in ('postgres', 'service_role', 'supabase_admin'))
 order by sort_rank, s.created_at;
revoke all on public.v_recruit_sla_queue from public, anon;
grant select on public.v_recruit_sla_queue to authenticated, service_role;
comment on view public.v_recruit_sla_queue is
  'WP3: one row per open recruit needing a human: NEW_UNTOUCHED (no logged human touch 15 business min after apply, no open booking), CALL_NO_OUTCOME (call ended >2h, no outcome), CALLBACK, FOLLOWUP_DUE, LICENSED_UNBOOKED. Staff only. Licensed first, then oldest.';

-- ── 16. pipeline + inbox read human contact, not the automated stamp ─────────────
-- v_recruiting_pipeline.last_contact for applicants was COALESCE(last_contacted_at,
-- contacted_at); an automated 72h email stamped contacted_at, so 707 applicants read
-- 'Contacted' while 21 had any logged human touch. Columns are appended, never moved.
create or replace view public.v_recruiting_pipeline with (security_barrier = true) as
 SELECT person_key, person_type, id, name, phone, email, instagram, lead_source, recruiter_id,
    hiring_manager_user_id, assigned_va_id, raw_status, monday_status, pipeline_stage_override,
    intent_level, expected_start, last_contact, next_follow_up, raw_next_action, notes,
    license_status, license_progress, contracted_at, created_at, upcoming_interviews, stage,
    next_action_display, human_last_contact_at, last_automated_touch_at
   FROM ( WITH app_rows AS (
                 SELECT 'app:'::text || a.id::text AS person_key,
                    'applicant'::text AS person_type,
                    a.id,
                    TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text)) AS name,
                    a.phone,
                    a.email,
                    a.instagram_handle AS instagram,
                    COALESCE(a.utm_source, a.source, a.referral_source) AS lead_source,
                    a.recruiter_id,
                    a.hiring_manager_user_id,
                    a.assigned_va_id,
                    a.status::text AS raw_status,
                    a.monday_status,
                    a.pipeline_stage_override,
                    a.intent_level,
                    a.start_date::text AS expected_start,
                    a.human_last_contact_at AS last_contact,
                    COALESCE(a.next_action_due_at, a.next_action_at, a.next_touch_by) AS next_follow_up,
                    COALESCE(a.next_action, a.next_action_type) AS raw_next_action,
                    a.notes,
                    a.license_status::text AS license_status,
                    a.license_progress::text AS license_progress,
                    a.contracted_at,
                    a.created_at,
                    ( SELECT count(*)::integer AS count
                           FROM interview_events ie
                          WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND COALESCE(ie.scheduled_at, now()) >= (now() - '1 day'::interval)) AS upcoming_interviews,
                    a.human_last_contact_at,
                    GREATEST(a.last_automated_email_at, ( SELECT max(m.sent_at) FROM next_step_messages m WHERE m.application_id = a.id)) AS last_automated_touch_at
                   FROM applications a
                  WHERE COALESCE(a.is_duplicate, false) = false AND NOT (EXISTS ( SELECT 1
                           FROM agents g
                          WHERE g.source_application_id = a.id))
                ), agent_rows AS (
                 SELECT 'agent:'::text || g.id::text AS person_key,
                    'agent'::text AS person_type,
                    g.id,
                    COALESCE(g.display_name, p.full_name, 'Agent'::text) AS name,
                    p.phone,
                    p.email,
                    NULL::text AS instagram,
                    NULL::text AS lead_source,
                    g.manager_id AS recruiter_id,
                    NULL::uuid AS hiring_manager_user_id,
                    NULL::uuid AS assigned_va_id,
                    g.status::text AS raw_status,
                    g.attendance_status::text AS monday_status,
                    g.pipeline_stage_override,
                    g.intent_level,
                    g.start_date::text AS expected_start,
                    g.stage_changed_at AS last_contact,
                    g.next_action_due_at AS next_follow_up,
                    g.next_action_text AS raw_next_action,
                    g.notes,
                    g.license_status::text AS license_status,
                    g.license_progress::text AS license_progress,
                    g.contracted_at,
                    g.created_at,
                    0 AS upcoming_interviews,
                    NULL::timestamptz AS human_last_contact_at,
                    NULL::timestamptz AS last_automated_touch_at
                   FROM agents g
                     LEFT JOIN profiles p ON p.user_id = g.user_id
                  WHERE NOT is_placeholder_agent(g.agent_code, g.user_id)
                )
         SELECT r.person_key, r.person_type, r.id, r.name, r.phone, r.email, r.instagram, r.lead_source,
            r.recruiter_id, r.hiring_manager_user_id, r.assigned_va_id, r.raw_status, r.monday_status,
            r.pipeline_stage_override, r.intent_level, r.expected_start, r.last_contact, r.next_follow_up,
            r.raw_next_action, r.notes, r.license_status, r.license_progress, r.contracted_at, r.created_at,
            r.upcoming_interviews,
                CASE
                    WHEN r.pipeline_stage_override IS NOT NULL AND r.pipeline_stage_override <> ''::text THEN r.pipeline_stage_override
                    WHEN r.monday_status = 'no_show'::text THEN 'No Show'::text
                    WHEN r.monday_status = 'showed'::text THEN 'Showed'::text
                    WHEN r.monday_status = 'confirmed'::text THEN 'Confirmed'::text
                    WHEN r.monday_status = 'expected'::text THEN 'Expected Monday'::text
                    WHEN r.person_type = 'agent'::text THEN
                    CASE
                        WHEN r.raw_status = ANY (ARRAY['terminated'::text, 'inactive'::text]) THEN 'Inactive/No Longer With Us'::text
                        WHEN r.raw_status = 'active'::text THEN 'Active Agent'::text
                        ELSE 'Onboarding'::text
                    END
                    ELSE
                    CASE
                        WHEN r.raw_status = ANY (ARRAY['rejected'::text, 'disqualified'::text, 'terminated'::text]) THEN 'Inactive/No Longer With Us'::text
                        WHEN r.raw_status = 'attended_no_show'::text THEN 'No Show'::text
                        WHEN r.raw_status = 'paid'::text THEN 'Ready for Training'::text
                        WHEN r.raw_status = 'contracting'::text AND r.contracted_at IS NOT NULL THEN 'Contracting In Progress'::text
                        WHEN r.raw_status = 'contracting'::text THEN 'Contract Sent'::text
                        WHEN r.raw_status = 'onboarding'::text THEN 'Onboarding'::text
                        WHEN r.raw_status = 'interview'::text THEN 'Interested'::text
                        WHEN r.upcoming_interviews > 0 THEN 'Call Scheduled'::text
                        -- WP3: 'Contacted' means a logged human touch, nothing else.
                        WHEN r.last_contact IS NOT NULL THEN 'Contacted'::text
                        ELSE 'New Lead'::text
                    END
                END AS stage,
            COALESCE(NULLIF(r.raw_next_action, ''::text),
                CASE
                    WHEN r.pipeline_stage_override IS NOT NULL THEN 'Update status'::text
                    WHEN r.monday_status = 'no_show'::text THEN 'Re-engage / reschedule'::text
                    WHEN r.monday_status = 'showed'::text THEN 'Send onboarding'::text
                    WHEN r.monday_status = 'confirmed'::text THEN 'Confirm Monday attendance'::text
                    WHEN r.monday_status = 'expected'::text THEN 'Confirm Monday'::text
                    WHEN r.raw_status = 'contracting'::text THEN 'Complete contracting'::text
                    WHEN r.raw_status = 'onboarding'::text THEN 'Send onboarding / start training'::text
                    WHEN r.raw_status = 'paid'::text THEN 'Start training'::text
                    WHEN r.person_type = 'agent'::text AND r.raw_status = 'active'::text THEN 'Keep active / check production'::text
                    WHEN r.person_type = 'applicant'::text AND r.raw_status = 'new'::text THEN 'Call prospect / send application link'::text
                    ELSE 'Follow up'::text
                END) AS next_action_display,
            r.human_last_contact_at,
            r.last_automated_touch_at
           FROM ( SELECT * FROM app_rows
                UNION ALL
                 SELECT * FROM agent_rows) r) q
  WHERE (CURRENT_USER <> ALL (ARRAY['anon'::name, 'authenticated'::name])) OR ( SELECT api_is_staff() AS api_is_staff);

create or replace view public.v_recruiting_inbox as
 SELECT application_id, owner_agent_id, owner_name, applicant_name, phone, email, city, state,
    license_status, applied_at, hours_since_applied, contacted_at, next_action, next_action_at,
    urgency, referral_source, human_last_contact_at, last_automated_touch_at
   FROM ( SELECT a.id AS application_id,
            own_map.canonical_agent_id AS owner_agent_id,
            COALESCE(p_owner.full_name, 'Unassigned'::text) AS owner_name,
            TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text)) AS applicant_name,
            a.phone,
            a.email,
            a.city,
            a.state,
            a.license_status,
            a.created_at AS applied_at,
            EXTRACT(epoch FROM now() - a.created_at) / 3600::numeric AS hours_since_applied,
            a.contacted_at,
            a.next_action,
            a.next_action_at,
                CASE
                    WHEN x.human_last_contact_at IS NOT NULL THEN 'contacted'::text
                    WHEN a.created_at < (now() - '48:00:00'::interval) THEN 'CRITICAL_48H_PLUS'::text
                    WHEN a.created_at < (now() - '24:00:00'::interval) THEN 'overdue_24h'::text
                    WHEN a.created_at < (now() - '04:00:00'::interval) THEN 'cooling'::text
                    ELSE 'fresh'::text
                END AS urgency,
            a.referral_source,
            x.human_last_contact_at,
            GREATEST(x.last_automated_email_at, ( SELECT max(m.sent_at) FROM next_step_messages m WHERE m.application_id = a.id)) AS last_automated_touch_at
           FROM v_applications_real a
             JOIN applications x ON x.id = a.id
             LEFT JOIN v_agent_canonical_map own_map ON own_map.agent_id = a.assigned_agent_id
             LEFT JOIN agents ag_owner ON ag_owner.id = own_map.canonical_agent_id
             LEFT JOIN profiles p_owner ON p_owner.id = ag_owner.profile_id
          WHERE a.created_at >= (now() - '30 days'::interval)) _g
  WHERE is_agency_staff() OR auth.uid() IS NULL;

-- v_va_call_queue: read by nothing (types.ts only), 'never called' meant
-- last_contacted_at IS NULL (an automated stamp), 403 of 411 rows AGED. Replaced by
-- v_recruit_sla_queue. Preimage below.
drop view if exists public.v_va_call_queue;

-- v_interview_outcome_truth: append coverage + receipt columns (never moves existing ones).
create or replace view public.v_interview_outcome_truth as
 SELECT ( SELECT count(*) AS count FROM interview_events
          WHERE interview_events.canceled_at IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '7 days'::interval)) AS calls_ended_7d,
    ( SELECT count(*) AS count FROM interview_events
          WHERE interview_events.canceled_at IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '7 days'::interval) AND interview_events.outcome IS NOT NULL) AS outcomes_7d,
    ( SELECT count(*) AS count FROM interview_events
          WHERE interview_events.canceled_at IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '7 days'::interval) AND (interview_events.raw_payload ->> 'outcome_asked_at'::text) IS NOT NULL) AS asked_7d,
    ( SELECT count(*) AS count FROM interview_events
          WHERE interview_events.canceled_at IS NULL AND interview_events.outcome IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '36:00:00'::interval) AND (interview_events.raw_payload ->> 'outcome_asked_at'::text) IS NULL) AS unasked_now,
    ( SELECT round(EXTRACT(epoch FROM now() - min(interview_events.scheduled_at)) / 3600::numeric) AS round FROM interview_events
          WHERE interview_events.canceled_at IS NULL AND interview_events.outcome IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '36:00:00'::interval) AND (interview_events.raw_payload ->> 'outcome_asked_at'::text) IS NULL) AS oldest_unasked_h,
    ( SELECT max((interview_events.raw_payload ->> 'outcome_asked_at'::text)::timestamp with time zone) AS max FROM interview_events) AS last_ask_at,
    ( SELECT count(*) FROM interview_events e
          WHERE e.canceled_at IS NULL AND NOT e.is_backfill_duplicate
            AND e.call_track IN ('licensed','leader','onboarding','licensing')
            AND COALESCE(e.ended_at, e.scheduled_at + interval '30 minutes') < now() - interval '2 hours'
            AND e.scheduled_at > now() - interval '14 days') AS recruit_calls_ended_2h_14d,
    ( SELECT count(*) FROM interview_events e
          WHERE e.canceled_at IS NULL AND NOT e.is_backfill_duplicate AND e.outcome IS NOT NULL
            AND e.call_track IN ('licensed','leader','onboarding','licensing')
            AND COALESCE(e.ended_at, e.scheduled_at + interval '30 minutes') < now() - interval '2 hours'
            AND e.scheduled_at > now() - interval '14 days') AS recruit_outcomes_2h_14d,
    ( SELECT count(*) FROM interview_events e
          WHERE (e.raw_payload ->> 'outcome_ask_status') = '200'
            AND (e.raw_payload ->> 'outcome_asked_at')::timestamptz > now() - interval '7 days') AS asks_delivered_7d,
    ( SELECT count(*) FROM interview_events e
          WHERE e.raw_payload ? 'outcome_ask_settled_at' AND COALESCE(e.raw_payload ->> 'outcome_ask_status', '') <> '200'
            AND COALESCE((e.raw_payload ->> 'outcome_asked_at')::timestamptz, (e.raw_payload ->> 'outcome_ask_settled_at')::timestamptz) > now() - interval '7 days') AS asks_failed_7d;

-- ── 17. the pager: a channel Sam reads, only for recruits who arrive after go-live ──
-- Sam's in-app inbox was 0 of 5,153 read in 30 days, so the page goes to ntfy (his
-- phone). The topic is public: first name, state and license status only. No phone,
-- no email, no surname, no record id. Other staff owners (VAs, only ever assigned
-- while they sign in) get an in-app notification, which is the surface they work in.
create or replace function public.fn_recruit_sla_open_untouched(p_cutoff timestamptz)
returns setof public.applications language sql stable security definer set search_path to 'public' as $$
  select a.* from public.applications a
   where a.created_at >= p_cutoff
     and a.human_last_contact_at is null
     and coalesce(a.is_duplicate, false) = false
     and coalesce(a.record_type, 'application') = 'application'
     and a.do_not_contact_at is null and a.terminated_at is null and a.closed_at is null
     and not public.fn_application_has_agent(a.id)
     and not exists (select 1 from public.interview_events e
                      where e.application_id = a.id and e.canceled_at is null and e.outcome is null
                        and not e.is_backfill_duplicate and e.scheduled_at >= now() - interval '2 hours')
$$;
revoke execute on function public.fn_recruit_sla_open_untouched(timestamptz) from public, anon, authenticated;

create or replace function public.fn_recruit_sla_pager()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_cutoff timestamptz := public.fn_wp3_cutoff();
  v_sam uuid := public.fn_recruit_sam_user_id();
  v_local timestamp := now() at time zone 'America/Phoenix';
  c_link constant text := 'https://apex-financial.org/dashboard/recruiting';
  r record;
  v_owner uuid;
  v_mgr uuid;
  v_log bigint;
  v_nid uuid;
  v_title text;
  v_body text;
  v_eligible int;
  v_paged int := 0;
  v_inbox int := 0;
  v_escalated int := 0;
  v_reassigned int := 0;
begin
  if v_cutoff = 'infinity'::timestamptz then
    return jsonb_build_object('skipped', 'no_cutoff_setting', 'at', now());
  end if;

  -- (a) Ownership repair, any hour: open recruits owned by someone who has not signed
  -- in for 7 days go back to the fallback (no page for pre-cutoff rows).
  for r in
    select a.id, a.recruiting_owner_user_id, a.license_status::text as lic, a.created_at
      from public.applications a
     where a.recruiting_owner_user_id is not null and a.recruiting_owner_user_id <> v_sam
       and coalesce(a.is_duplicate, false) = false
       and coalesce(a.record_type, 'application') = 'application'
       and a.do_not_contact_at is null and a.terminated_at is null and a.closed_at is null
       and a.created_at >= now() - interval '45 days'
       and (not public.fn_recruit_user_is_active(a.recruiting_owner_user_id)
            or (a.created_at >= v_cutoff and a.human_last_contact_at is null
                and a.created_at < now() - interval '72 hours'
                and coalesce(a.owner_alert_meta ->> 'reassigned_at', '') = ''))
     for update skip locked
  loop
    v_owner := public.fn_pick_recruit_owner(r.lic, r.recruiting_owner_user_id);
    update public.applications
       set recruiting_owner_user_id = v_owner,
           recruiting_owner_set_at = now(),
           recruiting_owner_set_by = null,
           owner_alerted_at = case when r.created_at >= v_cutoff and human_last_contact_at is null then null else owner_alerted_at end,
           owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('reassigned_at', now(), 'reassigned_from', r.recruiting_owner_user_id)
     where id = r.id;
    v_reassigned := v_reassigned + 1;
  end loop;

  -- Pages only inside 08:00-19:00 Phoenix.
  if extract(hour from v_local) < 8 or extract(hour from v_local) >= 19 then
    return jsonb_build_object('reassigned', v_reassigned, 'skipped', 'outside_phoenix_business_hours', 'at', now());
  end if;

  -- (b) First page for each NEW_UNTOUCHED recruit (15 business minutes, post-cutoff).
  select count(*) into v_eligible
    from public.fn_recruit_sla_open_untouched(v_cutoff) a
   where a.owner_alerted_at is null and public.fn_phx_business_minutes(a.created_at, now()) >= 15;

  if v_eligible > 5 then
    -- Storm guard: a burst (bulk import, replay) becomes ONE push, never N.
    insert into public.recruit_sla_push_log (kind, owner_user_id, channel, req_id, counts)
    values ('batch_page', v_sam, 'ntfy',
            public.fn_ntfy_relay(v_eligible || ' new recruits waiting',
              v_eligible || ' recruits applied with no human contact yet. Open the recruiting queue: ' || c_link,
              '4', 'telephone_receiver'),
            jsonb_build_object('eligible', v_eligible))
    returning id into v_log;
    update public.applications a
       set owner_alerted_at = now(),
           owner_alert_meta = coalesce(a.owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('log_id', v_log, 'channel', 'ntfy', 'batch', true, 'paged_at', now())
     where a.id in (select u.id from public.fn_recruit_sla_open_untouched(v_cutoff) u
                     where u.owner_alerted_at is null and public.fn_phx_business_minutes(u.created_at, now()) >= 15);
    v_paged := v_eligible;
  else
    for r in
      select u.id, u.first_name, u.state, u.license_status::text as lic, u.created_at,
             coalesce(u.recruiting_owner_user_id, v_sam) as owner
        from public.fn_recruit_sla_open_untouched(v_cutoff) u
       where u.owner_alerted_at is null and public.fn_phx_business_minutes(u.created_at, now()) >= 15
       order by u.created_at
    loop
      v_title := 'Call ' || coalesce(nullif(split_part(btrim(coalesce(r.first_name, '')), ' ', 1), ''), 'a new recruit')
                 || ' (' || coalesce(r.lic, 'unknown') || ', ' || coalesce(nullif(btrim(r.state), ''), '?') || ')';
      v_body := 'Applied ' || greatest(1, round(extract(epoch from now() - r.created_at) / 60))::int
                || ' min ago. No human contact yet. Open the recruiting queue: ' || c_link;
      if r.owner = v_sam then
        insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, req_id)
        values ('page', r.id, r.owner, 'ntfy', public.fn_ntfy_relay(v_title, v_body, '4', 'telephone_receiver'))
        returning id into v_log;
        v_paged := v_paged + 1;
      else
        v_nid := public.fn_emit_inbox_notification(r.owner, 'recruit_sla_page', v_title, v_body,
                   '/dashboard/recruiting', 'high', jsonb_build_object('application_id', r.id));
        insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, notification_id, settled_at, settle_note)
        values ('page', r.id, r.owner, 'inbox', v_nid, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end)
        returning id into v_log;
        v_inbox := v_inbox + 1;
      end if;
      update public.applications
         set owner_alerted_at = now(),
             owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                                || jsonb_build_object('log_id', v_log, 'paged_user', r.owner, 'paged_at', now())
       where id = r.id;
    end loop;
  end if;

  -- (c) 2h escalation for recruits a non-Sam owner has not touched: the active
  -- va_manager's inbox, else Sam's phone. 24h is Sam's digest; 72h is (a) above.
  for r in
    select u.id, u.first_name, u.state, u.license_status::text as lic, u.recruiting_owner_user_id as owner
      from public.fn_recruit_sla_open_untouched(v_cutoff) u
     where u.owner_alerted_at < now() - interval '2 hours'
       and u.recruiting_owner_user_id is not null and u.recruiting_owner_user_id <> v_sam
       and coalesce(u.owner_alert_meta ->> 'escalated_at', '') = ''
  loop
    select ur.user_id into v_mgr from public.user_roles ur
     where ur.role = 'va_manager' and ur.user_id <> r.owner and public.fn_recruit_user_is_active(ur.user_id)
     order by ur.user_id limit 1;
    v_title := 'Still waiting 2h: ' || coalesce(nullif(split_part(btrim(coalesce(r.first_name, '')), ' ', 1), ''), 'a recruit')
               || ' (' || coalesce(r.lic, 'unknown') || ', ' || coalesce(nullif(btrim(r.state), ''), '?') || ')';
    v_body := 'Owner ' || coalesce(public.fn_staff_first_name(r.owner), 'staff') || ' has not logged contact. Open: ' || c_link;
    if v_mgr is not null then
      v_nid := public.fn_emit_inbox_notification(v_mgr, 'recruit_sla_escalation', v_title, v_body,
                 '/dashboard/recruiting', 'high', jsonb_build_object('application_id', r.id));
      insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, notification_id, settled_at, settle_note)
      values ('escalation', r.id, v_mgr, 'inbox', v_nid, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end)
      returning id into v_log;
    else
      insert into public.recruit_sla_push_log (kind, application_id, owner_user_id, channel, req_id)
      values ('escalation', r.id, v_sam, 'ntfy', public.fn_ntfy_relay(v_title, v_body, '4', 'rotating_light'))
      returning id into v_log;
    end if;
    update public.applications
       set owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb)
                              || jsonb_build_object('escalated_at', now(), 'escalation_log_id', v_log)
     where id = r.id;
    v_escalated := v_escalated + 1;
  end loop;

  return jsonb_build_object('paged_ntfy', v_paged, 'paged_inbox', v_inbox, 'escalated', v_escalated,
                            'reassigned', v_reassigned, 'eligible', v_eligible, 'at', now());
end $$;

-- Settle on a LATER tick: pg_net sends after commit, so a same-transaction read of
-- net._http_response can never see the row (the bug that killed the outcome ask).
create or replace function public.fn_recruit_sla_pager_settle()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_status integer;
  v_content text;
  v_settled int := 0;
  v_expired int := 0;
  v_retried int := 0;
begin
  for r in
    select l.id, l.kind, l.application_id, l.req_id, l.created_at
      from public.recruit_sla_push_log l
     where l.settled_at is null and l.channel = 'ntfy' and l.req_id is not null
       and l.created_at < now() - interval '1 minute'
     for update skip locked
  loop
    select h.status_code, h.content into v_status, v_content from net._http_response h where h.id = r.req_id;
    if found then
      update public.recruit_sla_push_log
         set settled_at = now(), status_code = v_status,
             ntfy_id = case when v_status = 200 then public.fn_wp3_ntfy_id(v_content) end,
             settle_note = case when v_status = 200 then 'delivered_to_ntfy' else 'ntfy_refused' end
       where id = r.id;
      v_settled := v_settled + 1;
      -- One retry for a first page that did not land: clear the stamp so the next
      -- pager tick pages again. Never more than once.
      if v_status is distinct from 200 and r.kind = 'page' and r.application_id is not null then
        update public.applications
           set owner_alerted_at = null,
               owner_alert_meta = coalesce(owner_alert_meta, '{}'::jsonb) || jsonb_build_object('retries', 1, 'first_status', v_status)
         where id = r.application_id and human_last_contact_at is null
           and coalesce((owner_alert_meta ->> 'retries')::int, 0) = 0;
        if found then v_retried := v_retried + 1; end if;
      end if;
    elsif r.created_at < now() - interval '6 hours' then
      update public.recruit_sla_push_log
         set settled_at = now(), settle_note = 'expired_unknown'
       where id = r.id;
      v_expired := v_expired + 1;
    end if;
  end loop;
  return jsonb_build_object('settled', v_settled, 'expired', v_expired, 'retried', v_retried, 'at', now());
end $$;

-- ── 18. one daily digest per owner, sent even at 0 (replaces the 200/day firehose) ──
create or replace function public.fn_recruit_sla_digest()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_cutoff timestamptz := public.fn_wp3_cutoff();
  v_sam uuid := public.fn_recruit_sam_user_id();
  c_link constant text := 'https://apex-financial.org/dashboard/recruiting';
  v_counts jsonb;
  v_last timestamptz;
  v_new_untouched int;
  v_backlog int;
  v_stalls int;
  v_total int;
  v_body text;
  v_log bigint;
  v_nid uuid;
  v_sent_inbox int := 0;
  r record;
begin
  if exists (select 1 from public.recruit_sla_push_log
              where kind = 'digest' and owner_user_id = v_sam and created_at > now() - interval '20 hours') then
    return jsonb_build_object('skipped', 'already_sent_today', 'at', now());
  end if;

  select coalesce(jsonb_object_agg(sla_state, n), '{}'::jsonb), coalesce(sum(n), 0)::int
    into v_counts, v_total
    from (select sla_state, count(*) n from public.v_recruit_sla_queue group by 1) x;
  select count(*) filter (where post_deploy), count(*) filter (where not post_deploy)
    into v_new_untouched, v_backlog
    from public.v_recruit_sla_queue where sla_state = 'NEW_UNTOUCHED';
  v_last := greatest(v_cutoff, coalesce((select max(created_at) from public.recruit_sla_push_log
                                           where kind = 'digest' and owner_user_id = v_sam), v_cutoff));
  -- New stall crossings since the last digest, as a count. Never a per-row alert.
  select count(*) into v_stalls from public.next_step_progress
   where status = 'active' and is_stalled and stalled_at > v_last;

  v_body := 'New since go-live, no human contact: ' || v_new_untouched || E'\n'
         || 'Call ended, no outcome: ' || coalesce((v_counts ->> 'CALL_NO_OUTCOME')::int, 0) || E'\n'
         || 'Callback due: ' || coalesce((v_counts ->> 'CALLBACK')::int, 0) || E'\n'
         || 'Follow-up due: ' || coalesce((v_counts ->> 'FOLLOWUP_DUE')::int, 0) || E'\n'
         || 'Licensed, never booked: ' || coalesce((v_counts ->> 'LICENSED_UNBOOKED')::int, 0) || E'\n'
         || 'Older untouched (before go-live, last 45 days): ' || v_backlog || E'\n'
         || 'New next-step stalls since last digest: ' || v_stalls || E'\n\n'
         || 'Open: ' || c_link;

  insert into public.recruit_sla_push_log (kind, owner_user_id, channel, req_id, counts)
  values ('digest', v_sam, 'ntfy',
          public.fn_ntfy_relay('Recruit queue: ' || v_total || ' need a human', v_body, '3', 'clipboard'),
          v_counts || jsonb_build_object('new_untouched_post_cutoff', v_new_untouched,
                                         'backlog_pre_cutoff', v_backlog, 'new_stalls', v_stalls, 'total', v_total))
  returning id into v_log;

  -- Other staff owners: their own counts in the app they work in. Owners come from
  -- the queue plus every active VA seat, so an active seat hears '0' rather than silence.
  for r in
    select o.uid from (
      select distinct q.owner_user_id as uid from public.v_recruit_sla_queue q where q.owner_user_id <> v_sam
      union
      select ur.user_id from public.user_roles ur
       where ur.role in ('va', 'va_manager') and public.fn_recruit_user_is_active(ur.user_id)
    ) o where o.uid is not null and o.uid <> v_sam
  loop
    select coalesce(jsonb_object_agg(sla_state, n), '{}'::jsonb) into v_counts
      from (select sla_state, count(*) n from public.v_recruit_sla_queue where owner_user_id = r.uid group by 1) x;
    v_nid := public.fn_emit_inbox_notification(r.uid, 'recruit_sla_digest',
               'Your recruit queue today',
               'New, untouched: ' || coalesce((v_counts ->> 'NEW_UNTOUCHED')::int, 0)
               || ' · Call, no outcome: ' || coalesce((v_counts ->> 'CALL_NO_OUTCOME')::int, 0)
               || ' · Callback: ' || coalesce((v_counts ->> 'CALLBACK')::int, 0)
               || ' · Follow-up: ' || coalesce((v_counts ->> 'FOLLOWUP_DUE')::int, 0),
               '/dashboard/recruiting', 'normal', v_counts);
    insert into public.recruit_sla_push_log (kind, owner_user_id, channel, notification_id, counts, settled_at, settle_note)
    values ('digest', r.uid, 'inbox', v_nid, v_counts, now(), case when v_nid is null then 'inbox_emit_returned_null' else 'stored' end);
    v_sent_inbox := v_sent_inbox + 1;
  end loop;

  return jsonb_build_object('digest_log_id', v_log, 'total', v_total, 'backlog_pre_cutoff', v_backlog,
                            'new_stalls', v_stalls, 'inbox_digests', v_sent_inbox, 'at', now());
end $$;

revoke execute on function public.fn_recruit_sla_pager() from public, anon, authenticated;
revoke execute on function public.fn_recruit_sla_pager_settle() from public, anon, authenticated;
revoke execute on function public.fn_recruit_sla_digest() from public, anon, authenticated;
grant execute on function public.fn_recruit_sla_pager() to service_role;
grant execute on function public.fn_recruit_sla_pager_settle() to service_role;
grant execute on function public.fn_recruit_sla_digest() to service_role;

-- ── 19. crons ────────────────────────────────────────────────────────────────────
-- Pager: every 15 min, 08:00-18:45 Phoenix (UTC-7, no DST) = 15:00-01:45 UTC.
select cron.schedule('apex-recruit-sla-pager', '*/15 15-23,0-1 * * *', 'select public.fn_recruit_sla_pager()');
select cron.schedule('apex-recruit-sla-settle', '*/5 * * * *', 'select public.fn_recruit_sla_pager_settle()');
select cron.schedule('apex-interview-outcome-settle', '2-59/5 * * * *', 'select public.fn_interview_outcome_ask_settle()');
-- The firehose job keeps its name and 07:00 Phoenix slot; it now sends the digest.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'apex_notif_manager_followup_daily') then
    perform cron.alter_job((select jobid from cron.job where jobname = 'apex_notif_manager_followup_daily'),
                           command := 'SELECT public.fn_recruit_sla_digest();');
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- PREIMAGES (live definitions read 2026-11-10 before WP3 applied). Comments only.
-- ════════════════════════════════════════════════════════════════════════════
-- ===== PREIMAGE function auto_nipr_verify_on_apply (acl: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.auto_nipr_verify_on_apply()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
-- AS $function$
-- DECLARE
--   service_url TEXT;
--   service_key TEXT;
-- BEGIN
--   -- Only attempt verification for a self-reported licensed applicant who gave an NPN.
--   IF NEW.license_status = 'licensed' AND NEW.nipr_number IS NOT NULL AND btrim(NEW.nipr_number) <> '' THEN
--     service_url := current_setting('app.settings.supabase_url', true);
--     service_key := current_setting('app.settings.service_role_key', true);
--     IF service_url IS NOT NULL AND service_key IS NOT NULL AND service_url <> '' THEN
--       -- verify-nipr expects camelCase {niprNumber, applicationId, firstName, lastName, state}
--       -- (the old call sent application_id/nipr_number and omitted state, so it 400'd and
--       --  verification never ran). Pass the shape the function validates.
--       PERFORM net.http_post(
--         url := service_url || '/functions/v1/verify-nipr',
--         headers := jsonb_build_object(
--           'Content-Type','application/json',
--           'Authorization', 'Bearer ' || service_key
--         ),
--         body := jsonb_build_object(
--           'applicationId', NEW.id,
--           'niprNumber', NEW.nipr_number,
--           'firstName', COALESCE(NEW.first_name,''),
--           'lastName', COALESCE(NEW.last_name,''),
--           'state', COALESCE(NEW.state,'')
--         )
--       );
--     END IF;
--   END IF;
--   RETURN NEW;
-- END;
-- $function$
-- ===== PREIMAGE function cc_dispose_interview (acl: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.cc_dispose_interview(p_id uuid, p_outcome text, p_notes text DEFAULT NULL::text, p_followup_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
--  RETURNS interview_events
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_row public.interview_events;
-- begin
--   update public.interview_events
--      set outcome         = p_outcome,
--          outcome_at      = now(),
--          outcome_by      = auth.uid(),
--          notes           = coalesce(p_notes, notes),
--          followup_due_at = coalesce(p_followup_due_at, followup_due_at),
--          contacted_at    = case when p_outcome = 'callback' then now() else contacted_at end
--    where id = p_id
--    returning * into v_row;
-- 
--   if v_row.id is null then
--     raise exception 'interview_events row % not found', p_id;
--   end if;
-- 
--   -- Keep the application status in step when we have a linked application.
--   -- NOTE: application_status has no 'hired' value — the real enum is
--   -- new/reviewing/interview/contracting/approved/rejected/no_pickup/lead/
--   -- registered/attended/attended_no_show/paid/onboarding/producing/lapsed/
--   -- disqualified/quick_qualified. Map onto the values that actually exist
--   -- rather than inventing one and throwing at runtime.
--   if v_row.application_id is not null then
--     update public.applications
--        set last_contacted_at = now(),
--            status = case
--                       when p_outcome in ('hired','contracted') then 'contracting'::application_status
--                       when p_outcome = 'completed'             then 'interview'::application_status
--                       when p_outcome = 'no_show'               then 'attended_no_show'::application_status
--                       when p_outcome = 'no_answer'             then 'no_pickup'::application_status
--                       when p_outcome in ('not_interested','not_a_fit') then 'rejected'::application_status
--                       else status
--                     end
--      where id = v_row.application_id;
--   end if;
-- 
--   return v_row;
-- end $function$
-- ===== PREIMAGE function check_speed_to_lead (acl: postgres=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.check_speed_to_lead()
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'extensions', 'net'
-- AS $function$
-- DECLARE v_webhook text; v_body jsonb; v_list text; v_count int;
-- BEGIN
--   PERFORM set_config('statement_timeout','0', true);
--   SELECT value INTO v_webhook FROM public.system_settings WHERE key='discord_webhook_url';
--   IF v_webhook IS NULL THEN RETURN jsonb_build_object('no_webhook',true); END IF;
--   SELECT string_agg('• ' || first_name || ' ' || last_name || ' — ' ||
--       (EXTRACT(EPOCH FROM (now() - created_at))/60)::int::text || 'm', E'\n' ORDER BY created_at),
--       COUNT(*)::int INTO v_list, v_count
--   FROM public.applications
--   WHERE status = 'new' AND created_at < now() - interval '30 minutes'
--     AND created_at > now() - interval '4 hours';
--   IF v_count IS NULL OR v_count = 0 THEN RETURN jsonb_build_object('clean',true); END IF;
--   v_body := jsonb_build_object('username','APEX Speed-to-Lead',
--     'content', format(E'⏱️ **%s app%s uncalled for >30 min** — speed-to-lead drops 2× after an hour\n\n%s',
--       v_count, CASE WHEN v_count = 1 THEN '' ELSE 's' END, v_list));
--   PERFORM net.http_post(url := v_webhook,
--     headers := jsonb_build_object('Content-Type','application/json'),
--     body := v_body, timeout_milliseconds := 10000);
--   RETURN jsonb_build_object('pinged', v_count);
-- END $function$
-- ===== PREIMAGE function fn_contact_log_stamp_application (acl: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_contact_log_stamp_application()
--  RETURNS trigger
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- begin
--   update public.applications
--      set last_contacted_at = greatest(coalesce(last_contacted_at, new.logged_at), new.logged_at),
--          contacted_at      = coalesce(contacted_at, new.logged_at)
--    where id = new.application_id;
--   return new;
-- exception when others then
--   -- Do not block the contact log write during a live call session, but do NOT swallow
--   -- silently either — a silent failure here is the exact class of bug this fixes.
--   raise warning 'fn_contact_log_stamp_application failed for application_id=%: %',
--     new.application_id, sqlerrm;
--   return new;
-- end;
-- $function$
-- ===== PREIMAGE function fn_interview_outcome_ask (acl: postgres=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_interview_outcome_ask()
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   r record;
--   v_tok text;
--   v_base text := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/interview-outcome';
--   v_asked integer := 0;
--   v_failed integer := 0;
--   v_body text;
--   v_req bigint;
--   v_id bigint;
--   k text;
-- begin
--   select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'apex_bot_token' limit 1;
--   if v_tok is null then return jsonb_build_object('error', 'no bot token'); end if;
--   for r in
--     select e.id, e.invitee_name, e.invitee_phone, e.event_type_name, e.scheduled_at
--       from public.interview_events e
--      where e.canceled_at is null and e.outcome is null
--        and e.scheduled_at < now() - interval '20 minutes'
--        and e.scheduled_at > now() - interval '36 hours'
--        and (e.raw_payload->>'outcome_asked_at') is null
--      order by e.scheduled_at
--      limit 8
--   loop
--     v_body := format('%s · %s · %s%s',
--       coalesce(r.invitee_name, 'Someone'),
--       to_char(r.scheduled_at at time zone 'America/Phoenix', 'Dy HH12:MI AM'),
--       coalesce(r.event_type_name, 'call'),
--       case when r.invitee_phone is not null then ' · ' || r.invitee_phone else '' end);
--     v_body := v_body || E'\n\n';
--     foreach k in array array['completed', 'no_show', 'hired', 'no_answer'] loop
--       v_body := v_body || format('%s: %s?id=%s&o=%s&k=%s' || E'\n',
--         case k when 'completed' then 'Showed' when 'no_show' then 'No-show' when 'hired' then 'Hired' else 'No answer' end,
--         v_base, r.id, k, encode(extensions.hmac(convert_to(r.id::text || ':' || k, 'UTF8'), convert_to(v_tok, 'UTF8'), 'sha256'), 'hex'));
--     end loop;
--     begin
--       select public.fn_ntfy_relay('Did ' || coalesce(split_part(r.invitee_name, ' ', 1), 'they') || ' show?', v_body, '4', 'phone') into v_req;
--       perform pg_sleep(1.2);
--       select public.fn_ntfy_relay_result(v_req) into v_id;
--       if v_id is not null then
--         update public.interview_events set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('outcome_asked_at', now(), 'outcome_ask_ntfy_id', v_id) where id = r.id;
--         v_asked := v_asked + 1;
--       else
--         v_failed := v_failed + 1;
--       end if;
--     exception when others then
--       v_failed := v_failed + 1;
--     end;
--   end loop;
--   return jsonb_build_object('asked', v_asked, 'failed', v_failed, 'at', now());
-- end $function$
-- ===== PREIMAGE function fn_next_step_nudge_sweep (acl: postgres=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_next_step_nudge_sweep()
--  RETURNS TABLE(queued integer)
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_queued int := 0;
--   r record;
--   v_days int;
--   v_key text;
--   v_dedupe text;
--   v_ins int;
-- begin
--   for r in
--     select np.application_id, np.agent_id, np.current_stage_key, np.entered_at, np.nudge_count, np.last_nudged_at,
--            s.reminder_cadence, public.fn_next_step_send_zones(np.application_id, np.agent_id) as zones
--     from public.next_step_progress np
--     join public.next_step_stages s on s.stage_key = np.current_stage_key
--     where np.status = 'active' and s.reminder_cadence is not null
--   loop
--     -- NULL outside 08:00-21:00 in the recipient's zone(s); a held hour step stays due
--     -- until it has had 3h of allowed time (20261016210500)
--     v_key := public.fn_next_step_cadence_due_local(r.reminder_cadence, r.entered_at, now(), r.zones);
--     continue when v_key is null;
--     -- day steps keep the 20h throttle. Hour steps take 6h: the tightest live gap is
--     -- hour:1,12 (11h, nudge at most 2h late in its window), so 6h never holds a real
--     -- step, and it stops a row the old sweep nudged as day1 this hour from getting
--     -- hour24 again on the first tick after this migration
--     continue when r.last_nudged_at is not null and r.last_nudged_at >= now() -
--       case when v_key like 'day%' then interval '20 hours' else interval '6 hours' end;
--     v_days := floor(extract(epoch from (now() - r.entered_at))/86400.0)::int;
--     v_dedupe := coalesce(r.application_id::text, r.agent_id::text) || ':' || r.current_stage_key || ':' || v_key;
--     insert into public.next_step_messages
--       (application_id, agent_id, stage_key, channel, template_key, dedupe_key, metadata)
--     values
--       (r.application_id, r.agent_id, r.current_stage_key, 'telegram',
--        r.current_stage_key || ':' || v_key, v_dedupe,
--        jsonb_build_object('day', v_days, 'step', v_key, 'cadence', r.reminder_cadence,
--                           'send_zones', coalesce(to_jsonb(r.zones), '"unknown: ET+PT"'::jsonb)))
--     on conflict (dedupe_key) where dedupe_key is not null do nothing;
--     get diagnostics v_ins = row_count;
--     continue when v_ins = 0;
--     update public.next_step_progress
--       set last_nudged_at = now(), nudge_count = nudge_count + 1
--       where (application_id = r.application_id and r.application_id is not null)
--          or (agent_id = r.agent_id and r.agent_id is not null);
--     v_queued := v_queued + 1;
--   end loop;
--   return query select v_queued;
-- end;
-- $function$
-- ===== PREIMAGE function fn_queue_high_value_applicant_alert (acl: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_queue_high_value_applicant_alert()
--  RETURNS trigger
--  LANGUAGE plpgsql
-- AS $function$
-- BEGIN
--   IF NEW.qualified_role ILIKE '%agency%'
--      OR NEW.qualified_role ILIKE '%manager%'
--      OR COALESCE(NEW.previous_team_size, 0) > 5 THEN
--     INSERT INTO public.poke_queue (kind, payload)
--     VALUES (
--       'high_value_applicant',
--       jsonb_build_object(
--         'application_id', NEW.id,
--         'name', TRIM(CONCAT(NEW.first_name, ' ', NEW.last_name)),
--         'qualified_role', NEW.qualified_role,
--         'previous_team_size', NEW.previous_team_size,
--         'state', NEW.state,
--         'phone', NEW.phone
--       )
--     );
--   END IF;
--   RETURN NEW;
-- END;
-- $function$
-- ===== PREIMAGE function fn_recover_stale_applicant (acl: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_recover_stale_applicant(p_application_id uuid, p_action text, p_new_agent_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_allowed boolean := coalesce(public.has_role(auth.uid(), 'admin'::app_role), false)
--                     or coalesce(public.has_role(auth.uid(), 'manager'::app_role), false);
-- begin
--   if not v_allowed then
--     return jsonb_build_object('ok', false, 'error', 'Admins and managers only');
--   end if;
--   if p_action not in ('mark_contacted', 'ghost', 'dismiss') then
--     return jsonb_build_object('ok', false, 'error', 'Unknown action: ' || coalesce(p_action, 'null'));
--   end if;
--   if not exists (select 1 from public.applications where id = p_application_id) then
--     return jsonb_build_object('ok', false, 'error', 'Application not found');
--   end if;
-- 
--   if p_action = 'mark_contacted' then
--     update public.applications
--        set contacted_at = coalesce(contacted_at, now()),
--            last_contacted_at = now(),
--            assigned_agent_id = coalesce(p_new_agent_id, assigned_agent_id)
--      where id = p_application_id;
--   elsif p_action = 'ghost' then
--     update public.applications
--        set contacted_at = coalesce(contacted_at, now()),
--            last_contacted_at = now(),
--            status = 'no_pickup'
--      where id = p_application_id;
--   else
--     update public.applications
--        set contacted_at = coalesce(contacted_at, now())
--      where id = p_application_id;
--   end if;
-- 
--   begin
--     insert into public.application_contact_log (application_id, channel, outcome, notes, logged_by)
--     values (p_application_id, 'manual', p_action, p_note, auth.uid());
--   exception when others then
--     -- The applicant update above stands; the missing timeline entry is reported, not hidden.
--     raise warning 'fn_recover_stale_applicant: contact log insert failed for %: %', p_application_id, sqlerrm;
--     return jsonb_build_object('ok', true, 'action', p_action, 'logged', false, 'log_error', sqlerrm);
--   end;
-- 
--   return jsonb_build_object('ok', true, 'action', p_action, 'logged', true);
-- end;
-- $function$
-- ===== PREIMAGE function fn_run_applicant_nudges (acl: postgres=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_run_applicant_nudges()
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   rec record;
--   v_token text;
--   v_pipeline_chat bigint;
--   v_count_24h int := 0;
--   v_count_72h int := 0;
--   v_msg text;
--   v_name text;
--   v_subject text;
--   v_html text;
-- BEGIN
--   SELECT TRIM('"' FROM value::text) INTO v_token FROM system_settings WHERE key='telegram_bot_token';
--   SELECT chat_id INTO v_pipeline_chat FROM telegram_groups
--     WHERE type IN ('pipeline','onboarding') AND is_active=true AND chat_id <> 0 LIMIT 1;
-- 
--   -- 24h nudge (unchanged email/DM logic — PII goes to the applicant themselves, fine)
--   FOR rec IN
--     SELECT id, first_name, email, phone, license_status, telegram_chat_id
--     FROM applications
--     WHERE created_at < NOW() - INTERVAL '24 hours'
--       AND created_at >= NOW() - INTERVAL '48 hours'
--       AND course_purchased_at IS NULL
--       AND license_approved_at IS NULL
--       AND COALESCE(license_status, 'unlicensed') <> 'licensed'
--       AND followup_sent_at IS NULL
--       AND email IS NOT NULL
--       AND (next_step_stage_key IS NULL OR next_step_stage_key NOT IN ('closed_lost','passed_exam','finished_prelicense'))
--     LIMIT 25
--   LOOP
--     v_name := COALESCE(rec.first_name, 'there');
--     IF rec.telegram_chat_id IS NOT NULL AND v_token IS NOT NULL THEN
--       PERFORM net.http_post(
--         url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
--         headers := jsonb_build_object('Content-Type','application/json'),
--         body := jsonb_build_object(
--           'chat_id', rec.telegram_chat_id,
--           'text', 'Day 1 check-in, ' || v_name || E'.\n\n' ||
--                   'You have not started the prelicensing course yet. ' ||
--                   'What is blocking? Reply with one word:' || E'\n\n' ||
--                   '• CARD — payment issue' || E'\n' ||
--                   '• TIME — need a clear daily window' || E'\n' ||
--                   '• UNSURE — questions, senior agent will call' || E'\n\n' ||
--                   '— Sam'
--         )
--       );
--     END IF;
--     v_subject := v_name || ', day 1 check-in';
--     v_html := '<p>' || v_name || ',</p>' ||
--               '<p>You applied yesterday but have not started the prelicensing course yet.</p>' ||
--               '<p>What is blocking? Reply CARD, TIME, or UNSURE.</p>' ||
--               '<p>Or start the course right now: ' ||
--               '<a href="https://apex-financial.org/get-licensed?email=' || rec.email || '">apex-financial.org/get-licensed</a></p>' ||
--               '<p>— Sam<br/>Apex Financial</p>';
--     PERFORM net.http_post(
--       url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-email',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
--       body := jsonb_build_object('to', rec.email, 'subject', v_subject, 'html', v_html)
--     );
--     UPDATE applications SET followup_sent_at = NOW(), updated_at = NOW() WHERE id = rec.id;
--     v_count_24h := v_count_24h + 1;
--   END LOOP;
-- 
--   -- 72h escalation - PII-light pipeline broadcast (no phone, no email)
--   FOR rec IN
--     SELECT id, first_name, last_name, email, state, license_status, telegram_chat_id
--     FROM applications
--     WHERE created_at < NOW() - INTERVAL '72 hours'
--       AND created_at >= NOW() - INTERVAL '7 days'
--       AND course_purchased_at IS NULL
--       AND license_approved_at IS NULL
--       AND COALESCE(license_status, 'unlicensed') <> 'licensed'
--       AND manual_followup_sent_at IS NULL
--       AND email IS NOT NULL
--     LIMIT 25
--   LOOP
--     v_name := COALESCE(rec.first_name, 'there');
--     IF rec.telegram_chat_id IS NOT NULL AND v_token IS NOT NULL THEN
--       PERFORM net.http_post(
--         url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
--         headers := jsonb_build_object('Content-Type','application/json'),
--         body := jsonb_build_object(
--           'chat_id', rec.telegram_chat_id,
--           'text', 'Last automated check-in, ' || v_name || E'.\n\nYour manager calls personally within 24 hours.\n\n— Sam'
--         )
--       );
--     END IF;
--     v_subject := v_name || ', last automated check-in';
--     v_html := '<p>' || v_name || ',</p><p>You applied 3 days ago. Your manager will call personally within 24 hours.</p><p>Or move now: <a href="https://apex-financial.org/get-licensed?email=' || rec.email || '">apex-financial.org/get-licensed</a></p><p>— Sam</p>';
--     PERFORM net.http_post(
--       url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-email',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)),
--       body := jsonb_build_object('to', rec.email, 'subject', v_subject, 'html', v_html)
--     );
--     -- PII-light pipeline broadcast
--     IF v_pipeline_chat IS NOT NULL AND v_token IS NOT NULL THEN
--       v_msg := '⏰ <b>72h ESCALATION</b>' || E'\n\n' ||
--                '<b>' || v_name || ' ' || COALESCE(rec.last_name, '') || '</b>' || E'\n' ||
--                '📍 ' || COALESCE(rec.state, '?') || E'\n\n' ||
--                'Applied 72h ago. Prelicensing not started.' || E'\n' ||
--                '🔗 <a href="https://apex-financial.org/dashboard/applicants?lead=' || rec.id::text || '">Open file</a> for contact.';
--       PERFORM public.fn_broadcast_to_telegram_chat('pipeline', v_msg);
--     END IF;
--     UPDATE applications SET
--       manual_followup_sent_at = NOW(),
--       next_action = 'MANAGER_CALL_72H_ESCALATION',
--       next_action_at = NOW(),
--       next_action_due_at = NOW() + INTERVAL '24 hours',
--       updated_at = NOW()
--     WHERE id = rec.id;
--     v_count_72h := v_count_72h + 1;
--   END LOOP;
-- 
--   RETURN jsonb_build_object('ran_at', NOW(), 'nudges_24h', v_count_24h, 'escalations_72h', v_count_72h);
-- END;
-- $function$
-- ===== PREIMAGE function fn_sweep_interview_reminders (acl: postgres=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_sweep_interview_reminders()
--  RETURNS TABLE(upcoming_emitted integer, missed_emitted integer)
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE r record; up int := 0; ms int := 0; v_user_id uuid; v_app_name text; v_zone text; v_nid uuid;
-- BEGIN
--   -- Upcoming T-30 (window: 28-32 min ahead), one-shot guarded by NOT EXISTS notif of same type+interview_id
--   FOR r IN
--     SELECT si.id, si.application_id, si.scheduled_by, si.interview_date
--       FROM public.scheduled_interviews si
--      WHERE si.status = 'scheduled'
--        AND si.interview_date BETWEEN now() + interval '28 minutes' AND now() + interval '32 minutes'
--        AND si.scheduled_by IS NOT NULL
--        AND NOT EXISTS (
--          SELECT 1 FROM public.notifications n
--           WHERE n.user_id = si.scheduled_by
--             AND n.type = 'interview_upcoming_t30'
--             AND (n.metadata->>'interview_id')::uuid = si.id
--        )
--   LOOP
--     SELECT COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')
--       INTO v_app_name FROM public.applications WHERE id = r.application_id;
--     PERFORM public.fn_emit_inbox_notification(
--       r.scheduled_by, 'interview_upcoming_t30',
--       'Interview in 30 min: ' || COALESCE(trim(v_app_name),'applicant'),
--       to_char(r.interview_date AT TIME ZONE 'America/Phoenix','Mon DD, HH12:MI AM TZ'),
--       '/dashboard/applicants/' || r.application_id::text, 'high',
--       jsonb_build_object('application_id', r.application_id, 'interview_id', r.id)
--     );
--     up := up + 1;
--   END LOOP;
-- 
--   -- Missed: interview_date < now() - 15 min AND status='scheduled'
--   FOR r IN
--     SELECT si.id, si.application_id, si.scheduled_by, si.interview_date
--       FROM public.scheduled_interviews si
--      WHERE si.status = 'scheduled'
--        AND si.interview_date < now() - interval '15 minutes'
--        AND si.scheduled_by IS NOT NULL
--        AND NOT EXISTS (
--          SELECT 1 FROM public.notifications n
--           WHERE n.user_id = si.scheduled_by
--             AND n.type = 'interview_missed'
--             AND (n.metadata->>'interview_id')::uuid = si.id
--        )
--   LOOP
--     SELECT COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')
--       INTO v_app_name FROM public.applications WHERE id = r.application_id;
--     PERFORM public.fn_emit_inbox_notification(
--       r.scheduled_by, 'interview_missed',
--       'Missed interview: ' || COALESCE(trim(v_app_name),'applicant'),
--       'Reschedule now to recover the applicant.',
--       '/dashboard/applicants/' || r.application_id::text, 'high',
--       jsonb_build_object('application_id', r.application_id, 'interview_id', r.id)
--     );
--     ms := ms + 1;
--   END LOOP;
-- 
--   -- APEX OS §7: staff-booked interview_events. OFF unless
--   -- system_settings.calendar_interview_reminders_enabled = 'true'. Computed from
--   -- scheduled_at at sweep time; reminder_notification_id (the inbox row the
--   -- emitter actually returned) is the one-shot guard and the receipt, and
--   -- reschedule_interview_event clears it so the reminder follows the new time.
--   -- A failed emit returns NULL and leaves the row unstamped for the next tick.
--   -- Calendly-owned rows are skipped: Calendly sends its own reminders.
--   IF public.calendar_interview_reminders_enabled() THEN
--     FOR r IN
--       SELECT ie.id, ie.application_id, ie.owner_user_id, ie.scheduled_at, ie.event_tz,
--              COALESCE(NULLIF(btrim(ie.invitee_name), ''), ie.invitee_email, 'your interview') AS who
--         FROM public.interview_events ie
--        WHERE ie.canceled_at IS NULL
--          AND ie.outcome IS NULL
--          AND ie.source <> 'calendly'
--          AND ie.owner_user_id IS NOT NULL
--          AND ie.reminder_notification_id IS NULL
--          AND ie.scheduled_at BETWEEN now() + interval '28 minutes' AND now() + interval '32 minutes'
--        FOR UPDATE SKIP LOCKED
--     LOOP
--       v_zone := COALESCE(r.event_tz, 'America/Phoenix');
--       v_nid := public.fn_emit_inbox_notification(
--         r.owner_user_id, 'interview_upcoming_t30',
--         'Interview in 30 min: ' || r.who,
--         to_char(r.scheduled_at AT TIME ZONE v_zone, 'Mon DD, HH12:MI AM') || ' ' || v_zone,
--         '/dashboard/calendar', 'high',
--         jsonb_build_object('interview_event_id', r.id, 'application_id', r.application_id,
--                            'scheduled_at', r.scheduled_at)
--       );
--       IF v_nid IS NOT NULL THEN
--         UPDATE public.interview_events SET reminder_notification_id = v_nid WHERE id = r.id;
--         up := up + 1;
--       END IF;
--     END LOOP;
--   END IF;
-- 
--   RETURN QUERY SELECT up, ms;
-- END;
-- $function$
-- ===== PREIMAGE function fn_sweep_manager_followup_reminders (acl: postgres=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.fn_sweep_manager_followup_reminders()
--  RETURNS integer
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE r record; emitted int := 0; v_user_id uuid;
-- BEGIN
--   FOR r IN
--     SELECT app.id, app.first_name, app.last_name, app.last_contacted_at,
--            COALESCE(app.assigned_agent_id, app.recruiter_id) AS owner_agent_id
--       FROM public.applications app
--      WHERE COALESCE(app.last_contacted_at, app.created_at) < now() - interval '72 hours'
--        AND app.terminated_at IS NULL
--        AND COALESCE(app.assigned_agent_id, app.recruiter_id) IS NOT NULL
--        AND NOT EXISTS (
--          SELECT 1 FROM public.notifications n
--           WHERE n.type = 'manager_followup_reminder'
--             AND (n.metadata->>'application_id')::uuid = app.id
--             AND n.created_at > now() - interval '24 hours'
--        )
--      LIMIT 200
--   LOOP
--     SELECT a.user_id INTO v_user_id FROM public.agents a WHERE a.id = r.owner_agent_id;
--     IF v_user_id IS NOT NULL THEN
--       PERFORM public.fn_emit_inbox_notification(
--         v_user_id, 'manager_followup_reminder',
--         'Follow up: ' || trim(COALESCE(r.first_name,'') || ' ' || COALESCE(r.last_name,'')),
--         'No contact in 72h. Reach out today.',
--         '/dashboard/applicants/' || r.id::text, 'normal',
--         jsonb_build_object('application_id', r.id)
--       );
--       emitted := emitted + 1;
--     END IF;
--   END LOOP;
--   RETURN emitted;
-- END;
-- $function$
-- ===== PREIMAGE function rp_pipeline_action (acl: =X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.rp_pipeline_action(p_person_key text, p_action text, p_value text DEFAULT NULL::text)
--  RETURNS text
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare v_kind text := split_part(p_person_key,':',1);
--   v_id uuid := nullif(split_part(p_person_key,':',2),'')::uuid; v_stage text;
-- begin
--   if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager')
--           or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'recruiter')) then
--     raise exception 'not authorized'; end if;
--   if v_id is null then raise exception 'bad person_key'; end if;
--   if v_kind='app' then
--     if p_action='monday' then update applications set monday_status=nullif(p_value,'clear'), updated_at=now() where id=v_id;
--     elsif p_action='stage' then update applications set pipeline_stage_override=nullif(p_value,'clear'), updated_at=now() where id=v_id;
--     elsif p_action='intent' then update applications set intent_level=nullif(p_value,'clear'), updated_at=now() where id=v_id;
--     elsif p_action='followup' then update applications set next_action_due_at=nullif(p_value,'')::timestamptz, updated_at=now() where id=v_id;
--     elsif p_action='contacted' then update applications set last_contacted_at=now(), contacted_at=coalesce(contacted_at,now()), updated_at=now() where id=v_id;
--     elsif p_action='note' and coalesce(p_value,'')<>'' then update applications set notes=trim(coalesce(notes||E'\n','')||to_char(now(),'MM/DD')||': '||p_value), updated_at=now() where id=v_id;
--     else raise exception 'unknown action %', p_action; end if;
--   elsif v_kind='agent' then
--     if p_action='stage' then update agents set pipeline_stage_override=nullif(p_value,'clear'), updated_at=now() where id=v_id;
--     elsif p_action='intent' then update agents set intent_level=nullif(p_value,'clear'), updated_at=now() where id=v_id;
--     elsif p_action='followup' then update agents set next_action_due_at=nullif(p_value,'')::timestamptz, updated_at=now() where id=v_id;
--     elsif p_action='note' and coalesce(p_value,'')<>'' then update agents set notes=trim(coalesce(notes||E'\n','')||to_char(now(),'MM/DD')||': '||p_value), updated_at=now() where id=v_id;
--     elsif p_action='monday' then null;
--     else raise exception 'unknown action %', p_action; end if;
--   else raise exception 'bad kind %', v_kind; end if;
--   select stage into v_stage from v_recruiting_pipeline where person_key=p_person_key;
--   return v_stage;
-- end $function$
-- ===== PREIMAGE function run_automation_job (acl: postgres=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.run_automation_job(p_job_name text, p_function_name text, p_body jsonb DEFAULT '{}'::jsonb)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_log_id uuid;
--   v_url text;
--   v_key text;
--   v_start timestamptz;
--   v_base_url text;
-- BEGIN
--   v_start := clock_timestamp();
-- 
--   INSERT INTO public.automation_run_log (job_name, status)
--   VALUES (p_job_name, 'running')
--   RETURNING id INTO v_log_id;
-- 
--   v_base_url := current_setting('app.settings.supabase_url', true);
--   IF v_base_url IS NULL OR v_base_url = '' THEN
--     SELECT value INTO v_base_url FROM public.system_settings WHERE key = 'supabase_url';
--   END IF;
--   IF v_base_url IS NULL OR v_base_url = '' THEN
--     v_base_url := 'https://xrzweoneiieddzxogewk.supabase.co';
--   END IF;
-- 
--   v_url := v_base_url || '/functions/v1/' || p_function_name;
-- 
--   v_key := current_setting('app.settings.service_role_key', true);
--   IF v_key IS NULL OR v_key = '' THEN
--     SELECT value INTO v_key FROM public.system_settings WHERE key = 'service_role_key';
--   END IF;
--   IF v_key IS NULL OR v_key = '' THEN
--     SELECT value INTO v_key FROM public.system_settings WHERE key = 'supabase_anon_key';
--   END IF;
-- 
--   IF v_key IS NULL OR v_key = '' THEN
--     UPDATE public.automation_run_log
--     SET status = 'error', error = 'No auth key available',
--         completed_at = now(),
--         duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
--     WHERE id = v_log_id;
--     RETURN v_log_id;
--   END IF;
-- 
--   PERFORM net.http_post(
--     url := v_url,
--     body := p_body,
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || v_key,
--       'apikey', v_key,
--       'x-automation-job', p_job_name,
--       'x-automation-log-id', v_log_id::text
--     ),
--     timeout_milliseconds := 30000
--   );
-- 
--   UPDATE public.automation_run_log
--   SET status = 'success', completed_at = now(),
--       duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
--   WHERE id = v_log_id;
-- 
--   RETURN v_log_id;
-- EXCEPTION WHEN others THEN
--   UPDATE public.automation_run_log
--   SET status = 'error', error = SQLERRM, completed_at = now(),
--       duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
--   WHERE id = v_log_id;
--   RETURN v_log_id;
-- END;
-- $function$
-- ===== PREIMAGE function set_recruit_stage (acl: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.set_recruit_stage(p_application_id uuid, p_agent_id uuid, p_to_stage text, p_reason text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- declare
--   v_uid uuid := auth.uid(); v_now timestamptz := now();
--   v_to int; v_cur text; v_cur_rank int; v_final text; v_floor int := public.fn_next_step_rank('hired_unlicensed'); v_hired int := public.fn_next_step_rank('hired'); v_lic text;
-- begin
--   if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
--   if (p_application_id is null) = (p_agent_id is null) then raise exception 'pass exactly one of application or agent'; end if;
--   if not exists (select 1 from public.next_step_stages where stage_key = p_to_stage) then raise exception 'unknown stage %', p_to_stage; end if;
--   if exists (select 1 from public.next_step_stages where stage_key = p_to_stage and retired_at is not null) then raise exception 'stage % is retired', p_to_stage; end if;
--   if not public.fn_recruit_scope_ok(p_application_id, p_agent_id) then raise exception 'not allowed to edit this person' using errcode='42501'; end if;
-- 
--   v_to := public.fn_next_step_rank(p_to_stage);
--   if p_application_id is not null and v_to >= v_floor and p_to_stage <> 'closed_lost' then
--     return jsonb_build_object('ok', false, 'reason', 'not_an_agent',
--       'message', 'They are not an agent yet. Hire them (Add Agent) and the later stages open up.');
--   end if;
--   if p_agent_id is not null and v_to < v_floor then
--     return jsonb_build_object('ok', false, 'reason', 'agent_before_hired',
--       'message', 'They are already hired, so the applicant stages do not apply. Their licensing shows on the row.');
--   end if;
--   if p_agent_id is not null and v_to >= v_hired then
--     select license_status::text into v_lic from public.agents where id = p_agent_id;
--     if coalesce(v_lic,'') <> 'licensed' then
--       return jsonb_build_object('ok', false, 'reason', 'not_licensed',
--         'message', 'They are not licensed yet, so Hired and later stages do not apply. Set their license on the row first.');
--     end if;
--   end if;
--   if p_agent_id is not null and p_to_stage = 'closed_lost' then
--     return jsonb_build_object('ok', false, 'reason', 'use_no_longer_with_us',
--       'message', 'For an agent, use "No longer with us" so they are removed properly and get the re-engagement email.');
--   end if;
-- 
--   select current_stage_key into v_cur from public.next_step_progress
--    where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null) limit 1;
--   v_cur_rank := public.fn_next_step_rank(coalesce(v_cur,'applied'));
-- 
--   if p_application_id is not null then
--     update public.applications set
--       updated_at = v_now,
--       -- forward evidence: stamp only what the target implies
--       vsl_watched_at         = case when v_to >= 2  then coalesce(vsl_watched_at, v_now) else null end,
--       last_contacted_at      = case when v_to >= 4  then coalesce(last_contacted_at, v_now) else null end,
--       contacted_at           = case when v_to >= 4  then coalesce(contacted_at, v_now) else null end,
--       course_purchased_at    = case when v_to >= 7  then coalesce(course_purchased_at, v_now) else null end,
--       course_started_at      = case when v_to >= 7  then coalesce(course_started_at, v_now) else null end,
--       license_progress       = case when v_to >= 8 and v_to <= 11 then 'finished_course'::license_progress
--                                     when v_to = 7 then 'course_purchased'::license_progress
--                                     when v_to < 7 then 'unlicensed'::license_progress
--                                     else license_progress end,
--       exam_scheduled_at      = case when v_to >= 9  then coalesce(exam_scheduled_at, v_now) else null end,
--       exam_passed_at         = case when v_to >= 10 then coalesce(exam_passed_at, v_now) else null end,
--       fingerprints_submitted_at = case when v_to >= 10 then fingerprints_submitted_at else null end,
--       fingerprint_done       = case when v_to >= 10 then fingerprint_done else false end,
--       contracted_at          = case when v_to >= 11 then coalesce(contracted_at, v_now) else null end,
--       status                 = case when p_to_stage = 'closed_lost' then 'lapsed'::application_status
--                                     when v_to = 11 then 'contracting'::application_status
--                                     when status in ('lapsed','rejected','disqualified','contracting') then 'new'::application_status
--                                     else status end
--     where id = p_application_id;
--   else
--     update public.agents set
--       updated_at = v_now,
--       has_training_course       = case when v_to >= public.fn_next_step_rank('course_started') then true else false end,
--       onboarding_completed_at   = case when v_to >= public.fn_next_step_rank('course_completed') then coalesce(onboarding_completed_at, v_now) else null end,
--       field_training_started_at = case when v_to >= public.fn_next_step_rank('infield_training') then coalesce(field_training_started_at, v_now) else null end,
--       onboarding_stage          = case when v_to = public.fn_next_step_rank('infield_training') then 'in_field_training'::onboarding_stage
--                                        when v_to < public.fn_next_step_rank('infield_training') and onboarding_stage = 'in_field_training' then 'onboarding'::onboarding_stage
--                                        else onboarding_stage end,
--       first_appointment_at      = case when v_to >= public.fn_next_step_rank('first_appointment') then coalesce(first_appointment_at, v_now) else null end,
--       first_deal_at             = case when v_to >= public.fn_next_step_rank('first_deal') then coalesce(first_deal_at, v_now) else null end,
--       first_10k_at              = case when v_to >= public.fn_next_step_rank('first_10k_week') then coalesce(first_10k_at, v_now) else null end,
--       weekly_10k_badges         = case when v_to >= public.fn_next_step_rank('first_10k_week') then greatest(coalesce(weekly_10k_badges,0),1) else 0 end
--     where id = p_agent_id;
--   end if;
-- 
--   -- Hand-set stage, honoured by recompute until evidence outranks it.
--   update public.next_step_progress
--      set manual_stage_key = p_to_stage, manual_stage_at = v_now, manual_by = v_uid, updated_at = v_now
--    where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null);
--   if not found then
--     insert into public.next_step_progress (person_type, application_id, agent_id, current_stage_key, entered_at, status, manual_stage_key, manual_stage_at, manual_by)
--     values (case when p_application_id is not null then 'applicant' else 'agent' end, p_application_id, p_agent_id, p_to_stage, v_now, 'active', p_to_stage, v_now, v_uid);
--   end if;
-- 
--   perform public.fn_next_step_recompute_one(p_application_id, p_agent_id);
-- 
--   select current_stage_key into v_final from public.next_step_progress
--    where (application_id = p_application_id and p_application_id is not null) or (agent_id = p_agent_id and p_agent_id is not null) limit 1;
-- 
--   insert into public.next_step_events (application_id, agent_id, from_stage, to_stage, event_type, actor_user_id, source, payload)
--   values (p_application_id, p_agent_id, v_cur, v_final, 'manual_override', v_uid, 'manual',
--           jsonb_build_object('requested', p_to_stage, 'reason', nullif(btrim(p_reason),'')));
-- 
--   return jsonb_build_object('ok', true, 'requested', p_to_stage, 'final', v_final, 'matched', v_final = p_to_stage,
--     'message', case when v_final = p_to_stage then null
--                     else 'Evidence on file puts them at ' || coalesce((select display_name from public.next_step_stages where stage_key = v_final), v_final) || ', so they stay there.' end);
-- end;
-- $function$
-- ===== PREIMAGE function unified_mark_contacted (acl: postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres)
-- CREATE OR REPLACE FUNCTION public.unified_mark_contacted(p_id uuid, p_source text, p_by_user_id uuid DEFAULT auth.uid())
--  RETURNS void
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   PERFORM public.fn_require_caller_role(ARRAY['admin','manager','va_manager','va']::public.app_role[]);
--   IF p_source = 'aged_lead' OR p_source = 'aged_leads' THEN
--     UPDATE aged_leads
--       SET last_contacted_at = now(),
--           contacted_at = COALESCE(contacted_at, now())
--       WHERE id = p_id;
--   ELSE
--     UPDATE applications
--       SET last_contacted_at = now(),
--           contacted_at = COALESCE(contacted_at, now())
--       WHERE id = p_id;
--     INSERT INTO application_contact_log (application_id, channel, outcome, notes, logged_by)
--     VALUES (p_id, 'manual', 'marked_contacted', NULL, COALESCE(auth.uid(), p_by_user_id));
--   END IF;
-- END;
-- $function$
-- ===== PREIMAGE view v_interview_outcome_truth (acl: postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres; options: None)
--  SELECT ( SELECT count(*) AS count
--            FROM interview_events
--           WHERE interview_events.canceled_at IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '7 days'::interval)) AS calls_ended_7d,
--     ( SELECT count(*) AS count
--            FROM interview_events
--           WHERE interview_events.canceled_at IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '7 days'::interval) AND interview_events.outcome IS NOT NULL) AS outcomes_7d,
--     ( SELECT count(*) AS count
--            FROM interview_events
--           WHERE interview_events.canceled_at IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '7 days'::interval) AND (interview_events.raw_payload ->> 'outcome_asked_at'::text) IS NOT NULL) AS asked_7d,
--     ( SELECT count(*) AS count
--            FROM interview_events
--           WHERE interview_events.canceled_at IS NULL AND interview_events.outcome IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '36:00:00'::interval) AND (interview_events.raw_payload ->> 'outcome_asked_at'::text) IS NULL) AS unasked_now,
--     ( SELECT round(EXTRACT(epoch FROM now() - min(interview_events.scheduled_at)) / 3600::numeric) AS round
--            FROM interview_events
--           WHERE interview_events.canceled_at IS NULL AND interview_events.outcome IS NULL AND interview_events.scheduled_at < (now() - '00:20:00'::interval) AND interview_events.scheduled_at > (now() - '36:00:00'::interval) AND (interview_events.raw_payload ->> 'outcome_asked_at'::text) IS NULL) AS oldest_unasked_h,
--     ( SELECT max((interview_events.raw_payload ->> 'outcome_asked_at'::text)::timestamp with time zone) AS max
--            FROM interview_events) AS last_ask_at;
-- ===== PREIMAGE view v_recruiting_inbox (acl: postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres; options: None)
--  SELECT application_id,
--     owner_agent_id,
--     owner_name,
--     applicant_name,
--     phone,
--     email,
--     city,
--     state,
--     license_status,
--     applied_at,
--     hours_since_applied,
--     contacted_at,
--     next_action,
--     next_action_at,
--     urgency,
--     referral_source
--    FROM ( SELECT a.id AS application_id,
--             own_map.canonical_agent_id AS owner_agent_id,
--             COALESCE(p_owner.full_name, 'Unassigned'::text) AS owner_name,
--             TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text)) AS applicant_name,
--             a.phone,
--             a.email,
--             a.city,
--             a.state,
--             a.license_status,
--             a.created_at AS applied_at,
--             EXTRACT(epoch FROM now() - a.created_at) / 3600::numeric AS hours_since_applied,
--             a.contacted_at,
--             a.next_action,
--             a.next_action_at,
--                 CASE
--                     WHEN a.contacted_at IS NOT NULL THEN 'contacted'::text
--                     WHEN a.created_at < (now() - '48:00:00'::interval) THEN 'CRITICAL_48H_PLUS'::text
--                     WHEN a.created_at < (now() - '24:00:00'::interval) THEN 'overdue_24h'::text
--                     WHEN a.created_at < (now() - '04:00:00'::interval) THEN 'cooling'::text
--                     ELSE 'fresh'::text
--                 END AS urgency,
--             a.referral_source
--            FROM v_applications_real a
--              LEFT JOIN v_agent_canonical_map own_map ON own_map.agent_id = a.assigned_agent_id
--              LEFT JOIN agents ag_owner ON ag_owner.id = own_map.canonical_agent_id
--              LEFT JOIN profiles p_owner ON p_owner.id = ag_owner.profile_id
--           WHERE a.created_at >= (now() - '30 days'::interval)) _g
--   WHERE is_agency_staff() OR auth.uid() IS NULL;
-- ===== PREIMAGE view v_recruiting_pipeline (acl: postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres; options: {security_barrier=true})
--  SELECT person_key,
--     person_type,
--     id,
--     name,
--     phone,
--     email,
--     instagram,
--     lead_source,
--     recruiter_id,
--     hiring_manager_user_id,
--     assigned_va_id,
--     raw_status,
--     monday_status,
--     pipeline_stage_override,
--     intent_level,
--     expected_start,
--     last_contact,
--     next_follow_up,
--     raw_next_action,
--     notes,
--     license_status,
--     license_progress,
--     contracted_at,
--     created_at,
--     upcoming_interviews,
--     stage,
--     next_action_display
--    FROM ( WITH app_rows AS (
--                  SELECT 'app:'::text || a.id::text AS person_key,
--                     'applicant'::text AS person_type,
--                     a.id,
--                     TRIM(BOTH FROM (COALESCE(a.first_name, ''::text) || ' '::text) || COALESCE(a.last_name, ''::text)) AS name,
--                     a.phone,
--                     a.email,
--                     a.instagram_handle AS instagram,
--                     COALESCE(a.utm_source, a.source, a.referral_source) AS lead_source,
--                     a.recruiter_id,
--                     a.hiring_manager_user_id,
--                     a.assigned_va_id,
--                     a.status::text AS raw_status,
--                     a.monday_status,
--                     a.pipeline_stage_override,
--                     a.intent_level,
--                     a.start_date::text AS expected_start,
--                     COALESCE(a.last_contacted_at, a.contacted_at) AS last_contact,
--                     COALESCE(a.next_action_due_at, a.next_action_at, a.next_touch_by) AS next_follow_up,
--                     COALESCE(a.next_action, a.next_action_type) AS raw_next_action,
--                     a.notes,
--                     a.license_status::text AS license_status,
--                     a.license_progress::text AS license_progress,
--                     a.contracted_at,
--                     a.created_at,
--                     ( SELECT count(*)::integer AS count
--                            FROM interview_events ie
--                           WHERE ie.application_id = a.id AND ie.canceled_at IS NULL AND COALESCE(ie.scheduled_at, now()) >= (now() - '1 day'::interval)) AS upcoming_interviews
--                    FROM applications a
--                   WHERE COALESCE(a.is_duplicate, false) = false AND NOT (EXISTS ( SELECT 1
--                            FROM agents g
--                           WHERE g.source_application_id = a.id))
--                 ), agent_rows AS (
--                  SELECT 'agent:'::text || g.id::text AS person_key,
--                     'agent'::text AS person_type,
--                     g.id,
--                     COALESCE(g.display_name, p.full_name, 'Agent'::text) AS name,
--                     p.phone,
--                     p.email,
--                     NULL::text AS instagram,
--                     NULL::text AS lead_source,
--                     g.manager_id AS recruiter_id,
--                     NULL::uuid AS hiring_manager_user_id,
--                     NULL::uuid AS assigned_va_id,
--                     g.status::text AS raw_status,
--                     g.attendance_status::text AS monday_status,
--                     g.pipeline_stage_override,
--                     g.intent_level,
--                     g.start_date::text AS expected_start,
--                     g.stage_changed_at AS last_contact,
--                     g.next_action_due_at AS next_follow_up,
--                     g.next_action_text AS raw_next_action,
--                     g.notes,
--                     g.license_status::text AS license_status,
--                     g.license_progress::text AS license_progress,
--                     g.contracted_at,
--                     g.created_at,
--                     0 AS upcoming_interviews
--                    FROM agents g
--                      LEFT JOIN profiles p ON p.user_id = g.user_id
--                   WHERE NOT is_placeholder_agent(g.agent_code, g.user_id)
--                 )
--          SELECT r.person_key,
--             r.person_type,
--             r.id,
--             r.name,
--             r.phone,
--             r.email,
--             r.instagram,
--             r.lead_source,
--             r.recruiter_id,
--             r.hiring_manager_user_id,
--             r.assigned_va_id,
--             r.raw_status,
--             r.monday_status,
--             r.pipeline_stage_override,
--             r.intent_level,
--             r.expected_start,
--             r.last_contact,
--             r.next_follow_up,
--             r.raw_next_action,
--             r.notes,
--             r.license_status,
--             r.license_progress,
--             r.contracted_at,
--             r.created_at,
--             r.upcoming_interviews,
--                 CASE
--                     WHEN r.pipeline_stage_override IS NOT NULL AND r.pipeline_stage_override <> ''::text THEN r.pipeline_stage_override
--                     WHEN r.monday_status = 'no_show'::text THEN 'No Show'::text
--                     WHEN r.monday_status = 'showed'::text THEN 'Showed'::text
--                     WHEN r.monday_status = 'confirmed'::text THEN 'Confirmed'::text
--                     WHEN r.monday_status = 'expected'::text THEN 'Expected Monday'::text
--                     WHEN r.person_type = 'agent'::text THEN
--                     CASE
--                         WHEN r.raw_status = ANY (ARRAY['terminated'::text, 'inactive'::text]) THEN 'Inactive/No Longer With Us'::text
--                         WHEN r.raw_status = 'active'::text THEN 'Active Agent'::text
--                         ELSE 'Onboarding'::text
--                     END
--                     ELSE
--                     CASE
--                         WHEN r.raw_status = ANY (ARRAY['rejected'::text, 'disqualified'::text, 'terminated'::text]) THEN 'Inactive/No Longer With Us'::text
--                         WHEN r.raw_status = 'attended_no_show'::text THEN 'No Show'::text
--                         WHEN r.raw_status = 'paid'::text THEN 'Ready for Training'::text
--                         WHEN r.raw_status = 'contracting'::text AND r.contracted_at IS NOT NULL THEN 'Contracting In Progress'::text
--                         WHEN r.raw_status = 'contracting'::text THEN 'Contract Sent'::text
--                         WHEN r.raw_status = 'onboarding'::text THEN 'Onboarding'::text
--                         WHEN r.raw_status = 'interview'::text THEN 'Interested'::text
--                         WHEN r.upcoming_interviews > 0 THEN 'Call Scheduled'::text
--                         WHEN (r.raw_status = ANY (ARRAY['reviewing'::text, 'no_pickup'::text])) OR r.last_contact IS NOT NULL THEN 'Contacted'::text
--                         ELSE 'New Lead'::text
--                     END
--                 END AS stage,
--             COALESCE(NULLIF(r.raw_next_action, ''::text),
--                 CASE
--                     WHEN r.pipeline_stage_override IS NOT NULL THEN 'Update status'::text
--                     WHEN r.monday_status = 'no_show'::text THEN 'Re-engage / reschedule'::text
--                     WHEN r.monday_status = 'showed'::text THEN 'Send onboarding'::text
--                     WHEN r.monday_status = 'confirmed'::text THEN 'Confirm Monday attendance'::text
--                     WHEN r.monday_status = 'expected'::text THEN 'Confirm Monday'::text
--                     WHEN r.raw_status = 'contracting'::text THEN 'Complete contracting'::text
--                     WHEN r.raw_status = 'onboarding'::text THEN 'Send onboarding / start training'::text
--                     WHEN r.raw_status = 'paid'::text THEN 'Start training'::text
--                     WHEN r.person_type = 'agent'::text AND r.raw_status = 'active'::text THEN 'Keep active / check production'::text
--                     WHEN r.person_type = 'applicant'::text AND r.raw_status = 'new'::text THEN 'Call prospect / send application link'::text
--                     ELSE 'Follow up'::text
--                 END) AS next_action_display
--            FROM ( SELECT app_rows.person_key,
--                     app_rows.person_type,
--                     app_rows.id,
--                     app_rows.name,
--                     app_rows.phone,
--                     app_rows.email,
--                     app_rows.instagram,
--                     app_rows.lead_source,
--                     app_rows.recruiter_id,
--                     app_rows.hiring_manager_user_id,
--                     app_rows.assigned_va_id,
--                     app_rows.raw_status,
--                     app_rows.monday_status,
--                     app_rows.pipeline_stage_override,
--                     app_rows.intent_level,
--                     app_rows.expected_start,
--                     app_rows.last_contact,
--                     app_rows.next_follow_up,
--                     app_rows.raw_next_action,
--                     app_rows.notes,
--                     app_rows.license_status,
--                     app_rows.license_progress,
--                     app_rows.contracted_at,
--                     app_rows.created_at,
--                     app_rows.upcoming_interviews
--                    FROM app_rows
--                 UNION ALL
--                  SELECT agent_rows.person_key,
--                     agent_rows.person_type,
--                     agent_rows.id,
--                     agent_rows.name,
--                     agent_rows.phone,
--                     agent_rows.email,
--                     agent_rows.instagram,
--                     agent_rows.lead_source,
--                     agent_rows.recruiter_id,
--                     agent_rows.hiring_manager_user_id,
--                     agent_rows.assigned_va_id,
--                     agent_rows.raw_status,
--                     agent_rows.monday_status,
--                     agent_rows.pipeline_stage_override,
--                     agent_rows.intent_level,
--                     agent_rows.expected_start,
--                     agent_rows.last_contact,
--                     agent_rows.next_follow_up,
--                     agent_rows.raw_next_action,
--                     agent_rows.notes,
--                     agent_rows.license_status,
--                     agent_rows.license_progress,
--                     agent_rows.contracted_at,
--                     agent_rows.created_at,
--                     agent_rows.upcoming_interviews
--                    FROM agent_rows) r) q
--   WHERE (CURRENT_USER <> ALL (ARRAY['anon'::name, 'authenticated'::name])) OR ( SELECT api_is_staff() AS api_is_staff);
-- ===== PREIMAGE view v_va_call_queue (acl: postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres; options: None)
--  SELECT id AS application_id,
--     first_name,
--     last_name,
--     phone,
--     email,
--     state,
--     license_status::text AS license_status,
--     (created_at AT TIME ZONE 'America/Phoenix'::text)::date AS applied_on,
--     EXTRACT(day FROM now() - created_at)::integer AS days_old,
--         CASE
--             WHEN created_at >= (now() - '3 days'::interval) THEN 1
--             WHEN created_at >= (now() - '14 days'::interval) THEN 2
--             ELSE 3
--         END AS priority,
--         CASE
--             WHEN created_at >= (now() - '3 days'::interval) THEN 'HOT — applied within 3 days, never called'::text
--             WHEN created_at >= (now() - '14 days'::interval) THEN 'WARM — 4-14 days old, never called'::text
--             ELSE 'AGED — over 14 days, never called'::text
--         END AS priority_label
--    FROM applications a
--   WHERE terminated_at IS NULL AND phone IS NOT NULL AND phone_bad_at IS NULL AND COALESCE(license_status::text, ''::text) <> 'licensed'::text AND last_contacted_at IS NULL
--   ORDER BY (
--         CASE
--             WHEN created_at >= (now() - '3 days'::interval) THEN 1
--             WHEN created_at >= (now() - '14 days'::interval) THEN 2
--             ELSE 3
--         END), created_at DESC;
-- ===== PREIMAGE cron 23 next_step_stall_sweep schedule='11-59/15 * * * *' active=True
--  select public.fn_next_step_stall_sweep(); 
-- ===== PREIMAGE cron 24 next_step_nudge_sweep schedule='7 * * * *' active=True
--  select public.fn_next_step_nudge_sweep(); 
-- ===== PREIMAGE cron 40 pl081_system_health_autopilot schedule='4-59/5 * * * *' active=True
-- 
--       SELECT net.http_post(
--         url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/system-health-autopilot',
--         headers := jsonb_build_object(
--           'Content-Type','application/json',
--           'Authorization','Bearer ' || current_setting('app.settings.service_role_key', true)
--         ),
--         body := '{}'::jsonb
--       ) AS request_id;
--     
-- ===== PREIMAGE cron 49 apex-applicant-nudges-hourly schedule='23 * * * *' active=True
--  SELECT public.fn_run_applicant_nudges(); 
-- ===== PREIMAGE cron 51 apex_notif_interview_sweep_5min schedule='1-59/5 * * * *' active=True
-- SELECT public.fn_sweep_interview_reminders();
-- ===== PREIMAGE cron 52 apex_notif_manager_followup_daily schedule='0 14 * * *' active=True
-- SELECT public.fn_sweep_manager_followup_reminders();
-- ===== PREIMAGE cron 66 apex-postmark-approval-monitor-15min schedule='3-59/15 * * * *' active=True
--  SELECT net.http_post(url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/postmark-approval-monitor', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)), body := '{}'::jsonb); 
-- ===== PREIMAGE cron 144 apex-interview-outcome-ask schedule='*/15 * * * *' active=True
-- select public.fn_interview_outcome_ask()
-- ===== PREIMAGE constraint interview_events_call_track_check: CHECK ((call_track = ANY (ARRAY['licensed'::text, 'leader'::text, 'seminar'::text, 'exam'::text, 'other'::text, 'onboarding'::text])))
-- ===== PREIMAGE constraint interview_events_match_method_check: CHECK ((match_method = ANY (ARRAY['instagram'::text, 'email'::text, 'phone'::text, 'manual'::text, 'none'::text, 'booking_backfill'::text])))
-- ===== PREIMAGE next_step_stages.contacted.reminder_cadence = 'hour:24,48,72'
-- ===== PREIMAGE next_step_stages.started_prelicense.reminder_cadence = 'day:3,7,14,21'
