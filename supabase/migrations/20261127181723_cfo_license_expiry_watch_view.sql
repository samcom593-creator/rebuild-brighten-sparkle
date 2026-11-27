-- MP-CFO-LICENSE-EXPIRY-WATCH (2026-11-27 18:17Z). Applied live via MCP by the Studio finance worker, whose own
-- copy lives in ~/business-ops/migrations/2026-11-27-license-expiry-watch.sql (not this repo). Recorded here, read
-- back from pg_get_viewdef, so `supabase db push` on main does not fail with "remote migration versions not found"
-- (the cb45c0d2 precedent). The version is already in supabase_migrations.schema_migrations; db push skips it.
--
-- What it is: active licensed producers classified on license_expires_at + eo_expires_at
-- (EXPIRED / EXP_30 / EXP_60 / EXP_90 / OK / UNKNOWN / IMPLAUSIBLE). UNKNOWN = no expiry date on record, the real
-- blind spot (52 of 58 at creation). Read by scripts/license-expiry-watch.py under the service role only.
create or replace view public.v_cfo_license_expiry_watch as
 with base as (
         select a.id as agent_id,
            a.display_name,
            a.agent_code,
            a.license_expires_at,
            a.eo_expires_at,
            coalesce(d.deal_count, 0::bigint)::integer as deals_count,
            coalesce(d.alp, 0::numeric) as alp_total
           from public.agents a
             left join ( select deals.agent_id,
                    count(*) as deal_count,
                    sum(deals.annual_premium) as alp
                   from public.deals
                  group by deals.agent_id) d on d.agent_id = a.id
          where a.license_status = 'licensed'::license_status and a.status = 'active'::agent_status and coalesce(a.is_inactive, false) = false and a.canonical_agent_id is null
        ), classified as (
         select b.agent_id,
            b.display_name,
            b.agent_code,
            b.license_expires_at,
            b.eo_expires_at,
            b.deals_count,
            b.alp_total,
                case
                    when b.license_expires_at is null then 'UNKNOWN'::text
                    when b.license_expires_at > (now() + '20 years'::interval) then 'IMPLAUSIBLE'::text
                    when b.license_expires_at < now() then 'EXPIRED'::text
                    when b.license_expires_at < (now() + '30 days'::interval) then 'EXP_30'::text
                    when b.license_expires_at < (now() + '60 days'::interval) then 'EXP_60'::text
                    when b.license_expires_at < (now() + '90 days'::interval) then 'EXP_90'::text
                    else 'OK'::text
                end as lic_state,
                case
                    when b.eo_expires_at is null then 'UNKNOWN'::text
                    when b.eo_expires_at > (current_date + '20 years'::interval) then 'IMPLAUSIBLE'::text
                    when b.eo_expires_at < current_date then 'EXPIRED'::text
                    when b.eo_expires_at < (current_date + 30) then 'EXP_30'::text
                    when b.eo_expires_at < (current_date + 60) then 'EXP_60'::text
                    when b.eo_expires_at < (current_date + 90) then 'EXP_90'::text
                    else 'OK'::text
                end as eo_state
           from base b
        )
 select agent_id,
    display_name,
    agent_code,
    license_expires_at,
    eo_expires_at,
    deals_count,
    alp_total,
    lic_state,
    eo_state,
        case
            when 'EXPIRED'::text = lic_state or 'EXPIRED'::text = eo_state then 'EXPIRED'::text
            when 'EXP_30'::text = lic_state or 'EXP_30'::text = eo_state then 'EXP_30'::text
            when 'EXP_60'::text = lic_state or 'EXP_60'::text = eo_state then 'EXP_60'::text
            when 'EXP_90'::text = lic_state or 'EXP_90'::text = eo_state then 'EXP_90'::text
            when 'IMPLAUSIBLE'::text = lic_state or 'IMPLAUSIBLE'::text = eo_state then 'IMPLAUSIBLE'::text
            when lic_state = 'OK'::text or eo_state = 'OK'::text then 'OK'::text
            else 'UNKNOWN'::text
        end as worst_state,
    now() as as_of
   from classified c;

comment on view public.v_cfo_license_expiry_watch is
  'MP-CFO-LICENSE-EXPIRY-WATCH: active licensed producers classified on license_expires_at + eo_expires_at (EXPIRED/EXP_30/60/90/OK/UNKNOWN/IMPLAUSIBLE). UNKNOWN = no expiry date on record = the real blind spot. Chargeback-exposure lane; self-heals as dates backfill.';

-- Service-role only (as applied): the view names producers and their written ALP, and no page reads it.
revoke all on public.v_cfo_license_expiry_watch from anon, authenticated;
