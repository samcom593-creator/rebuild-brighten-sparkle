import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("APEX Recovery Command integration", () => {
  it("stays native to the authenticated APEX shell and manager-gated", () => {
    const app = read("src/App.tsx");
    const nav = read("src/components/layout/agentCloudNavigation.ts");
    expect(app).toMatch(/path="\/dashboard\/recovery" element=\{<ProtectedRoute requireAdmin allowManagers>/);
    expect(nav).toContain('href: "/dashboard/recovery"');
    expect(nav).toMatch(/Recovery Command[^\n]+modes: LEADERS/);
  });

  it("uses scoped source truth and does not embed or scrape Ethos", () => {
    const page = read("src/pages/RecoveryCommand.tsx");
    expect(page).toContain('.from("ethos_book_policies")');
    expect(page).toContain('.from("v_agentlink_book_scoped")');
    expect(page).not.toMatch(/iframe|document\.cookie|agents\.ethoslife\.com/i);
  });

  it("keeps workflow history server-audited and team-scoped", () => {
    const migration = read("supabase/migrations/20260906234500_policy_recovery_command.sql");
    expect(migration).toContain("public.apex_can_read_agent(source_owner_agent_id)");
    expect(migration).toContain("policy_recovery_audit_case_trigger");
    expect(migration).toContain("policy_recovery_score_snapshots");
    expect(migration).toContain("Assigned agent is not active and licensed in customer state");
    expect(migration).toContain("revoke all on public.policy_recovery_audit_events from anon");
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)[^;]+policy_recovery_audit_events/i);
  });
});
