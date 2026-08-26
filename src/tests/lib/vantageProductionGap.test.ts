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

  it("invalidates agency and today metrics from every live production source", () => {
    const imo = source("src/components/dashboard/ImoByAgency.tsx");
    const crm = source("src/pages/DashboardCRM.tsx");
    for (const table of ["deals", "agentlink_book", "production_external_daily_snapshots"]) {
      expect(imo).toContain(`table: "${table}"`);
      expect(crm).toContain(`table: "${table}"`);
    }
    expect(imo).toContain('queryKey: ["imo-by-agency"]');
    expect(imo).toContain('queryKey: ["crm-today-production"]');
  });
});
