-- MP-343: move a person through the recruiting pipeline from the website.
--
-- Sam: "make me able to move people through the pipeline on the website, I
-- should have full control."
--
-- WHAT EXISTED. set_agent_license_progress moves someone's stage, but it takes
-- an AGENT id and reads public.agents — it cannot touch a person who has not
-- been hired yet. The recruiting pipeline is almost entirely APPLICATIONS, so
-- the people Sam most needs to move were exactly the ones no RPC could move.
-- The UI could only terminate, restore, or set license progress on someone
-- already an agent; there was no "put this person at stage X".
--
-- STAGE IS DERIVED, NOT STORED. resolvePipelineStage() in the frontend reads
-- license_progress FIRST and falls back to timestamps (course_purchased_at,
-- exam_scheduled_at, exam_passed_at, licensed_at, contracted_at, ica_paid).
-- Writing only license_progress would therefore be silently overridden for any
-- row whose timestamps say something later — the board would snap back and look
-- like the click did nothing. So a move writes the progress value AND the
-- timestamp that defines that stage, and CLEARS the later-stage timestamps that
-- would otherwise outrank it. Moving backwards has to actually move backwards.
--
-- PERMISSION reuses can_work_application(), the same gate that governs calling
-- and contacting a recruit, so "who may I phone" and "who may I advance" cannot
-- drift apart. Admins pass it for everyone.
--
-- Every move is recorded. A pipeline you can rewrite invisibly is worse than one
-- you cannot rewrite at all.

begin;

create table if not exists public.applicant_stage_moves (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  moved_by uuid,
  note text,
  moved_at timestamptz not null default now()
);

create index if not exists applicant_stage_moves_app_idx
  on public.applicant_stage_moves (application_id, moved_at desc);

alter table public.applicant_stage_moves enable row level security;

drop policy if exists "read stage moves you can work" on public.applicant_stage_moves;
create policy "read stage moves you can work" on public.applicant_stage_moves
  for select to authenticated
  using (public.can_work_application(application_id));

grant select on public.applicant_stage_moves to authenticated;

create or replace function public.set_applicant_stage(
  p_application_id uuid,
  p_stage text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_app public.applications%rowtype;
  v_from text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if p_stage not in (
    'applied','course','finished_course','test_scheduled','passed_test','licensed','contracted'
  ) then
    raise exception 'invalid stage: %', p_stage using errcode = '22023';
  end if;

  select * into v_app from public.applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  if not public.can_work_application(p_application_id) then
    raise exception 'that person is not yours to move' using errcode = '42501';
  end if;

  -- Same precedence the board renders with, so the recorded "from" is the stage
  -- the mover actually saw rather than a column read in isolation.
  v_from := case
    when v_app.contracted_at is not null or coalesce(v_app.ica_paid, false) then 'contracted'
    when v_app.license_progress::text = 'licensed' or v_app.licensed_at is not null
         or v_app.license_status::text = 'licensed' then 'licensed'
    when v_app.license_progress::text in ('passed_test','waiting_on_license')
         or v_app.exam_passed_at is not null then 'passed_test'
    when v_app.license_progress::text = 'test_scheduled'
         or v_app.exam_scheduled_at is not null then 'test_scheduled'
    when v_app.license_progress::text = 'finished_course' then 'finished_course'
    when v_app.license_progress::text = 'course_purchased'
         or v_app.course_purchased_at is not null then 'course'
    else 'applied'
  end;

  -- Set the defining timestamp for the target stage and clear everything that
  -- ranks ABOVE it, or a backwards move would be immediately outranked by a
  -- leftover timestamp and the row would snap forward again.
  update public.applications set
    license_progress = (case p_stage
      when 'applied'         then 'unlicensed'
      when 'course'          then 'course_purchased'
      when 'finished_course' then 'finished_course'
      when 'test_scheduled'  then 'test_scheduled'
      when 'passed_test'     then 'passed_test'
      when 'licensed'        then 'licensed'
      when 'contracted'      then 'licensed'
    end)::public.license_progress,
    license_status = (case
      when p_stage in ('licensed','contracted') then 'licensed'
      when license_status::text = 'licensed' then 'pending'
      else license_status::text end)::public.license_status,
    course_purchased_at = case
      when p_stage = 'applied' then null
      when p_stage = 'course' then coalesce(course_purchased_at, v_now)
      else course_purchased_at end,
    exam_scheduled_at = case
      when p_stage in ('applied','course','finished_course') then null
      when p_stage = 'test_scheduled' then coalesce(exam_scheduled_at, v_now)
      else exam_scheduled_at end,
    exam_passed_at = case
      when p_stage in ('applied','course','finished_course','test_scheduled') then null
      when p_stage = 'passed_test' then coalesce(exam_passed_at, v_now)
      else exam_passed_at end,
    licensed_at = case
      when p_stage in ('licensed','contracted') then coalesce(licensed_at, v_now)
      else null end,
    contracted_at = case
      when p_stage = 'contracted' then coalesce(contracted_at, v_now)
      else null end,
    updated_at = v_now
  where id = p_application_id;

  insert into public.applicant_stage_moves (application_id, from_stage, to_stage, moved_by, note)
  values (p_application_id, v_from, p_stage, auth.uid(), nullif(btrim(p_note), ''));

  return jsonb_build_object(
    'application_id', p_application_id,
    'from_stage', v_from,
    'to_stage', p_stage,
    'moved_at', v_now
  );
end;
$function$;

comment on function public.set_applicant_stage(uuid, text, text) is
  'MP-343: move a recruit to any pipeline stage from the website. Writes the '
  'defining timestamp AND clears later-stage timestamps, because the board '
  'derives stage from timestamps and a backwards move would otherwise be '
  'outranked and snap forward. Gated by can_work_application, the same gate as '
  'calling them. Every move is written to applicant_stage_moves.';

revoke all on function public.set_applicant_stage(uuid, text, text) from public;
grant execute on function public.set_applicant_stage(uuid, text, text) to authenticated;

commit;
