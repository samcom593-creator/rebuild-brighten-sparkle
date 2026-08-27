import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20260827040000_leaderboard_hierarchy_scope.sql"),
  "utf8",
);

describe("leaderboard hierarchy scope", () => {
  it("keeps external agency reconciliation admin-only", () => {
    expect(migration).toContain("u.origin = 'external_daily_gap' and public.apex_is_admin()");
  });

  it("scopes both hero and individual rows through the canonical CRM hierarchy guard", () => {
    expect(migration.match(/public\.crm_can_read_agent_scope\(/g)).toHaveLength(2);
    expect(migration).toContain("or (t.agent_id is not null and public.crm_can_read_agent_scope(t.agent_id))");
    expect(migration).toContain("coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name)))");
  });

  it("keeps both RPCs closed to anonymous users", () => {
    expect(migration).toContain("revoke all on function public.leaderboard_book_hero() from public, anon");
    expect(migration).toContain("revoke all on function public.leaderboard_board(date, date) from public, anon");
  });
});
