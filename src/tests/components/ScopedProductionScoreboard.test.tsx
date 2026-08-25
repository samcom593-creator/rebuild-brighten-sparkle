import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scoreboardWindow } from "@/lib/scoreboardPeriod";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

describe("scoped production scoreboard", () => {
  it("anchors every requested period to the chosen calendar date", () => {
    expect(scoreboardWindow("day", "2026-08-26")).toMatchObject({ start: "2026-08-26", end: "2026-08-27" });
    expect(scoreboardWindow("week", "2026-08-26")).toMatchObject({ start: "2026-08-24", end: "2026-08-27" });
    expect(scoreboardWindow("past_week", "2026-08-26")).toMatchObject({ start: "2026-08-20", end: "2026-08-27" });
    expect(scoreboardWindow("month", "2026-08-26")).toMatchObject({ start: "2026-08-01", end: "2026-08-27" });
    expect(scoreboardWindow("year", "2026-08-26")).toMatchObject({ start: "2026-01-01", end: "2026-08-27" });
  });

  it("uses the unified ledger and recursively scopes non-admin hierarchy", () => {
    const migration = source("../supabase/migrations/20260825065000_scoped_production_scoreboard.sql");
    expect(migration).toContain("public.v_production_unified");
    expect(migration).toContain("with recursive caller_canon");
    expect(migration).toContain("child.invited_by_manager_id = parent.id");
    expect(migration).toContain("child.manager_id = parent.id");
    expect(migration).toContain("child.switched_to_manager_id = parent.id");
    expect(migration).toContain("where a.user_id = auth.uid()");
    expect(migration).toContain("revoke all on function public.scoped_production_scoreboard(date, date) from public, anon");
  });

  it("places the same scoreboard before agent and manager command views", () => {
    const dashboard = source("pages/Dashboard.tsx");
    expect(dashboard.match(/<ScopedProductionScoreboard \/>/g)).toHaveLength(2);
    expect(source("components/dashboard/AgentCloudHome.tsx")).toContain("<ScopedProductionScoreboard />");
  });
});
