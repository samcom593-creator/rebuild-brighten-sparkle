-- Sam reported on 2026-09-03 that Vantage said it wrote about $2,000 on
-- 2026-09-02, while neither AgentLink nor the disabled Discord reader held any
-- September Vantage rows. Preserve the amount immediately as an explicitly
-- unattributed agency snapshot so every unified-ledger dashboard includes it.
--
-- The source report did not include policy-level fields or an exact policy
-- count. One aggregate placeholder is intentional: it makes the known ALP
-- visible without inventing producers, carriers, clients, or policy numbers.
-- v_external_production_gap automatically shrinks this placeholder as stronger
-- canonical rows arrive after the Discord reader is credentialed.

insert into public.production_external_daily_snapshots (
  agency_name,
  business_date,
  reported_policies,
  reported_alp,
  source,
  external_ref,
  reported_at,
  metadata
) values (
  'Vantage Financial',
  date '2026-09-02',
  1,
  2000.00,
  'discord_vantage_owner_report',
  'sam-relay:2026-09-03:vantage:2026-09-02',
  now(),
  jsonb_build_object(
    'provenance', 'Sam relayed Vantage owner-reported production on 2026-09-03',
    'attribution', 'agency aggregate pending individual Discord policy ingestion',
    'policy_count_known', false,
    'amount_precision', 'reported as about $2,000'
  )
)
on conflict (agency_name, business_date, source) do update set
  reported_policies = excluded.reported_policies,
  reported_alp = excluded.reported_alp,
  external_ref = excluded.external_ref,
  reported_at = excluded.reported_at,
  metadata = excluded.metadata,
  updated_at = now();
