import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20260827041000_crm_roster_external_gap_scope.sql"),
  "utf8",
);

describe("CRM roster external production reconciliation", () => {
  it("adds external daily gaps only to admin production totals", () => {
    expect(migration).toContain("where public.apex_is_admin()");
    expect(migration).toContain("u.origin = 'external_daily_gap'");
    expect(migration.match(/\+ external_mtd\.alp/g)).toHaveLength(2);
  });

  it("does not invent an extra producing agent or off-roster producer", () => {
    expect(migration).toContain("count(*) filter (where mtd_alp > 0)::int");
    expect(migration).toContain("coalesce(sum(mtd_alp) filter (where status <> 'active'), 0)");
  });
});
