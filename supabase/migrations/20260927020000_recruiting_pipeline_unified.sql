-- Minimal, non-destructive: one missing concept (Monday attendance override) + a
-- manual stage override so managers can move anyone by hand. Nothing dropped.
alter table public.applications add column if not exists monday_status text;      -- expected|confirmed|showed|no_show
alter table public.applications add column if not exists pipeline_stage_override text;
alter table public.agents       add column if not exists pipeline_stage_override text;

-- Unified recruiting pipeline: applications that never became agents + all agents,
-- mapped to ONE 15-stage vocabulary, with the next action and every display field.
create or replace view public.v_recruiting_pipeline as
with app_rows as (
  select
    'app:'||a.id::text as person_key, 'applicant'::text as person_type, a.id,
    trim(coalesce(a.first_name,'')||' '||coalesce(a.last_name,'')) as name,
    a.phone, a.email, a.instagram_handle as instagram,
    coalesce(a.utm_source, a.source, a.referral_source) as lead_source,
    a.recruiter_id, a.hiring_manager_user_id, a.assigned_va_id,
    a.status::text as raw_status, a.monday_status, a.pipeline_stage_override,
    a.start_date::text as expected_start,
    coalesce(a.last_contacted_at, a.contacted_at) as last_contact,
    coalesce(a.next_action_due_at, a.next_action_at, a.next_touch_by) as next_follow_up,
    coalesce(a.next_action, a.next_action_type) as raw_next_action,
    a.notes, a.license_status::text as license_status, a.license_progress::text as license_progress,
    a.contracted_at, a.created_at,
    (select count(*)::int from public.interview_events ie where ie.application_id=a.id and ie.canceled_at is null and coalesce(ie.scheduled_at, now()) >= now()-interval '1 day') as upcoming_interviews
  from public.applications a
  where coalesce(a.is_duplicate,false)=false
    and not exists (select 1 from public.agents g where g.source_application_id=a.id)
),
agent_rows as (
  select
    'agent:'||g.id::text as person_key, 'agent'::text as person_type, g.id,
    coalesce(g.display_name, p.full_name, 'Agent') as name,
    p.phone, p.email, null::text as instagram,
    null::text as lead_source, g.manager_id::uuid as recruiter_id, null::uuid as hiring_manager_user_id, null::uuid as assigned_va_id,
    g.status::text as raw_status, g.attendance_status::text as monday_status, g.pipeline_stage_override,
    g.start_date::text as expected_start,
    g.stage_changed_at as last_contact,
    g.next_action_due_at as next_follow_up,
    g.next_action_text as raw_next_action,
    g.notes, g.license_status::text as license_status, g.license_progress::text as license_progress,
    g.contracted_at, g.created_at,
    0 as upcoming_interviews
  from public.agents g
  left join public.profiles p on p.user_id=g.user_id
)
select r.*,
  case
    when r.pipeline_stage_override is not null and r.pipeline_stage_override<>'' then r.pipeline_stage_override
    -- manual Monday override always wins for the attendance band
    when r.monday_status='no_show' then 'No Show'
    when r.monday_status='showed' then 'Showed'
    when r.monday_status='confirmed' then 'Confirmed'
    when r.monday_status='expected' then 'Expected Monday'
    when r.person_type='agent' then
      case
        when r.raw_status in ('terminated','inactive') then 'Inactive/No Longer With Us'
        when r.raw_status='active' then 'Active Agent'
        else 'Onboarding'
      end
    else
      case
        when r.raw_status in ('rejected','disqualified','terminated') then 'Inactive/No Longer With Us'
        when r.raw_status='attended_no_show' then 'No Show'
        when r.raw_status='paid' then 'Ready for Training'
        when r.raw_status='contracting' and r.contracted_at is not null then 'Contracting In Progress'
        when r.raw_status='contracting' then 'Contract Sent'
        when r.raw_status='onboarding' then 'Onboarding'
        when r.raw_status='interview' then 'Interested'
        when r.upcoming_interviews>0 then 'Call Scheduled'
        when r.raw_status in ('reviewing','no_pickup') or r.last_contact is not null then 'Contacted'
        else 'New Lead'
      end
  end as stage,
  coalesce(nullif(r.raw_next_action,''),
    case
      when r.pipeline_stage_override is not null then 'Update status'
      when r.monday_status='no_show' then 'Re-engage / reschedule'
      when r.monday_status='showed' then 'Send onboarding'
      when r.monday_status='confirmed' then 'Confirm Monday attendance'
      when r.monday_status='expected' then 'Confirm Monday'
      when r.raw_status='contracting' then 'Complete contracting'
      when r.raw_status='onboarding' then 'Send onboarding / start training'
      when r.raw_status='paid' then 'Start training'
      when r.person_type='agent' and r.raw_status='active' then 'Keep active / check production'
      when r.person_type='applicant' and r.raw_status='new' then 'Call prospect / send application link'
      else 'Follow up'
    end) as next_action_display
from (select * from app_rows union all select * from agent_rows) r;

grant select on public.v_recruiting_pipeline to authenticated;
-- One dispatcher for every fast action. Writes to EXISTING columns. Manager/admin
-- gated, EXCEPTION-safe, returns the person's new stage so the UI can refresh one row.
create or replace function public.rp_pipeline_action(p_person_key text, p_action text, p_value text default null)
returns text
language plpgsql security definer set search_path=public as $fn$
declare
  v_kind text := split_part(p_person_key,':',1);
  v_id uuid := nullif(split_part(p_person_key,':',2),'')::uuid;
  v_stage text;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager')
          or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'recruiter')) then
    raise exception 'not authorized';
  end if;
  if v_id is null then raise exception 'bad person_key'; end if;

  if v_kind='app' then
    if p_action='monday' then
      update applications set monday_status=nullif(p_value,'clear'), updated_at=now() where id=v_id;
    elsif p_action='stage' then
      update applications set pipeline_stage_override=nullif(p_value,'clear'), updated_at=now() where id=v_id;
    elsif p_action='followup' then
      update applications set next_action_due_at=nullif(p_value,'')::timestamptz, updated_at=now() where id=v_id;
    elsif p_action='contacted' then
      update applications set last_contacted_at=now(), contacted_at=coalesce(contacted_at,now()), updated_at=now() where id=v_id;
    elsif p_action='note' and coalesce(p_value,'')<>'' then
      update applications set notes=trim(coalesce(notes||E'\n','')||to_char(now(),'MM/DD')||': '||p_value), updated_at=now() where id=v_id;
    else raise exception 'unknown action %', p_action; end if;
  elsif v_kind='agent' then
    if p_action='stage' then
      update agents set pipeline_stage_override=nullif(p_value,'clear'), updated_at=now() where id=v_id;
    elsif p_action='followup' then
      update agents set next_action_due_at=nullif(p_value,'')::timestamptz, updated_at=now() where id=v_id;
    elsif p_action='note' and coalesce(p_value,'')<>'' then
      update agents set notes=trim(coalesce(notes||E'\n','')||to_char(now(),'MM/DD')||': '||p_value), updated_at=now() where id=v_id;
    elsif p_action='monday' then
      -- agents aren't Monday prospects; no-op rather than error
      null;
    else raise exception 'unknown action %', p_action; end if;
  else raise exception 'bad kind %', v_kind; end if;

  select stage into v_stage from v_recruiting_pipeline where person_key=p_person_key;
  return v_stage;
end $fn$;
grant execute on function public.rp_pipeline_action(text,text,text) to authenticated;
