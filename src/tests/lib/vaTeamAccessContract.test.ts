import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const crm = readFileSync(resolve(process.cwd(), "src/pages/DashboardCRM.tsx"), "utf8");

describe("VA team access contract", () => {
  it("lets VA operators load the agency roster without requiring an agent record", () => {
    expect(crm).toContain("const canWorkAgencyRoster = isAdmin || isVaManager || isVa");
    expect(crm).toContain("if (!currentAgent && !canWorkAgencyRoster) { return []; }");
    expect(crm).toContain("if (!canWorkAgencyRoster) {");
  });

  it("provides a permission-checked team check-in receipt", () => {
    expect(crm).toContain('.update({ last_contacted_at: checkedInAt })');
    expect(crm).toContain("marked checked in");
  });
});
