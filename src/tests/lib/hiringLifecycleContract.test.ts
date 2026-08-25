import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("one-tap hiring lifecycle", () => {
  it("creates the account through one canonical path", () => {
    const promote = read("src/components/applicants/PromoteApplicantButton.tsx");
    expect(promote).toContain('functions.invoke("add-agent"');
    expect(promote).toContain("sourceApplicationId: applicationId");
    expect(promote).not.toContain('rpc("promote_applicant_to_agent"');

    const applicants = read("src/pages/DashboardApplicants.tsx");
    expect(applicants).not.toContain("handleMarkAsHired");
  });

  it("preserves hierarchy and the application-to-agent receipt", () => {
    const edge = read("supabase/functions/add-agent/index.ts");
    expect(edge).toContain("manager_id: managerId");
    expect(edge).toContain("invited_by_manager_id: managerId");
    expect(edge).toContain("source_application_id: sourceApplication?.id ?? null");
    expect(edge).toContain('status: "onboarding"');
    expect(edge).toContain('closed_at: new Date().toISOString()');
  });

  it("uses only APEX intake -> spreadsheet -> private Discord for contracting", () => {
    const edge = read("supabase/functions/add-agent/index.ts");
    expect(edge).toContain('const contractingLink = "https://apex-financial.org/start-contracting"');
    expect(edge).toContain('rpc("submit_contracting_intake"');
    expect(edge).not.toContain('.from("contracting_links")');
    expect(edge).not.toContain("Ethos sheet — copy the line below");
  });

  it("derives hire and first-sale metrics from captured lifecycle truth", () => {
    const dashboard = read("src/pages/Dashboard.tsx");
    expect(dashboard).toContain("hired: applications.filter((app) => app.closed_at).length");
    expect(dashboard).toContain("promotedAgents.filter((agent) => agent.first_deal_at).length");
    expect(dashboard).not.toContain("firstSale: applications.filter((app) => app.first_deal_at).length");
  });

  it("uses saved producer comp, including real comp above 100 percent", () => {
    const migration = read("supabase/migrations/20260825121500_scoreboard_saved_comp_truth.sql");
    expect(migration).toContain("a.contract_percentage between 0 and 200");
    expect(migration).toContain("from public.v_production_unified u");
  });
});
