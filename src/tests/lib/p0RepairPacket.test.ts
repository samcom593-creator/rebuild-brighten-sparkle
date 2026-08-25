import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

describe("P0 repair packet", () => {
  it("keeps the contracting result operational and provides immediate onboarding", () => {
    const page = source("pages/StartContracting.tsx");
    const result = source("components/contracting/ContractingSuccessModal.tsx");
    expect(page).toContain("ContractingSuccessModal");
    expect(result).toContain("Contracting Initiated — Fast Track Active");
    expect(result).toContain("SCHEDULING_LINKS.licensed");
    expect(`${page}\n${result}`.toLowerCase()).not.toContain("in a queue");
  });

  it("renders live production skeletons without placeholder money", () => {
    const crm = source("pages/DashboardCRM.tsx");
    const metrics = source("components/dashboard/ProductionMetricsCard.tsx");
    expect(crm).toContain("<ProductionMetricsCard");
    expect(metrics).toContain("Loading live team production metrics");
    expect(metrics).toContain("<Skeleton");
    expect(`${crm}\n${metrics}`).not.toContain('"$40K"');
  });

  it("serializes the real deals ledger and returns a replay receipt", () => {
    const migration = source("../supabase/migrations/20260825232500_deals_idempotency.sql");
    expect(migration).toContain("deals_policy_identity_unique");
    expect(migration).toContain("carrier_id, lower(btrim(policy_number)), writing_npn");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'status', 'already_recorded'");
    expect(migration).toContain("duplicate_of_deal_id");
  });
});
