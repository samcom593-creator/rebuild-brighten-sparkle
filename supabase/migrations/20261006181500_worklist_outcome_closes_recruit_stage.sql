-- Worklist "Not interested" / "Do not contact" now closes the recruit on Recruit Stages too.
--
-- record_recruiting_outcome() (20261006120000) closes an item in the worklist by
-- writing applications.last_contact_outcome / do_not_contact_at. Recruit Stages
-- (recruit_pipeline_list) reads next_step_progress, which is derived from
-- applications.status and never looks at either column, so a recruit marked
-- Not interested in the worklist stayed active, and stalled, on Recruit Stages.
--
-- This mirrors exactly what Recruit Stages itself writes for Closed/Lost
-- (set_recruit_stage, 20260930210000 / 20261001100000): applications.status =
-- 'lapsed' plus a hand-set closed_lost stage, then a recompute. It deliberately
-- does NOT call set_recruit_stage():
--   * set_recruit_stage rewrites the evidence columns (vsl_watched_at,
--     course_*, exam_*, contracted_at) from the target stage's rank, which is
--     not something a contact outcome should touch;
--   * it raises when fn_recruit_scope_ok() is false, and the worklist admits
--     staff (recruiters) that Recruit Stages does not, so calling it would roll
--     back the outcome they just recorded.
--
-- Reopening: when the newest outcome before this one was "Not interested" and
-- the application is still 'lapsed', recording any other outcome means staff are
-- working the person again, so the status returns to 'new' and the hand-set
-- closed_lost stage is cleared (the same reversal set_recruit_stage applies when
-- someone is moved out of Closed/Lost). A lapse set on Recruit Stages, with no
-- worklist "Not interested" behind it, is left alone.
--
-- Failures are caught and raised as warnings: syncing the stage must never roll
-- back the contact record the worklist just saved.

create or replace function public.trg_fn_worklist_outcome_sync_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_closing boolean := new.last_contact_outcome in ('not_interested', 'do_not_contact');
  v_reopening boolean := not coalesce(new.last_contact_outcome in ('not_interested', 'do_not_contact'), false)
                         and old.last_contact_outcome = 'not_interested'
                         and new.status = 'lapsed'::public.application_status;
begin
  if not (v_closing or v_reopening) then
    return null;
  end if;

  begin
    if v_closing then
      if new.status not in ('rejected'::public.application_status,
                            'disqualified'::public.application_status,
                            'lapsed'::public.application_status) then
        update public.applications
           set status = 'lapsed'::public.application_status
         where id = new.id;
      end if;
      update public.next_step_progress
         set manual_stage_key = 'closed_lost',
             manual_stage_at = now(),
             manual_by = auth.uid(),
             updated_at = now()
       where application_id = new.id;
    else
      update public.applications
         set status = 'new'::public.application_status
       where id = new.id;
      update public.next_step_progress
         set manual_stage_key = null,
             manual_stage_at = null,
             manual_by = null,
             updated_at = now()
       where application_id = new.id
         and manual_stage_key = 'closed_lost';
    end if;

    perform public.fn_next_step_recompute_one(new.id, null);
  exception when others then
    raise warning 'worklist_outcome_sync_stage failed for application %: %', new.id, sqlerrm;
  end;

  return null;
end
$function$;

revoke all on function public.trg_fn_worklist_outcome_sync_stage() from public, anon, authenticated;

drop trigger if exists trg_worklist_outcome_sync_stage on public.applications;
create trigger trg_worklist_outcome_sync_stage
  after update of last_contact_outcome_at on public.applications
  for each row
  when (new.last_contact_outcome_at is distinct from old.last_contact_outcome_at)
  execute function public.trg_fn_worklist_outcome_sync_stage();

comment on function public.trg_fn_worklist_outcome_sync_stage() is
  'Keeps Recruit Stages in step with worklist outcomes: Not interested / Do not contact close the recruit (status lapsed + closed_lost), and a later outcome after Not interested reopens it.';
