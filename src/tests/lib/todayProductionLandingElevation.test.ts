import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("today production and landing elevation", () => {
  it("aggregates the signed-in hierarchy on the Phoenix business date", () => {
    const migration = source("supabase/migrations/20260826003000_crm_today_production.sql");
    expect(migration).toContain("d.created_at at time zone 'America/Phoenix'");
    expect(migration).toContain("sold_on = current_date");
    expect(migration).toContain("d.duplicate_of_deal_id is null");
    expect(migration).toContain("crm_can_read_agent_scope(d.agent_id)");
  });

  it("keeps the CRM headline live and visibly reports today's policies and streak", () => {
    const crm = source("src/pages/DashboardCRM.tsx");
    const metrics = source("src/components/dashboard/ProductionMetricsCard.tsx");
    expect(crm).toContain('queryKey: ["crm-today-production"]');
    expect(crm).toContain('rpc("crm_today_production"');
    expect(crm).toContain('table: "deals"');
    expect(metrics).toContain("Sold Today:");
    expect(metrics).toContain("active selling streak");
  });

  it("positions the landing page for each APEX partner path", () => {
    const hero = source("src/components/landing/HeroSection.tsx");
    expect(hero).toContain("The enterprise IMO &");
    expect(hero).toContain("Agency Acceleration Platform");
    expect(hero).toContain("Agency Builders");
    expect(hero).toContain("Licensed Producers");
    expect(hero).toContain("Licensing Roadmap");
    expect(hero).toContain("#0D0D0D");
    expect(hero).toContain("#D4AF37");
    expect(hero.toLowerCase()).not.toContain("guaranteed placement");
  });
});
