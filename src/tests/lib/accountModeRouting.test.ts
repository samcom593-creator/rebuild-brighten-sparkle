import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, `../../${rel}`), "utf8");

// MP-332 contract: a person's admin-set account_mode decides their home screen
// and nav. Before this, nothing in routing read account_mode — a Pure Recruiter
// landed on the agent production home and an Agency Owner was a plain manager.
describe("account mode → home screen routing", () => {
  it("useAuth resolves effectiveMode with admin winning, then account_mode, then roles", () => {
    const auth = src("hooks/useAuth.ts");
    expect(auth).toContain('if (isAdmin) return "admin";');
    expect(auth).toContain('if (m === "agency_owner" || m === "recruiter" || m === "manager" || m === "va" || m === "va_manager") return m;');
    expect(auth).toContain('if (isRecruiter) return "recruiter";');
    // the role union must include recruiter or hasRole("recruiter") is a type error
    expect(auth).toContain('"va" | "recruiter"');
    // the mode read must never throw into the auth boot path
    expect(auth).toContain('.select("account_mode")');
  });

  it("Dashboard routes each mode to its own home", () => {
    const d = src("pages/Dashboard.tsx");
    expect(d).toContain('if (effectiveRole === "recruiter") {');
    expect(d).toContain("<RecruiterHome />");
    expect(d).toContain('if (effectiveRole === "agency_owner") {');
    expect(d).toContain("<AgencyOwnerHome />");
    expect(d).toContain('effectiveRole === "va" || effectiveRole === "va_manager"');
    // the legacy snapshot must not fire for the new homes
    expect(d).toContain('!["recruiter", "agency_owner", "va", "va_manager"].includes(effectiveRole)');
  });

  it("the Agency Owner home carries no money of its own (scoreboard above it is the single source)", () => {
    const home = src("pages/AgencyOwnerHome.tsx");
    expect(home).not.toContain("agentlink_deals_snapshot");
    expect(home).not.toContain("annual_premium");
    expect(home).toContain("my_downline_agent_ids");
  });

  it("the Recruiter home is scoped to the recruiter's own recruits", () => {
    const home = src("pages/RecruiterHome.tsx");
    expect(home).toContain('.eq("recruiter_id", agentId)');
    expect(home).not.toContain("agentlink");
    expect(home).not.toContain("insuracloud");
  });

  it("role preview covers every mode and derives the real role from effectiveMode", () => {
    const p = src("hooks/useRolePreview.ts");
    expect(p).toContain('["agent", "manager", "agency_owner", "recruiter", "va", "va_manager", "admin"]');
    expect(p).toContain("const actualRole: RolePreview = effectiveMode;");
  });

  it("nav allowlists keep the selling surface off recruiter and VA modes", () => {
    const nav = src("components/layout/agentCloudNavigation.ts");
    expect(nav).toContain('const PRODUCERS: AccountMode[] = ["agent", "manager", "agency_owner"];');
    expect(nav).toContain('label: "Sell"');
    expect(nav).toContain('modes: [...PRODUCERS, "va", "va_manager"]');
    // The mode check lives in the shared filter (one rule for the sidebar and the palette); the sidebar must call it
    // with viewMode = the previewed role when Sam is previewing, else the real mode.
    expect(nav).toContain("modes.includes(viewer.viewMode)");
    const sidebar = src("components/layout/GlobalSidebar.tsx");
    expect(sidebar).toContain("filterAgentCloudNav(entries, { seesAll, viewMode, grants: navGrants, isSam: isSamEmail(user?.email) })");
    expect(sidebar).not.toContain("modes.includes(viewMode)");
    expect(sidebar).toContain("const viewMode = isPreviewing ? effectiveRole : effectiveMode;");
    expect(sidebar).toContain("const seesAll = isAdmin && !isPreviewing;");
  });

  it("canonical recruiting routes admit recruiters and training aliases preserve their guarded destinations", () => {
    const app = src("App.tsx");
    const route = (pathname: string) => {
      const matches = app.split("\n").filter(line => line.includes(`<Route path="${pathname}" `));
      expect(matches, pathname).toHaveLength(1);
      return matches[0];
    };
    for (const [pathname, page] of [
      ["/dashboard/recruiting", "DashboardApplicants"],
      ["/dashboard/recruiting/pipeline", "RecruitingPipeline"],
      ["/dashboard/recruiting/interviews", "Interviews"],
      ["/dashboard/recruiting/follow-ups", "InterviewRecovery"],
      ["/dashboard/recruiting/hires", "DashboardApplicants"],
      ["/dashboard/training/progress", "CourseProgress"],
      ["/dashboard/training/content", "CourseContent"],
    ]) {
      expect(route(pathname), pathname).toContain(`<ProtectedRoute requireAdmin allowManagers allowRoles={["va_manager", "va", "recruiter"]}><${page} /></ProtectedRoute>`);
    }
    for (const [suffix, page, staffOnly] of [
      ["", "ApexTrainingEntry", false],
      ["/library", "TrainingHub", false],
      ["/library/course/:courseId", "TrainingHubCourse", false],
      ["/sales-course", "CourseCatalog", false],
      ["/progress", "CourseProgress", true],
      ["/content", "CourseContent", true],
      ["/annuities", "AnnuityTraining", false],
    ] as const) {
      const canonical = `/dashboard/training${suffix}`;
      expect(route(`/dashboard/recruiting/training${suffix}`)).toContain(`element={<LegacyWorkspaceRedirect to="${canonical}" />}`);
      if (!staffOnly) expect(route(canonical)).toContain(`<ProtectedRoute><${page} /></ProtectedRoute>`);
      expect(legacyRedirectTarget(canonical, { search: "?tab=team&filter=retained", hash: "#lesson" }, { courseId: "course one" }))
        .toBe(`${canonical.replace(":courseId", "course%20one")}?tab=team&filter=retained#lesson`);
    }
  });
});
