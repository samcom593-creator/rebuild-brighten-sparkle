-- MP-502: RECOVERED FROM PROD, not authored here.
--
-- This migration was applied to prod by the Supabase MCP connector, which
-- assigns its OWN precise-timestamp version and records the statements in
-- supabase_migrations.schema_migrations. The authoring wave separately
-- committed its SQL under a hand-chosen round timestamp (20260910020100),
-- so local and remote history never agreed on which version had run.
--
-- Six such pairs accumulated and every one of them blocked `supabase db push`
-- with "Remote migration versions not found in local migrations directory" --
-- the whole migration leg of deploy-supabase.yml has been red since 00:06Z.
--
-- Five of the six pairs were byte-identical (modulo comments/whitespace) and
-- were reconciled by renaming the local file to the version that actually ran.
-- THIS pair was NOT identical: prod runs the occurrence-count guard below,
-- while the repo's file used `position('agentcloud_producer' in def) > 0`.
-- So the repo's variant never ran, and renaming it would have recorded a lie
-- about what is live. This file therefore carries the statements PROD ACTUALLY
-- EXECUTED, recovered verbatim from schema_migrations; the repo's revised
-- variant survives untouched at 20260910040000 and applies forward in order.
--
-- Body below is verbatim prod. Do not "tidy" it -- it is a record, not a change.

-- MP-CONTENT-4: Vantage production attributed to the agents who wrote it.
-- The Agent Cloud production API (sync every 15 min) already reports per-producer policies and premium
-- in production_external_daily_snapshots.metadata->'producers'; v_production_unified collapsed every
-- API day into anonymous rows on agent ...a008 ("Vantage Financial (API aggregate)"), so Marquay Vaughns,
-- Kaeden Vaughns, Pranav Kodali, Jaden Selvaraj, David Ladd never appeared as themselves anywhere.
-- Producers are mapped to agents rows by exact display name inside the vantage subagency; unmatched
-- producers (Marlyn Johnson today) stay in the aggregate bucket so nothing is invented.

create table if not exists public.vantage_producer_map (
  agentcloud_agent_id text primary key,
  producer_name text not null,
  apex_agent_id uuid references public.agents(id),
  matched_by text not null default 'display_name',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vantage_producer_map enable row level security;
revoke all on public.vantage_producer_map from anon, authenticated;
grant all on public.vantage_producer_map to service_role;
grant select, insert, update on public.vantage_producer_map to authenticated;
drop policy if exists vantage_producer_map_admin on public.vantage_producer_map;
create policy vantage_producer_map_admin on public.vantage_producer_map for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

-- seed: every producer the API has ever reported, matched by name within the vantage subagency
insert into public.vantage_producer_map (agentcloud_agent_id, producer_name, apex_agent_id, matched_by)
select p.agent_id, p.name,
       (select a.id from public.agents a where lower(a.display_name) = lower(p.name) and public.fn_agent_subagency(a.id) = 'vantage' order by (a.status::text = 'active') desc, a.created_at limit 1),
       'display_name'
from (select distinct x->>'agent_id' as agent_id, x->>'name' as name
      from public.production_external_daily_snapshots s, jsonb_array_elements(coalesce(s.metadata->'producers','[]'::jsonb)) x
      where s.source = 'agentcloud_production_api') p
on conflict (agentcloud_agent_id) do nothing;

-- patch the view in place: replace the aggregate tail with per-producer rows (anchor asserted unique)
do $patch$
declare def text; cut integer; head text; tail text;
begin
  def := pg_get_viewdef('public.v_production_unified'::regclass, true);
  if (length(def) - length(replace(def, 'agentcloud-total:', ''))) / length('agentcloud-total:') <> 1 then
    raise exception 'agentcloud-total anchor not unique in v_production_unified';
  end if;
  if position('agentcloud_producer' in def) > 0 then raise notice 'already patched'; return; end if;
  cut := position('agentcloud-total:' in def);
  head := substr(def, 1, cut);
  cut := length(head) - position(reverse('UNION ALL') in reverse(head)) - length('UNION ALL') + 2;  -- start of the last UNION ALL before the anchor
  head := substr(def, 1, cut - 1);
  tail := $t$UNION ALL
 SELECT ('agentcloud:' || a.business_date::text || ':' || (pr.x ->> 'agent_id') || ':' || series.n::text) AS row_key,
    CASE WHEN m.apex_agent_id IS NOT NULL THEN 'agentcloud_producer'::text ELSE 'external_daily_gap'::text END AS origin,
    COALESCE(m.apex_agent_id, '00000000-0000-0000-0000-00000000a008'::uuid) AS agent_id,
    CASE WHEN m.apex_agent_id IS NOT NULL THEN (pr.x ->> 'name') ELSE 'Vantage Financial (API aggregate)'::text END AS agent_name,
    NULL::text AS client_name, NULL::text AS carrier, NULL::text AS product, NULL::text AS policy_number,
    (pr.x ->> 'premium')::numeric / NULLIF((pr.x ->> 'policies')::integer, 0)::numeric AS annual_premium,
    a.business_date AS posted_date, NULL::date AS effective_date, 'reported_external'::text AS status, a.updated_at AS synced_at
   FROM api_days a
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.metadata -> 'producers', '[]'::jsonb)) pr(x)
     LEFT JOIN vantage_producer_map m ON m.agentcloud_agent_id = (pr.x ->> 'agent_id') AND m.apex_agent_id IS NOT NULL
     CROSS JOIN LATERAL generate_series(1, GREATEST(COALESCE((pr.x ->> 'policies')::integer, 0), 0)) series(n)
  WHERE jsonb_array_length(COALESCE(a.metadata -> 'producers', '[]'::jsonb)) > 0
UNION ALL
 SELECT ('agentcloud-total:' || a.business_date::text || ':' || series.n::text) AS row_key,
    'external_daily_gap'::text AS origin,
    '00000000-0000-0000-0000-00000000a008'::uuid AS agent_id,
    'Vantage Financial (API aggregate)'::text AS agent_name,
    NULL::text AS client_name, NULL::text AS carrier, NULL::text AS product, NULL::text AS policy_number,
    a.reported_alp / NULLIF(a.reported_policies, 0)::numeric AS annual_premium,
    a.business_date AS posted_date, NULL::date AS effective_date, 'reported_external'::text AS status, a.updated_at AS synced_at
   FROM api_days a
     CROSS JOIN LATERAL generate_series(1, a.reported_policies) series(n)
  WHERE jsonb_array_length(COALESCE(a.metadata -> 'producers', '[]'::jsonb)) = 0$t$;
  execute 'create or replace view public.v_production_unified as ' || head || tail;
end $patch$;

select public.refresh_production_truth(true);
