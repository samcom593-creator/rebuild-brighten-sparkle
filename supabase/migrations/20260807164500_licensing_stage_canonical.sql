-- wave-licensing-stage-canonical
-- Closes apex-platform-audit-2026-07-21.md:118 — "Fragmented licensing stage model:
-- four incompatible status vocabularies for the same person".
--
-- Verified live before writing this (bot-sql, project xrzweoneiieddzxogewk):
--   * 95 applications read license_status='licensed' AND license_progress='unlicensed'.
--     ALL 95 carry a real licensed_at; 52 also carry licensed_states. licensed_at
--     PREDATES created_at on the sample, i.e. these are Xcel/state-verified licences on
--     people who applied AFTER getting licensed. license_progress is the stale default,
--     license_status is the corroborated column.
--   * 15 licensing_students rows sit at current_stage='enrolled' while the same applicant
--     is already licensed (13 of them with a licensed_at).
--   * unified_set_license_progress writes ONLY license_progress. v_hot_licensing_prospects
--     gates on license_status IN ('unlicensed','pending'). So marking someone "Licensed" in
--     License Push never releases them from the call queue and never promotes them into
--     LicensedInbox. 1 row is in exactly that stuck state right now.
--
-- The fix is deliberately NOT another RPC patch. license_status is written by the Xcel
-- importer, the Apply form, admin surfaces and unified_set_license_progress; patching one
-- caller leaves the other three free to re-diverge. Reconciliation goes on the table.

-- ---------------------------------------------------------------------------
-- 1. Stage ranking — lets us advance a stage without ever demoting one.
-- ---------------------------------------------------------------------------
create or replace function public.fn_license_stage_rank(p license_progress)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select case p
    when 'unlicensed'          then 0
    when 'course_purchased'    then 1
    when 'finished_course'     then 2
    when 'test_scheduled'      then 3
    when 'failed_test'         then 3
    when 'passed_test'         then 4
    when 'exam_passed'         then 4
    when 'waiting_fingerprints' then 5
    when 'fingerprints_done'   then 6
    when 'waiting_on_license'  then 7
    when 'licensed'            then 8
    when 'in_field_training'   then 9
    else 0
  end;
$$;

comment on function public.fn_license_stage_rank(license_progress) is
  'Ordinal for license_progress so reconciliation can only ever advance a stage, never demote one. in_field_training ranks ABOVE licensed so a producing agent is never knocked back to "licensed".';

-- ---------------------------------------------------------------------------
-- 2. Canonical stage — one truth derived from all four vocabularies.
-- ---------------------------------------------------------------------------
create or replace view public.v_licensing_stage_canonical as
select
  a.id                          as application_id,
  a.first_name,
  a.last_name,
  a.license_status              as stored_status,
  a.license_progress            as stored_progress,
  ls.current_stage              as tracker_stage,
  a.licensed_at,
  a.terminated_at,
  case
    -- Hard evidence of a licence outranks every self-reported stage.
    when a.license_progress = 'in_field_training' then 'in_field_training'::license_progress
    when a.license_status = 'licensed' or a.licensed_at is not null or a.license_progress = 'licensed'
      then 'licensed'::license_progress
    when ls.exam_passed_at is not null or ls.current_stage = 'exam_passed'
      then case when public.fn_license_stage_rank(a.license_progress)
                     >= public.fn_license_stage_rank('passed_test'::license_progress)
                then a.license_progress else 'passed_test'::license_progress end
    when ls.exam_scheduled_at is not null or ls.current_stage = 'booked'
      then case when public.fn_license_stage_rank(a.license_progress)
                     >= public.fn_license_stage_rank('test_scheduled'::license_progress)
                then a.license_progress else 'test_scheduled'::license_progress end
    else coalesce(a.license_progress, 'unlicensed'::license_progress)
  end                           as canonical_stage
from public.applications a
left join public.licensing_students ls on ls.application_id = a.id;

comment on view public.v_licensing_stage_canonical is
  'One licensing truth per applicant, derived from applications.license_status + license_progress + licensed_at and licensing_students.current_stage/exam timestamps. Every licensing surface should read canonical_stage instead of picking one of the four raw vocabularies.';

-- ---------------------------------------------------------------------------
-- 3. Drift view — makes this class of divergence permanently observable.
-- ---------------------------------------------------------------------------
create or replace view public.v_licensing_stage_drift as
select
  c.application_id,
  c.first_name,
  c.last_name,
  c.stored_status,
  c.stored_progress,
  c.tracker_stage,
  c.canonical_stage,
  case
    when c.canonical_stage = 'licensed' and c.stored_progress is distinct from 'licensed'
      then 'progress_behind_licence'
    when c.canonical_stage = 'licensed' and c.tracker_stage is not null
         and c.tracker_stage not in ('exam_passed','quit')
      then 'tracker_still_enrolled_though_licensed'
    when c.stored_progress = 'licensed' and c.stored_status is distinct from 'licensed'
      then 'progress_licensed_but_status_not'
    else 'other'
  end as drift_reason
from public.v_licensing_stage_canonical c
where c.terminated_at is null
  and (
    (c.canonical_stage = 'licensed' and c.stored_progress is distinct from 'licensed')
    or (c.canonical_stage = 'licensed' and c.tracker_stage is not null
        and c.tracker_stage not in ('exam_passed','quit'))
    or (c.stored_progress = 'licensed' and c.stored_status is distinct from 'licensed')
  );

comment on view public.v_licensing_stage_drift is
  'Rows where the licensing vocabularies contradict each other. Should read 0 once the reconciliation trigger is live; a non-zero count means a new write path is bypassing it.';

-- ---------------------------------------------------------------------------
-- 4. Reconciliation trigger on applications — covers EVERY write path.
--    Wrapped in EXCEPTION: losing an applicant row to a bookkeeping trigger is
--    strictly worse than losing the bookkeeping (see the 2026-08-07 applicant
--    Telegram alert outage, where COALESCE on an enum would have aborted every
--    applicant INSERT).
-- ---------------------------------------------------------------------------
create or replace function public.fn_reconcile_licensing_vocabularies()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- A verified licence (status or timestamp) drags the stage forward, never back.
  if new.license_status = 'licensed' or new.licensed_at is not null then
    new.license_status := 'licensed';
    new.licensed_at    := coalesce(new.licensed_at, now());
    if public.fn_license_stage_rank(coalesce(new.license_progress, 'unlicensed'))
       < public.fn_license_stage_rank('licensed') then
      new.license_progress := 'licensed';
    end if;

  -- Someone marked Licensed in License Push: promote the status so the call queue
  -- releases them and LicensedInbox picks them up.
  elsif new.license_progress in ('licensed', 'in_field_training') then
    new.license_status := 'licensed';
    new.licensed_at    := coalesce(new.licensed_at, now());
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_reconcile_licensing_vocabularies on public.applications;
create trigger trg_reconcile_licensing_vocabularies
  before insert or update of license_status, license_progress, licensed_at
  on public.applications
  for each row
  execute function public.fn_reconcile_licensing_vocabularies();

-- Mirror onto the tracker so LicensingTracker stops chasing licensed people.
create or replace function public.fn_mirror_licensing_tracker()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.license_status = 'licensed' or new.license_progress in ('licensed','in_field_training') then
    update public.licensing_students
       set current_stage    = 'exam_passed',
           exam_passed_at   = coalesce(exam_passed_at, new.licensed_at, now()),
           stage_changed_at = now(),
           updated_at       = now()
     where application_id = new.id
       and current_stage not in ('exam_passed', 'quit');
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists trg_mirror_licensing_tracker on public.applications;
create trigger trg_mirror_licensing_tracker
  after insert or update of license_status, license_progress, licensed_at
  on public.applications
  for each row
  execute function public.fn_mirror_licensing_tracker();

-- ---------------------------------------------------------------------------
-- 5. Snapshot + backfill. Snapshot FIRST so the backfill is reversible.
-- ---------------------------------------------------------------------------
create table if not exists public.licensing_stage_backfill_20260807 (
  application_id   uuid primary key,
  prior_status     license_status,
  prior_progress   license_progress,
  prior_licensed_at timestamptz,
  prior_tracker_stage licensing_stage,
  captured_at      timestamptz not null default now()
);

alter table public.licensing_stage_backfill_20260807 enable row level security;

drop policy if exists "admins read licensing backfill snapshot"
  on public.licensing_stage_backfill_20260807;
create policy "admins read licensing backfill snapshot"
  on public.licensing_stage_backfill_20260807
  for select
  using (public.has_role(auth.uid(), 'admin'::app_role));

comment on table public.licensing_stage_backfill_20260807 is
  'Pre-image of every row touched by the wave-licensing-stage-canonical backfill. Rollback path: UPDATE applications a SET license_progress = b.prior_progress ... FROM this table.';

insert into public.licensing_stage_backfill_20260807
  (application_id, prior_status, prior_progress, prior_licensed_at, prior_tracker_stage)
select a.id, a.license_status, a.license_progress, a.licensed_at, ls.current_stage
from public.applications a
left join public.licensing_students ls on ls.application_id = a.id
where a.id in (select application_id from public.v_licensing_stage_drift)
on conflict (application_id) do nothing;

-- The trigger does the actual reconciliation; this no-op touch fires it for every
-- drifting row so the backfill and the guard can never disagree about the rules.
update public.applications a
   set license_status = a.license_status
 where a.id in (select application_id from public.v_licensing_stage_drift);
