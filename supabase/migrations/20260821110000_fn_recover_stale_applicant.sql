-- /dashboard/stale-recovery calls fn_recover_stale_applicant on every Recover /
-- Ghost / Dismiss click. The function shipped 2026-05-19 via bot-sql, was never
-- round-tripped into migrations, and at some point vanished from prod — every
-- click has 404'd (PGRST202) since. Recreated to the UI's exact contract
-- (StaleRecovery.tsx:487): args (p_application_id, p_action, p_new_agent_id,
-- p_note), returns jsonb {ok} / {ok:false, error}.
--
-- v_stale_applicants surfaces rows WHERE contacted_at IS NULL, so every action
-- stamps contacted_at — the row genuinely leaves the queue, not a cosmetic ack.
-- 'ghost' additionally sets status='no_pickup' (existing enum value).
-- Contact-log insert is EXCEPTION-wrapped: the recovery must not roll back if
-- logging fails (applicant-alert precedent).
create or replace function public.fn_recover_stale_applicant(
  p_application_id uuid,
  p_action text,
  p_new_agent_id uuid default null,
  p_note text default null
) returns jsonb
language plpgsql volatile security definer
set search_path to 'public'
as $fn$
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
    insert into public.application_contact_log (application_id, channel, outcome, notes, logged_by)
    values (p_application_id, 'recovery_panel', p_action, p_note, auth.uid());
  exception when others then
    null;
  end;

  return jsonb_build_object('ok', true, 'action', p_action);
end;
$fn$;

grant execute on function public.fn_recover_stale_applicant(uuid, text, uuid, text) to authenticated;
