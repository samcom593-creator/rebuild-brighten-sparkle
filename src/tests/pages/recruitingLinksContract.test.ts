import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * MP-342 — "send out links under managers" contract.
 *
 * The whole feature hangs on four seams staying wired together: the admin
 * RPC stays admin-gated in its migration, the page reaches it, the router
 * serves the page admin-only, and the sidebar entry is adminOnly. Any one
 * of them drifting turns the surface into either a 404 or an open roster
 * read — both silent.
 */
const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("recruiting links (MP-342)", () => {
  it("RPC migration keeps the in-body admin gate", () => {
    const mig = read("supabase/migrations/20260830100000_admin_recruiting_links_rpc.sql");
    expect(mig).toMatch(/create or replace function public\.admin_recruiting_links/);
    expect(mig).toMatch(/apex_is_admin\(\)/);
    expect(mig).toMatch(/revoke all on function public\.admin_recruiting_links\(\) from public, anon/);
  });

  it("page calls the RPC and builds links only from ref_slug", () => {
    const page = read("src/pages/RecruitingLinks.tsx");
    expect(page).toMatch(/rpc\("admin_recruiting_links"/);
    expect(page).toMatch(/\/r\/\$\{slug\}|\/r\/\$\{row\.ref_slug|`\$\{SITE\}\/r\/\$\{slug\}`/);
    expect(page).not.toMatch(/from\("agents"\)/); // never a direct table read on a public-ish surface
  });

  it("route is admin-gated and sidebar entry is adminOnly", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/path="\/dashboard\/recruiting-links" element=\{<ProtectedRoute requireAdmin>/);
    const nav = read("src/components/layout/agentCloudNavigation.ts");
    expect(nav).toMatch(/href: "\/dashboard\/recruiting-links", icon: Link2, adminOnly: true/);
  });
});
