import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// MP-303 guard. The goal engine's money model must stay on the scoreboard's
// first-hop override basis (MP-328): Sam's income from a manager's tree is
// team_AP * (sam_pct - mgr_pct)/100, never seller-comp, and the projection
// must never reach down to the seller at the bottom of the chain. If this
// migration is ever redefined off a seller-comp spread, the $24.6k class of
// bug (two surfaces disagreeing on income) returns. This pins the text of the
// shipped migration the same way financesLayeredOverride.test.ts pins Finances.

const MIG = resolve(__dirname, "../../../supabase/migrations/20261119030000_goal_period_and_breakdown.sql");

describe("goal engine money model (first-hop override, MP-328)", () => {
  const sql = readFileSync(MIG, "utf8");

  it("computes Sam's override as the spread over the FIRST hop, not the seller", () => {
    // sam_pct - own_pct (the first hop is the manager being scored)
    expect(sql).toMatch(/greatest\(\s*v_sam_pct\s*-\s*v_own_pct\s*,\s*0\s*\)/);
    // must NOT subtract a seller comp anywhere in the projection
    expect(sql).not.toMatch(/seller_comp/i);
    expect(sql).not.toMatch(/v_caller_comp\s*-\s*\w*seller/i);
  });

  it("reads production from the canonical truth source, not the retired book", () => {
    expect(sql).toMatch(/v_production_canonical/);
    expect(sql).not.toMatch(/from\s+public\.agentlink_book\b/i);
    expect(sql).not.toMatch(/agentlink_deals_snapshot/i);
  });

  it("pins the owner board to is_sam()/admin and the scorecard to self-or-upline", () => {
    expect(sql).toMatch(/is_sam\(\)\s+or\s+public\.has_role\(v_caller,\s*'admin'/);
    expect(sql).toMatch(/v_caller_agent\s*=\s*v_mgr_id/); // direct upline may read a report
  });

  it("bounds the period in America/Phoenix like the other production surfaces", () => {
    expect(sql).toMatch(/America\/Phoenix/);
  });
});
