-- Contracting call list v2 (Sam, 2026-10-14): "42 people to call, but some of them are actively selling, posting deals,
-- and it shows they never opened the link." Link opens are only tracked since today, so "never opened" says nothing
-- about people contracted before that. A posted deal is contracting evidence: anyone with lifetime production moves to
-- a 'selling' bucket (counted and listed below the call list, never in it) with their last sale date.
create or replace function public.contracting_call_list()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_all boolean; v_version integer; v_rows jsonb; v_counts jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va');
  if not (v_all or public.has_role(v_uid, 'manager')) then raise exception 'not authorized' using errcode = '42501'; end if;
  select c.version into v_version from public.contract_review_config c where c.singleton;
  with pop as (
    select a.id, a.user_id, coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') as display_name,
           a.start_date, a.nipr_number, a.license_status::text as license_status, a.licensed_at, a.license_states,
           coalesce(nullif(btrim(pu.phone), ''), nullif(btrim(pp.phone), ''), nullif(btrim(ap.phone), '')) as phone
      from public.agents a
      join public.fn_contract_review_population() p on p.agent_id = a.id
      left join public.profiles pu on pu.user_id = a.user_id
      left join public.profiles pp on pp.id = a.profile_id
      left join public.applications ap on ap.id = a.source_application_id
     where (v_all or public.apex_can_read_agent(a.id))
       and (a.user_id is null or a.user_id <> v_uid)
       and not (a.user_id is not null and public.has_role(a.user_id, 'admin'))
  ), facts as (
    select p.*, o.first_opened_at, o.last_opened_at, coalesce(o.opens, 0) as opens,
           (cp.agent_id is not null and cp.first_name is not null and cp.last_name is not null and cp.email is not null and cp.resident_state is not null
              and nullif(regexp_replace(coalesce(p.nipr_number, ''), '\D', '', 'g'), '') is not null) as profile_saved,
           (cp.dob is not null and cp.address_line1 is not null and cp.city is not null and cp.zip is not null) as details_saved,
           (select count(*) from public.contract_review_marks m where m.agent_id = p.id and m.version = v_version) as marked_count,
           (select r.status from public.contracting_requests r where r.agent_id = p.id and r.status not in ('archived','declined') order by r.created_at desc limit 1) as request_status,
           f.channel as last_channel, f.outcome as last_outcome, f.created_at as last_followup_at, f.acted_by as last_by,
           fp.full_name as last_by_name,
           coalesce(lp.lifetime_deals, 0) as lifetime_deals, lp.last_production_date as last_sale
      from pop p
      left join public.agent_lifetime_production lp on lp.agent_id = p.id
      left join public.contracting_link_opens o on o.agent_id = p.id
      left join public.agent_contract_profile cp on cp.agent_id = p.id
      left join lateral (select x.channel, x.outcome, x.created_at, x.acted_by from public.contracting_followups x
                          where x.agent_id = p.id order by x.created_at desc limit 1) f on true
      left join public.profiles fp on fp.user_id = f.acted_by
  ), graded as (
    select f.*,
      case when f.marked_count = 4 or f.request_status in ('submitted','approved') or (f.profile_saved and f.details_saved) then 'finished'
           when f.license_status <> 'licensed' then 'unlicensed'
           -- A posted deal is contracting evidence the link log cannot see (opens are only tracked from 2026-10-14).
           when f.lifetime_deals > 0 then 'selling'
           when f.last_outcome = 'not_interested' and f.last_followup_at > now() - interval '30 days' then 'not_now'
           when f.last_followup_at > now() - interval '7 days' then 'called_recently'
           else 'to_call' end as bucket,
      case when f.profile_saved then 'missing_details'
           when f.last_opened_at is not null then 'opened_not_saved'
           else 'never_opened' end as reason
      from facts f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', g.id, 'display_name', g.display_name, 'phone', g.phone,
           'license_states', g.license_states, 'licensed_at', g.licensed_at, 'start_date', g.start_date,
           'bucket', g.bucket, 'reason', g.reason,
           'last_opened_at', g.last_opened_at, 'opens', g.opens, 'marked_count', g.marked_count,
           'profile_saved', g.profile_saved, 'details_saved', g.details_saved, 'request_status', g.request_status,
           'lifetime_deals', g.lifetime_deals, 'last_sale', g.last_sale,
           'followup', case when g.last_followup_at is null then null else jsonb_build_object(
               'channel', g.last_channel, 'outcome', g.last_outcome, 'at', g.last_followup_at,
               'by', g.last_by_name, 'mine', g.last_by = v_uid) end)
         order by case g.bucket when 'to_call' then 0 when 'called_recently' then 1 when 'not_now' then 2 when 'selling' then 3 else 4 end,
                  case when g.bucket = 'selling' then g.last_sale end desc nulls last,
                  case when g.bucket = 'called_recently' then g.last_followup_at end asc nulls last,
                  case g.reason when 'opened_not_saved' then 0 when 'missing_details' then 1 else 2 end,
                  g.last_opened_at desc nulls last, g.licensed_at asc nulls last, g.start_date asc nulls last, g.display_name)
         filter (where g.bucket <> 'unlicensed'), '[]'::jsonb),
         jsonb_build_object(
           'to_call', count(*) filter (where g.bucket = 'to_call'),
           'called_recently', count(*) filter (where g.bucket = 'called_recently'),
           'not_now', count(*) filter (where g.bucket = 'not_now'),
           'finished', count(*) filter (where g.bucket = 'finished'),
           'selling', count(*) filter (where g.bucket = 'selling'),
           'unlicensed', count(*) filter (where g.bucket = 'unlicensed'),
           'no_phone', count(*) filter (where g.bucket in ('to_call','called_recently') and g.phone is null),
           'total', count(*))
    into v_rows, v_counts from graded g;
  -- Everything is read in the one statement above: a CTE is not visible to a later statement in the block.
  return jsonb_build_object('ok', true, 'counts', v_counts, 'rows', v_rows);
end;
$$;
revoke all on function public.contracting_call_list() from public, anon;
grant execute on function public.contracting_call_list() to authenticated;
