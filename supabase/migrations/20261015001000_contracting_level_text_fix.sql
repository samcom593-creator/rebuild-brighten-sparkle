-- rtrim(rtrim(pct::text,'0'),'.') turned 60 into "6%" on the contracting sheet (every multiple of ten lost its zero).
-- Whole numbers print whole; only a decimal tail is trimmed.
CREATE OR REPLACE FUNCTION public.fn_contracting_request_row(p_agent uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with a as (
    select a.id, a.display_name, a.nipr_number, a.nipr_verified, a.manager_id, a.start_date, a.user_id, a.profile_id, a.source_application_id
      from public.agents a where a.id = p_agent
  ),
  cp as (select * from public.agent_contract_profile where agent_id = p_agent),
  pu as (select p.full_name, p.email, p.phone from public.profiles p, a where p.user_id = a.user_id),
  pp as (select p.full_name, p.email, p.phone from public.profiles p, a where p.id = a.profile_id),
  app as (select ap.first_name, ap.last_name, ap.email, ap.phone, ap.nipr_number from public.applications ap, a where ap.id = a.source_application_id),
  lvl as (select l.pct, l.provenance from public.fn_agent_contract_pct(p_agent) l),
  mgr as (select m.id, coalesce(mp.full_name, m.display_name) as name
            from a join public.agents m on m.id = a.manager_id left join public.profiles mp on mp.id = m.profile_id),
  req as (select r.* from public.contracting_requests r
           where r.agent_id = p_agent and r.status not in ('archived','declined') order by r.created_at desc limit 1),
  adv as (select nullif(btrim(s.value), '') as v from public.system_settings s where s.key = 'contracting_default_advance'),
  ph as (select regexp_replace(coalesce((select phone from pu), (select phone from pp), (select phone from app), ''), '\D', '', 'g') as digits,
                case when (select phone from pu) is not null or (select phone from pp) is not null then 'profile'
                     when (select phone from app) is not null then 'application' end as src),
  ten as (select case when length(digits) = 11 and left(digits, 1) = '1' then substr(digits, 2) when length(digits) = 10 then digits end as d, src from ph)
  select jsonb_build_object(
    'agent_id', a.id,
    'display_name', coalesce(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)'),
    'start_date', a.start_date,
    'request_type', 'contracting',
    'first_name', coalesce(cp.first_name, app.first_name),
    'first_name_source', case when cp.first_name is not null then 'agent' when app.first_name is not null then 'application' end,
    'last_name', coalesce(cp.last_name, app.last_name),
    'last_name_source', case when cp.last_name is not null then 'agent' when app.last_name is not null then 'application' end,
    'npn', coalesce(nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(app.nipr_number, ''), '\D', '', 'g'), '')),
    'npn_source', case when nullif(regexp_replace(coalesce(a.nipr_number, ''), '\D', '', 'g'), '') is not null then (case when a.nipr_verified then 'agent record (verified)' else 'agent record' end)
                       when nullif(regexp_replace(coalesce(app.nipr_number, ''), '\D', '', 'g'), '') is not null then 'application' end,
    'email', coalesce(cp.email, pu.email, pp.email, app.email),
    'email_source', case when cp.email is not null then 'agent' when coalesce(pu.email, pp.email) is not null then 'profile' when app.email is not null then 'application' end,
    'agency_name', null, 'agency_tin', null, 'agency_npn', null, 'agency_applicability', 'not_established',
    'direct_upline', mgr.name, 'direct_upline_id', mgr.id, 'direct_upline_source', case when mgr.id is not null then 'agent record (manager)' end,
    'commission_level_pct', lvl.pct,
    'commission_level', case when lvl.pct is not null then (case when lvl.pct = trunc(lvl.pct) then trunc(lvl.pct)::bigint::text else rtrim(lvl.pct::text, '0') end) || '%' end,
    'commission_level_source', lvl.provenance,
    'advance', coalesce(req.advance, adv.v),
    'advance_source', case when req.advance is not null then 'request' when adv.v is not null then 'approved default' end,
    'dob', cp.dob,
    'residential_address', case when cp.address_line1 is not null and cp.city is not null and cp.resident_state is not null and cp.zip is not null
                                then concat_ws(', ', cp.address_line1, cp.address_line2, cp.city, cp.resident_state || ' ' || cp.zip) end,
    'residential_state', cp.resident_state,
    'phone', case when ten.d is not null then '(' || substr(ten.d, 1, 3) || ') ' || substr(ten.d, 4, 3) || '-' || substr(ten.d, 7, 4) end,
    'phone_source', case when ten.d is not null then ten.src end,
    'request_id', req.id, 'request_status', req.status, 'request_version', req.version, 'submitted_at', req.submitted_at,
    'sheet_status', req.sheet_status, 'sheet_synced_at', req.sheet_synced_at, 'sheet_error', req.sheet_error, 'sheet_row', req.sheet_row,
    'snapshot', req.snapshot
  )
  from a
  left join cp on true left join pu on true left join pp on true left join app on true
  left join lvl on true left join mgr on true left join req on true left join adv on true left join ten on true;
$function$
;
