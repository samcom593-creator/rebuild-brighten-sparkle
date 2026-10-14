-- Contracting link activity, second cut (Sam, 2026-10-14): the screen is a working queue, not a roster.
--   clicked_not_finished  opened the link, never saved the five-field profile — the people to chase, newest open first
--   never_clicked         active, not finished, never opened the link — oldest hire first (longest overdue)
--   finished              profile saved, or all four carriers already confirmed by hand, or a request submitted/approved
-- Excluded entirely: the viewer's own agent row and any agent whose login is an admin (Sam opening the page to look at
-- it is not an agent starting contracting).
create or replace function public.contracting_link_activity()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_all boolean; v_version integer; v_rows jsonb; v_counts jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  if not (v_all or public.has_role(v_uid, 'manager')) then raise exception 'not authorized' using errcode = '42501'; end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;
  with pop as (
    select a.id, a.user_id, coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') as display_name, a.start_date, a.nipr_number
      from public.agents a
      join public.fn_contract_review_population() p on p.agent_id = a.id
      left join public.profiles pu on pu.user_id = a.user_id
      left join public.profiles pp on pp.id = a.profile_id
     where (v_all or public.apex_can_read_agent(a.id))
       and (a.user_id is null or a.user_id <> v_uid)
       and not (a.user_id is not null and public.has_role(a.user_id, 'admin'))
  ), facts as (
    select p.id, p.display_name, p.start_date,
           o.first_opened_at, o.last_opened_at, coalesce(o.opens, 0) as opens,
           (cp.agent_id is not null and cp.first_name is not null and cp.last_name is not null and cp.email is not null and cp.resident_state is not null
              and nullif(regexp_replace(coalesce(p.nipr_number, ''), '\D', '', 'g'), '') is not null) as profile_saved,
           (cp.dob is not null and cp.address_line1 is not null and cp.city is not null and cp.zip is not null) as details_saved,
           (select count(*) from public.contract_review_marks m where m.agent_id = p.id and m.version = v_version) as marked_count,
           (select r.status from public.contracting_requests r where r.agent_id = p.id and r.status not in ('archived','declined') order by r.created_at desc limit 1) as request_status
      from pop p
      left join public.contracting_link_opens o on o.agent_id = p.id
      left join public.agent_contract_profile cp on cp.agent_id = p.id
  ), bucketed as (
    select f.*, case
        when f.profile_saved or f.marked_count = 4 or f.request_status in ('submitted','approved') then 'finished'
        when f.last_opened_at is not null then 'clicked_not_finished'
        else 'never_clicked' end as bucket
      from facts f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', b.id, 'display_name', b.display_name, 'start_date', b.start_date, 'bucket', b.bucket,
           'opened', b.last_opened_at is not null, 'first_opened_at', b.first_opened_at, 'last_opened_at', b.last_opened_at, 'opens', b.opens,
           'profile_saved', b.profile_saved, 'details_saved', b.details_saved, 'marked_count', b.marked_count, 'request_status', b.request_status)
         order by case b.bucket when 'clicked_not_finished' then 0 when 'never_clicked' then 1 else 2 end,
                  b.last_opened_at desc nulls last, b.start_date asc nulls last, b.display_name), '[]'::jsonb),
         jsonb_build_object(
           'clicked_not_finished', count(*) filter (where b.bucket = 'clicked_not_finished'),
           'never_clicked', count(*) filter (where b.bucket = 'never_clicked'),
           'finished', count(*) filter (where b.bucket = 'finished'),
           'opened', count(*) filter (where b.last_opened_at is not null),
           'total', count(*))
    into v_rows, v_counts from bucketed b;
  -- Everything is read in the one statement above: a CTE is not visible to a later statement in the block.
  return jsonb_build_object('ok', true, 'count', (v_counts->>'total')::int, 'opened', (v_counts->>'opened')::int,
                            'counts', v_counts, 'rows', v_rows);
end;
$$;
revoke all on function public.contracting_link_activity() from public, anon;
grant execute on function public.contracting_link_activity() to authenticated;
