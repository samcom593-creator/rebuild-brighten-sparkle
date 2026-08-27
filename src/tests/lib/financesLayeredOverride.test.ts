import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// MP-328 parity ratchet. finances_overview('agency') and the dashboard's
// scoped_production_scoreboard must compute a caller's estimated income from the
// SAME layered basis. The bug this guards against: crediting the viewer the
// spread to the SELLER (bottom of the chain) instead of to their DIRECT report
// (first hop), which over-credited Sam $24,613.83 on one month. CI has no DB, so
// this pins the doctrine in the migration text; a live cross-surface parity check
// runs in apex-doctor.
const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20260827160000_finances_layered_override_parity.sql"),
  "utf8",
);

describe("finances layered first-hop override parity", () => {
  it("credits the viewer the spread to their DIRECT report, never to the seller", () => {
    // The scoreboard's canonical first-hop resolver, now shared by finances.
    expect(migration).toContain("public.fn_hierarchy_first_hops(v_personal_ids)");
    expect(migration).toContain("greatest(v_caller_comp - coalesce(fhp.pct, v_fallback), 0)");
    // Unreachable downline earns the caller nothing (matches the scoreboard).
    expect(migration).toContain("when h.first_hop is null then 0::numeric");
    // The seller-comp override model is gone. If this line comes back, the
    // $24.6k over-credit comes back with it.
    expect(migration).not.toContain("v_caller_comp - t.seller_comp_pct");
  });

  it("reads caller comp from the canonical resolver, not the contract_percentage placeholder", () => {
    expect(migration).toContain("cross join lateral public.fn_agent_contract_pct(u.id) p");
    // The old ad-hoc "contract_percentage <> 120 unless admin" resolution is gone.
    expect(migration).not.toContain("a.contract_percentage <> 120");
  });

  it("credits the Vantage gap at the head and never leaks it into a personal total", () => {
    expect(migration).toContain("v_caller_comp - coalesce(v_head_pct, v_fallback)");
    // The gap is agency-only. 'mine' must stay strictly own production.
    expect(migration).toContain("v_scope = 'agency'");
    expect(migration).toContain("public.fn_agent_subagency(t.raw_agent_id) = 'vantage'");
  });

  it("keeps the scoped commission engine private behind the wrapper", () => {
    expect(migration).toContain(
      "revoke all on function public.finances_overview_base(text, date) from public, anon, authenticated",
    );
  });
});
