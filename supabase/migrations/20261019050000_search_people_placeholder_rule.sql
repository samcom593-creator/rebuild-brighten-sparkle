-- PL-WIB-SEARCH-PEOPLE-PLACEHOLDER (2026-10-19). apex-doctor Check #90 CRITICAL: search_people spelled the
-- placeholder-agent rule inline again. MP-593 (20261010003500) had routed it through public.is_placeholder_agent;
-- 20261011010000_search_people_recent copied the older body and put the inline form back.
--
-- The inline form was not "the same rule spelled twice". `not (a.agent_code like 'GHOST\_%' and a.user_id is null)`
-- is NULL when agent_code is NULL and user_id is NULL, and a NULL WHERE drops the row. is_placeholder_agent
-- coalesces agent_code to '', so it answers false for those rows. Measured 2026-10-19: 7 real agents have no
-- agent_code and no login, and the Command Palette search could not find any of them (one is active, licensed,
-- with 3 deals). The placeholder set is identical under both forms (6 GHOST_AYRO_* rows), so nobody new appears.
--
-- Body below is the live definition (pg_get_functiondef) with only that clause substituted. Proof:
-- python3 scripts/tests/run-search-people.py (test 14 fails on the pre-image, passes on this body).
begin;

CREATE OR REPLACE FUNCTION public.search_people(p_q text, p_limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_all boolean;
  v_manager boolean;
  v_caller_agent uuid;
  v_tokens text[];
  v_q text := regexp_replace(btrim(coalesce(p_q, '')), '\s+', ' ', 'g');
  v_lim integer := greatest(1, least(coalesce(p_limit, 8), 25));
  v_agents jsonb;
  v_apps jsonb;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  v_all := public.apex_is_admin() or public.has_role(v_uid, 'va_manager') or public.has_role(v_uid, 'va') or public.has_role(v_uid, 'recruiter');
  v_manager := public.has_role(v_uid, 'manager');
  if not (v_all or v_manager) then return jsonb_build_object('ok', true, 'agents', '[]'::jsonb, 'applicants', '[]'::jsonb); end if;
  if char_length(v_q) = 1 then return jsonb_build_object('ok', true, 'agents', '[]'::jsonb, 'applicants', '[]'::jsonb); end if;
  select a.id into v_caller_agent from public.agents a where a.user_id = v_uid order by (a.canonical_agent_id is null) desc, a.created_at desc limit 1;
  v_tokens := (select array_agg('%' || public.fn_like_escape(t) || '%') from (select distinct lower(t) t from unnest(string_to_array(v_q, ' ')) t where t <> '' limit 6) x);

  with cand as (
    select a.id, a.created_at, coalesce(nullif(btrim(pr.full_name), ''), a.display_name, 'Name not on file') as name,
           coalesce(pr.email, '') as email, coalesce(pr.phone, '') as phone, coalesce(a.agent_code, '') as code,
           a.status::text as status, a.license_status::text as license, s.stage as stage,
           (select m.display_name from public.agents m where m.id = coalesce(a.manager_id, a.invited_by_manager_id)) as upline,
           lower(coalesce(nullif(btrim(pr.full_name), ''), a.display_name, '') || ' ' || coalesce(pr.email, '') || ' ' || regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g') || ' ' || coalesce(a.agent_code, '')) as hay
      from public.agents a
      left join public.profiles pr on pr.user_id = a.user_id
      left join public.agent_stage s on s.agent_id = a.id
     where (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and not public.is_placeholder_agent(a.agent_code, a.user_id)
       and (v_all or public.apex_can_read_agent(a.id))
  ), hit as (
    select c.*, case when lower(c.name) like public.fn_like_escape(lower(v_q)) || '%' then 0
                     when lower(c.name) like '%' || public.fn_like_escape(lower(split_part(v_q, ' ', 1))) || '%' then 1 else 2 end as rank
      from cand c
     where v_q = '' or (select bool_and(c.hay like t) from unnest(v_tokens) t)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'email', nullif(h.email, ''), 'phone', nullif(h.phone, ''), 'code', nullif(h.code, ''),
           'status', h.status, 'license', h.license, 'stage', h.stage, 'upline', h.upline) order by h.rank, case when v_q = '' then h.created_at end desc, h.name, h.id), '[]'::jsonb)
    into v_agents from (select * from hit order by rank, case when v_q = '' then created_at end desc, name, id limit v_lim) h;

  with cand as (
    select ap.id, btrim(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, '')) as name, coalesce(ap.email, '') as email, coalesce(ap.phone, '') as phone,
           ap.status::text as status, ap.license_status::text as license, ap.created_at,
           lower(coalesce(ap.first_name, '') || ' ' || coalesce(ap.last_name, '') || ' ' || coalesce(ap.email, '') || ' ' || regexp_replace(coalesce(ap.phone, ''), '\D', '', 'g')) as hay
      from public.applications ap
     where v_all
        or (v_manager and (ap.hiring_manager_user_id = v_uid or ap.referral_manager_id = v_caller_agent
                           or (ap.assigned_agent_id is not null and public.apex_can_read_agent(ap.assigned_agent_id))
                           or (ap.referrer_agent_id is not null and public.apex_can_read_agent(ap.referrer_agent_id))))
  ), hit as (
    select c.*, case when lower(c.name) like public.fn_like_escape(lower(v_q)) || '%' then 0
                     when lower(c.name) like '%' || public.fn_like_escape(lower(split_part(v_q, ' ', 1))) || '%' then 1 else 2 end as rank
      from cand c
     where v_q = '' or (select bool_and(c.hay like t) from unnest(v_tokens) t)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'email', nullif(h.email, ''), 'phone', nullif(h.phone, ''),
           'status', h.status, 'license', h.license, 'applied_at', h.created_at) order by h.rank, h.created_at desc, h.id), '[]'::jsonb)
    into v_apps from (select * from hit order by rank, created_at desc, id limit v_lim) h;

  return jsonb_build_object('ok', true, 'q', v_q, 'agents', v_agents, 'applicants', v_apps);
end $function$;

revoke all on function public.search_people(text, integer) from public, anon;
grant execute on function public.search_people(text, integer) to authenticated, service_role;

commit;
