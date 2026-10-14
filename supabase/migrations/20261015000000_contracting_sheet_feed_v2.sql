-- Sam, 2026-10-14: the contracting sheet in order of importance (real production first), commission level 60% by default
-- (Obi + Chudi 85, Aisha 75 set on their rows via set_review_placement_level), anyone under John Riley or KJ Vaughns moved
-- under Samuel James (SJAMES01), Jontay Taylor selectable as a manager. Data moves were applied live with a snapshot in
-- public._backup_20261014_contracting_sheet_fix (agent_id, old_manager_id, old_pct, old_is_manager); only the feed function
-- is re-declared here so the repo matches the database.
CREATE OR REPLACE FUNCTION public.contracting_sheet_csv()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- The live feed behind the "apex new contracting" Google Sheet (Sam, 2026-10-14). One row per active agent, ordered by
-- importance: real production first (deals in v_production_unified, most recent sale breaking ties), then licensed,
-- then everyone else by name. Commission level defaults to 60% when no level is on file (Sam's rule; Obi and Chudi 85,
-- Aisha 75 are set on their rows). A name the agent has not typed on the contracting page falls back to the roster name;
-- every other blank is an honest blank. agent_lifetime_production is NOT used here: it filters on is_owner(), which is
-- false for the edge function's service role, and that silently turned the order alphabetical on the first cut.
declare v text; v_rows text;
begin
  with prod as (
    select coalesce(m.canonical_agent_id, u.agent_id) as agent_id, count(*)::int as deals, max(u.posted_date) as last_sale
      from public.v_production_unified u left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
     where u.origin <> 'external_daily_gap' and u.agent_id is not null group by 1
  ), pop as (
    select p.agent_id, coalesce(pr.deals, 0) as deals, pr.last_sale,
           public.fn_contracting_request_eval(p.agent_id) as e, a.license_status::text as lic,
           btrim(coalesce(pu.full_name, pp.full_name, a.display_name, '')) as nm
      from public.fn_contract_review_population() p
      join public.agents a on a.id = p.agent_id
      left join public.profiles pu on pu.user_id = a.user_id
      left join public.profiles pp on pp.id = a.profile_id
      left join prod pr on pr.agent_id = p.agent_id
  ), cells as (
    select deals, last_sale, lic, nm,
      array['contracting',
            coalesce(e->>'first_name', case when nm ~ '@' then '' else split_part(nm, ' ', 1) end),
            coalesce(e->>'last_name', case when nm ~ '@' or position(' ' in nm) = 0 then '' else substr(nm, position(' ' in nm) + 1) end),
            e->>'npn', coalesce(e->>'email', case when nm ~ '@' then nm end), '', '', '', e->>'direct_upline',
            coalesce(nullif(e->>'commission_level', ''), '60%'), coalesce(nullif(e->>'advance', ''), '6 month'),
            left(e->>'dob', 10), e->>'residential_address', e->>'phone'] as c
    from pop
  )
  select string_agg((select string_agg(public.fn_csv_cell(x), ',') from unnest(c) x), E'\r\n' order by deals desc, last_sale desc nulls last, (lic = 'licensed') desc, nm)
    into v_rows from cells;
  v := 'Request Type,Agent First Name (as appears on license),Agent Last Name (as appears on license),NPN,Agent Email Address,Agency Name (if applicable),Agency TIN (if applicable),Agency NPN (if applicable),Direct Upline,Commission Level,Advance?,DOB,Residential Address,Agent Phone';
  return v || E'\r\n' || coalesce(v_rows, '') || E'\r\n';
end;
$function$
;
