-- One transaction keeps interview outcome, recruiting plan, and contact evidence
-- together. Undo restores its own receipt only; newer activity makes it refuse.
create table if not exists public.interview_disposition_receipts (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity,
  interview_id uuid not null references public.interview_events(id),
  application_id uuid references public.applications(id),
  actor_user_id uuid references auth.users(id),
  outcome text not null,
  before_interview jsonb not null,
  after_interview jsonb not null,
  before_application jsonb,
  after_application jsonb,
  before_progress jsonb,
  after_progress jsonb,
  contact_log_id uuid,
  contact_log_receipt jsonb,
  can_undo boolean not null default false,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users(id)
);
create index if not exists interview_disposition_receipts_latest_idx on public.interview_disposition_receipts(interview_id,sequence desc);
alter table public.interview_disposition_receipts enable row level security;
revoke all on public.interview_disposition_receipts from public,anon,authenticated;
grant select on public.interview_disposition_receipts to service_role;

create or replace function public.cc_dispose_interview(p_id uuid,p_outcome text,p_notes text default null,p_followup_due_at timestamptz default null)
returns public.interview_events language plpgsql security definer set search_path = public as $fn$
declare
  before_row public.interview_events; after_row public.interview_events;
  app public.applications; app_before jsonb; app_after jsonb;
  progress_before jsonb; progress_after jsonb;
  agent_ids uuid[]; canonical_agent uuid; contact_id uuid; contact_receipt jsonb;
  v_contact_outcome text; calendar_only boolean;
begin
  select * into before_row from public.interview_events where id=p_id for update;
  if not found then raise exception 'Interview not found'; end if;
  if not (coalesce(auth.role(),'')='service_role' or coalesce(public.calendar_is_scheduling_staff(),false) or coalesce(before_row.owner_user_id=auth.uid(),false)) then
    raise exception 'not authorized to record an interview outcome' using errcode='42501';
  end if;
  if p_outcome is null or p_outcome not in ('completed','hired','contracted','passed','no_show','no_answer','rescheduled','bad_number','callback','not_interested','not_a_fit') then raise exception 'Invalid interview outcome'; end if;
  if p_outcome='callback' and (p_followup_due_at is null or p_followup_due_at<=now()) then raise exception 'Choose a future callback date before saving'; end if;
  if before_row.application_id is not null then
    select * into app from public.applications where id=before_row.application_id for update;
    app_before:=to_jsonb(app);
    select to_jsonb(p) into progress_before from public.next_step_progress p where p.application_id=app.id for update;
  end if;
  if p_outcome in ('hired','contracted') then
    select array_agg(a.id) into agent_ids from public.agents a
      where (a.id=before_row.agent_id or (before_row.application_id is not null and a.source_application_id=before_row.application_id))
      and a.user_id is not null and coalesce(a.is_deactivated,false)=false and a.canonical_agent_id is null;
    if coalesce(cardinality(agent_ids),0)<>1 then raise exception 'Create the canonical agent account through add-agent before recording Hired'; end if;
    canonical_agent:=agent_ids[1];
  end if;

  update public.interview_events set outcome=p_outcome,outcome_at=clock_timestamp(),outcome_by=auth.uid(),
    agent_id=coalesce(canonical_agent,agent_id), notes=coalesce(nullif(btrim(p_notes),''),notes),
    followup_due_at=case when p_outcome in ('hired','contracted','not_interested','not_a_fit') then null else coalesce(p_followup_due_at,followup_due_at) end,
    contacted_at=case when p_outcome='callback' then now() else contacted_at end
    where id=p_id returning * into after_row;

  calendar_only:=before_row.application_id is not null and auth.uid() is null and p_outcome='no_show' and coalesce(p_notes,'') ilike 'Calendly no-show%';
  if before_row.application_id is not null then
    if calendar_only then
      update public.applications set status='attended_no_show'::public.application_status where id=app.id;
    else
      contact_id:=public.fn_log_human_contact(app.id,'call',p_outcome,auth.uid(),case when auth.uid() is null then 'one_tap_link' else 'interview_disposition' end,'interview '||p_id::text);
      v_contact_outcome:=case when p_outcome in ('callback','no_answer','not_interested') then p_outcome when p_outcome='bad_number' then 'wrong_number' else null end;
      update public.application_contact_log set contact_outcome=v_contact_outcome,
        next_action=case when p_followup_due_at is not null then case when p_outcome='callback' then 'Call back' else 'Follow up' end else null end,
        next_action_due_at=p_followup_due_at where id=contact_id;
      update public.applications a set
        last_contact_outcome=coalesce(v_contact_outcome,a.last_contact_outcome),
        last_contact_outcome_at=case when v_contact_outcome is not null then now() else a.last_contact_outcome_at end,
        last_contact_outcome_by=case when v_contact_outcome is not null then auth.uid() else a.last_contact_outcome_by end,
        last_contact_channel=case when v_contact_outcome is not null then 'call' else a.last_contact_channel end,
        next_action=case when p_outcome in ('hired','contracted','not_interested','not_a_fit') then null when p_followup_due_at is not null then case when p_outcome='callback' then 'Call back' else 'Follow up' end else a.next_action end,
        next_action_due_at=case when p_outcome in ('hired','contracted','not_interested','not_a_fit') then null when p_followup_due_at is not null then p_followup_due_at else a.next_action_due_at end,
        next_action_set_at=case when p_followup_due_at is not null or p_outcome in ('hired','contracted','not_interested','not_a_fit') then now() else a.next_action_set_at end,
        next_action_set_by=case when p_followup_due_at is not null or p_outcome in ('hired','contracted','not_interested','not_a_fit') then auth.uid() else a.next_action_set_by end,
        waiting_reason=case when p_followup_due_at is not null or p_outcome in ('hired','contracted','not_interested','not_a_fit') then null else a.waiting_reason end,
        next_review_at=case when p_followup_due_at is not null or p_outcome in ('hired','contracted','not_interested','not_a_fit') then null else a.next_review_at end
        where a.id=app.id;
    end if;
    -- add-agent has already moved a hire into onboarding. A later disposition
    -- must not move that person backwards to recruiting/contracting.
    if canonical_agent is not null or public.fn_application_has_agent(app.id) then
      update public.applications set status=case when app.status in ('onboarding','producing','approved') then app.status else 'onboarding'::public.application_status end,
        closed_at=coalesce(closed_at,now()) where id=app.id;
    end if;
    select to_jsonb(a) into app_after from public.applications a where a.id=app.id;
    select to_jsonb(p) into progress_after from public.next_step_progress p where p.application_id=app.id;
    select to_jsonb(l) into contact_receipt from public.application_contact_log l where l.id=contact_id;
  end if;
  insert into public.interview_disposition_receipts(interview_id,application_id,actor_user_id,outcome,before_interview,after_interview,before_application,after_application,before_progress,after_progress,contact_log_id,contact_log_receipt,can_undo)
  values(p_id,before_row.application_id,auth.uid(),p_outcome,to_jsonb(before_row),to_jsonb(after_row),app_before,app_after,progress_before,progress_after,contact_id,contact_receipt,auth.uid() is not null and canonical_agent is null and not calendar_only);
  return after_row;
end $fn$;
revoke all on function public.cc_dispose_interview(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.cc_dispose_interview(uuid,text,text,timestamptz) to authenticated,service_role;

create or replace function public.cc_record_interview_disposition(p_id uuid,p_outcome text,p_notes text,p_followup_due_at timestamptz,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r public.interview_events; receipt public.interview_disposition_receipts;
begin
  select * into r from public.interview_events where id=p_id for update;
  if not found then raise exception 'Interview not found'; end if;
  if not (coalesce(auth.role(),'')='service_role' or coalesce(public.calendar_is_scheduling_staff(),false) or coalesce(r.owner_user_id=auth.uid(),false)) then raise exception 'not authorized' using errcode='42501'; end if;
  if p_expected_updated_at is null or r.updated_at is distinct from p_expected_updated_at or r.outcome is not null then raise exception 'Interview changed. Refresh before recording another outcome.' using errcode='40001'; end if;
  perform public.cc_dispose_interview(p_id,p_outcome,p_notes,p_followup_due_at);
  select * into receipt from public.interview_disposition_receipts where interview_id=p_id order by sequence desc limit 1;
  return jsonb_build_object('receipt_id',receipt.id,'can_undo',receipt.can_undo);
end $fn$;

create or replace function public.cc_undo_interview_disposition(p_receipt_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare receipt public.interview_disposition_receipts; r public.interview_events; old_row public.interview_events;
  app public.applications; old_app public.applications; progress public.next_step_progress; old_progress public.next_step_progress; progress_current jsonb;
begin
  select * into receipt from public.interview_disposition_receipts where id=p_receipt_id for update;
  if not found then raise exception 'Outcome receipt not found'; end if;
  select * into r from public.interview_events where id=receipt.interview_id for update;
  if not (coalesce(auth.role(),'')='service_role' or coalesce(public.calendar_is_scheduling_staff(),false) or coalesce(r.owner_user_id=auth.uid(),false)) then raise exception 'not authorized' using errcode='42501'; end if;
  if receipt.undone_at is not null then return jsonb_build_object('ok',true,'already_undone',true); end if;
  if not receipt.can_undo or receipt.outcome in ('hired','contracted') then raise exception 'This action cannot be undone. Agent accounts and onboarding are preserved.'; end if;
  if to_jsonb(r) is distinct from receipt.after_interview then raise exception 'Interview changed after this outcome; Undo refused.' using errcode='40001'; end if;
  if receipt.application_id is not null then
    select * into app from public.applications where id=receipt.application_id for update;
    select * into progress from public.next_step_progress where application_id=receipt.application_id for update;
    progress_current:=case when found then to_jsonb(progress) else null end;
    if to_jsonb(app) is distinct from receipt.after_application or progress_current is distinct from receipt.after_progress then raise exception 'Recruiting activity changed after this outcome; Undo refused.' using errcode='40001'; end if;
  end if;
  old_row:=jsonb_populate_record(null::public.interview_events,receipt.before_interview);
  update public.interview_events set outcome=old_row.outcome,outcome_at=old_row.outcome_at,outcome_by=old_row.outcome_by,notes=old_row.notes,
    followup_due_at=old_row.followup_due_at,contacted_at=old_row.contacted_at,agent_id=old_row.agent_id where id=r.id;
  if receipt.application_id is not null then
    -- The full original contact row remains in this immutable receipt. Remove
    -- only its false operational contact evidence, never unrelated history.
    delete from public.application_contact_log where id=receipt.contact_log_id and application_id=receipt.application_id;
    old_app:=jsonb_populate_record(null::public.applications,receipt.before_application);
    update public.applications set status=old_app.status,closed_at=old_app.closed_at,
      last_contacted_at=old_app.last_contacted_at,contacted_at=old_app.contacted_at,human_first_contact_at=old_app.human_first_contact_at,human_last_contact_at=old_app.human_last_contact_at,
      last_contact_outcome=old_app.last_contact_outcome,last_contact_outcome_at=old_app.last_contact_outcome_at,last_contact_outcome_by=old_app.last_contact_outcome_by,last_contact_channel=old_app.last_contact_channel,
      next_action=old_app.next_action,next_action_due_at=old_app.next_action_due_at,next_action_set_at=old_app.next_action_set_at,next_action_set_by=old_app.next_action_set_by,
      waiting_reason=old_app.waiting_reason,next_review_at=old_app.next_review_at where id=receipt.application_id;
    if receipt.before_progress is null then
      delete from public.next_step_progress where application_id=receipt.application_id;
    else
      old_progress:=jsonb_populate_record(null::public.next_step_progress,receipt.before_progress);
      update public.next_step_progress set current_stage_key=old_progress.current_stage_key,prior_stage_key=old_progress.prior_stage_key,entered_at=old_progress.entered_at,
        completed_at=old_progress.completed_at,is_stalled=old_progress.is_stalled,stalled_at=old_progress.stalled_at,stall_reason=old_progress.stall_reason,sla_due_at=old_progress.sla_due_at,
        manual_stage_key=old_progress.manual_stage_key,manual_stage_at=old_progress.manual_stage_at,manual_by=old_progress.manual_by,metadata=old_progress.metadata,
        owner_role=old_progress.owner_role,owner_user_id=old_progress.owner_user_id,status=old_progress.status where id=old_progress.id;
    end if;
  end if;
  update public.interview_disposition_receipts set undone_at=now(),undone_by=auth.uid() where id=receipt.id;
  return jsonb_build_object('ok',true,'receipt_id',receipt.id);
end $fn$;
revoke all on function public.cc_record_interview_disposition(uuid,text,text,timestamptz,timestamptz),public.cc_undo_interview_disposition(uuid) from public,anon;
grant execute on function public.cc_record_interview_disposition(uuid,text,text,timestamptz,timestamptz),public.cc_undo_interview_disposition(uuid) to authenticated,service_role;
