import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountMode } from "@/hooks/useAuth";
import {
  AGENT_CLOUD_ACCOUNT_NAV,
  AGENT_CLOUD_PRIMARY_NAV,
  agentCloudBreadcrumb,
  filterAgentCloudNav,
  flattenAgentCloudNav,
  type AgentCloudNavGrant,
} from "@/components/layout/agentCloudNavigation";

const root = path.resolve(__dirname, "../../..");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");

function hrefsFor(viewMode: AccountMode): string[] {
  const entries = filterAgentCloudNav([...AGENT_CLOUD_PRIMARY_NAV, ...AGENT_CLOUD_ACCOUNT_NAV], { seesAll: false, viewMode });
  return flattenAgentCloudNav(entries).map((link) => link.href.split("?")[0]);
}

/** Roles a route's ProtectedRoute admits, read from App.tsx. null = open to every signed-in user. */
function guardFor(href: string): { open: boolean; managers: boolean; roles: string[] } {
  const line = app.split("\n").find((l) => l.includes(`path="${href}"`));
  if (!line) throw new Error(`no route for ${href}`);
  if (!line.includes("requireAdmin")) return { open: true, managers: false, roles: [] };
  const roles = /allowRoles=\{\[([^\]]*)\]\}/.exec(line)?.[1]?.match(/"([a-z_]+)"/g)?.map((r) => r.replace(/"/g, "")) ?? [];
  return { open: false, managers: line.includes("allowManagers"), roles };
}

describe("sidebar items only reach routes their audience can open", () => {
  // Mode -> the role that mode stands for in the route guards. agency_owner
  // does not imply the manager role, so it is checked as a plain agent.
  const MODE_ROLE: Record<string, { manager: boolean; role: string | null }> = {
    agent: { manager: false, role: null },
    agency_owner: { manager: false, role: null },
    manager: { manager: true, role: null },
    recruiter: { manager: false, role: "recruiter" },
    va: { manager: false, role: "va" },
    va_manager: { manager: false, role: "va_manager" },
  };

  for (const [mode, who] of Object.entries(MODE_ROLE)) {
    it(`${mode} sees no guarded page that refuses it`, () => {
      for (const href of hrefsFor(mode as AccountMode)) {
        const guard = guardFor(href);
        if (guard.open) continue;
        const admitted = (guard.managers && who.manager) || (who.role !== null && guard.roles.includes(who.role));
        expect({ mode, href, admitted }).toEqual({ mode, href, admitted: true });
      }
    });
  }

  it("offers Sold Calls only to a viewer holding the sold_calls grant (admins and Aisha), in her manager mode too", () => {
    const soldCalls = (grants?: ReadonlySet<AgentCloudNavGrant>) =>
      flattenAgentCloudNav(filterAgentCloudNav([...AGENT_CLOUD_PRIMARY_NAV, ...AGENT_CLOUD_ACCOUNT_NAV], { seesAll: false, viewMode: "manager", grants }))
        .some((link) => link.href === "/dashboard/sold-calls");
    expect(soldCalls()).toBe(false);
    expect(soldCalls(new Set())).toBe(false);
    expect(soldCalls(new Set<AgentCloudNavGrant>(["sold_calls"]))).toBe(true);
    const admin = flattenAgentCloudNav(filterAgentCloudNav([...AGENT_CLOUD_PRIMARY_NAV, ...AGENT_CLOUD_ACCOUNT_NAV], { seesAll: true, viewMode: "manager" }));
    expect(admin.some((link) => link.href === "/dashboard/sold-calls")).toBe(true);
  });

  it("shows Money Inbox only to Sam with admin navigation, ahead of Launch Board", () => {
    const links = (isSam?: boolean, seesAll = true) =>
      flattenAgentCloudNav(filterAgentCloudNav(AGENT_CLOUD_PRIMARY_NAV, { seesAll, viewMode: "admin", isSam }))
        .map((link) => link.href);
    expect(links()).not.toContain("/dashboard/money-inbox");
    expect(links(false)).not.toContain("/dashboard/money-inbox");
    expect(links(true, false)).not.toContain("/dashboard/money-inbox");
    const samLinks = links(true);
    expect(samLinks).toContain("/dashboard/money-inbox");
    expect(samLinks.indexOf("/dashboard/money-inbox")).toBe(samLinks.indexOf("/dashboard/launch-board") - 1);
  });

  it("never offers a retired destination", () => {
    for (const mode of Object.keys(MODE_ROLE)) {
      const hrefs = hrefsFor(mode as AccountMode);
      for (const retired of ["/dashboard/quoter", "/dashboard/recruiting/interviews", "/dashboard/recruiting/follow-ups", "/dashboard/agencies", "/dashboard/scripts", "/dashboard/content"]) {
        expect(hrefs).not.toContain(retired);
      }
    }
  });

  it("gives a plain agent a recruiting action they can open", () => {
    expect(hrefsFor("agent")).toContain("/dashboard/referrals/new");
  });

  it("names detail routes by section, not by record id", () => {
    expect(agentCloudBreadcrumb("/dashboard/agents/3f2a9c1e-1111-4222-8333-444455556666")).toEqual(["Agents"]);
    expect(agentCloudBreadcrumb("/dashboard/contracting/requests")).toEqual(["Contracting", "Requests"]);
    expect(agentCloudBreadcrumb("/dashboard/contracting/history")).toEqual(["Contracting", "Intake history"]);
    expect(agentCloudBreadcrumb("/dashboard/help")).toEqual(["Support desk"]);
  });
});
