/**
 * appRoutingContract.test.ts: the three routing promises of the 2026-10-15
 * routing wave, graded against the real src/App.tsx so they cannot drift.
 *
 *  1. /r/:code (the public recruiting short link) is mounted outside the
 *     authenticated shell. Inside it, every logged-out tap bounced to /login
 *     (measured: 11 of 23 anonymous taps on record went to the sign-in page).
 *  2. Every retired URL is a one-hop alias onto a declared page, and keeps the
 *     visitor's query and hash (no bare <Navigate> on a <Route path> line).
 *  3. /today aliases the Today page, not the old command center.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const ROUTE_LINE = /<Route\s+path="([^"]+)"\s+element=\{(.*)\}\s*\/>/;

interface RouteTable {
  pages: Set<string>;
  redirects: Map<string, { to: string; line: number }>;
  navigateOnRouteLines: number[];
}

function routeTable(src: string): RouteTable {
  const pages = new Set<string>();
  const redirects = new Map<string, { to: string; line: number }>();
  const navigateOnRouteLines: number[] = [];
  src.split("\n").forEach((line, index) => {
    const match = line.match(ROUTE_LINE);
    if (!match) return;
    const [, routePath, element] = match;
    if (element.includes("<Navigate ")) navigateOnRouteLines.push(index + 1);
    const legacy = element.match(/<LegacyWorkspaceRedirect to="([^"]+)"/);
    if (legacy) redirects.set(routePath, { to: legacy[1], line: index + 1 });
    else pages.add(routePath);
  });
  return { pages, redirects, navigateOnRouteLines };
}

function isDeclared(target: string, pages: Set<string>): boolean {
  const segments = target.split("/").filter(Boolean);
  for (const pattern of pages) {
    if (pattern === "*") continue;
    const patternSegments = pattern.split("/").filter(Boolean);
    if (patternSegments.length !== segments.length) continue;
    if (patternSegments.every((seg, i) => seg.startsWith(":") || seg === segments[i])) return true;
  }
  return false;
}

const pathOnly = (to: string) => to.split("#")[0].split("?")[0];

describe("App.tsx routing contract", () => {
  const app = read("src/App.tsx");
  const lines = app.split("\n");
  const table = routeTable(app);

  it("parses a real route table (a parser that sees nothing proves nothing)", () => {
    expect(table.pages.size).toBeGreaterThan(100);
    expect(table.redirects.size).toBeGreaterThan(10);
  });

  it("mounts the public recruiting short link outside the authenticated shell", () => {
    const shortLink = lines.findIndex((l) => l.includes('path="/r/:code"'));
    const shell = lines.findIndex((l) => l.includes("<Route element={<AuthenticatedShell />}>"));
    expect(shortLink).toBeGreaterThan(-1);
    expect(shell).toBeGreaterThan(-1);
    expect(shortLink).toBeLessThan(shell);
  });

  it("every alias is one hop: no redirect targets another redirect", () => {
    const chains = [...table.redirects]
      .filter(([, r]) => table.redirects.has(pathOnly(r.to)))
      .map(([from, r]) => `${from} -> ${r.to} (line ${r.line})`);
    expect(chains).toEqual([]);
  });

  it("every alias lands on a declared page", () => {
    const dead = [...table.redirects]
      .filter(([, r]) => !isDeclared(pathOnly(r.to), table.pages))
      .map(([from, r]) => `${from} -> ${r.to} (line ${r.line})`);
    expect(dead).toEqual([]);
  });

  it("no alias uses a bare <Navigate>, which drops the query string and hash", () => {
    expect(table.navigateOnRouteLines).toEqual([]);
  });

  it("LegacyWorkspaceRedirect builds its target through legacyRedirectTarget", () => {
    expect(app).toContain('import { legacyRedirectTarget } from "@/lib/legacyRedirect";');
    expect(app).toContain("<Navigate to={legacyRedirectTarget(to, location, params)} replace");
  });

  it("/today aliases the Today page, not the old command center", () => {
    expect(table.redirects.get("/today")?.to).toBe("/dashboard/today");
    expect(table.pages.has("/dashboard/today")).toBe(true);
  });

  it("keeps legal aliases public and all duplicate workspace URLs canonical", () => {
    const shell = lines.findIndex((line) => line.includes("<Route element={<AuthenticatedShell />}>"));
    for (const path of ["/privacy-policy", "/terms-of-service"]) {
      const index = lines.findIndex((line) => line.includes(`path="${path}"`));
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(shell);
    }
    expect(table.redirects.get("/dashboard/my-commissions")?.to).toBe("/dashboard/finances?tab=commissions");
    expect(table.redirects.get("/dashboard/my-deals")?.to).toBe("/dashboard/production");
    expect(table.redirects.get("/dashboard/clients")?.to).toBe("/dashboard/agent-pipeline");
    expect(table.redirects.get("/dashboard/recruiting/training/library/course/:courseId")?.to).toBe("/dashboard/training/library/course/:courseId");
  });

  it("consolidates duplicate workspaces without redirect chains or lost award views", () => {
    const expected = {
      "/dashboard/annuity-training": "/dashboard/training/annuities",
      "/hall-of-fame": "/dashboard/hall-of-fame",
      "/team-chat": "/dashboard/team-chat",
      "/leaderboard": "/dashboard/leaderboard",
      "/dashboard/rewards": "/dashboard/my-plaques?source=reward",
      "/rewards": "/dashboard/my-plaques?source=reward",
      "/bulk-deals": "/dashboard/bulk-deals",
      "/agentlink-sync": "/dashboard/agentlink-sync",
      "/dashboard/lead-bundles": "/dashboard/lead-manager",
      "/admin/producer-trends": "/dashboard/producer-trends",
      "/dashboard/seminar-control": "/dashboard/seminar",
      "/dashboard/contracting/downlines": "/dashboard/grow",
      "/dashboard/contracting/requests": "/dashboard/contracting",
      "/recruit-pipeline": "/dashboard/recruit-pipeline",
      "/dashboard/agents/:id": "/dashboard/agent/:id",
    };
    for (const [from, to] of Object.entries(expected)) {
      expect(table.redirects.get(from)?.to, from).toBe(to);
      expect(table.pages.has(pathOnly(to)), from).toBe(true);
    }
    expect(lines.find(line => line.includes('path="/bulk-deals"'))).toContain("<ProtectedRoute requireAdmin allowManagers>");
    expect(lines.find(line => line.includes('path="/admin/producer-trends"'))).toContain("<ProtectedRoute requireAdmin>");
    expect(lines.find(line => line.includes('path="/dashboard/contracting/requests"'))).toContain("<ProtectedRoute requireAdmin>");
    expect(lines.find(line => line.includes('path="/dashboard/seminar-control"'))).toContain("<ProtectedRoute requireAdmin allowManagers allowPresenters>");
  });
});

describe("Dashboard.tsx home contract", () => {
  it("renders AgentCloudHome for a real admin with no role preview, and its comments say so", () => {
    const dashboard = read("src/pages/Dashboard.tsx");
    const branch = dashboard.slice(dashboard.indexOf("if (shouldRenderDefaultAdminCommand)"));
    expect(branch.slice(0, 400)).toContain("<AgentCloudHome />");
    expect(dashboard).toContain("no preview + real admin: AgentCloudHome");
    expect(dashboard).not.toMatch(/lazy\(\(\) => import\("@\/pages\/DashboardToday"\)\)/);
  });
});
