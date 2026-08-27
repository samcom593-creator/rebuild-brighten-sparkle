import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// MP-329 lockdown ratchet. MP-326 opened agent WRITES, MP-328 revoked 17
// comp/NIPR columns; three manager-internal columns and one NPN-leaking view
// remained readable by every authenticated agent. This pins the residual close
// so a future blanket `grant select on agents` or a re-grant of the view can't
// silently reopen the leak without a reviewer seeing this test change.
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20260827190000_agents_residual_read_leak_lockdown.sql"),
  "utf8",
);

describe("agents residual read-leak lockdown", () => {
  it("revokes the three manager-internal columns from authenticated + anon", () => {
    expect(migration).toContain(
      "revoke select (evaluation_result, potential_rating, next_action_text)",
    );
    expect(migration).toContain("on public.agents from authenticated, anon");
  });

  it("closes the NPN-leaking monitoring view to authenticated + anon", () => {
    expect(migration).toContain(
      "revoke select on public.v_agent_license_alert_health from authenticated, anon",
    );
  });

  it("does NOT revoke columns that have live agent-facing base reads", () => {
    // notes (AgentProfileDrawer transfer badge) and crm_setup_link (ContractedModal)
    // are read from the base table by agent-facing surfaces — revoking them 403s.
    expect(migration).not.toMatch(/revoke select \([^)]*\bnotes\b/);
    expect(migration).not.toMatch(/revoke select \([^)]*crm_setup_link/);
  });
});
