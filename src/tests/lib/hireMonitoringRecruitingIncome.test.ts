import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("hire monitoring and recruiting income contract", () => {
  const migration = source("supabase/migrations/20260827241000_zero_lead_spend_recruiting_income.sql");

  it("sets lead spend to zero on the server, and no leaderboard shows the category at all", () => {
    expect(migration).toContain("values ('board_lead_cost', '0', now())");
    expect(migration).toContain("0::numeric as lead_cost");
    // OVERHAUL-leaderboards (2026-10-29): leads are company-funded, so "Lead spend $0" and
    // "After leads" (always equal to Est. income) were removed from both boards, per Sam.
    for (const page of ["src/pages/Leaderboard.tsx", "src/pages/BoardLive.tsx"]) {
      const code = source(page);
      expect(code).not.toMatch(/lead_cost|leadCost|leadSpend|afterLeadSpend/);
      expect(code.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/>[^<]*Lead spend|After leads/);
    }
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
    const facts = source("src/components/onboarding/useOnboardingExceptionFacts.ts");
    const applicants = source("src/pages/DashboardApplicants.tsx");
    expect(panel).toContain("No Hire Left Behind");
    // The panel still describes the live queue, in product words rather than a staff name and an acronym.
    expect(panel).toContain("New hires with an open onboarding step.");
    // APEX OS §6: the panel is an actionable exception queue now, fed by one
    // facts RPC with realtime on the hot tables (moved into the shared hook).
    expect(panel).toContain("useOnboardingExceptionFacts");
    expect(panel).toContain("OnboardingExceptionQueue");
    expect(facts).toContain('"onboarding_exception_facts"');
    expect(facts).toContain('table: "agents"');
    expect(facts).toContain('table: "onboarding_progress"');
    // The notification-gap tile was a doctor metric (0 rows), not a hire exception.
    expect(panel).not.toContain("v_hire_notification_gaps");
    expect(applicants).toContain("isAdmin || isManager || isVaStaff");
    expect(applicants).toContain("<NoHireLeftBehindPanel />");
  });
});
