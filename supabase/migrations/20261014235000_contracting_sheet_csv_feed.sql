-- The "apex new contracting" Google Sheet is fed by PULL (IMPORTDATA in A1), not pushed: no Google service account or
-- OAuth token exists anywhere Apex can reach, and Sam needs every agent on the form automatically. The feed key gates
-- the public edge function contracting-sheet-csv; the default advance follows Sam's own template rows ("6 month").
insert into public.system_settings (key, value) values ('contracting_sheet_feed_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) on conflict (key) do nothing;
insert into public.system_settings (key, value) values ('contracting_default_advance', '6 month') on conflict (key) do update set value = excluded.value;

CREATE OR REPLACE FUNCTION public.fn_csv_cell(x text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when x is null or x = '' then ''
              else '"' || replace(case when x ~ '^[=+\-@\t\r]' then '''' || x else x end, '"', '""') || '"' end
$function$
;

CREATE OR REPLACE FUNCTION public.contracting_sheet_csv()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- The live feed behind the "apex new contracting" Google Sheet (Sam, 2026-10-14: every agent added lands on the form
-- automatically; every producing agent is already there). One row per active agent from the same mapping the Requests
-- tab shows (fn_contracting_request_eval); producing agents first, then licensed, then the rest. A name the agent has not
-- typed on the contracting page falls back to the roster name (the IMO verifies against the license); every other blank
-- is an honest blank, never a guess.
declare v text; v_rows text;
begin
  with pop as (
    select p.agent_id, coalesce(lp.lifetime_deals, 0) as deals,
           public.fn_contracting_request_eval(p.agent_id) as e, a.license_status::text as lic,
           btrim(coalesce(pu.full_name, pp.full_name, a.display_name, '')) as nm
      from public.fn_contract_review_population() p
      join public.agents a on a.id = p.agent_id
      left join public.profiles pu on pu.user_id = a.user_id
      left join public.profiles pp on pp.id = a.profile_id
      left join public.agent_lifetime_production lp on lp.agent_id = p.agent_id
  ), cells as (
    select deals, lic, nm,
      array['contracting',
            coalesce(e->>'first_name', case when nm ~ '@' then '' else split_part(nm, ' ', 1) end),
            coalesce(e->>'last_name', case when nm ~ '@' or position(' ' in nm) = 0 then '' else substr(nm, position(' ' in nm) + 1) end),
            e->>'npn', coalesce(e->>'email', case when nm ~ '@' then nm end), '', '', '', e->>'direct_upline', e->>'commission_level', e->>'advance',
            left(e->>'dob', 10), e->>'residential_address', e->>'phone'] as c
    from pop
  )
  select string_agg((select string_agg(public.fn_csv_cell(x), ',') from unnest(c) x), E'\r\n' order by deals desc, (lic = 'licensed') desc, nm)
    into v_rows from cells;
  v := 'Request Type,Agent First Name (as appears on license),Agent Last Name (as appears on license),NPN,Agent Email Address,Agency Name (if applicable),Agency TIN (if applicable),Agency NPN (if applicable),Direct Upline,Commission Level,Advance?,DOB,Residential Address,Agent Phone';
  return v || E'\r\n' || coalesce(v_rows, '') || E'\r\n';
end;
$function$
;
revoke all on function public.contracting_sheet_csv() from public, anon, authenticated;
