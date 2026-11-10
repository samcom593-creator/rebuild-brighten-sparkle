-- MP-LEAD-MANAGER-15 (2026-11-10): the console's counts hit the API statement
-- timeout. Measured today: lead_pool_tiles() 2.5s and lead_pool_counts('marketing')
-- 3.1s on a 125,258-lead pool, both on every visit, and `authenticated` carries
-- statement_timeout=8s. function_errors holds 57014 rows for lead-pool:marketing
-- at 2026-11-09 21:39 — AFTER the bind fix (MP-7) — so the page was still failing
-- under load. Two prior speed passes (MP-12, MP-12b) stayed at ~3.2s because the
-- cost is materializing ~161k rows through two view layers per call; no SQL
-- rewrite of the live read removes that.
--
-- Fix: a materialized snapshot of the four pools (mat_lead_pool), refreshed by
-- pg_cron every 10 minutes CONCURRENTLY (readers never block), and the two
-- read paths (counts + tiles) read the snapshot. The exclusions that MOVE on
-- a drop (resale ledger, live bundle item) stay LIVE — indexed EXISTS probes on
-- phone10 — so "Ready to drop" still decrements the instant a pack lands.
-- The drop itself (lead_pool_assign -> sellable_pool) is untouched and keeps
-- reading live rows; a one-off 3s action is fine, a stale selection is not.
--
-- Honest freshness: counts carry `as_of` (snapshot time) and the console shows
-- it; v_lead_pool_freshness grades never/error/stale/fresh for apex-doctor.
--
-- Also: 11 lead RPCs carried anon:EXECUTE through the default PUBLIC grant
-- (bodies gate on can_view_sold_calls()/auth.uid(), proven 42501/0 rows, so no
-- leak — but the same class the MP-RECRUIT-BILLING addendum revoked on
-- sellable_pool). Revoked from public+anon, re-granted to authenticated+service_role.

-- 1) snapshot meta -------------------------------------------------------------
create table if not exists public.lead_pool_snapshot_meta (
  id boolean primary key default true check (id),
  started_at timestamptz,
  refreshed_at timestamptz,
  rows integer,
  duration_ms integer,
  last_error text,
  error_at timestamptz
);
insert into public.lead_pool_snapshot_meta (id) values (true) on conflict (id) do nothing;
revoke all on public.lead_pool_snapshot_meta from public, anon, authenticated;
grant select on public.lead_pool_snapshot_meta to service_role;

-- 2) the snapshot --------------------------------------------------------------
create materialized view if not exists public.mat_lead_pool as
with u as (
  select 'marketing'::text as source, lead_id, phone10, first_name, last_name, email, state, age, tier, tags, flags, lead_age_days, under_9mo from public.v_pool_marketing
  union all
  select 'dialer', lead_id, phone10, first_name, last_name, email, state, age, tier, tags, flags, lead_age_days, under_9mo from public.v_pool_dialer
  union all
  select 'rewrite', lead_id, phone10, first_name, last_name, email, state, age, tier, tags, flags, lead_age_days, under_9mo from public.v_pool_rewrite
  union all
  select 'winback', lead_id, phone10, first_name, last_name, email, state, age, tier, tags, flags, lead_age_days, under_9mo from public.v_pool_winback
)
select row_number() over (order by source, phone10, lead_id, tier, first_name, last_name) as rid,
       source, lead_id, phone10, first_name, last_name, email, state, age, tier, tags, flags,
       lead_age_days, under_9mo,
       coalesce((flags->>'dnc')::boolean, false) as dnc
from u
where phone10 ~ '^[0-9]{10}$'
with data;

-- CONCURRENTLY needs one unique index over every row; (source, phone10, lead_id,
-- tier) is NOT unique in the rewrite/winback pools (measured 213 rows / 212 keys),
-- so rid is the key.
create unique index if not exists mat_lead_pool_rid on public.mat_lead_pool (rid);
create index if not exists mat_lead_pool_source_tier on public.mat_lead_pool (source, tier);
create index if not exists mat_lead_pool_source_state on public.mat_lead_pool (source, state);
create index if not exists mat_lead_pool_phone10 on public.mat_lead_pool (phone10);
-- PII (names, phones, emails): only the definer read paths touch it.
revoke all on public.mat_lead_pool from public, anon, authenticated;
grant select on public.mat_lead_pool to service_role;

-- 3) refresh + freshness -------------------------------------------------------
create or replace function public.refresh_lead_pool_snapshot()
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare t0 timestamptz := clock_timestamp(); n integer; ms integer;
begin
  update public.lead_pool_snapshot_meta set started_at = t0 where id;
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
revoke all on function public.refresh_lead_pool_snapshot() from public, anon, authenticated;
grant execute on function public.refresh_lead_pool_snapshot() to service_role;

-- One row in every state (never blank-green): never / error / stale / fresh.
create or replace view public.v_lead_pool_freshness
with (security_invoker = true) as
select m.refreshed_at, m.started_at, m.rows, m.duration_ms, m.last_error, m.error_at,
       (extract(epoch from (now() - m.refreshed_at)) / 60)::numeric(10,1) as age_min,
       case when m.refreshed_at is null then 'never'
            when m.last_error is not null and (m.error_at is null or m.error_at > m.refreshed_at) then 'error'
            when now() - m.refreshed_at > interval '60 minutes' then 'stale'
            else 'fresh' end as verdict
from public.lead_pool_snapshot_meta m;
revoke all on public.v_lead_pool_freshness from public, anon, authenticated;
grant select on public.v_lead_pool_freshness to service_role;

do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'apex-lead-pool-snapshot';
  perform cron.schedule('apex-lead-pool-snapshot', '*/10 * * * *', 'select public.refresh_lead_pool_snapshot()');
end $cron$;

-- 4) read paths now read the snapshot -----------------------------------------
create or replace function public.lead_pool_counts(p_source text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
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
               state, age, tier, tags, flags, lead_age_days, under_9mo
        from e order by array_position(array['S','A','B','C','D'], tier), lead_age_days desc limit 25) q), '[]'::jsonb),
    'as_of', v_as_of,
    'snapshot', true
  ) into v;
  return v;
end $function$;

create or replace function public.lead_pool_tiles()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  with m as (
    select s.source, s.phone10, s.tier
    from public.mat_lead_pool s
    where not s.dnc
      and not exists(select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10)
      and not exists(select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null)
  ),
  -- DISTINCT subqueries hash in one pass where count(distinct) sorts (see lead_pool_counts).
  per as (select source, tier, count(*)::int as n from (select distinct source, tier, phone10 from m) q group by 1, 2),
  tot as (select source, count(*)::int as total from (select distinct source, phone10 from m) q group by 1),
  src as (select unnest(array['marketing','dialer','rewrite','winback']) as source)
  select jsonb_object_agg(src.source, jsonb_build_object(
           'total', coalesce(tot.total, 0),
           'by_tier', coalesce((select jsonb_object_agg(per.tier, per.n) from per where per.source = src.source), '{}'::jsonb)))
    into v
  from src left join tot on tot.source = src.source;
  return coalesce(v, '{}'::jsonb);
end $function$;

-- 5) anon off the lead RPC surface ---------------------------------------------
-- `revoke ... from anon` alone is a no-op when execute flows through PUBLIC
-- (MP-RECRUIT-BILLING trap): revoke from public+anon, grant back the two roles.
--
-- MP-LEAD-MANAGER-15b (2026-11-10): the first cut of this block was a hardcoded
-- whitelist of 11 signatures, so three lead definer RPCs added since —
-- lead_bundle_assign + lead_bundle_build (both lead-ASSIGNMENT write paths) and
-- lead_resale_pool_counts (lead-PII count) — kept anon:EXECUTE through the
-- default PUBLIC grant. All three gate on can_view_sold_calls() (proven 42501/0
-- rows, so latent not leaking), but anon on a definer write path is exactly the
-- class the MP-RECRUIT-BILLING addendum revoked on sellable_pool. A whitelist
-- is a guard that silently rots the next time someone adds a lead RPC — so this
-- is now a catalog-driven sweep over EVERY lead_%/my_lead_% definer function in
-- public. They are all admin/agent-facing and gate internally; none is public,
-- so authenticated+service_role is the correct grant for the whole class, and a
-- future lead RPC inherits the lockdown instead of silently reopening the hole.
do $grants$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosecdef                              -- definer only (gate lives in the body)
      and (p.proname like 'lead\_%' or p.proname like 'my\_lead\_%')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $grants$;
