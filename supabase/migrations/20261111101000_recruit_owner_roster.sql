-- recruit-owner-roster (2026-11-10, Sam: "answer N5 so the queue has owners other than you").
-- Only Sam and Aisha have signed in within 30 days (Milver last 2026-09-10, April 2026-09-08),
-- so the VA round-robin always fell back to Sam. Licensed + pending recruits stay with Sam (the
-- closer). Unlicensed recruits now round-robin over system_settings.recruit_owner_roster
-- (Aisha) while she is active, before va_manager and Sam. The open unlicensed backlog rows
-- with no owner (34 NEW_UNTOUCHED + 5 CALL_NO_OUTCOME, all with a phone) move to Aisha's queue.
-- Ownership changes no access; Aisha already holds the manager role. Revert: delete the
-- setting row and null recruiting_owner_user_id for the ids in ops_preimage_snapshots
-- reason recruit_owner_roster_2026_11_10.

insert into public.system_settings (key, value) values ('recruit_owner_roster', '["66bc4464-f10b-4ecf-8e8b-144486f18a44"]')
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.fn_pick_recruit_owner(p_license text, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Sam's explicit owner roster (system_settings.recruit_owner_roster, a JSON array of
  -- user ids; 2026-11-10: Aisha, the only active non-Sam staff). Round-robin over members
  -- who signed in within 7 days. Ownership grants nothing: it only decides whose queue a
  -- recruit sits in. Remove the setting row to revert to va_manager, then Sam.
  select array_agg(m.uid order by m.uid) into v_pool
    from (select (jsonb_array_elements_text(value::jsonb))::uuid uid
            from public.system_settings where key = 'recruit_owner_roster'
             and value ~ '^\s*\[') m
   where m.uid is distinct from p_exclude and public.fn_recruit_user_is_active(m.uid);
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
end $function$;

insert into public.ops_preimage_snapshots (reason, payload)
select 'recruit_owner_roster_2026_11_10',
       jsonb_build_object('note', 'unlicensed SLA backlog rows whose recruiting_owner_user_id was NULL before assignment to Aisha',
                          'application_ids', jsonb_agg(q.application_id))
  from public.v_recruit_sla_queue q join public.applications a on a.id = q.application_id
 where q.license_status = 'unlicensed' and a.recruiting_owner_user_id is null
   and not exists (select 1 from public.ops_preimage_snapshots where reason = 'recruit_owner_roster_2026_11_10')
having count(*) > 0;

update public.applications a
   set recruiting_owner_user_id = '66bc4464-f10b-4ecf-8e8b-144486f18a44'::uuid, recruiting_owner_set_at = now()
  from public.v_recruit_sla_queue q
 where q.application_id = a.id and q.license_status = 'unlicensed' and a.recruiting_owner_user_id is null;

-- v_recruit_sla_queue (security_invoker) computes owner_user_id as
-- coalesce(recruiting_owner_user_id, fn_recruit_sam_user_id()), but authenticated had no
-- EXECUTE on that definer fn, so every signed-in read of owner_user_id - the queue tab's
-- column list and the "Mine" filter - failed with "permission denied for function
-- fn_recruit_sam_user_id" (found by this migration's Aisha dry run; unit tests mock the DB).
-- It returns Sam's user id and nothing else.
grant execute on function public.fn_recruit_sam_user_id() to authenticated;

-- The owner must be able to read the recruits in their own queue. Aisha's manager policies
-- only cover her team (assigned_agent_id / referral_manager_id / hiring_manager_user_id), so
-- the 39 rows assigned above were invisible to her (dry run: 0). Own-assigned rows only,
-- matching the own-rows access model; ownership is set by fn_pick_recruit_owner or an admin.
drop policy if exists applications_recruiting_owner_read on public.applications;
create policy applications_recruiting_owner_read on public.applications
  for select to authenticated
  using (recruiting_owner_user_id = (select auth.uid()));
