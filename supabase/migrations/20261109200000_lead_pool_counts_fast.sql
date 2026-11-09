-- MP-LEAD-MANAGER-12 (2026-11-09): "site running so slow" — measured: the site
-- is fine (REST p50 ~180ms); Lead Manager's counting is what drags. Marketing
-- counts took 3.2s and the page computes the marketing pool TWICE on open
-- (tile totals + the filter card's counts), ~9s of DB work per visit. EXPLAIN
-- says the exclusion probes are free (indexed; ledger empty today) — the cost
-- is materializing 125k rows out of sellable_pool, and MP-9's row_number added
-- a second full-row sort on top.
--
-- 1) lead_pool_counts drops the window function: distinct-phone totals via
--    count(distinct phone10), which only sorts the phone column. Same numbers
--    for marketing/dialer (zero dup phones, measured); for the tiny pools a
--    phone with rows in two tiers can count once per tier in by_tier — total
--    stays exact, and the drop path keeps its own rank-1 dedupe untouched.
-- 2) lead_pool_tiles() returns all four pools' total+tier mix in ONE call so
--    the tiles cost one round trip and the client can cache it for minutes.
create or replace function public.lead_pool_counts(
  p_source text, p_filters jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare v jsonb; v_excl_dnc boolean := coalesce((p_filters->>'exclude_dnc')::boolean, true);
  v_excl_sold boolean := coalesce((p_filters->>'exclude_resold')::boolean, true);
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  with m as (select * from public.sellable_pool(p_source, p_filters)),
  e as (select * from m
        where not (v_excl_dnc and coalesce((flags->>'dnc')::boolean, false))
          and not (v_excl_sold and already_sold)
          and not in_bundle)
  select jsonb_build_object(
    'total', (select count(distinct phone10)::int from e),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (
        select tier, count(distinct phone10)::int n from e group by tier) g), '{}'::jsonb),
    'under_9mo', (select count(distinct phone10)::int from e where under_9mo),
    'dnc_excluded', (select count(*)::int from m where coalesce((flags->>'dnc')::boolean, false)),
    'resold_excluded', (select count(*)::int from m where already_sold),
    'in_bundle_excluded', (select count(*)::int from m where in_bundle),
    'sample', coalesce((select jsonb_agg(row_to_json(t)) from (
        select first_name, last_name, '***-***-' || right(phone10, 4) as phone_masked,
               state, age, tier, tags, flags, lead_age_days, under_9mo
        from e order by array_position(array['S','A','B','C','D'], tier), lead_age_days desc limit 25) t), '[]'::jsonb)
  ) into v;
  return v;
end $function$;

create or replace function public.lead_pool_tiles()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $function$
declare v jsonb := '{}'::jsonb; p text;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  foreach p in array array['marketing','dialer','rewrite','winback'] loop
    v := v || jsonb_build_object(p, (
      with e as (
        select m.phone10, m.tier from public.sellable_pool(p, '{}'::jsonb) m
        where not coalesce((m.flags->>'dnc')::boolean, false)
          and not m.already_sold and not m.in_bundle)
      select jsonb_build_object(
        'total', (select count(distinct phone10)::int from e),
        'by_tier', coalesce((select jsonb_object_agg(tier, n) from (
            select tier, count(distinct phone10)::int n from e group by tier) g), '{}'::jsonb))
    ));
  end loop;
  return v;
end $function$;
grant execute on function public.lead_pool_tiles() to authenticated;
