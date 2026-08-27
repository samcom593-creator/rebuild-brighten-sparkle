import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("hire monitoring and recruiting income contract", () => {
  const migration = source("supabase/migrations/20260827241000_zero_lead_spend_recruiting_income.sql");

  it("sets lead spend to zero on both the server and every leaderboard fallback", () => {
    expect(migration).toContain("values ('board_lead_cost', '0', now())");
    expect(migration).toContain("0::numeric as lead_cost");
    expect(source("src/pages/BoardLive.tsx")).toContain("r.lead_cost ?? 0");
    expect(source("src/pages/Leaderboard.tsx")).toContain("const leadCostPerProducer = 0");
  });

  it("estimates recruiting income from canonical production and recursive hierarchy comp spread", () => {
    expect(migration).toContain("public.recruiting_income_estimate");
    expect(migration).toContain("with recursive hierarchy");
    expect(migration).toContain("public.v_production_comp_truth");
    expect(migration).toContain("greatest(v_recruiter_comp - seller_comp_pct, 0)");
    expect(migration).toContain("Estimate only; not paid commission");
  });

  it("keeps Milver and VA hiring operations on a real-time no-hire-left-behind queue", () => {
    const panel = source("src/components/recruiting/NoHireLeftBehindPanel.tsx");
    const applicants = source("src/pages/DashboardApplicants.tsx");
    expect(panel).toContain("No Hire Left Behind");
    expect(panel).toContain("Live Milver + VA handoff queue");
    expect(panel).toContain('table: "agents"');
    expect(panel).toContain('table: "onboarding_progress"');
    expect(panel).toContain("v_hire_notification_gaps");
    expect(applicants).toContain("isAdmin || isManager || isVaStaff");
    expect(applicants).toContain("<NoHireLeftBehindPanel />");
  });
});
