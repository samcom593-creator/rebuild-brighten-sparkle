-- MP-LEAD-POOL-REFRESH-COST (2): the hourly refresh's per-step timings (first measured run, 02:17Z):
-- pool 276,524 ms / stats 164,717 ms / slim 11,391 ms / phone_fix 11,250 ms / repair 120 ms = 467.5 s.
-- The stats step ran sellable_pool(source, '{}') for all four sources: the full per-row enrichment
-- (taps, work, jsonb flag merge) over 446k rows, just to count tiers, states and campaigns. Its header
-- comment still said "about 10 seconds each". The same "ready" set is a scan of mat_lead_pool_slim with
-- the live DNC / resale / pack exclusions the count path uses; the campaign facet is the one thing the
-- slim copy lacks, so it is read from mat_lead_pool once, for the dialer source only (the only source
-- that carries campaigns). Proven equal before swapping: tiles match the stored tiles for all four
-- sources (dialer 246,485 / marketing 192,348 / rewrite 54 / winback 33, by-tier identical).
--
-- Applied live 2026-11-27 02:28Z through the Supabase MCP apply_migration (version = file name).
-- After: fn_lead_pool_stats_refresh() 14.4 s measured on the live box (was 164.7 s inside the 02:17Z run).
create or replace function public.fn_lead_pool_stats_refresh()
returns void
language plpgsql security definer
set search_path to 'public'
set work_mem to '64MB'
as $$
declare v_tiles jsonb; v_facets jsonb;
begin
 with src as (select unnest(array['marketing','dialer','rewrite','winback']) as source),
 ready as materialized (
   select distinct on (s.source, s.phone10) s.source, s.phone10, s.tier, s.state
   from public.mat_lead_pool_slim s
   where not (s.flag_true_dnc or s.current_client or s.needs_review)
     and not exists (select 1 from public.lead_contact_dnc d where d.phone10 = s.phone10)
     and not (s.replaced_phone10 is not null and exists (select 1 from public.lead_contact_dnc d2 where d2.phone10 = s.replaced_phone10))
     and not exists (select 1 from public.lead_resale_ledger r where r.phone10 = s.phone10)
     and not exists (select 1 from public.lead_bundle_items i where i.phone10 = s.phone10 and i.removed_at is null)
   order by s.source, s.phone10, array_position(array['S','pos','A','B','F','C','D'], s.tier), s.lead_age_days
 ), per as (select source, tier, count(*)::int n from ready group by 1, 2),
 camp as (
   select m.source, c.campaign, count(*)::int n
   from public.mat_lead_pool m
   cross join lateral jsonb_array_elements_text(case when jsonb_typeof(m.flags->'campaigns') = 'array' then m.flags->'campaigns' else '[]'::jsonb end) c(campaign)
   where m.source = 'dialer' and m.phone10 in (select phone10 from ready where source = 'dialer')
   group by 1, 2
 )
 select jsonb_object_agg(src.source, jsonb_build_object('total', (select count(*) from ready r where r.source = src.source),
   'by_tier', coalesce((select jsonb_object_agg(tier, n) from per where per.source = src.source), '{}'))),
 jsonb_object_agg(src.source, jsonb_build_object(
   'states', coalesce((select jsonb_agg(jsonb_build_object('k', state, 'n', n) order by n desc, state)
      from (select state, count(*)::int n from ready r where r.source = src.source and state ~ '^[A-Z]{2}$' group by state) q), '[]'),
   'no_state', (select count(*) from ready r where r.source = src.source and state is null),
   'campaigns', coalesce((select jsonb_agg(jsonb_build_object('k', campaign, 'n', n) order by campaign)
      from camp where camp.source = src.source), '[]')))
 into v_tiles, v_facets from src;
 update public.lead_pool_stats set tiles = v_tiles, facets = v_facets, computed_at = now(), last_error = null where id;
end $$;
