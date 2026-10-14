import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const crm = readFileSync(resolve(process.cwd(), "src/pages/DashboardCRM.tsx"), "utf8");

describe("VA team access contract", () => {
  it("lets VA operators load the agency roster without requiring an agent record", () => {
    // 2026-10-14: the page reads the roster through crm_agent_roster(), which admits va/va_manager server-side, and
    // never looks up the viewer's own agents row first — so a VA with no agent record still sees the agency roster.
    expect(crm).toContain('supabase.rpc("crm_agent_roster"');
    expect(crm).not.toMatch(/from\("agents"\)\.select\("id"\)\.eq\("user_id"/);
  });

  it("provides a permission-checked team check-in receipt", () => {
    expect(crm).toContain('.update({ last_contacted_at: checkedInAt })');
    expect(crm).toContain("marked checked in");
  });
});
