import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("agent link-in-bio contract", () => {
  it("uses the short attributed application route with visible copy and open controls", () => {
    const card = read("src/components/agent/MyReferralLinkCard.tsx");
    const redirect = read("src/components/RecruitingShortLink.tsx");
    const routes = read("src/App.tsx");

    expect(card).toContain("Your link in bio");
    expect(card).toContain("/r/${encodeURIComponent(code)}");
    expect(card).toContain("Copy bio link");
    expect(card).toContain("> Open");
    expect(routes).toContain('path="/r/:code"');
    expect(redirect).toContain("/apply?ref=${encodeURIComponent(slug)}");
  });

  it("surfaces a recruiting link on agent, manager, recruiter, agency-owner, and admin homes", () => {
    expect(read("src/pages/AgentCommandDashboard.tsx")).toContain("<MyReferralLinkCard />");
    expect(read("src/pages/ManagerCommandView.tsx")).toContain("<MyReferralLinkCard />");
    expect(read("src/pages/RecruiterHome.tsx")).toContain("<RecruiterBountyCard");
    expect(read("src/pages/AgencyOwnerHome.tsx")).toContain("<RecruiterBountyCard");

    const dashboard = read("src/pages/Dashboard.tsx");
    const adminBranch = dashboard.slice(dashboard.indexOf("if (shouldRenderDefaultAdminCommand)"));
    expect(adminBranch).toContain("<ReferralLinkCard />");
  });

  it("allows any active agent link without a licensed-only gate", () => {
    const migration = read("supabase/migrations/20260826023000_free_leads_qualification.sql");
    const rpc = migration.slice(
      migration.indexOf("create or replace function public.my_recruiting_link()"),
      migration.indexOf("create or replace function public.crm_agent_free_leads_status()"),
    );

    expect(rpc).toContain("a.status = 'active'");
    expect(rpc).not.toContain("license_status");
  });
});
