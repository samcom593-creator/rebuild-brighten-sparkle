-- PL-WIB-CONTACT-LOG-CHANNEL, fifth writer: Stale Recovery actions never reached the timeline.
--
-- fn_recover_stale_applicant wrote channel 'recovery_panel' into
-- application_contact_log, which its CHECK refuses (call / sms / email / note /
-- in_person / manual). The 23514 was caught by `exception when others then null`,
-- so the applicant update committed and the page said "Marked contacted" while
-- the log row was silently dropped: 0 rows have ever carried 'recovery_panel'.
-- Found by src/tests/lib/contactLogChannelWrites.test.ts on its first run and
-- confirmed against live pg_proc on 2026-10-08.
--
-- Channel is now 'manual'. The insert stays non-blocking (the update above is
-- the action the admin asked for), but a failure is raised as a warning and
-- returned as logged:false so the page can say so.

CREATE OR REPLACE FUNCTION public.fn_recover_stale_applicant(p_application_id uuid, p_action text, p_new_agent_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    values (p_application_id, 'manual', p_action, p_note, auth.uid());
  exception when others then
    -- The applicant update above stands; the missing timeline entry is reported, not hidden.
    raise warning 'fn_recover_stale_applicant: contact log insert failed for %: %', p_application_id, sqlerrm;
    return jsonb_build_object('ok', true, 'action', p_action, 'logged', false, 'log_error', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'action', p_action, 'logged', true);
end;
$function$;
