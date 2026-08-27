import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20260827042000_finances_external_gap_rollup.sql"),
  "utf8",
);

describe("finances external production rollup", () => {
  it("adds external volume to admin production without inventing commission", () => {
    expect(migration).toContain("public.apex_is_admin() and v_scope <> 'mine'");
    expect(migration).toContain("'unattributed_alp'");
    expect(migration).toContain("'commission_pending_attribution'");
    expect(migration).not.toContain("unattributed_alp *");
  });

  it("keeps the original scoped commission engine private behind the wrapper", () => {
    expect(migration).toContain("finances_overview_base(p_scope, p_month)");
    expect(migration).toContain("revoke all on function public.finances_overview_base(text, date) from public, anon, authenticated");
  });
});
