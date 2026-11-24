-- MP-LEAD-MANAGER-RM.6 (2026-11-24). Measured on the full ReadyMode list (393,327 leads, 247,838 phones):
--  * lead_pool_tiles() and lead_pool_facets('dialer') took ~10s each: over the 8s limit of a signed-in call. They
--    are now computed once per snapshot refresh and read from one row.
--  * ReadyMode keeps the same phone in more than one campaign (the Starter packs repeat FEX / Veterans leads, and
--    General-B / General-D repeat other lists). The pool is one row per phone, so a phone showed only under its
--    newest campaign: General-D, Starter-FEX and Starter-Veterans could not be picked at all. Every campaign a
--    phone sits in is carried now, and the filter matches any of them.
--  * The "times called" counter was read from the newest copy only, so a number dialed 146 times under an old
--    campaign looked never-called when a fresh copy existed. It is the highest count across the copies.
--  * The refresh costs 70-100s at this size; every 10 minutes was too often. It runs twice an hour. The freshness
--    rule (v_lead_pool_freshness: stale after 60 minutes) is unchanged.

create or replace view public.v_pool_dialer with (security_invoker = true) as
with rl as (
  select distinct on (l.phone10) l.phone10, l.first_name, l.last_name, l.email, l.state, l.age, l.campaign, l.batch_name
    from public.readymode_leads l
   where l.phone10 is not null
   order by l.phone10, l.rm_lead_id desc
), agg as (
  select l.phone10, max(l.times_called) as times_called, min(l.first_seen_at) as first_seen_at,
         to_jsonb(array_agg(distinct l.campaign) filter (where l.campaign is not null)) as campaigns
    from public.readymode_leads l
   where l.phone10 is not null
   group by l.phone10
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
                case when coalesce(agg.times_called, 0) = 0 then 'F' when agg.times_called <= 3 then 'C' else 'D' end) as tier,
       concat_ws(' · ',
         coalesce(q.quality_reason,
                  case when coalesce(agg.times_called, 0) = 0 then 'Fresh: loaded in the dialer, never called'
                       else 'Dialed ' || agg.times_called || ' time' || case when agg.times_called = 1 then '' else 's' end || ' before April, no call detail on file' end),
         rl.campaign) as tags,
       jsonb_strip_nulls(jsonb_build_object(
         'dnc', (coalesce(q.quality_tier = 'blocked', false) or lower(coalesce(q.last_disposition, '')) = 'do not call' or sup.phone10 is not null),
         'campaign', rl.campaign,
         'campaigns', agg.campaigns,
         'source_file', rl.batch_name,
         'times_called', greatest(coalesce(q.attempts, 0), coalesce(agg.times_called, 0)),
         'current_client', case when sup.phone10 is not null then true end,
         'state_from_area_code', case when rl.state is null then true end)) as flags,
       coalesce(q.days_since_dialed, (now()::date - agg.first_seen_at::date)) as lead_age_days,
       false as under_9mo
  from rl
  join agg on agg.phone10 = rl.phone10
  full join public.v_readymode_lead_quality q on q.phone10 = rl.phone10
  left join sup on sup.phone10 = coalesce(q.phone10, rl.phone10);

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
      and (f_campaigns is null or cardinality(f_campaigns) = 0 or (s.flags->'campaigns') ?| f_campaigns)
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
      and (f.campaigns is null or cardinality(f.campaigns)=0 or (s.flags->'campaigns') ?| f.campaigns)
      and (f.req_flags is null or cardinality(f.req_flags)=0
           or (select bool_and(coalesce((s.flags->>rf)::boolean, false)) from unnest(f.req_flags) rf))
      and (f.min_age is null or s.age >= f.min_age)
      and (f.max_age is null or s.age <= f.max_age)
      and (f.max_lead_age_days is null or s.lead_age_days <= f.max_lead_age_days)
      and (not f.vantage_only or coalesce((s.flags->>'vantage')::boolean, false))
  $q$, v_view) using coalesce(p_filters, '{}'::jsonb);
end $function$;

-- One row: the pool tiles and each pool's filter lists as of the last snapshot refresh.
create table if not exists public.lead_pool_stats (
  id          boolean primary key default true check (id),
  tiles       jsonb,
  facets      jsonb,
  computed_at timestamptz,
  last_error  text,
  error_at    timestamptz
);
insert into public.lead_pool_stats (id) values (true) on conflict do nothing;
alter table public.lead_pool_stats enable row level security;
revoke all on public.lead_pool_stats from anon, authenticated;

create or replace function public.fn_lead_pool_stats_refresh()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tiles jsonb; v_facets jsonb;
begin
  with m as (
    select s.source, s.phone10, s.tier
      from public.mat_lead_pool s
     where not s.dnc
       and not exists (select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10)
       and not exists (select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null)
  ),
  per as (select source, tier, count(*)::int as n from (select distinct source, tier, phone10 from m) q group by 1, 2),
  tot as (select source, count(*)::int as total from (select distinct source, phone10 from m) q group by 1),
  src as (select unnest(array['marketing','dialer','rewrite','winback']) as source)
  select jsonb_object_agg(src.source, jsonb_build_object(
           'total', coalesce(tot.total, 0),
           'by_tier', coalesce((select jsonb_object_agg(per.tier, per.n) from per where per.source = src.source), '{}'::jsonb)))
    into v_tiles
    from src left join tot on tot.source = src.source;

  select jsonb_object_agg(src.source, jsonb_build_object(
    'states', coalesce((select jsonb_agg(jsonb_build_object('k', x.state, 'n', x.n) order by x.n desc, x.state) from (
        select s.state, count(*)::int as n from public.mat_lead_pool s
         where s.source = src.source and not s.dnc and s.state ~ '^[A-Z]{2}$' group by s.state) x), '[]'::jsonb),
    'no_state', (select count(*)::int from public.mat_lead_pool s where s.source = src.source and not s.dnc and s.state is null),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('k', y.c, 'n', y.n) order by y.c) from (
        select c.c, count(*)::int as n
          from public.mat_lead_pool s cross join lateral jsonb_array_elements_text(s.flags->'campaigns') c(c)
         where s.source = src.source and not s.dnc and jsonb_typeof(s.flags->'campaigns') = 'array' group by c.c) y), '[]'::jsonb)))
    into v_facets
    from (select unnest(array['marketing','dialer','rewrite','winback']) as source) src;

  update public.lead_pool_stats set tiles = v_tiles, facets = v_facets, computed_at = now(), last_error = null where id;
end $$;
revoke all on function public.fn_lead_pool_stats_refresh() from public, anon, authenticated;

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
  -- MP-LEAD-PHONE-READYMODE-b: packs already handed out pick up new ReadyMode-number evidence.
  perform public.fn_repair_pack_phones();
  -- The pool tiles and the filter lists are worked out once here, not on every page visit: over ~450k rows they
  -- took about 10 seconds each, past the 8-second limit a signed-in page call gets.
  begin
    perform public.fn_lead_pool_stats_refresh();
  exception when others then
    update public.lead_pool_stats set last_error = sqlerrm, error_at = now() where id;
  end;
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

create or replace function public.lead_pool_tiles()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  -- as of the last snapshot refresh; the filtered count under the tiles (lead_pool_counts) stays live
  select s.tiles into v from public.lead_pool_stats s where s.id;
  return coalesce(v, '{}'::jsonb);
end $$;

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
  select s.facets->p_source into v from public.lead_pool_stats s where s.id;
  return coalesce(v, jsonb_build_object('states', '[]'::jsonb, 'no_state', 0, 'campaigns', '[]'::jsonb));
end $$;

-- twice an hour, off the top of the hour
select cron.alter_job((select jobid from cron.job where jobname = 'apex-lead-pool-snapshot'), schedule := '7,37 * * * *');
