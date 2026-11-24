-- MP-LEAD-MANAGER-RM (2026-11-24). Sam: "pull all leads from ReadyMode ... so they're all accessible within the lead
-- manager on the website ... for all categories I should have the same options like filtering through state ... a
-- description of each lead type A, B, C, D ... a record button on each lead ... move leads out of inboxes and remove
-- them from people who aren't working them."
--
-- Measured before this: the Dialer pool held 37,589 phones (only numbers ReadyMode had CALLED since April, no state,
-- no campaign) while ReadyMode's own lead pool held 384,156. Nothing pulled the lead list itself.
--
--  1. readymode_leads: every lead ReadyMode holds, pulled by readymode-bot/scripts/rm-leads-pull.mjs.
--  2. v_pool_dialer = every ReadyMode lead (+ any called phone the list no longer has), with state, age, campaign.
--  3. A state on win-back and re-write leads, so every pool filters by state.
--  4. Campaign filter + facets for the pickers.
--  5. Who is sitting on leads: board, pull back, move, pause the automatic top-up.
--  6. Every recording an agent makes on a lead is kept against that lead (phone), not just the last one.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. The ReadyMode lead list
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.readymode_leads (
  rm_lead_id    bigint primary key,
  phone10       text,
  first_name    text,
  last_name     text,
  email         text,
  address       text,
  city          text,
  state         text,
  zip           text,
  age           integer,
  campaign      text,
  batch_name    text,
  times_called  integer not null default 0,
  attrs         jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  pulled_at     timestamptz not null default now()
);
create index if not exists readymode_leads_phone10 on public.readymode_leads (phone10);
create index if not exists readymode_leads_campaign on public.readymode_leads (campaign);
alter table public.readymode_leads enable row level security;
revoke all on public.readymode_leads from anon, authenticated;
comment on table public.readymode_leads is
  'Every lead in ReadyMode''s lead pool (all campaigns), pulled from the View-leads feed by readymode-bot/scripts/rm-leads-pull.mjs. Read through v_pool_dialer / mat_lead_pool only.';

create or replace function public.fn_lead_age(p_age text, p_dob text)
returns integer language plpgsql stable set search_path to 'public' as $$
declare v integer; d date;
begin
  if p_age ~ '^\s*[0-9]{1,3}(\.[0-9]+)?\s*$' then
    v := floor(p_age::numeric)::int;
    if v between 18 and 110 then return v; end if;
  end if;
  if p_dob is not null and btrim(p_dob) <> '' then
    begin
      if p_dob ~ '^\s*[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}' then d := substring(btrim(p_dob) from '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}')::date;
      elsif p_dob ~ '^\s*[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}' then d := to_date(substring(btrim(p_dob) from '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}'), 'MM/DD/YYYY');
      end if;
    exception when others then d := null;
    end;
    if d is not null then
      v := extract(year from age(d))::int;
      if v between 18 and 110 then return v; end if;
    end if;
  end if;
  return null;
end $$;

-- Loader. A phone is kept only in the dialable shape (area code and exchange never start with 0 or 1):
-- right(digits, 10) alone turns junk into plausible numbers.
create or replace function public.upsert_readymode_leads(p_rows jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  insert into public.readymode_leads as t
    (rm_lead_id, phone10, first_name, last_name, email, address, city, state, zip, age, campaign, batch_name, times_called, attrs, pulled_at)
  select distinct on ((r->>'id')::bigint)
         (r->>'id')::bigint,
         case when p.ph ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then p.ph end,
         nullif(btrim(r->>'fn'), ''), nullif(btrim(r->>'ln'), ''), nullif(lower(btrim(r->>'email')), ''),
         nullif(btrim(r->>'addr'), ''), nullif(btrim(r->>'city'), ''),
         case when btrim(r->>'st') ~ '^[A-Za-z]{2}$' then upper(btrim(r->>'st')) end,
         nullif(btrim(r->>'zip'), ''),
         public.fn_lead_age(r->'x'->>'AGE', r->'x'->>'Date Of Birth'),
         nullif(btrim(r->>'camp'), ''), nullif(btrim(r->>'batch'), ''),
         case when (r->>'touch') ~ '^[0-9]{1,6}$' then (r->>'touch')::int else 0 end,
         coalesce(r->'x', '{}'::jsonb), now()
    from jsonb_array_elements(p_rows) r
    cross join lateral (select right(regexp_replace(coalesce(r->>'phone', ''), '[^0-9]', '', 'g'), 10) as ph) p
   where (r->>'id') ~ '^[0-9]{1,15}$'
  on conflict (rm_lead_id) do update set
    phone10 = excluded.phone10, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email,
    address = excluded.address, city = excluded.city, state = excluded.state, zip = excluded.zip, age = excluded.age,
    campaign = excluded.campaign, batch_name = excluded.batch_name, times_called = excluded.times_called,
    attrs = excluded.attrs, pulled_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.upsert_readymode_leads(jsonb) from public, anon, authenticated;
revoke all on function public.fn_lead_age(text, text) from public, anon;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The dialer pool is every ReadyMode lead
-- ---------------------------------------------------------------------------------------------------------------
-- Tier keeps the call-history ladder for anything in the call log (pos / A / B / C / D / blocked). A lead the log
-- has never seen is F (fresh: loaded, never dialed) or, when ReadyMode's own counter says it was dialed before the
-- call log starts (2026-04-01), C / D by that count. A phone on the client-suppression list (a policy that still
-- stands) is held back as do-not-call: we never hand our own client out as a lead.
create or replace view public.v_pool_dialer as
with rl as (
  -- only the columns the pool uses: carrying attrs (the lead's whole file) through this sort made it spill to disk
  select distinct on (l.phone10) l.phone10, l.first_name, l.last_name, l.email, l.state, l.age,
         l.campaign, l.batch_name, l.times_called, l.first_seen_at
    from public.readymode_leads l
   where l.phone10 is not null
   order by l.phone10, l.rm_lead_id desc
), sup as (
  select s.phone10 from public.v_dialer_client_suppression s where s.verdict = 'suppress'
)
select null::uuid as lead_id,
       coalesce(q.phone10, rl.phone10) as phone10,
       coalesce(rl.first_name, q.first_name) as first_name,
       coalesce(rl.last_name, q.last_name) as last_name,
       coalesce(rl.email, q.email) as email,
       coalesce(rl.state, (select upper(a.state) from public.us_area_codes a where a.area_code = left(coalesce(q.phone10, rl.phone10), 3) limit 1)) as state,
       rl.age as age,
       coalesce(q.quality_tier,
                case when coalesce(rl.times_called, 0) = 0 then 'F' when rl.times_called <= 3 then 'C' else 'D' end) as tier,
       concat_ws(' · ',
         coalesce(q.quality_reason,
                  case when coalesce(rl.times_called, 0) = 0 then 'Fresh: loaded in the dialer, never called'
                       else 'Dialed ' || rl.times_called || ' time' || case when rl.times_called = 1 then '' else 's' end || ' before April, no call detail on file' end),
         rl.campaign) as tags,
       jsonb_strip_nulls(jsonb_build_object(
         'dnc', (coalesce(q.quality_tier = 'blocked', false) or lower(coalesce(q.last_disposition, '')) = 'do not call' or sup.phone10 is not null),
         'campaign', rl.campaign,
         'source_file', rl.batch_name,
         'times_called', coalesce(q.attempts, rl.times_called, 0),
         'current_client', case when sup.phone10 is not null then true end,
         'state_from_area_code', case when rl.state is null then true end)) as flags,
       coalesce(q.days_since_dialed, (now()::date - rl.first_seen_at::date)) as lead_age_days,
       false as under_9mo
  from rl
  full join public.v_readymode_lead_quality q on q.phone10 = rl.phone10
  left join sup on sup.phone10 = coalesce(q.phone10, rl.phone10);

-- ---------------------------------------------------------------------------------------------------------------
-- 3. A state on win-back and re-write leads (the lead's own state on file, else the phone's area code)
-- ---------------------------------------------------------------------------------------------------------------
create or replace view public.v_pool_winback as
 SELECT NULL::uuid AS lead_id,
    COALESCE(f.to_phone10, "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10)) AS phone10,
    d.client_first_name AS first_name,
    d.client_last_name AS last_name,
    NULL::text AS email,
    COALESCE(( SELECT upper(cl.state) FROM client_leads cl WHERE cl.phone_digits = COALESCE(f.to_phone10, "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10)) AND cl.state ~ '^[A-Za-z]{2}$' LIMIT 1), (select upper(a.state) from public.us_area_codes a where a.area_code = left(COALESCE(f.to_phone10, "right"(regexp_replace(COALESCE(d.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10)), 3) limit 1)) AS state,
        CASE
            WHEN d.client_dob IS NOT NULL THEN EXTRACT(year FROM age(d.client_dob::timestamp with time zone))::integer
            ELSE NULL::integer
        END AS age,
        CASE
            WHEN lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text THEN 'A'::text
            ELSE 'B'::text
        END AS tier,
    NULLIF(array_to_string(array_remove(ARRAY[c.name, d.product_sold, COALESCE(d.policy_status_standard, d.status)], NULL::text), ' · '::text), ''::text) AS tags,
    (jsonb_build_object('lapsed', lower(COALESCE(d.status, ''::text)) = 'lapsed'::text OR d.policy_status_standard ~~* '%laps%'::text, 'vantage', is_vantage_agent(d.agent_id), 'dnc', false) || jsonb_build_object('readymode_number', f.to_phone10 IS NOT NULL)) || jsonb_strip_nulls(jsonb_build_object('replaced_phone10', NULLIF(f.from_phone10, ''::text))) AS flags,
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
    COALESCE(CASE WHEN btrim(p.client_state) ~ '^[A-Za-z]{2}$' THEN upper(btrim(p.client_state)) END, (select upper(a.state) from public.us_area_codes a where a.area_code = left(COALESCE(dc.lead_phone10, NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text)), 3) limit 1)) AS state,
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
    (jsonb_build_object('cc', p.payment_method_type = 'card'::text, 'direct_express', p.payment_method_type = 'direct_express'::text, 'bank_on_file', p.payment_method_type = ANY (ARRAY['checking'::text, 'savings'::text]), 'no_bank', p.payment_method_type IS NULL OR p.payment_method_type = 'unknown'::text, 'ssn_collected', p.ssn_encrypted IS NOT NULL OR p.ssn_last4 IS NOT NULL, 'bank_collected', p.bank_account_encrypted IS NOT NULL OR p.bank_name IS NOT NULL, 'hung_up', p.status = ANY (ARRAY['needs_review'::text, 'ready'::text]), 'spouse', COALESCE(ci.spouse_coverage, false), 'dnc', false) || jsonb_build_object('readymode_number', COALESCE(dc.lead_phone10 IS NOT NULL AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) ~ '^[0-9]{10}$'::text AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) <> dc.lead_phone10, false))) || jsonb_strip_nulls(jsonb_build_object('replaced_phone10',
        CASE
            WHEN dc.lead_phone10 IS NOT NULL AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) ~ '^[0-9]{10}$'::text AND NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) <> dc.lead_phone10 THEN NULLIF("right"(regexp_replace(COALESCE(p.client_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text)
            ELSE NULL::text
        END)) AS flags,
    (now() AT TIME ZONE 'America/Phoenix'::text)::date - (p.call_at AT TIME ZONE 'America/Phoenix'::text)::date AS lead_age_days,
    false AS under_9mo
   FROM readymode_booking_packets p
     LEFT JOIN readymode_call_insights ci ON ci.call_id = p.call_id
     LEFT JOIN readymode_dialer_calls dc ON dc.id = p.call_id
  WHERE COALESCE(p.status, ''::text) <> 'booked'::text;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Filters: campaign everywhere the pool filters run; facets for the pickers
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sellable_pool(p_source text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(lead_id uuid, phone10 text, first_name text, last_name text, email text, state text, age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean, already_sold boolean, in_bundle boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_view text;
begin
  -- The dialer pool is every ReadyMode lead (~380k): a live scan of v_pool_dialer per drop would
  -- run past the 30s drop limit, so drops read the 10-minute snapshot. already_sold / in_bundle
  -- stay live below, and My Leads hides a dialer do-not-call the moment it is dispositioned.
  v_view := case p_source
    when 'marketing' then 'public.v_pool_marketing'
    when 'dialer' then '(select * from public.mat_lead_pool where source = ''dialer'')'
    when 'rewrite' then 'public.v_pool_rewrite'
    when 'winback' then 'public.v_pool_winback' end;
  if v_view is null then raise exception 'Unknown lead pool: %', p_source using errcode = '22023'; end if;
  return query execute format($q$
    with f as (select
      case when jsonb_typeof($1->'tiers')='array' then array(select jsonb_array_elements_text($1->'tiers')) end as tiers,
      case when jsonb_typeof($1->'states')='array' then array(select upper(jsonb_array_elements_text($1->'states'))) end as states,
      case when jsonb_typeof($1->'campaigns')='array' then array(select jsonb_array_elements_text($1->'campaigns')) end as campaigns,
      case when jsonb_typeof($1->'require_flags')='array' then array(select jsonb_array_elements_text($1->'require_flags')) end as req_flags,
      ($1->>'min_age')::int as min_age, ($1->>'max_age')::int as max_age,
      ($1->>'max_lead_age_days')::int as max_lead_age_days,
      coalesce(($1->>'vantage_only')::boolean, false) as vantage_only)
    select s.lead_id, s.phone10, s.first_name, s.last_name, s.email, s.state, s.age,
      s.tier, s.tags, s.flags, s.lead_age_days, s.under_9mo,
      exists(select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10) as already_sold,
      exists(select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null) as in_bundle
    from %s s cross join f
    where s.phone10 ~ '^[0-9]{10}$'
      and (f.tiers is null or cardinality(f.tiers)=0 or s.tier = any(f.tiers))
      and (f.states is null or cardinality(f.states)=0 or s.state = any(f.states))
      and (f.campaigns is null or cardinality(f.campaigns)=0 or (s.flags->>'campaign') = any(f.campaigns))
      and (f.req_flags is null or cardinality(f.req_flags)=0
           or (select bool_and(coalesce((s.flags->>rf)::boolean, false)) from unnest(f.req_flags) rf))
      and (f.min_age is null or s.age >= f.min_age)
      and (f.max_age is null or s.age <= f.max_age)
      and (f.max_lead_age_days is null or s.lead_age_days <= f.max_lead_age_days)
      and (not f.vantage_only or coalesce((s.flags->>'vantage')::boolean, false))
  $q$, v_view) using coalesce(p_filters, '{}'::jsonb);
end $function$;

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
  f_campaigns text[] := case when jsonb_typeof(p_filters->'campaigns') = 'array' then array(select jsonb_array_elements_text(p_filters->'campaigns')) end;
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
      and (f_campaigns is null or cardinality(f_campaigns) = 0 or (s.flags->>'campaign') = any(f_campaigns))
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
        from e order by array_position(array['S','pos','A','B','F','C','D'], tier), lead_age_days desc limit 25) q), '[]'::jsonb),
    'as_of', v_as_of,
    'snapshot', true
  ) into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.lead_pool_assign(p_source text, p_filters jsonb, p_limit integer, p_agent_user_id uuid, p_name text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
declare v_agent text; v_bundle uuid; v_n int; v_name text;
  v_excl_dnc boolean := coalesce((p_filters->>'exclude_dnc')::boolean, true);
  v_excl_sold boolean := coalesce((p_filters->>'exclude_resold')::boolean, true);
  v_sort text := coalesce(p_filters->>'sort', 'tier');
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can drop leads into a portal.' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'A pack holds 1 to 5,000 leads.' using errcode = '22023';
  end if;
  select a.display_name into v_agent from public.agents a
  where a.user_id = p_agent_user_id and a.status = 'active'
    and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
  order by (a.canonical_agent_id is null) desc, a.created_at limit 1;
  if v_agent is null then raise exception 'Pick a live agent with a portal login.' using errcode = '22023'; end if;

  v_name := coalesce(nullif(btrim(p_name), ''),
    v_agent || ' - ' || to_char(now() at time zone 'America/Phoenix', 'Mon DD') || ' (' || p_source || ')');
  insert into public.lead_bundles (name, format, criteria, note, created_by)
  values (v_name, 'client_leads',
          coalesce(p_filters, '{}'::jsonb) || jsonb_build_object('pool', p_source, 'limit', p_limit),
          nullif(btrim(p_note), ''), auth.uid())
  returning id into v_bundle;

  insert into public.lead_bundle_items
    (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email, state, age,
     quality_tier, quality_reason, status, attrs)
  select v_bundle, e.lead_id, p_source, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
         e.tier, e.tags, 'new',
         e.flags || jsonb_build_object('lead_age_days', e.lead_age_days, 'under_9mo', e.under_9mo, 'pool', p_source)
  from (
    -- One row per phone: the unique index is phone-grain, so the selection must
    -- be too. rank 1 = the best row for that phone under the caller's sort.
    select q.*, row_number() over (
      partition by q.phone10
      order by
        case when v_sort = 'chargeback' then (case when q.under_9mo then 0 else 1 end) end asc nulls last,
        case when v_sort = 'oldest' then q.lead_age_days end desc,
        array_position(array['S','pos','A','B','F','C','D'], q.tier), q.lead_age_days asc
    ) as rn
    from (
      select * from public.sellable_pool(p_source, p_filters) m
      where not (v_excl_dnc and coalesce((m.flags->>'dnc')::boolean, false))
        and not (v_excl_sold and m.already_sold) and not m.in_bundle
    ) q
  ) e
  where e.rn = 1
  order by
    case when v_sort = 'chargeback' then (case when e.under_9mo then 0 else 1 end) end asc nulls last,
    case when v_sort = 'oldest' then e.lead_age_days end desc,
    array_position(array['S','pos','A','B','F','C','D'], e.tier), e.lead_age_days asc
  limit p_limit
  on conflict (phone10) where (removed_at is null) do nothing;
  get diagnostics v_n = row_count;

  insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
  values (v_bundle, p_agent_user_id, auth.uid(), nullif(btrim(p_note), ''));
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  values (v_bundle, p_agent_user_id, auth.uid(), 'granted',
          jsonb_build_object('agent', v_agent, 'items', v_n, 'pool', p_source));
  return jsonb_build_object('bundle_id', v_bundle, 'items', v_n, 'agent', v_agent);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_starter_pack_inventory(p_states text[], p_limit integer DEFAULT 25)
 RETURNS TABLE(source text, lead_id uuid, phone10 text, first_name text, last_name text, email text, state text, age integer, tier text, tags text, flags jsonb, lead_age_days integer, under_9mo boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- MP-MONDAY-ROLLCALL (2026-11-22): the suppression list is computed ONCE. As a per-row NOT EXISTS against the view
  -- it was re-planned as a sub-plan for every candidate lead (1,739 runs for one state, 50 to 76 seconds); the whole
  -- view is 1,219 rows and takes under 2 seconds. Same rows out, proven lead-for-lead before this replaced it.
  with sup as materialized (
    select distinct s.lead_id from public.v_leads_suppression_all s where s.lead_id is not null
  )
  select e.source, e.lead_id, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
         e.tier, e.tags, e.flags, e.lead_age_days, e.under_9mo
    from (
      select p.*,
             row_number() over (partition by p.phone10
                                order by array_position(array['A', 'B'], p.tier), (p.source = 'dialer') desc,
                                         p.lead_age_days asc nulls last) as rn
        from public.mat_lead_pool p
       -- 2026-11-24: dialer leads carry a state now (they had none, so none ever matched here). Automatic packs stay
       -- on purchased leads: a warm dialer lead may be another agent's open sale. To include them, add 'dialer' back.
       where p.source = 'marketing'
         and p.tier in ('A', 'B')
         and upper(btrim(p.state)) = any (p_states)
         and p.phone10 ~ '^[0-9]{10}$'
         and not coalesce(p.dnc, false)
         and not coalesce((p.flags ->> 'dnc')::boolean, false)
         and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.removed_at is null)
         and not exists (select 1 from public.lead_bundle_items i where i.phone10 = p.phone10 and i.status = 'do_not_call')
         and not exists (select 1 from public.readymode_dialer_calls c
                          where c.lead_phone10 = p.phone10 and lower(coalesce(c.disposition, '')) = 'do not call')
         and not exists (select 1 from public.lead_resale_ledger r where r.phone10 = p.phone10)
         and (p.lead_id is null or not exists (select 1 from sup s where s.lead_id = p.lead_id))
    ) e
   where e.rn = 1
   order by array_position(array['A', 'B'], e.tier), (e.source = 'dialer') desc, e.lead_age_days asc nulls last, e.phone10
   limit greatest(1, least(coalesce(p_limit, 25), 25))
$function$;

-- sellable_pool returns full phone numbers and has no gate of its own; it was executable by every signed-in user
-- (found 2026-11-24). Only lead_pool_assign calls it, and that runs as the owner, so nobody else needs it.
revoke all on function public.sellable_pool(text, jsonb) from public, anon, authenticated;

-- What can be picked in a pool: states and campaigns with how many leads each holds (do-not-call left out).
create or replace function public.lead_pool_facets(p_source text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  if p_source not in ('marketing','dialer','rewrite','winback') then
    raise exception 'Unknown lead pool: %', p_source using errcode = '22023';
  end if;
  select jsonb_build_object(
    'states', coalesce((select jsonb_agg(jsonb_build_object('k', state, 'n', n) order by n desc, state) from (
        select s.state, count(*)::int as n from public.mat_lead_pool s
         where s.source = p_source and not s.dnc and s.state ~ '^[A-Z]{2}$' group by s.state) x), '[]'::jsonb),
    'no_state', (select count(*)::int from public.mat_lead_pool s where s.source = p_source and not s.dnc and s.state is null),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('k', c, 'n', n) order by c) from (
        select s.flags->>'campaign' as c, count(*)::int as n from public.mat_lead_pool s
         where s.source = p_source and not s.dnc and s.flags ? 'campaign' group by 1) y), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.lead_pool_facets(text) from public, anon;
grant execute on function public.lead_pool_facets(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Who is sitting on leads: board, pull back, move, pause
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.lead_agent_holds (
  id        bigint generated always as identity primary key,
  user_id   uuid not null,
  held_at   timestamptz not null default now(),
  held_by   uuid,
  reason    text,
  lifted_at timestamptz,
  lifted_by uuid
);
create unique index if not exists lead_agent_holds_one_open on public.lead_agent_holds (user_id) where lifted_at is null;
alter table public.lead_agent_holds enable row level security;
revoke all on public.lead_agent_holds from anon, authenticated;
comment on table public.lead_agent_holds is
  'An open row = this agent gets no automatic leads (fn_morning_lead_candidates reason leads_paused). Set when Sam pulls or moves their unworked leads; lifted from Lead Manager.';

CREATE OR REPLACE FUNCTION public.fn_morning_lead_candidates()
 RETURNS TABLE(agent_id uuid, user_id uuid, first_name text, full_name text, mode text, last_sign_in_at timestamp with time zone, license_states text[], state_source text, new_leads integer, live_leads integer, eligible boolean, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pop as (
    select a.id, a.user_id, coalesce(a.account_mode, 'agent') as mode,
           coalesce(nullif(btrim(a.display_name), ''),
                    (select nullif(btrim(pr.full_name), '') from public.profiles pr where pr.id = a.profile_id),
                    'there') as full_name,
           (select u.last_sign_in_at from auth.users u where u.id = a.user_id) as last_sign_in_at
      from public.agents a
     where a.status::text = 'active'
       and coalesce(a.is_deactivated, false) = false
       and coalesce(a.is_inactive, false) = false
       and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and a.license_status::text = 'licensed'
       and coalesce(a.account_mode, 'agent') <> 'admin'
       and (a.user_id is null or not public.is_placeholder_agent(a.agent_code, a.user_id))
       and not public.fn_agent_is_roster_excluded(a.id)
  )
  select p.id, p.user_id,
         coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), 'there'),
         p.full_name, p.mode, p.last_sign_in_at,
         st.states, st.source, ld.new_leads, ld.live_leads,
         v.reason is null, coalesce(v.reason, 'ready')
    from pop p
    left join lateral public.fn_agent_lead_states(p.id) st on true
    cross join lateral (
      select count(*) filter (where i.status = 'new')::int as new_leads, count(*)::int as live_leads
        from public.lead_bundle_grants g
        join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
        join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
       where g.user_id = p.user_id and g.revoked_at is null
    ) ld
    cross join lateral (
      select case
        when p.user_id is null then 'no_login'
        when public.fn_agent_is_suspended(p.id) then 'suspended'
        when public.fn_user_login_blocked(p.user_id) then 'login_banned'
        when public.fn_agent_interview_state(p.id) in ('upcoming', 'missed', 'never') then 'not_interviewed_yet'
        when exists (select 1 from public.lead_agent_holds h where h.user_id = p.user_id and h.lifted_at is null) then 'leads_paused'
        when ld.new_leads >= 10 then 'has_leads'
        when st.states is null then 'license_state_unknown'
        else null end as reason
    ) v
$function$;

create or replace function public.lead_hold_set(p_user uuid, p_on boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can pause an agent''s leads.' using errcode = '42501';
  end if;
  if p_on then
    insert into public.lead_agent_holds (user_id, held_by, reason)
    values (p_user, auth.uid(), left(nullif(btrim(p_reason), ''), 200))
    on conflict (user_id) where lifted_at is null do nothing;
  else
    update public.lead_agent_holds set lifted_at = now(), lifted_by = auth.uid() where user_id = p_user and lifted_at is null;
  end if;
  return jsonb_build_object('paused', p_on);
end $$;

-- One row per person holding leads (or paused): how many they hold, how many they have never touched, how long the
-- oldest untouched lead has waited, when they last worked one. Worst first.
create or replace function public.lead_holder_board()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  with held as (
    select g.user_id,
           count(distinct b.id)::int as packs,
           count(i.id)::int as live_leads,
           count(i.id) filter (where i.status = 'new')::int as unworked,
           count(i.id) filter (where i.status <> 'new')::int as worked,
           count(i.id) filter (where i.status in ('callback', 'appointment'))::int as follow_ups,
           count(i.id) filter (where i.status = 'sold')::int as sold,
           min(g.granted_at) filter (where i.status = 'new') as oldest_unworked_at,
           greatest(max(i.status_at) filter (where i.status <> 'new'), max(i.last_dialed_at)) as last_worked_at
      from public.lead_bundle_grants g
      join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
      join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
     where g.revoked_at is null
     group by g.user_id
  ), who as (
    select user_id from held
    union
    select h.user_id from public.lead_agent_holds h where h.lifted_at is null
  )
  select coalesce(jsonb_agg(row_to_json(t) order by t.unworked desc, t.oldest_unworked_at asc nulls last, t.name), '[]'::jsonb) into v
  from (
    select w.user_id,
           coalesce((select a.display_name from public.agents a where a.user_id = w.user_id
                      order by (a.canonical_agent_id is null) desc, a.created_at limit 1), 'Agent') as name,
           coalesce(h.packs, 0) as packs, coalesce(h.live_leads, 0) as live_leads,
           coalesce(h.unworked, 0) as unworked, coalesce(h.worked, 0) as worked,
           coalesce(h.follow_ups, 0) as follow_ups, coalesce(h.sold, 0) as sold,
           h.oldest_unworked_at, h.last_worked_at,
           (select u.last_sign_in_at from auth.users u where u.id = w.user_id) as last_sign_in_at,
           (select count(*)::int from public.lead_item_recordings r where r.user_id = w.user_id) as recordings,
           exists (select 1 from public.lead_agent_holds x where x.user_id = w.user_id and x.lifted_at is null) as paused
      from who w left join held h on h.user_id = w.user_id
  ) t;
  return v;
end $$;

-- The unworked leads one agent holds, as item ids. A pack someone else also holds is left out: those leads are not
-- this agent's alone to lose.
create or replace function public.fn_lead_unworked_items(p_user uuid)
returns table (item_id uuid, bundle_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select i.id, b.id
    from public.lead_bundle_grants g
    join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
    join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null and i.status = 'new'
   where g.user_id = p_user and g.revoked_at is null
     and not exists (select 1 from public.lead_bundle_grants g2
                      where g2.bundle_id = b.id and g2.revoked_at is null and g2.user_id <> p_user)
$$;
revoke all on function public.fn_lead_unworked_items(uuid) from public, anon, authenticated;

-- Take back every lead this agent has never touched. Leads they have worked (callbacks, appointments, no-answers,
-- sales) stay with them. The leads return to the pool at once. By default the agent is also paused, or the hourly
-- top-up would hand them 25 more within the hour.
create or replace function public.lead_pull_back(p_user uuid, p_pause boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_ids uuid[]; v_bundles uuid[]; v_n int := 0; v_shared int := 0;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can take leads back.' using errcode = '42501';
  end if;
  select array_agg(u.item_id), array_agg(distinct u.bundle_id) into v_ids, v_bundles from public.fn_lead_unworked_items(p_user) u;
  if v_ids is not null then
    update public.lead_bundle_items set removed_at = now() where id = any(v_ids) and removed_at is null;
    get diagnostics v_n = row_count;
    insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
    select x.bundle_id, p_user, auth.uid(), 'pulled_back', jsonb_build_object('items', x.n)
      from (select u.bundle_id, count(*)::int as n from public.fn_lead_unworked_items_from(v_ids) u group by 1) x;
    update public.lead_bundles b set archived_at = now()
     where b.id = any(v_bundles) and b.archived_at is null
       and not exists (select 1 from public.lead_bundle_items i where i.bundle_id = b.id and i.removed_at is null);
  end if;
  -- a pack shared with someone else: this agent only loses access to it
  with gone as (
    update public.lead_bundle_grants g set revoked_at = now(), revoked_by = auth.uid()
     where g.user_id = p_user and g.revoked_at is null
       and exists (select 1 from public.lead_bundle_grants g2 where g2.bundle_id = g.bundle_id and g2.revoked_at is null and g2.user_id <> p_user)
       and not exists (select 1 from public.lead_bundle_items i where i.bundle_id = g.bundle_id and i.removed_at is null and i.status <> 'new' and i.status_by = p_user)
    returning g.bundle_id)
  select count(*)::int into v_shared from gone;
  if p_pause then perform public.lead_hold_set(p_user, true, 'unworked leads taken back'); end if;
  return jsonb_build_object('pulled', v_n, 'shared_packs_revoked', v_shared, 'paused', p_pause);
end $$;

create or replace function public.fn_lead_unworked_items_from(p_ids uuid[])
returns table (item_id uuid, bundle_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select i.id, i.bundle_id from public.lead_bundle_items i where i.id = any(p_ids)
$$;
revoke all on function public.fn_lead_unworked_items_from(uuid[]) from public, anon, authenticated;

-- Move one agent's untouched leads to another agent as a new pack. Same rule as pull back for what moves.
create or replace function public.lead_move_unworked(p_from uuid, p_to uuid, p_limit integer default null, p_pause boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_to text; v_from text; v_ids uuid[]; v_bundles uuid[]; v_bundle uuid; v_n int := 0;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can move leads.' using errcode = '42501';
  end if;
  if p_from = p_to then raise exception 'Pick a different agent to move the leads to.' using errcode = '22023'; end if;
  select a.display_name into v_to from public.agents a
   where a.user_id = p_to and a.status = 'active'
     and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
     and not public.fn_agent_is_roster_excluded(a.id)
   order by (a.canonical_agent_id is null) desc, a.created_at limit 1;
  if v_to is null then raise exception 'Pick a live agent with a portal login.' using errcode = '22023'; end if;
  select coalesce((select a.display_name from public.agents a where a.user_id = p_from
                    order by (a.canonical_agent_id is null) desc, a.created_at limit 1), 'agent') into v_from;

  select array_agg(s.item_id), array_agg(distinct s.bundle_id) into v_ids, v_bundles
    from (select u.item_id, u.bundle_id from public.fn_lead_unworked_items(p_from) u
           limit greatest(1, least(coalesce(p_limit, 5000), 5000))) s;
  if v_ids is null then
    return jsonb_build_object('moved', 0, 'agent', v_to);
  end if;

  insert into public.lead_bundles (name, format, criteria, note, created_by)
  values (v_to || ' - ' || to_char(now() at time zone 'America/Phoenix', 'Mon DD') || ' (moved from ' || v_from || ')',
          'client_leads', jsonb_build_object('pool', 'moved', 'moved_from', p_from), null, auth.uid())
  returning id into v_bundle;

  -- free the phones first: live items are unique per phone
  update public.lead_bundle_items set removed_at = now() where id = any(v_ids) and removed_at is null;
  insert into public.lead_bundle_items
    (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email, state, age,
     quality_tier, quality_reason, attempts, last_dialed_at, last_disposition, last_agent, status, attrs)
  select v_bundle, i.lead_id, i.source_kind, i.phone10, i.first_name, i.last_name, i.email, i.state, i.age,
         i.quality_tier, i.quality_reason, i.attempts, i.last_dialed_at, i.last_disposition, i.last_agent, 'new',
         coalesce(i.attrs, '{}'::jsonb) || jsonb_build_object('moved_from', v_from)
    from public.lead_bundle_items i where i.id = any(v_ids)
  on conflict (phone10) where (removed_at is null) do nothing;
  get diagnostics v_n = row_count;

  insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note) values (v_bundle, p_to, auth.uid(), 'moved from ' || v_from);
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  values (v_bundle, p_to, auth.uid(), 'granted', jsonb_build_object('agent', v_to, 'items', v_n, 'pool', 'moved', 'moved_from', p_from));
  insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
  select x.bundle_id, p_from, auth.uid(), 'moved_out', jsonb_build_object('items', x.n, 'to', p_to)
    from (select u.bundle_id, count(*)::int as n from public.fn_lead_unworked_items_from(v_ids) u group by 1) x;
  update public.lead_bundles b set archived_at = now()
   where b.id = any(v_bundles) and b.archived_at is null
     and not exists (select 1 from public.lead_bundle_items i where i.bundle_id = b.id and i.removed_at is null);
  if p_pause then perform public.lead_hold_set(p_from, true, 'unworked leads moved to ' || v_to); end if;
  return jsonb_build_object('moved', v_n, 'agent', v_to, 'bundle_id', v_bundle, 'paused', p_pause);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Recordings: every one an agent makes on a lead is kept, keyed to the phone so it follows the lead
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.lead_item_recordings (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.lead_bundle_items (id) on delete cascade,
  bundle_id      uuid not null,
  phone10        text not null,
  user_id        uuid not null,
  recording_path text not null,
  summary        jsonb,
  created_at     timestamptz not null default now(),
  unique (item_id, recording_path)
);
create index if not exists lead_item_recordings_phone on public.lead_item_recordings (phone10, created_at desc);
create index if not exists lead_item_recordings_user on public.lead_item_recordings (user_id, created_at desc);
alter table public.lead_item_recordings enable row level security;
revoke all on public.lead_item_recordings from anon, authenticated;

-- the one recording saved before this table existed
insert into public.lead_item_recordings (item_id, bundle_id, phone10, user_id, recording_path, created_at)
select i.id, i.bundle_id, i.phone10, i.status_by, i.recording_path, coalesce(i.status_at, now())
  from public.lead_bundle_items i
 where i.recording_path is not null and i.status_by is not null and i.phone10 is not null
on conflict (item_id, recording_path) do nothing;

-- Saved the moment the upload finishes, so a recording is never lost because no result was tapped afterwards.
-- Called again with the same path it adds the AI summary once that is ready.
create or replace function public.lead_item_add_recording(p_item uuid, p_path text, p_summary jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_bundle uuid; v_phone text; v_path text := nullif(btrim(p_path), ''); v_n int;
begin
  select i.bundle_id, i.phone10 into v_bundle, v_phone from public.lead_bundle_items i where i.id = p_item and i.removed_at is null;
  if v_bundle is null then
    raise exception 'That lead is no longer in a live bundle.' using errcode = '22023';
  end if;
  if not (public.can_view_sold_calls() or exists (
        select 1 from public.lead_bundle_grants g
         where g.bundle_id = v_bundle and g.user_id = auth.uid() and g.revoked_at is null)) then
    raise exception 'This lead is not assigned to you.' using errcode = '42501';
  end if;
  if v_path is null or v_path !~ '^callcenter/[A-Za-z0-9._/-]{5,200}$' then
    raise exception 'That is not a call recording.' using errcode = '22023';
  end if;
  insert into public.lead_item_recordings (item_id, bundle_id, phone10, user_id, recording_path, summary)
  values (p_item, v_bundle, v_phone, auth.uid(), v_path, p_summary)
  on conflict (item_id, recording_path) do update set summary = coalesce(excluded.summary, public.lead_item_recordings.summary);
  update public.lead_bundle_items set recording_path = v_path where id = p_item;
  select count(*)::int into v_n from public.lead_item_recordings r where r.phone10 = v_phone;
  if p_summary is null then
    insert into public.lead_bundle_events (bundle_id, item_id, user_id, actor, action, detail)
    values (v_bundle, p_item, auth.uid(), auth.uid(), 'recording', jsonb_build_object('path', v_path));
  end if;
  return jsonb_build_object('ok', true, 'recordings', v_n);
end $$;

-- A lead's recordings (every pack this phone has been in). The holder sees when, who, and the summary; the storage
-- path, which is what playback needs, goes only to Sam and Aisha.
create or replace function public.lead_item_recordings_list(p_item uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_bundle uuid; v_phone text; v_admin boolean := public.can_view_sold_calls(); v jsonb;
begin
  select i.bundle_id, i.phone10 into v_bundle, v_phone from public.lead_bundle_items i where i.id = p_item;
  if v_bundle is null then return '[]'::jsonb; end if;
  if not (v_admin or exists (
        select 1 from public.lead_bundle_grants g
         where g.bundle_id = v_bundle and g.user_id = auth.uid() and g.revoked_at is null)) then
    raise exception 'This lead is not assigned to you.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'created_at', r.created_at, 'mine', r.user_id = auth.uid(),
           'by', (select a.display_name from public.agents a where a.user_id = r.user_id
                   order by (a.canonical_agent_id is null) desc, a.created_at limit 1),
           'summary', r.summary->>'briefSummary',
           'path', case when v_admin then r.recording_path end) order by r.created_at desc), '[]'::jsonb)
    into v
    from public.lead_item_recordings r where r.phone10 = v_phone;
  return v;
end $$;

-- Newest recordings across every lead, for review and training.
create or replace function public.lead_recordings_recent(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    select r.id, r.created_at, r.recording_path as path, r.summary->>'briefSummary' as summary,
           r.summary->>'sentiment' as sentiment,
           (select a.display_name from public.agents a where a.user_id = r.user_id
             order by (a.canonical_agent_id is null) desc, a.created_at limit 1) as agent,
           nullif(concat_ws(' ', i.first_name, i.last_name), '') as lead_name,
           i.state, i.quality_tier as tier, i.status
      from public.lead_item_recordings r
      join public.lead_bundle_items i on i.id = r.item_id
     order by r.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) t;
  return v;
end $$;

-- the manage list shows how many recordings each lead carries
create or replace function public.lead_bundle_items_manage(p_bundle uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.added_at), '[]'::jsonb) into v from (
    select i.id as item_id,
      nullif(concat_ws(' ', i.first_name, i.last_name), '') as name,
      '***-***-' || right(coalesce(i.phone10,''), 4) as phone_masked,
      i.quality_tier as tier, i.status, i.quality_reason as tags, i.added_at,
      (i.recording_path is not null) as has_recording,
      (select count(*)::int from public.lead_item_recordings r where r.phone10 = i.phone10) as recordings
    from public.lead_bundle_items i
    where i.bundle_id = p_bundle and i.removed_at is null
  ) t;
  return v;
end $$;

-- Grants for the NEW functions: signed-in callers only; every body gates itself. Replaced functions keep their ACL.
do $$
declare f text;
begin
  foreach f in array array[
    'public.lead_hold_set(uuid, boolean, text)', 'public.lead_holder_board()', 'public.lead_pull_back(uuid, boolean)',
    'public.lead_move_unworked(uuid, uuid, integer, boolean)', 'public.lead_item_add_recording(uuid, text, jsonb)',
    'public.lead_item_recordings_list(uuid)', 'public.lead_recordings_recent(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;


-- ---------------------------------------------------------------------------------------------------------------
-- 7. A dialer lead's card shows its ReadyMode file, not just the last call
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_lead_detail(p_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v record; v_detail jsonb := '{}'::jsonb; v_file jsonb;
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
    -- The lead's own ReadyMode file: address, and every field the purchased list carried (date of birth,
    -- beneficiary, policy, mortgage ...). Bookkeeping columns the agent cannot use are left out.
    select jsonb_strip_nulls(jsonb_build_object(
             'street_address', l.address, 'city', l.city, 'zip', l.zip, 'email', l.email,
             'dialer_campaign', l.campaign, 'source_file', l.batch_name))
           || coalesce((select jsonb_object_agg(k.key, k.value)
                          from (select lower(regexp_replace(btrim(e.key), '[^A-Za-z0-9]+', '_', 'g')) as key, e.value
                                  from jsonb_each_text(l.attrs) e) k
                         where k.key not in ('external_id', 'ready_priority', 'record_created_date', 'source_created_date',
                                             'data_source', 'benefitinbps', 'benefit_bps', 'candidate_type', 'age', 'name')), '{}'::jsonb)
      into v_file
      from public.readymode_leads l
     where l.phone10 = v.phone10
     order by l.rm_lead_id desc limit 1;
    select jsonb_strip_nulls(jsonb_build_object(
      'last_call_type', dc.campaign_name, 'last_call_at', dc.call_started_at,
      'last_call_seconds', dc.duration_seconds, 'last_disposition', dc.disposition,
      'last_call_agent', dc.agent_raw, 'email', dc.lead_email, 'call_notes', dc.notes,
      'call_recording', dc.recording_url,
      'times_called', (select count(*) from public.readymode_dialer_calls x where x.lead_phone10 = v.phone10)))
    into v_detail
    from public.readymode_dialer_calls dc
    where dc.lead_phone10 = v.phone10
    order by dc.call_started_at desc nulls last limit 1;
    v_detail := coalesce(v_file, '{}'::jsonb) || coalesce(v_detail, '{}'::jsonb);
  end if;

  return jsonb_build_object('source', v.source_kind, 'detail', coalesce(v_detail, '{}'::jsonb));
end $function$;
