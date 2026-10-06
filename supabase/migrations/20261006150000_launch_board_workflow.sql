-- §11 Launch Board — one content workflow on content_cards (additive).
--
--   Idea -> Record -> Edit -> Review -> Ready -> Scheduled -> Published
--
-- Mirrors src/lib/contentWorkflow.ts. What this enforces in the database, so a
-- stale bundle or a direct PostgREST call cannot fake it:
--   * the status CHECK is WIDENED, never narrowed: legacy 'recorded' / 'posted'
--     rows stay valid and are mapped at read time (recorded -> Edit, posted ->
--     "Published (unconfirmed)" unless a live URL + evidence is on the row).
--     No existing row is rewritten.
--   * 'published' requires an https URL on a known platform domain AND an
--     evidence kind ('provider' | 'manual_confirmation'). A signed-in user can
--     only ever claim manual_confirmation, and the trigger stamps who/when.
--   * 'scheduled' requires a time and a kind. kind='job' requires a job
--     reference and can only be written by the service role (a real scheduler);
--     everything a person schedules is a 'manual' plan and is labelled so.
--   * Ready/Scheduled/Published are approval-gated: entering them from an
--     earlier stage needs approved_at, and only an admin can set approved_at.
--   * the page can no longer WRITE the retired 'posted' status (the old
--     "I posted it" tap); a 'recorded' write from a stale bundle is mapped to
--     'edit'.
-- Copying a caption or downloading a clip never touches this table.

-- 1. Execution fields (hook / record_script / clip / edit_prompt / caption /
--    brand already exist; brand is the destination channel).
alter table public.content_cards add column if not exists cta text not null default '';
alter table public.content_cards add column if not exists owner text not null default '';
alter table public.content_cards add column if not exists due_date date;
alter table public.content_cards add column if not exists approved_by uuid;
alter table public.content_cards add column if not exists approved_at timestamptz;
alter table public.content_cards add column if not exists scheduled_for timestamptz;
alter table public.content_cards add column if not exists schedule_kind text;
alter table public.content_cards add column if not exists schedule_job_ref text;
alter table public.content_cards add column if not exists published_url text;
alter table public.content_cards add column if not exists publish_evidence text;
alter table public.content_cards add column if not exists published_confirmed_by uuid;
alter table public.content_cards add column if not exists published_confirmed_at timestamptz;
alter table public.content_cards add column if not exists status_changed_at timestamptz;

comment on column public.content_cards.cta is 'Call to action for this piece (Launch Board). Separate from the caption so a missing CTA is visible.';
comment on column public.content_cards.owner is 'Who executes the next step (name or email). Free text: editors may be outside the agent roster.';
comment on column public.content_cards.due_date is 'Deadline for the next step, America/Phoenix calendar date.';
comment on column public.content_cards.schedule_kind is 'manual = a human plan (labelled "Manual plan"); job = a real scheduler job (service role only, needs schedule_job_ref).';
comment on column public.content_cards.publish_evidence is 'provider = the publishing platform/scheduler reported the post; manual_confirmation = a signed-in person confirmed it with the live URL.';

-- 2. Platform URL rule (mirrors PLATFORM_DOMAINS + isLivePostUrl in contentWorkflow.ts).
create or replace function public.content_publish_url_ok(p_url text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(
    p_url ~* '^https://([a-z0-9-]+\.)*(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|linkedin\.com|snapchat\.com|threads\.net)/[^[:space:]]*[^/[:space:]][^[:space:]]*$',
    false);
$function$;

-- 3. Widen the status vocabulary (existing values kept).
alter table public.content_cards drop constraint if exists content_cards_status_check;
alter table public.content_cards add constraint content_cards_status_check
  check (status = any (array['idea','record','edit','review','ready','scheduled','published','recorded','posted']::text[]));

alter table public.content_cards drop constraint if exists content_cards_schedule_kind_check;
alter table public.content_cards add constraint content_cards_schedule_kind_check
  check (schedule_kind is null or schedule_kind = any (array['manual','job']::text[]));

alter table public.content_cards drop constraint if exists content_cards_publish_evidence_check;
alter table public.content_cards add constraint content_cards_publish_evidence_check
  check (publish_evidence is null or publish_evidence = any (array['provider','manual_confirmation']::text[]));

alter table public.content_cards drop constraint if exists content_cards_published_needs_evidence;
alter table public.content_cards add constraint content_cards_published_needs_evidence
  check (status <> 'published' or (publish_evidence is not null and public.content_publish_url_ok(published_url)));

alter table public.content_cards drop constraint if exists content_cards_scheduled_needs_plan;
alter table public.content_cards add constraint content_cards_scheduled_needs_plan
  check (status <> 'scheduled' or (scheduled_for is not null and schedule_kind is not null));

alter table public.content_cards drop constraint if exists content_cards_job_needs_ref;
alter table public.content_cards add constraint content_cards_job_needs_ref
  check (schedule_kind is distinct from 'job' or coalesce(btrim(schedule_job_ref), '') <> '');

-- 4. Workflow guard.
create or replace function public.content_cards_workflow_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_person boolean := coalesce(auth.role(), '') = 'authenticated';
  v_old_status text := case when tg_op = 'UPDATE' then old.status else null end;
  v_old_approved timestamptz := case when tg_op = 'UPDATE' then old.approved_at else null end;
  v_old_url text := case when tg_op = 'UPDATE' then old.published_url else null end;
  v_old_evidence text := case when tg_op = 'UPDATE' then old.publish_evidence else null end;
  v_old_kind text := case when tg_op = 'UPDATE' then old.schedule_kind else null end;
begin
  if v_person then
    -- Retired writes.
    if new.status = 'recorded' and new.status is distinct from v_old_status then
      new.status := 'edit';
    end if;
    if new.status = 'posted' and new.status is distinct from v_old_status then
      raise exception 'Posted is retired: confirm Published with the live post URL'
        using errcode = 'check_violation';
    end if;

    -- Approval: only an admin can grant it; the trigger stamps who.
    if new.approved_at is not null and new.approved_at is distinct from v_old_approved then
      if not public.apex_is_admin() then
        raise exception 'Only an admin can approve content for publishing'
          using errcode = 'insufficient_privilege';
      end if;
      new.approved_at := now();
      new.approved_by := auth.uid();
    elsif new.approved_at is null then
      new.approved_by := null;
    end if;

    -- Approval gate: Ready / Scheduled / Published only from an approved card.
    if new.status in ('ready','scheduled','published')
       and new.status is distinct from v_old_status
       and coalesce(v_old_status, '') not in ('ready','scheduled','published','posted')
       and new.approved_at is null then
      raise exception 'Approve this card in Review before it can be Ready'
        using errcode = 'check_violation';
    end if;

    -- Only a real scheduler (service role) may claim a scheduled job.
    if new.schedule_kind = 'job' and new.schedule_kind is distinct from v_old_kind then
      raise exception 'A scheduled job can only be recorded by the scheduler; plan it as a manual post'
        using errcode = 'insufficient_privilege';
    end if;

    -- Only a provider integration (service role) may claim provider evidence.
    if new.publish_evidence = 'provider' and new.publish_evidence is distinct from v_old_evidence then
      raise exception 'Provider evidence can only be written by the publishing integration'
        using errcode = 'insufficient_privilege';
    end if;

    -- A person confirming publication: stamp who and when.
    if new.status = 'published' and new.publish_evidence = 'manual_confirmation'
       and (new.status is distinct from v_old_status or new.published_url is distinct from v_old_url
            or new.publish_evidence is distinct from v_old_evidence) then
      new.published_confirmed_by := auth.uid();
      new.published_confirmed_at := now();
    end if;
  end if;

  if new.published_url is not null then
    new.published_url := btrim(new.published_url);
  end if;
  if tg_op = 'INSERT' or new.status is distinct from v_old_status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_content_cards_workflow_guard on public.content_cards;
create trigger trg_content_cards_workflow_guard
  before insert or update on public.content_cards
  for each row execute function public.content_cards_workflow_guard();

-- 5. Board ordering helpers.
create index if not exists content_cards_status_due_idx on public.content_cards (status, due_date);
