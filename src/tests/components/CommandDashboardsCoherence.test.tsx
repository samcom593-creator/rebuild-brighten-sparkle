import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

function routeLine(app: string, routePath: string): string | undefined {
  return app.split("\n").find((line) => line.includes(`path="${routePath}"`));
}

describe("command dashboards link only to pages their audience can open", () => {
  const app = source("App.tsx");

  it("contracting tile reads carrier-case truth and never renders a failed read as zero", () => {
    const tile = source("components/dashboard/OperationsCommandCenter.tsx");
    expect(tile).toContain('supabase.rpc("contracting_exception_digest"');
    expect(tile).toContain('to="/dashboard/contracting/cases"');
    expect(tile).toContain("Could not load carrier cases");
    expect(tile).not.toContain("d.contracting.");
    expect(tile).not.toContain("/dashboard/recruiting/interviews");
    // Recruiting counts come from the worklist, the same source as HomeOperationsSummary.
    expect(tile).toContain("useRecruitingWorklist(isAdmin)");
    expect(tile).not.toContain("need a call");
    expect(routeLine(app, "/dashboard/contracting/cases")).toContain("requireAdmin");
  });

  it("manager home links stay inside routes that admit managers", () => {
    const view = source("pages/ManagerCommandView.tsx");
    expect(view).not.toContain("/dashboard/agent-management");
    expect(view).not.toContain("/dashboard/inbound-leads");
    expect(view).toContain("to={`/dashboard/agent/${a.id}`}");
    expect(view).not.toContain("live production from AgentLink");
    expect(routeLine(app, "/dashboard/agent/:id")).toContain("<ProtectedRoute>");
    expect(routeLine(app, "/dashboard/call-center")).toContain("<ProtectedRoute>");
    expect(routeLine(app, "/dashboard/recruiting")).toContain("allowManagers");
  });

  it("agent command dashboard has no dead or ignored deep links", () => {
    const page = source("pages/AgentCommandDashboard.tsx");
    expect(page).not.toMatch(/"\/book-of-business"/);
    expect(page).not.toContain("filter=follow_up_due");
    expect(page).not.toContain("contacted=untouched");
    expect(page).not.toContain("Wire your AgentLink");
    expect(page).toContain('to="/dashboard/recruit-pipeline"');
    expect(routeLine(app, "/dashboard/book-of-business")).toBeDefined();
    expect(routeLine(app, "/dashboard/recruit-pipeline")).toContain("<ProtectedRoute>");
  });

  it("AgentLink tooling has no entry points from non-admin or settings surfaces", () => {
    expect(source("components/dashboard/ProfileSettings.tsx")).not.toContain("InsuraCloudTokenSection");
    expect(source("pages/ResourcesLicensing.tsx")).not.toContain("agentlink.insuracloud.ai");
    expect(source("pages/Dashboard.tsx")).not.toContain('href="/dashboard/agentlink-sync"');
    expect(source("pages/SystemHealth.tsx")).not.toContain("/admin/missing-al-link");
    expect(source("pages/AutomationHub.tsx")).not.toContain("InsuraCloudOutbox");
    expect(source("pages/DashboardCommandCenter.tsx")).not.toContain("<InsuraCloudHealthAlert");
  });
});
