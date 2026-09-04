import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("Vantage external production reconciliation", () => {
  const migration = source("supabase/migrations/20260826020000_vantage_external_gap_truth.sql");

  it("records the owner-reported Discord total with explicit provenance", () => {
    expect(migration).toContain("production_external_daily_snapshots");
    expect(migration).toContain("'Vantage Financial', date '2026-08-25', 8, 14078.00");
    expect(migration).toContain("discord_vantage_owner_report");
    expect(migration).toContain("agency aggregate pending individual policy sync");
  });

  it("records the reported September 2 gap without fabricating policy details", () => {
    const repair = source("supabase/migrations/20260903171000_vantage_september_2_reported_gap.sql");
    expect(repair).toContain("'Vantage Financial'");
    expect(repair).toContain("date '2026-09-02'");
    expect(repair).toContain("2000.00");
    expect(repair).toContain("'policy_count_known', false");
    expect(repair).toContain("pending individual Discord policy ingestion");
    expect(repair).toContain("on conflict (agency_name, business_date, source) do update");
    expect(repair).not.toContain("production_external_deals");
  });

  it("retires the September estimate after exact named Discord messages settle", () => {
    const exact = source("supabase/migrations/20260904201000_vantage_september_exact_discord_truth.sql");

    expect(exact).toContain("reported_policies = 0");
    expect(exact).toContain("reported_alp = 0");
    expect(exact).toContain("exact named Discord messages settled by MP-426");
    expect(exact.match(/select public\.ingest_discord_production_deal\(/g)).toHaveLength(3);
    expect(exact.match(/where exists \(\n  select 1 from public\.agents/g)).toHaveLength(3);
    expect(exact).toContain("from public.discord_deal_ingestion_receipts r");
    expect(exact).toContain("r.status in ('ingested', 'duplicate')");
    expect(exact).toContain(") = 3;");
    for (const messageId of ["1545052246897725484", "1545083481569235006", "1545502341275586661"]) {
      expect(exact).toContain(messageId);
    }
    expect(exact).not.toContain("delete from public.production_external_daily_snapshots");
  });

  it("contributes only the positive gap so later AgentLink rows cannot double count", () => {
    expect(migration).toContain("public.v_production_canonical");
    expect(migration).toContain("public.v_external_production_gap");
    expect(migration).toContain("greatest(r.reported_policies - coalesce(c.canonical_policies, 0), 0)");
    expect(migration).toContain("greatest(r.reported_alp - coalesce(c.canonical_alp, 0), 0)");
    expect(migration).toContain("external_daily_gap");
    expect(migration).not.toContain("create table if not exists public.policies");
  });

  it("keeps external aggregate production out of commission estimates", () => {
    expect(migration).toContain("when u.origin = 'external_daily_gap' then 0::numeric");
    expect(migration).toContain("attribution row");
    expect(migration).toContain("grants no access, routing, manager rights, alerts, or credentials");
  });

  it("keeps agency snapshots in totals but out of individual leaderboards", () => {
    const attribution = source("supabase/migrations/20260826144000_leaderboard_individual_attribution.sql");
    const productionLog = source("supabase/functions/log-production/index.ts");

    expect(attribution).toContain("create or replace function public.leaderboard_board");
    expect(attribution).toContain("t.origin is distinct from 'external_daily_gap'");
    expect(attribution).toContain("u.origin is distinct from 'external_daily_gap'");
    expect(productionLog).toContain('.neq("origin", "external_daily_gap")');
  });

  it("invalidates agency and today metrics from every live production source", () => {
    const imo = source("src/components/dashboard/ImoByAgency.tsx");
    const crm = source("src/pages/DashboardCRM.tsx");
    for (const table of ["deals", "agentlink_book", "production_external_daily_snapshots", "production_external_deals"]) {
      expect(imo).toContain(`table: "${table}"`);
      expect(crm).toContain(`table: "${table}"`);
    }
    expect(imo).toContain('queryKey: ["imo-by-agency"]');
    expect(imo).toContain('queryKey: ["crm-today-production"]');
  });

  it("keeps named Discord sales live and reconciles them one-for-one", () => {
    const named = source("supabase/migrations/20260826162500_discord_named_production_truth.sql");
    expect(named).toContain("production_external_deals");
    expect(named).toContain("ingest_external_production_deal");
    expect(named).toContain("'discord_external'::text");
    expect(named).toContain("row_number() over");
    expect(named).toContain("e.match_rank > coalesce(c.matched_rows, 0)");
    expect(named).toContain("'Marquay Vaughns'");
    expect(named).toContain("'Pranav Kodali'");
    expect(named).toContain("2037");
    expect(named).toContain("1094");
    expect(named).toContain("4020");
  });

  it("keeps the source-attested Vantage writer name after canonical reconciliation", () => {
    const identity = source("supabase/migrations/20260904040000_vantage_writer_identity.sql");

    expect(identity).toContain("when u.origin = 'discord_external' then u.agent_name");
    expect(identity).toContain("coalesce(m.canonical_agent_id, u.agent_id) as agent_id");
    expect(identity).toContain("Named Discord rows preserve the source-attested writing-agent name");
  });

  it("settles one Discord message once without replacing its source-resolved writer", () => {
    const repair = source("supabase/migrations/20260904190000_discord_message_identity_and_writer.sql");
    const enumCast = source("supabase/migrations/20260904200000_discord_agent_status_enum_cast.sql");

    expect(repair).toContain("retry.external_ref = original.external_ref || ':1'");
    expect(repair).toContain("deal_ordinal = 0");
    expect(repair).toContain("production_external_deal_id = pair.original_id");
    expect(repair).toContain("set status = 'duplicate'");
    expect(repair).toContain("'duplicate', 'lapsed', 'cancelled'");
    expect(repair).toContain("v_writer_agent_id, v_canonical_agent_id");
    expect(repair).toContain("v_agency_name, v_writer_agent_id, btrim(p_agent_name)");
    expect(repair).not.toContain("v_agency_name, v_canonical_agent_id, btrim(p_agent_name)");
    expect(enumCast).toContain("lower(coalesce(a.status::text, ''active''))");
    expect(enumCast).toContain("pg_get_functiondef(v_signature)");
    expect(enumCast).toContain("raise exception 'Discord ingestion RPC no longer matches");
  });
});
