-- "No longer with us" (2026-09-30). Sam: a button that sends a re-engagement
-- email and removes the person from his agents, so the roster becomes a
-- concrete list of who is actually here. The email itself is sent by the UI
-- through send-email (admin/manager JWT). send-email does NOT consult
-- email_unsubscribes, so this function does: it returns unsubscribed=true and
-- the UI sends nothing to that person.
alter table public.contracting_checkins
  add column if not exists left_at timestamptz,
  add column if not exists left_by uuid,
  add column if not exists left_reason text,
  add column if not exists reengage_email_sent_at timestamptz;

create or replace function public.mark_no_longer_with_us(
  p_checkin_id uuid, p_agent_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_name text; v_email text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  -- Removing someone from the roster is an admin/manager call, not a VA one.
  if not (public.apex_is_admin() or public.has_role(v_uid,'manager')) then
    raise exception 'Admins and managers only' using errcode='42501';
  end if;

  if p_agent_id is not null then
    if not exists (select 1 from public.fn_contracting_checkin_scope() s where s.agent_id = p_agent_id) then
      raise exception 'not allowed to update this agent' using errcode='42501';
    end if;
    update public.agents set status='inactive', is_inactive=true, is_deactivated=true, updated_at=now()
     where id = p_agent_id;
    insert into public.contracting_checkins(agent_id) values (p_agent_id) on conflict (agent_id) do nothing;
    select c.id into v_id from public.contracting_checkins c where c.agent_id = p_agent_id;
    select a.display_name,
           coalesce(nullif(pr.email,''), (select ci.email from public.contracting_intakes ci where ci.agent_id=a.id order by ci.created_at desc limit 1), ap.email)
      into v_name, v_email
      from public.agents a
      left join public.profiles pr on pr.id = a.profile_id
      left join public.applications ap on ap.id = a.source_application_id
     where a.id = p_agent_id;
  else
    select c.id, c.display_name, coalesce(nullif(c.email,''), ap.email, pr.email)
      into v_id, v_name, v_email
      from public.contracting_checkins c
      left join public.applications ap on ap.id = c.application_id
      left join public.profiles pr on pr.id = c.profile_id
     where c.id = p_checkin_id and c.agent_id is null;
    if v_id is null then raise exception 'unknown check-in row'; end if;
  end if;

  update public.contracting_checkins
     set left_at = now(), left_by = v_uid, left_reason = nullif(btrim(p_reason),''),
         flagged_no_contracts = false, updated_at = now(), updated_by = v_uid
   where id = v_id;
  insert into public.contracting_checkin_log(checkin_id, step, done, note, changed_by)
  values (v_id, 'left', true, nullif(btrim(p_reason),''), v_uid);

  return jsonb_build_object('checkin_id', v_id, 'name', v_name, 'email', v_email,
    'unsubscribed', v_email is not null and exists (
      select 1 from public.email_unsubscribes u where lower(u.email) = lower(btrim(v_email))));
end;
$$;

create or replace function public.mark_reengage_email_sent(p_checkin_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not (public.apex_is_admin() or public.has_role(auth.uid(),'manager')) then
    raise exception 'Admins and managers only' using errcode='42501';
  end if;
  update public.contracting_checkins set reengage_email_sent_at = now() where id = p_checkin_id;
  insert into public.contracting_checkin_log(checkin_id, step, done, changed_by)
  values (p_checkin_id, 'reengage_email_sent', true, auth.uid());
end;
$$;

revoke all on function public.mark_no_longer_with_us(uuid,uuid,text) from public, anon;
revoke all on function public.mark_reengage_email_sent(uuid) from public, anon;
grant execute on function public.mark_no_longer_with_us(uuid,uuid,text) to authenticated;
grant execute on function public.mark_reengage_email_sent(uuid) to authenticated;

-- Hide non-agents Sam marked as no longer with us.
CREATE OR REPLACE FUNCTION public.contracting_checkin_list()
 RETURNS TABLE(checkin_id uuid, agent_id uuid, display_name text, manager_name text, phone text, email text, agent_status text, license_status text, npn text, is_agent boolean, source text, intake_received boolean, deals_30d integer, producing boolean, flagged boolean, contracts_sent_at timestamp with time zone, contracts_confirmed_at timestamp with time zone, training_ready_at timestamp with time zone, last_call_at timestamp with time zone, last_call_outcome text, call_count integer, last_checkin_at timestamp with time zone, note text, stage text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with scope as (select * from public.fn_contracting_checkin_scope()),
  prod as (
    select coalesce(m.canonical_agent_id, p.agent_id) aid, count(*)::int n
    from public.v_production_canonical p
    left join public.v_agent_canonical_map m on m.agent_id = p.agent_id
    where p.posted_date >= (now() at time zone 'America/Phoenix')::date - 30
    group by 1
  ),
  agent_rows as (
    select a.id aid, c.*
    from public.agents a
    join scope s on s.agent_id = a.id
    left join public.contracting_checkins c on c.agent_id = a.id
    where a.canonical_agent_id is null
      and coalesce(a.agent_code,'') not like 'GHOST_%'
      and ( (a.status = 'active' and not coalesce(a.is_deactivated,false) and not coalesce(a.is_inactive,false))
            or coalesce(c.flagged_no_contracts,false) )
  )
  select r.id, a.id, a.display_name, mg.display_name,
         coalesce(nullif(pr.phone,''), nullif(ci.phone_e164,''), nullif(ap.phone,'')),
         coalesce(pr.email, ci.email, ap.email),
         case when coalesce(a.is_deactivated,false) or a.status='terminated' then 'terminated'
              when coalesce(a.is_inactive,false) or a.status='inactive' then 'inactive' else 'active' end,
         a.license_status::text, coalesce(nullif(a.nipr_number,''), ci.npn), true, 'agent',
         (ci.id is not null or a.contracted_at is not null),
         coalesce(pd.n,0), coalesce(pd.n,0) > 0, coalesce(r.flagged_no_contracts,false),
         r.contracts_sent_at, r.contracts_confirmed_at, r.training_ready_at,
         r.last_call_at, r.last_call_outcome, coalesce(r.call_count,0), r.last_checkin_at, r.note,
         case
           when r.training_ready_at is not null then 'ready_for_training'
           when r.contracts_confirmed_at is not null then 'contracts_confirmed'
           when r.contracts_sent_at is not null then 'contracts_sent'
           when coalesce(pd.n,0) > 0 and not coalesce(r.flagged_no_contracts,false) then 'producing'
           else 'needs_contracts'
         end
  from agent_rows r
  join public.agents a on a.id = r.aid
  left join public.agents mg on mg.id = a.manager_id
  left join public.profiles pr on pr.id = a.profile_id
  left join public.applications ap on ap.id = a.source_application_id
  left join lateral (select * from public.contracting_intakes x where x.agent_id = a.id
                     order by x.created_at desc limit 1) ci on true
  left join prod pd on pd.aid = a.id
  union all
  -- people on the list who are not agents yet (applicants, portal-only, name-only)
  select c.id, null, c.display_name, null,
         coalesce(nullif(c.phone,''), nullif(ap.phone,''), nullif(pr.phone,'')),
         coalesce(c.email, ap.email, pr.email),
         'not_an_agent', ap.license_status::text, ap.nipr_number, false,
         case when c.application_id is not null then 'applicant'
              when c.profile_id is not null then 'portal account' else 'name only' end,
         false, 0, false, c.flagged_no_contracts,
         c.contracts_sent_at, c.contracts_confirmed_at, c.training_ready_at,
         c.last_call_at, c.last_call_outcome, c.call_count, c.last_checkin_at, c.note,
         case
           when c.training_ready_at is not null then 'ready_for_training'
           when c.contracts_confirmed_at is not null then 'contracts_confirmed'
           when c.contracts_sent_at is not null then 'contracts_sent'
           else 'needs_contracts'
         end
  from public.contracting_checkins c
  left join public.applications ap on ap.id = c.application_id
  left join public.profiles pr on pr.id = c.profile_id
  where c.agent_id is null and c.left_at is null and public.fn_contracting_is_staff();
$function$;
