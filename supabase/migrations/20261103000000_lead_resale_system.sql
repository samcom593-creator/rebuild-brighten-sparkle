-- APEX lead resale system (MP-LEAD-MANAGER, 2026-11-03).
-- Owned aged-lead resale over public.client_leads: filter -> pick a live agent ->
-- drop the pack into their portal. Resale ledger prevents double-selling, DNC
-- excluded by default, under-9mo chargeback-risk tag, grade/attribute/state/age
-- filters. Applied live via bot-sql; mirrored here for the migration ledger.
-- Does NOT touch the Vantage policyholder book. All statements idempotent.

alter table public.lead_bundle_items
  add column if not exists state text,
  add column if not exists age integer,
  add column if not exists lead_id uuid,
  add column if not exists source_kind text,
  add column if not exists attrs jsonb;

create table if not exists public.lead_resale_ledger (
  id uuid primary key default gen_random_uuid(),
  phone10 text not null,
  lead_id uuid,
  source_kind text not null default 'client_leads',
  bundle_id uuid references public.lead_bundles(id) on delete set null,
  sold_to text,
  price_cents integer,
  lead_age_days_at_sale integer,
  note text,
  marked_by uuid default auth.uid(),
  sold_at timestamptz not null default now()
);
create unique index if not exists lead_resale_ledger_phone10_key on public.lead_resale_ledger (phone10);
create index if not exists lead_resale_ledger_bundle_idx on public.lead_resale_ledger (bundle_id);
alter table public.lead_resale_ledger enable row level security;
drop policy if exists lead_resale_ledger_admin_all on public.lead_resale_ledger;
create policy lead_resale_ledger_admin_all on public.lead_resale_ledger
  for all to authenticated using (public.can_view_sold_calls()) with check (public.can_view_sold_calls());

alter table public.lead_bundles drop constraint if exists lead_bundles_format_check;
alter table public.lead_bundles add constraint lead_bundles_format_check
  check (format = any (array['called_leads','pos','client_leads']));

drop view if exists public.v_sellable_client_leads;
create view public.v_sellable_client_leads with (security_invoker = true) as
 SELECT id AS lead_id,
    "right"(regexp_replace(COALESCE(phone_digits, phone_e164, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AS phone10,
    NULLIF(btrim(first_name), ''::text) AS first_name,
    NULLIF(btrim(last_name), ''::text) AS last_name,
    NULLIF(btrim(email), ''::text) AS email,
    upper(NULLIF(btrim(state), ''::text)) AS state,
    age,
    lead_tier,
    lead_type,
    lead_pack,
        CASE
            WHEN lead_tier = ANY (ARRAY['A List'::text, 'A_PLUS_BENEFICIARY'::text]) THEN 'A'::text
            WHEN lead_tier = 'B_LIST'::text THEN 'B'::text
            WHEN lead_tier = 'C_LIST'::text THEN 'C'::text
            ELSE 'D'::text
        END AS grade,
    (COALESCE(candidate_type, ''::text) <> ALL (ARRAY[''::text, 'Remaining'::text])) OR lead_type ~* '(cash out|refinance|heloc|reverse|mortgage|lower payment|jumbo|cash purchase)'::text OR COALESCE(is_homeowner, false) OR COALESCE(loan_amount, 0::numeric) > 0::numeric AS wants_mortgage,
    veteran_status IS NOT NULL OR military_status IS NOT NULL OR lead_pack ~* 'veteran'::text OR lead_type ~* '(veteran|\mva\M)'::text AS is_veteran,
    COALESCE(is_homeowner, false) AS is_homeowner,
    COALESCE(has_existing_policy, false) AS is_policyholder,
    COALESCE(dnc, false) AS dnc,
    policy_carrier,
    policy_face_amount,
    estimated_equity,
    dial_count,
    last_dialed_at,
    last_disposition,
    (now() AT TIME ZONE 'America/Phoenix'::text)::date - COALESCE(lead_date, (created_at AT TIME ZONE 'America/Phoenix'::text)::date) AS lead_age_days
   FROM client_leads l;

CREATE OR REPLACE FUNCTION public.sellable_leads_match(p_filters jsonb)
 RETURNS TABLE(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text, age integer, grade text, wants_mortgage boolean, is_veteran boolean, is_homeowner boolean, is_policyholder boolean, dnc boolean, lead_age_days integer, policy_carrier text, policy_face_amount numeric, dial_count integer, last_dialed_at timestamp with time zone, last_disposition text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with f as (
    select
      case when jsonb_typeof(p_filters->'grades') = 'array'
        then array(select jsonb_array_elements_text(p_filters->'grades')) end as grades,
      case when jsonb_typeof(p_filters->'states') = 'array'
        then array(select upper(jsonb_array_elements_text(p_filters->'states'))) end as states,
      coalesce((p_filters->>'wants_mortgage')::boolean, false)  as f_mortgage,
      coalesce((p_filters->>'is_veteran')::boolean, false)      as f_veteran,
      coalesce((p_filters->>'is_homeowner')::boolean, false)    as f_homeowner,
      coalesce((p_filters->>'policyholders_only')::boolean, false) as f_policyholder,
      (p_filters->>'min_age')::int as min_age,
      (p_filters->>'max_age')::int as max_age,
      (p_filters->>'max_lead_age_days')::int as max_lead_age_days,
      coalesce((p_filters->>'exclude_dnc')::boolean, true)      as exclude_dnc,
      coalesce((p_filters->>'exclude_resold')::boolean, true)   as exclude_resold
  )
  select s.lead_id, s.phone10, s.first_name, s.last_name, s.email, s.state, s.age,
         s.grade, s.wants_mortgage, s.is_veteran, s.is_homeowner, s.is_policyholder,
         s.dnc, s.lead_age_days, s.policy_carrier, s.policy_face_amount,
         s.dial_count, s.last_dialed_at, s.last_disposition
  from public.v_sellable_client_leads s cross join f
  where s.phone10 ~ '^[0-9]{10}$'
    and (f.grades is null or cardinality(f.grades) = 0 or s.grade = any(f.grades))
    and (f.states is null or cardinality(f.states) = 0 or s.state = any(f.states))
    and (not f.f_mortgage    or s.wants_mortgage)
    and (not f.f_veteran     or s.is_veteran)
    and (not f.f_homeowner   or s.is_homeowner)
    and (not f.f_policyholder or s.is_policyholder)
    and (f.min_age is null or s.age >= f.min_age)
    and (f.max_age is null or s.age <= f.max_age)
    and (f.max_lead_age_days is null or s.lead_age_days <= f.max_lead_age_days)
    and (not f.exclude_dnc or not s.dnc)
    and (not f.exclude_resold or not exists (
          select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10))
    and not exists (
          select 1 from public.lead_bundle_items i
          where i.phone10 = s.phone10 and i.removed_at is null);
$function$;

CREATE OR REPLACE FUNCTION public.lead_resale_pool_counts(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_result jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse the resale pool.' using errcode = '42501';
  end if;
  with m as (select * from public.sellable_leads_match(p_filters))
  select jsonb_build_object(
    'total', (select count(*)::int from m),
    'by_grade', coalesce((select jsonb_object_agg(grade, n)
                          from (select grade, count(*)::int n from m group by grade) g), '{}'::jsonb),
    'under_9mo', (select count(*)::int from m where lead_age_days < 274),  -- < 9 months
    'sample', coalesce((select jsonb_agg(row_to_json(t)) from (
        select first_name, last_name, '***-***-' || right(phone10, 4) as phone_masked,
               state, age, grade, wants_mortgage, is_veteran, is_policyholder,
               lead_age_days, (lead_age_days < 274) as under_9mo
        from m order by grade, lead_age_days desc limit 25) t), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.lead_bundle_build(p_name text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 100, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_n int; v_sort text := coalesce(p_filters->>'sort', 'grade');
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can build lead bundles.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'A bundle holds 1 to 5,000 leads.' using errcode = '22023';
  end if;
  insert into public.lead_bundles (name, format, criteria, note, created_by)
  values (coalesce(nullif(btrim(p_name), ''),
            'Leads ' || to_char(now() at time zone 'America/Phoenix', 'Mon DD')),
          'client_leads', coalesce(p_filters, '{}'::jsonb) || jsonb_build_object('limit', p_limit),
          nullif(btrim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into public.lead_bundle_items
    (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email,
     state, age, quality_tier, quality_reason, attempts, last_dialed_at, last_disposition, status, attrs)
  select v_id, m.lead_id, 'client_leads', m.phone10, m.first_name, m.last_name, m.email,
         m.state, m.age, m.grade,
         nullif(array_to_string(array_remove(array[
             case when m.wants_mortgage then 'mortgage' end,
             case when m.is_veteran then 'veteran' end,
             case when m.is_homeowner then 'homeowner' end,
             case when m.is_policyholder then 'policyholder' end,
             case when m.lead_age_days < 274 then 'under-9mo' end], null), ', '), ''),
         m.dial_count, m.last_dialed_at, m.last_disposition, 'new',
         jsonb_build_object(
           'grade', m.grade, 'wants_mortgage', m.wants_mortgage, 'is_veteran', m.is_veteran,
           'is_homeowner', m.is_homeowner, 'is_policyholder', m.is_policyholder,
           'lead_age_days', m.lead_age_days, 'under_9mo', (m.lead_age_days < 274),
           'policy_carrier', m.policy_carrier, 'policy_face_amount', m.policy_face_amount)
  from public.sellable_leads_match(p_filters) m
  order by
    case when v_sort = 'chargeback' then (case when m.lead_age_days < 274 then 0 else 1 end) end asc nulls last,
    case when v_sort = 'chargeback' then m.lead_age_days end asc,
    case when v_sort = 'oldest' then m.lead_age_days end desc,
    array_position(array['A','B','C','D'], m.grade), m.lead_age_days asc
  limit p_limit;
  get diagnostics v_n = row_count;

  insert into public.lead_bundle_events (bundle_id, actor, action, detail)
  values (v_id, auth.uid(), 'created',
          jsonb_build_object('items', v_n, 'filters', p_filters, 'source', 'client_leads'));
  return jsonb_build_object('bundle_id', v_id, 'items', v_n);
end $function$;

CREATE OR REPLACE FUNCTION public.lead_bundle_assign(p_filters jsonb, p_limit integer, p_agent_user_id uuid, p_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_agent_name text; v_name text; v_res jsonb; v_bundle uuid; v_items int;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can drop leads into a portal.' using errcode = '42501';
  end if;
  select a.display_name into v_agent_name
  from public.agents a
  where a.user_id = p_agent_user_id and a.status = 'active'
    and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
  order by (a.canonical_agent_id is null) desc, a.created_at
  limit 1;
  if v_agent_name is null then
    raise exception 'Pick a live agent with a portal login.' using errcode = '22023';
  end if;

  v_name := coalesce(nullif(btrim(p_name), ''),
    v_agent_name || ' - ' || to_char(now() at time zone 'America/Phoenix', 'Mon DD') || ' leads');
  v_res := public.lead_bundle_build(v_name, p_filters, p_limit, p_note);
  v_bundle := (v_res->>'bundle_id')::uuid;
  v_items  := (v_res->>'items')::int;

  insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
  values (v_bundle, p_agent_user_id, auth.uid(), nullif(btrim(p_note), ''));
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  values (v_bundle, p_agent_user_id, auth.uid(), 'granted',
          jsonb_build_object('agent', v_agent_name, 'items', v_items));

  return jsonb_build_object('bundle_id', v_bundle, 'items', v_items, 'agent', v_agent_name);
end $function$;

CREATE OR REPLACE FUNCTION public.lead_assignable_agents(p_search text DEFAULT NULL::text)
 RETURNS TABLE(user_id uuid, agent_id uuid, display_name text, subagency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct on (a.user_id)
    a.user_id, a.id as agent_id, a.display_name, public.fn_agent_subagency(a.id) as subagency
  from public.agents a
  where public.can_view_sold_calls()
    and a.user_id is not null
    and a.status = 'active'
    and coalesce(a.is_deactivated, false) = false
    and coalesce(a.is_inactive, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
    and (nullif(btrim(p_search), '') is null
         or a.display_name ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by a.user_id, (a.canonical_agent_id is null) desc, a.created_at
$function$;

CREATE OR REPLACE FUNCTION public.lead_bundle_mark_sold(p_bundle uuid, p_sold_to text DEFAULT NULL::text, p_price_cents integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_newly int; v_already int;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can mark bundles sold.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lead_bundles b where b.id = p_bundle) then
    raise exception 'No such bundle.' using errcode = '22023';
  end if;
  with ins as (
    insert into public.lead_resale_ledger
      (phone10, lead_id, source_kind, bundle_id, sold_to, price_cents, lead_age_days_at_sale, note)
    select i.phone10, i.lead_id, coalesce(i.source_kind, 'client_leads'), p_bundle,
           nullif(btrim(p_sold_to), ''), p_price_cents,
           (i.attrs->>'lead_age_days')::int, nullif(btrim(p_note), '')
    from public.lead_bundle_items i
    where i.bundle_id = p_bundle and i.removed_at is null and i.phone10 ~ '^[0-9]{10}$'
    on conflict (phone10) do nothing
    returning 1)
  select count(*)::int into v_newly from ins;
  update public.lead_bundle_items
    set status = 'sold', status_by = auth.uid(), status_at = now(),
        status_note = coalesce(status_note, nullif(btrim(p_note), ''))
    where bundle_id = p_bundle and removed_at is null and status <> 'sold';
  select count(*)::int into v_already
    from public.lead_bundle_items i
    where i.bundle_id = p_bundle and i.removed_at is null
      and exists (select 1 from public.lead_resale_ledger r
                  where r.phone10 = i.phone10 and r.bundle_id is distinct from p_bundle);
  insert into public.lead_bundle_events (bundle_id, actor, action, detail)
  values (p_bundle, auth.uid(), 'sold',
          jsonb_build_object('sold_to', p_sold_to, 'price_cents', p_price_cents,
                             'newly_ledgered', v_newly, 'already_sold_elsewhere', v_already));
  return jsonb_build_object('ok', true, 'newly_ledgered', v_newly,
                            'already_sold_elsewhere', v_already);
end $function$;

CREATE OR REPLACE FUNCTION public.lead_bundle_recent(p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    select b.id as bundle_id, b.name, b.format, b.criteria, b.note, b.created_at, b.archived_at,
      count(i.id) filter (where i.removed_at is null)::int as live_items,
      count(i.id) filter (where i.removed_at is null and i.status = 'sold')::int as sold,
      count(i.id) filter (where (i.attrs->>'under_9mo')::boolean is true and i.removed_at is null)::int as under_9mo,
      exists(select 1 from public.lead_resale_ledger r where r.bundle_id = b.id) as resold,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'user_id', g.user_id, 'granted_at', g.granted_at,
          'name', (select a2.display_name from public.agents a2
                   where a2.user_id = g.user_id
                   order by (a2.canonical_agent_id is null) desc, a2.created_at limit 1))
        order by g.granted_at), '[]'::jsonb)
        from public.lead_bundle_grants g where g.bundle_id = b.id and g.revoked_at is null) as holders
    from public.lead_bundles b
    left join public.lead_bundle_items i on i.bundle_id = b.id
    where b.format = 'client_leads'
    group by b.id
    order by b.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) t;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.lead_bundle_export(p_bundle uuid)
 RETURNS TABLE(first_name text, last_name text, phone10 text, email text, state text, age integer, grade text, tags text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.first_name, i.last_name, i.phone10, i.email, i.state, i.age,
         i.quality_tier, i.quality_reason, i.status
  from public.lead_bundle_items i
  where i.bundle_id = p_bundle and i.removed_at is null
    and public.can_view_sold_calls()
  order by array_position(array['A','B','C','D'], i.quality_tier), i.last_name nulls last;
$function$;

grant execute on function public.sellable_leads_match(jsonb) to authenticated;
grant execute on function public.lead_resale_pool_counts(jsonb) to authenticated;
grant execute on function public.lead_bundle_build(text, jsonb, integer, text) to authenticated;
grant execute on function public.lead_bundle_assign(jsonb, integer, uuid, text, text) to authenticated;
grant execute on function public.lead_assignable_agents(text) to authenticated;
grant execute on function public.lead_bundle_mark_sold(uuid, text, integer, text) to authenticated;
grant execute on function public.lead_bundle_recent(integer) to authenticated;
grant execute on function public.lead_bundle_export(uuid) to authenticated;
