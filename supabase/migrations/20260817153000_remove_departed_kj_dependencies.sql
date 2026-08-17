-- Remove departed staff member KJ Vaughn from active APEX operations.
-- Preserve recruiter/referral/invited_by attribution for historical reporting.

-- First-write-wins remains the default protection. An authenticated admin can
-- explicitly open the operational-reassignment path through the RPC below.
create or replace function public.fn_protect_application_attribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allow_admin_reassignment boolean :=
    current_setting('apex.allow_attribution_reassignment', true) = 'on'
    and public.has_role(auth.uid(), 'admin');
begin
  if tg_op = 'UPDATE' and not allow_admin_reassignment then
    if old.assigned_agent_id is not null and new.assigned_agent_id is distinct from old.assigned_agent_id then
      new.assigned_agent_id := old.assigned_agent_id;
    end if;
    if old.recruiter_id is not null and new.recruiter_id is distinct from old.recruiter_id then
      new.recruiter_id := old.recruiter_id;
    end if;
    if old.referral_manager_id is not null and new.referral_manager_id is distinct from old.referral_manager_id then
      new.referral_manager_id := old.referral_manager_id;
    end if;
    if old.referral_recruiter_id is not null and new.referral_recruiter_id is distinct from old.referral_recruiter_id then
      new.referral_recruiter_id := old.referral_recruiter_id;
    end if;
    if old.referrer_agent_id is not null and new.referrer_agent_id is distinct from old.referrer_agent_id then
      new.referrer_agent_id := old.referrer_agent_id;
    end if;
    if old.hiring_manager_user_id is not null and new.hiring_manager_user_id is distinct from old.hiring_manager_user_id then
      new.hiring_manager_user_id := old.hiring_manager_user_id;
    end if;
  end if;

  return new;
end
$$;

create or replace function public.admin_reassign_application_owner(
  p_application_id uuid,
  p_new_agent_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_manager_user_id uuid;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  select user_id
    into new_manager_user_id
    from public.agents
   where id = p_new_agent_id
     and coalesce(is_inactive, false) is false
     and coalesce(is_deactivated, false) is false
     and coalesce(status::text, '') not in ('inactive', 'terminated');

  if not found then
    raise exception 'Target agent is missing or inactive';
  end if;

  perform set_config('apex.allow_attribution_reassignment', 'on', true);

  update public.applications
     set assigned_agent_id = p_new_agent_id,
         hiring_manager_user_id = coalesce(new_manager_user_id, hiring_manager_user_id),
         updated_at = now()
   where id = p_application_id;

  if not found then
    raise exception 'Application not found';
  end if;
end
$$;

revoke all on function public.admin_reassign_application_owner(uuid, uuid) from public;
grant execute on function public.admin_reassign_application_owner(uuid, uuid) to authenticated;

do $$
declare
  departed_agent_id constant uuid := '431dff0d-7c82-4134-a85e-457e5226fc7f';
  departed_user_id constant uuid := '75b17131-e565-49c9-9da4-8480a35b06a3';
  sam_agent_id constant uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
  sam_user_id uuid;
begin
  select user_id
    into sam_user_id
    from public.agents
   where id = sam_agent_id;

  if sam_user_id is null then
    raise exception 'Samuel James canonical agent is missing a user_id';
  end if;

  -- The first-write-wins trigger correctly blocks ordinary ownership theft.
  -- Disable it only inside this exact, one-person administrative cleanup.
  execute 'alter table public.applications disable trigger trg_protect_application_attribution';
  begin
    -- Move active applicant work to Sam without rewriting recruiting attribution.
    update public.applications
       set assigned_agent_id = sam_agent_id,
           hiring_manager_user_id = case
             when hiring_manager_user_id is null or hiring_manager_user_id = departed_user_id
               then sam_user_id
             else hiring_manager_user_id
           end,
           updated_at = now()
     where assigned_agent_id = departed_agent_id
       and status not in ('rejected', 'disqualified', 'lapsed');

    update public.applications
       set hiring_manager_user_id = sam_user_id,
           updated_at = now()
     where hiring_manager_user_id = departed_user_id
       and status not in ('rejected', 'disqualified', 'lapsed');
  exception when others then
    execute 'alter table public.applications enable trigger trg_protect_application_attribution';
    raise;
  end;
  execute 'alter table public.applications enable trigger trg_protect_application_attribution';

  -- Active and recoverable downline agents now report operationally to Sam.
  -- invited_by_manager_id remains untouched as the historical attribution field.
  update public.agents
     set manager_id = sam_agent_id,
         updated_at = now()
   where manager_id = departed_agent_id
     and status <> 'terminated';

  -- Re-home every open next-step item previously owned by the departed user.
  update public.next_step_progress nsp
     set owner_user_id = case
           when nsp.application_id is not null then coalesce(
             (select coalesce(a.hiring_manager_user_id, manager.user_id)
                from public.applications a
                left join public.agents manager on manager.id = a.assigned_agent_id
               where a.id = nsp.application_id),
             sam_user_id
           )
           when nsp.agent_id is not null then coalesce(
             (select manager.user_id
                from public.agents agent
                left join public.agents manager on manager.id = agent.manager_id
               where agent.id = nsp.agent_id),
             sam_user_id
           )
           else sam_user_id
         end,
         owner_role = case when nsp.owner_role = 'kj' then 'hiring_manager' else nsp.owner_role end,
         updated_at = now()
   where nsp.status = 'active'
     and (nsp.owner_user_id = departed_user_id or nsp.owner_role = 'kj');

  -- The seminar stage follows the assigned manager, never a named employee.
  update public.next_step_stages
     set owner_role = 'hiring_manager',
         manager_alert_template = '{{first_name}} {{last_name}} is registered for seminar on {{seminar_date}}. Their assigned manager owns attendance and follow-up.',
         updated_at = now()
   where stage_key = 'booked_seminar';

  -- Cancel stale outbound tasks and acknowledge the obsolete Calendly warning.
  update public.manager_touches
     set status = 'cancelled',
         error_message = 'Cancelled 2026-08-17: staff member departed APEX'
   where agent_id = departed_agent_id
     and coalesce(status, '') not in ('sent', 'cancelled');

  update public.poke_queue
     set acked_at = coalesce(acked_at, now())
   where kind = 'kj_calendly_missing';

  -- Revoke operational access while retaining the agent/production record.
  delete from public.user_roles where user_id = departed_user_id;

  update public.agents
     set status = 'terminated',
         is_inactive = true,
         is_deactivated = true,
         is_manager = false,
         is_presenting = false,
         telegram_opt_out = true,
         deactivation_reason = 'inactive',
         leader_notes = concat_ws(E'\n', nullif(leader_notes, ''), 'Departed APEX 2026-08-17; operational ownership reassigned to Samuel James.'),
         next_action_text = null,
         next_action_due_at = null,
         updated_at = now()
   where id = departed_agent_id;

  update auth.users
     set banned_until = greatest(coalesce(banned_until, '-infinity'::timestamptz), '2099-12-31 23:59:59+00'::timestamptz),
         updated_at = now()
   where id = departed_user_id;
end
$$;
