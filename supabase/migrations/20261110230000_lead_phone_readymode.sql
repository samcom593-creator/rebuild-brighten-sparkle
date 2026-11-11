-- MP-LEAD-PHONE-READYMODE (2026-11-10). Sam: "a lot of agents have a habit of letting the
-- book of business put in the wrong number. If you match the lead name, make sure you use the
-- lead's number straight from ReadyMode ... this should maximize pickup rate."
--
-- Measured before building (live):
--   * v_pool_rewrite PREFERRED the typed packet phone over the ReadyMode call the packet is
--     linked to (call_id). 217 packets, all linked; 37 carry a typed phone; 16 differ from the
--     call's number — every one of those calls was a Completed Sale of 11-73 minutes, and 15 of
--     the 16 typed numbers were never dialed (the 16th: dialed once, never answered). Raymond
--     Brown's typed number is one digit off. -> rewrite now uses the call's number. No name needed.
--   * v_pool_winback takes deals.client_phone (agent-typed). 198 leads: 157 never went through
--     ReadyMode, 30 agree, 11 share a name with a ReadyMode lead on another number.
--   * A NAME ALONE IS NOT ENOUGH, proven both ways: Pamela Hill's book number is the household
--     line the sale closed on while her ReadyMode number never answered in 6 dials; April Jones /
--     Anna Miller / Raymond Johnson / Mary Hammond / Anthony Bruce are different people (ReadyMode
--     never reached anyone, dates don't line up). In marketing, 1,484 purchased leads share a name
--     with someone ReadyMode reached on another number — 0 share an email, only 121 are unique on
--     both sides. Swapping on name alone would dial strangers and LOWER pickup.
--
-- Rule (mat_lead_phone_fix, refreshed with the pool snapshot every 10 min): swap the pool number for
-- ReadyMode's number for the same name only when ReadyMode REACHED the person on its number (not
-- 'Not Available', not 'Do Not Call'), the pool number never answered any ReadyMode call, the
-- ReadyMode number is not Do-Not-Call anywhere (dialer disposition, agent mark, client_leads.dnc),
-- and one of: numbers differ by <= 2 digits ('typo'); ReadyMode's sale is within 14 days of the
-- deal ('sale_matches_deal'); one reached number + one record of that name + same area code
-- ('unique_name_same_area'); the pool number is missing ('pool_number_missing').
-- First run: 16 leads (3 win-back, 13 marketing) + 16 re-write by call link.
--
-- The replaced number travels in flags.replaced_phone10 -> lead_bundle_items.attrs so the agent's
-- client file (my_lead_detail) still finds the source record, and My Leads can show it as a
-- fallback. flags.readymode_number badges the lead. The admin sample strips the replaced number.

-- 1) decisions ---------------------------------------------------------------------------------
create materialized view if not exists public.mat_lead_phone_fix as
with ev as (
  select c.lead_name_key as k, c.lead_phone10 as p,
         bool_or(c.disposition is not null and c.disposition not in ('Not Available', 'Do Not Call')) as reached,
         bool_or(c.disposition = 'Completed Sale') as sold,
         max(c.call_started_at) filter (where c.disposition = 'Completed Sale') as sold_at,
         max(c.call_started_at) filter (where c.disposition is not null and c.disposition not in ('Not Available', 'Do Not Call')) as last_reached
  from public.readymode_dialer_calls c
  where c.lead_phone10 ~ '^[0-9]{10}$' and length(c.lead_name_key) >= 6
  group by 1, 2
),
reached_p as (
  select distinct c.lead_phone10 as p from public.readymode_dialer_calls c
  where c.lead_phone10 is not null and c.disposition is not null and c.disposition not in ('Not Available', 'Do Not Call')
),
dnc_p as (
  select c.lead_phone10 as p from public.readymode_dialer_calls c where c.disposition = 'Do Not Call' and c.lead_phone10 is not null
  union select i.phone10 from public.lead_bundle_items i where i.status = 'do_not_call'
  union select right(regexp_replace(coalesce(l.phone_digits, l.phone_e164, ''), '[^0-9]', '', 'g'), 10) from public.client_leads l where l.dnc
),
good as (
  select ev.*,
         row_number() over (partition by ev.k order by ev.sold desc, ev.last_reached desc nulls last, ev.p) as rnk,
         count(*) over (partition by ev.k) as n_good
  from ev
  where ev.reached and not exists (select 1 from dnc_p d where d.p = ev.p)
),
src as (
  select 'winback'::text as source,
         right(regexp_replace(coalesce(d.client_phone, ''), '[^0-9]', '', 'g'), 10) as from_p,
         regexp_replace(lower(coalesce(d.client_first_name, '') || coalesce(d.client_last_name, '')), '[^a-z0-9]', '', 'g') as k,
         coalesce(d.posted_at::date, d.effective_date) as deal_date
  from public.deals d
  where ((lower(coalesce(d.status, '')) = any (array['lapsed', 'cancelled'])) or d.policy_status_standard ~* 'laps|cancel|withdrawn|declined|not taken')
    and (lower(coalesce(d.status, '')) <> all (array['active', 'in_force', 'submitted', 'pending']))
  union all
  select 'marketing',
         right(regexp_replace(coalesce(l.phone_digits, l.phone_e164, ''), '[^0-9]', '', 'g'), 10),
         regexp_replace(lower(coalesce(l.first_name, '') || coalesce(l.last_name, '')), '[^a-z0-9]', '', 'g'),
         null::date
  from public.client_leads l
),
srck as (select source, k, count(distinct from_p) as n_in_source from src group by 1, 2),
cand as (
  select s.source, s.from_p, s.k, s.deal_date, g.p as to_p, g.sold, g.sold_at, g.last_reached, g.n_good, sk.n_in_source,
         case when s.from_p ~ '^[0-9]{10}$'
              then (select count(*)::int from generate_series(1, 10) i where substr(g.p, i, 1) <> substr(s.from_p, i, 1)) end as digits_differ
  from src s
  join good g on g.k = s.k and g.rnk = 1
  join srck sk on sk.source = s.source and sk.k = s.k
  where length(s.k) >= 6
    and g.p is distinct from s.from_p
    and not exists (select 1 from reached_p r where r.p = s.from_p)
),
decided as (
  select c.*,
    case
      when c.from_p !~ '^[0-9]{10}$' and c.n_good = 1 and c.n_in_source = 1 then 'pool_number_missing'
      when c.digits_differ <= 2 then 'typo'
      when c.source = 'winback' and c.sold and abs(c.sold_at::date - c.deal_date) <= 14 then 'sale_matches_deal'
      when c.n_good = 1 and c.n_in_source = 1 and left(c.to_p, 3) = left(c.from_p, 3) then 'unique_name_same_area'
    end as reason
  from cand c
)
select distinct on (source, from_p, k)
  source, from_p as from_phone10, k as name_key, to_p as to_phone10, reason,
  jsonb_build_object('sold', sold, 'sold_at', sold_at, 'last_reached', last_reached, 'digits_differ', digits_differ,
                     'readymode_numbers_reached', n_good, 'name_in_source', n_in_source, 'deal_date', deal_date) as evidence,
  now() as decided_at
from decided
where reason is not null
order by source, from_p, k, deal_date desc nulls last
with data;
create unique index if not exists mat_lead_phone_fix_key on public.mat_lead_phone_fix (source, from_phone10, name_key);
revoke all on public.mat_lead_phone_fix from public, anon, authenticated;
grant select on public.mat_lead_phone_fix to service_role;


-- 2) pools read the decisions ----------------------------------------------------------------
create or replace view public.v_pool_winback as
SELECT NULL::uuid AS lead_id,
    COALESCE(f.to_phone10, "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10)) AS phone10,
    d.client_first_name AS first_name,
    d.client_last_name AS last_name,
    NULL::text AS email,
    NULL::text AS state,
        CASE
            WHEN d.client_dob IS NOT NULL THEN EXTRACT(year FROM age(d.client_dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text THEN 'A'::text
            ELSE 'B'::text
        END AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[c.name, d.product_sold, COALESCE(d.policy_status_standard, d.status)], NULL::text), ' · '::text), ''::text) AS tags,
    jsonb_build_object('lapsed', lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text, 'vantage', is_vantage_agent(d.agent_id), 'dnc', false) || jsonb_build_object('readymode_number', f.to_phone10 IS NOT NULL) || jsonb_strip_nulls(jsonb_build_object('replaced_phone10', NULLIF(f.from_phone10, ''::text))) AS flags,
    now()::date - COALESCE(d.posted_at::date, d.effective_date) AS lead_age_days,
    false AS under_9mo
   FROM deals d
     LEFT JOIN carriers c ON c.id = d.carrier_id
     LEFT JOIN mat_lead_phone_fix f ON f.source = 'winback'::text AND f.from_phone10 = "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AND f.name_key = regexp_replace(lower(COALESCE(d.client_first_name, ''::text) || COALESCE(d.client_last_name, ''::text)), '[^a-z0-9]'::text, ''::text, 'g'::text)
  WHERE ((lower(COALESCE(d.status, ''::text)) = ANY (ARRAY['lapsed'::text, 'cancelled'::text])) OR d.policy_status_standard ~* 'laps|cancel|withdrawn|declined|not taken'::text) AND (lower(COALESCE(d.status, ''::text)) <> ALL (ARRAY['active'::text, 'in_force'::text, 'submitted'::text, 'pending'::text]));

create or replace view public.v_pool_rewrite as
SELECT NULL::uuid AS lead_id,
    COALESCE(dc.lead_phone10, NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text)) AS phone10,
    p.client_first_name AS first_name,
    p.client_last_name AS last_name,
    NULL::text AS email,
    p.client_state AS state,
        CASE
            WHEN p.client_dob IS NOT NULL THEN EXTRACT(year FROM age(p.client_dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN (p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL) AND (p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL) THEN 'S'::text
            WHEN p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL OR p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL THEN 'A'::text
            ELSE 'B'::text
        END AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[
        CASE
            WHEN p.payment_method_type = 'card'::text THEN 'card on file'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.payment_method_type = 'direct_express'::text THEN 'direct express'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]) THEN 'bank on file'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text THEN 'no bank'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL THEN 'SSN collected'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL THEN 'bank collected'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]) THEN 'data collected, not booked'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(ci.spouse_coverage, false) THEN 'spouse opportunity'::text
            ELSE NULL::text
        END], NULL::text), ', '::text), ''::text) AS tags,
    jsonb_build_object('cc', p.payment_method_type = 'card'::text, 'direct_express', p.payment_method_type = 'direct_express'::text, 'bank_on_file', p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]), 'no_bank', p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text, 'ssn_collected', p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL, 'bank_collected', p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL, 'hung_up', p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]), 'spouse', COALESCE(ci.spouse_coverage, false), 'dnc', false) || jsonb_build_object('readymode_number', COALESCE((dc.lead_phone10 IS NOT NULL AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) ~ '^[0-9]{10}$'::text AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) <> dc.lead_phone10), false)) || jsonb_strip_nulls(jsonb_build_object('replaced_phone10', CASE WHEN (dc.lead_phone10 IS NOT NULL AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) ~ '^[0-9]{10}$'::text AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) <> dc.lead_phone10) THEN NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) ELSE NULL::text END)) AS flags,
    (now() AT TIME ZONE 'America/Phoenix'::text)::date - (p.call_at AT TIME ZONE 'America/Phoenix'::text)::date AS lead_age_days,
    false AS under_9mo
   FROM readymode_booking_packets p
     LEFT JOIN readymode_call_insights ci ON ci.call_id = p.call_id
     LEFT JOIN readymode_dialer_calls dc ON dc.id = p.call_id
  WHERE COALESCE(p.status, ''::text) <> 'booked'::text;

create or replace view public.v_pool_marketing as
SELECT s.lead_id,
    COALESCE(f.to_phone10, s.phone10) AS phone10,
    first_name,
    last_name,
    email,
    state,
    age,
    grade AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[
        CASE
            WHEN wants_mortgage THEN 'mortgage'::text
            ELSE NULL::text
        END,
        CASE
            WHEN is_veteran THEN 'veteran'::text
            ELSE NULL::text
        END,
        CASE
            WHEN is_homeowner THEN 'homeowner'::text
            ELSE NULL::text
        END,
        CASE
            WHEN is_policyholder THEN 'policyholder'::text
            ELSE NULL::text
        END,
        CASE
            WHEN lead_age_days < 274 THEN 'under-9mo'::text
            ELSE NULL::text
        END], NULL::text), ', '::text), ''::text) AS tags,
    jsonb_build_object('mortgage', wants_mortgage, 'veteran', is_veteran, 'homeowner', is_homeowner, 'policyholder', is_policyholder, 'dnc', dnc) || jsonb_build_object('readymode_number', f.to_phone10 IS NOT NULL) || jsonb_strip_nulls(jsonb_build_object('replaced_phone10', NULLIF(f.from_phone10, ''::text))) AS flags,
    lead_age_days,
    lead_age_days < 274 AS under_9mo
   FROM v_sellable_client_leads s
     LEFT JOIN mat_lead_phone_fix f ON f.source = 'marketing'::text AND f.from_phone10 = s.phone10 AND f.name_key = regexp_replace(lower(COALESCE(s.first_name, ''::text) || COALESCE(s.last_name, ''::text)), '[^a-z0-9]'::text, ''::text, 'g'::text);

-- 3) counts sample, snapshot refresh order, client file ------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_pool_counts(p_source text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_as_of timestamptz;
  v_excl_dnc boolean := coalesce((p_filters->>'exclude_dnc')::boolean, true);
  v_excl_sold boolean := coalesce((p_filters->>'exclude_resold')::boolean, true);
  f_tiers text[] := case when jsonb_typeof(p_filters->'tiers') = 'array' then array(select jsonb_array_elements_text(p_filters->'tiers')) end;
  f_states text[] := case when jsonb_typeof(p_filters->'states') = 'array' then array(select upper(jsonb_array_elements_text(p_filters->'states'))) end;
  f_flags text[] := case when jsonb_typeof(p_filters->'require_flags') = 'array' then array(select jsonb_array_elements_text(p_filters->'require_flags')) end;
  f_min_age integer := (p_filters->>'min_age')::int;
  f_max_age integer := (p_filters->>'max_age')::int;
  f_max_lead_age integer := (p_filters->>'max_lead_age_days')::int;
  f_vantage boolean := coalesce((p_filters->>'vantage_only')::boolean, false);
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  if p_source not in ('marketing','dialer','rewrite','winback') then
    raise exception 'Unknown lead pool: %', p_source using errcode = '22023';
  end if;
  select refreshed_at into v_as_of from public.lead_pool_snapshot_meta;
  with m as (
    select s.phone10, s.first_name, s.last_name, s.state, s.age, s.tier, s.tags, s.flags,
           s.lead_age_days, s.under_9mo, s.dnc,
           exists(select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10) as already_sold,
           exists(select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null) as in_bundle
    from public.mat_lead_pool s
    where s.source = p_source
      and (f_tiers is null or cardinality(f_tiers) = 0 or s.tier = any(f_tiers))
      and (f_states is null or cardinality(f_states) = 0 or s.state = any(f_states))
      and (f_flags is null or cardinality(f_flags) = 0
           or (select bool_and(coalesce((s.flags->>rf)::boolean, false)) from unnest(f_flags) rf))
      and (f_min_age is null or s.age >= f_min_age)
      and (f_max_age is null or s.age <= f_max_age)
      and (f_max_lead_age is null or s.lead_age_days <= f_max_lead_age)
      and (not f_vantage or coalesce((s.flags->>'vantage')::boolean, false))
  ),
  e as (select * from m where not (v_excl_dnc and dnc) and not (v_excl_sold and already_sold) and not in_bundle),
  x as (select count(*) filter (where dnc) as dnc_x, count(*) filter (where already_sold) as sold_x,
               count(*) filter (where in_bundle) as bundle_x from m)
  -- Phone-grain counts via DISTINCT subqueries, not count(distinct): the
  -- planner hashes a DISTINCT (one pass) but always SORTS count(distinct) —
  -- measured 1,005ms -> 505ms on the 125k marketing pool, two sorts spilled.
  select jsonb_build_object(
    'total', (select count(*)::int from (select distinct phone10 from e) q),
    'under_9mo', (select count(*)::int from (select distinct phone10 from e where under_9mo) q),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (
        select tier, count(*)::int n from (select distinct tier, phone10 from e) q group by tier) g), '{}'::jsonb),
    'dnc_excluded', (select dnc_x::int from x),
    'resold_excluded', (select sold_x::int from x),
    'in_bundle_excluded', (select bundle_x::int from x),
    'sample', coalesce((select jsonb_agg(row_to_json(q)) from (
        select first_name, last_name, '***-***-' || right(phone10, 4) as phone_masked,
               state, age, tier, tags, flags - 'replaced_phone10' AS flags, lead_age_days, under_9mo
        from e order by array_position(array['S','A','B','C','D'], tier), lead_age_days desc limit 25) q), '[]'::jsonb),
    'as_of', v_as_of,
    'snapshot', true
  ) into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.refresh_lead_pool_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t0 timestamptz := clock_timestamp(); n integer; ms integer;
begin
  update public.lead_pool_snapshot_meta set started_at = t0 where id;
  refresh materialized view concurrently public.mat_lead_phone_fix;
  refresh materialized view concurrently public.mat_lead_pool;
  select count(*)::int into n from public.mat_lead_pool;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  update public.lead_pool_snapshot_meta
     set refreshed_at = clock_timestamp(), rows = n, duration_ms = ms, last_error = null
   where id;
  return jsonb_build_object('rows', n, 'duration_ms', ms);
exception when others then
  update public.lead_pool_snapshot_meta set last_error = sqlerrm, error_at = now() where id;
  return jsonb_build_object('error', sqlerrm);
end $function$;

CREATE OR REPLACE FUNCTION public.my_lead_detail(p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v record; v_detail jsonb := '{}'::jsonb;
begin
  select i.* into v
  from public.lead_bundle_items i
  join public.lead_bundles b on b.id = i.bundle_id and b.archived_at is null
  where i.id = p_item and i.removed_at is null;
  if v.id is null then
    raise exception 'That lead is no longer in a live bundle.' using errcode = '22023';
  end if;
  if not (public.can_view_sold_calls() or exists (
        select 1 from public.lead_bundle_grants g
        where g.bundle_id = v.bundle_id and g.user_id = auth.uid() and g.revoked_at is null)) then
    raise exception 'This lead is not assigned to you.' using errcode = '42501';
  end if;

  if v.source_kind = 'marketing' then
    select jsonb_strip_nulls(jsonb_build_object(
      'date_of_birth', l.dob,
      'street_address', l.street_address, 'city', l.city, 'zip', l.zip, 'timezone', l.timezone,
      'alt_phone', nullif(right(regexp_replace(coalesce(l.phone_alt, ''), '[^0-9]', '', 'g'), 10), ''),
      'alt_email', l.email_alt,
      'beneficiary', l.beneficiary, 'burial_type', l.burial_type,
      'existing_policy_number', l.policy_number, 'existing_policy_carrier', l.policy_carrier,
      'existing_policy_date', l.policy_date, 'existing_policy_product', l.policy_product,
      'existing_policy_face_amount', l.policy_face_amount,
      'existing_policy_annual_premium', l.policy_annual_premium,
      'existing_policy_monthly_premium', l.policy_monthly_premium,
      'original_agent', l.original_agent,
      'loan_amount', l.loan_amount, 'loan_type', l.loan_type, 'interest_rate', l.interest_rate,
      'lien_balance', l.lien_balance, 'estimated_property_value', l.estimated_property_value,
      'estimated_equity', l.estimated_equity, 'lender_name', l.lender_name,
      'last_sale_date', l.last_sale_date, 'last_sale_amount', l.last_sale_amount,
      'military_status', l.military_status, 'veteran_status', l.veteran_status,
      'lead_type', l.lead_type, 'lead_pack', l.lead_pack, 'notes', l.notes,
      'times_dialed', nullif(l.dial_count, 0), 'last_disposition', l.last_disposition))
    into v_detail
    from public.client_leads l
    where (v.lead_id is not null and l.id = v.lead_id)
       or (v.lead_id is null and right(regexp_replace(coalesce(l.phone_digits, l.phone_e164, ''), '[^0-9]', '', 'g'), 10) = coalesce(v.attrs->>'replaced_phone10', v.phone10))
    limit 1;

  elsif v.source_kind = 'rewrite' then
    select jsonb_strip_nulls(jsonb_build_object(
      'date_of_birth', p.client_dob,
      'street_address', p.client_street, 'city', p.client_city, 'state', p.client_state, 'zip', p.client_zip,
      'email', p.client_email, 'ssn_last4', p.ssn_last4, 'tobacco', p.tobacco,
      'health_notes', p.health_notes, 'carrier_discussed', p.carrier, 'product_discussed', p.product,
      'face_amount', p.face_amount, 'monthly_premium', p.monthly_premium,
      'draft_day', p.draft_day, 'payment_method', p.payment_method_type, 'bank_name', p.bank_name,
      'beneficiaries', p.beneficiaries, 'call_summary', p.call_summary, 'key_points', p.key_points,
      'call_date', p.call_at, 'original_call_agent', p.agent_raw,
      'call_recording', dc.recording_url, 'call_duration_seconds', dc.duration_seconds,
      'transcript_excerpt', p.transcript_excerpt,
      'missing_fields', p.missing_fields))
    into v_detail
    from public.readymode_booking_packets p
    left join public.readymode_dialer_calls dc on dc.id = p.call_id
    where dc.lead_phone10 = v.phone10
       or nullif(right(regexp_replace(coalesce(p.client_phone, ''), '[^0-9]', '', 'g'), 10), '') = coalesce(v.attrs->>'replaced_phone10', v.phone10)
    order by (dc.lead_phone10 = v.phone10) desc nulls last, p.call_at desc nulls last limit 1;

  elsif v.source_kind = 'winback' then
    select jsonb_strip_nulls(jsonb_build_object(
      'date_of_birth', d.client_dob,
      'carrier', c.name, 'product', d.product_sold, 'policy_number', d.policy_number,
      'monthly_premium', d.monthly_premium, 'annual_premium', d.annual_premium,
      'face_amount', d.face_amount, 'effective_date', d.effective_date,
      'policy_status', coalesce(d.policy_status_standard, d.status),
      'payment_method', d.payment_method, 'draft_day', d.draft_day,
      'original_agent', a.display_name, 'lead_source', d.lead_source, 'notes', d.notes))
    into v_detail
    from public.deals d
    left join public.carriers c on c.id = d.carrier_id
    left join public.agents a on a.id = d.agent_id
    where right(regexp_replace(coalesce(d.client_phone, ''), '[^0-9]', '', 'g'), 10) = coalesce(v.attrs->>'replaced_phone10', v.phone10)
    -- the client may ALSO have a newer active/submitted deal on the same phone;
    -- the win-back pitch is about the policy that LAPSED, so prefer it
    -- (v_pool_winback's own predicate), newest-first only as the tiebreak.
    -- coalesce(..., false) is LOAD-BEARING: policy_status_standard is NULL on
    -- most rows, false OR (NULL ~* ...) = NULL, and DESC sorts NULLs first —
    -- without it the submitted rows outsort the lapsed one (proven live).
    order by coalesce(lower(coalesce(d.status, '')) in ('lapsed', 'cancelled')
              or d.policy_status_standard ~* 'laps|cancel|withdrawn|declined|not taken', false) desc,
             d.posted_at desc nulls last
    limit 1;

  elsif v.source_kind = 'dialer' then
    select jsonb_strip_nulls(jsonb_build_object(
      'campaign', dc.campaign_name, 'last_call_at', dc.call_started_at,
      'last_call_seconds', dc.duration_seconds, 'last_disposition', dc.disposition,
      'last_call_agent', dc.agent_raw, 'email', dc.lead_email, 'call_notes', dc.notes,
      'call_recording', dc.recording_url,
      'times_called', (select count(*) from public.readymode_dialer_calls x where x.lead_phone10 = v.phone10)))
    into v_detail
    from public.readymode_dialer_calls dc
    where dc.lead_phone10 = v.phone10
    order by dc.call_started_at desc nulls last limit 1;
  end if;

  return jsonb_build_object('source', v.source_kind, 'detail', coalesce(v_detail, '{}'::jsonb));
end $function$;
