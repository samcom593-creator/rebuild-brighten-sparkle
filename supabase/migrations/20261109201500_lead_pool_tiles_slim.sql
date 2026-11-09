-- MP-LEAD-MANAGER-12b (2026-11-09): the first speed cut didn't move the needle
-- (3.36s vs 3.2s) because the cost is (a) materializing sellable_pool's full
-- 14-column rows (flags jsonb included) into a temp spool and (b) six separate
-- aggregate passes over it. Two changes:
--   * lead_pool_counts aggregates the excluded/total numbers in ONE pass over m
--     (FILTER clauses) plus one small by_tier pass over e — 2 passes, not 6.
--   * lead_pool_tiles skips sellable_pool entirely: it reads each v_pool_* view
--     projecting only phone10/tier/flags so the planner prunes every other
--     column, with the same exclusion predicates sellable_pool applies (phone
--     shape, dnc flag, resale ledger, live bundle item — the latter two
--     indexed). One narrow CTE per pool, aggregated once.
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
    'under_9mo', (select count(distinct phone10)::int from e where under_9mo),
    'by_tier', coalesce((select jsonb_object_agg(tier, n) from (
        select tier, count(distinct phone10)::int n from e group by tier) g), '{}'::jsonb),
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
declare v jsonb := '{}'::jsonb; p record; one jsonb;
begin
  if not public.can_view_sold_calls() then
    raise exception 'Only Sam and Aisha can browse lead pools.' using errcode = '42501';
  end if;
  for p in select * from (values ('marketing','v_pool_marketing'),('dialer','v_pool_dialer'),
                                 ('rewrite','v_pool_rewrite'),('winback','v_pool_winback')) t(pool, rel) loop
    execute format($q$
      with e as (
        select s.phone10, s.tier
        from public.%I s
        where s.phone10 ~ '^[0-9]{10}$'
          and not coalesce((s.flags->>'dnc')::boolean, false)
          and not exists (select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10)
          and not exists (select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null)
      )
      select jsonb_build_object(
        'total', (select count(distinct phone10)::int from e),
        'by_tier', coalesce((select jsonb_object_agg(tier, n) from (
            select tier, count(distinct phone10)::int n from e group by tier) g), '{}'::jsonb))
    $q$, p.rel) into one;
    v := v || jsonb_build_object(p.pool, one);
  end loop;
  return v;
end $function$;
grant execute on function public.lead_pool_tiles() to authenticated;
