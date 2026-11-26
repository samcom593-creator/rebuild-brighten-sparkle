-- MP-LEAD-COUNTS-SLIM (1/2): a slim, phone-flagged copy of the lead pool for the count path.
-- The no-history preview in lead_pool_preview_candidates read v_lead_pool_candidate_base, which
-- recomputes the held-phone flags over the whole 300 MB pool and merge-joins 250k dialer rows
-- through an uncorrelated (source, phone10) index: 245k random heap touches, 3.8s before the
-- counts function even starts its DISTINCT ON passes (8.2s total on an idle box; the API cancels
-- at 8s). The hold flags only change when the pool is rebuilt, so they belong in the snapshot.
-- ~60 MB, stored in (source, phone10) order; DNC marks, sold phones and live packs stay live.
--
-- Applied live 2026-11-26 17:31Z through the Supabase MCP apply_migration (version = file name).
set local work_mem = '128MB';
set local maintenance_work_mem = '128MB';

create materialized view public.mat_lead_pool_slim as
with holds as materialized (
  select h.phone10,
    bool_or(coalesce((h.flags->>'true_dnc')::boolean, (h.dnc and not coalesce((h.flags->>'current_client')::boolean, false)))) as true_dnc,
    bool_or(coalesce((h.flags->>'current_client')::boolean, false)) as current_client,
    bool_or(coalesce((h.flags->>'import_review_required')::boolean, false)) as needs_review
  from public.mat_lead_pool h
  where h.dnc or h.flags @> '{"true_dnc": true}'::jsonb or h.flags @> '{"current_client": true}'::jsonb or h.flags @> '{"import_review_required": true}'::jsonb
  group by h.phone10
)
select s.rid, s.source, s.phone10, s.state, s.age, s.tier, s.lead_age_days, s.under_9mo,
  coalesce(h.true_dnc, false) as flag_true_dnc,
  coalesce(h.current_client, false) as current_client,
  coalesce(h.needs_review, false) as needs_review,
  nullif(s.flags->>'replaced_phone10', '') as replaced_phone10
from public.mat_lead_pool s
left join holds h on h.phone10 = s.phone10
order by s.source, s.phone10;

create unique index mat_lead_pool_slim_rid on public.mat_lead_pool_slim using btree (rid);
create index mat_lead_pool_slim_source_phone on public.mat_lead_pool_slim using btree (source, phone10);
analyze public.mat_lead_pool_slim;

revoke all on public.mat_lead_pool_slim from public;
revoke all on public.mat_lead_pool_slim from anon, authenticated;
grant select on public.mat_lead_pool_slim to service_role;
