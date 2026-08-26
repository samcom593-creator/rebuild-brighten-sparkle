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

  it("separates direct and override earnings without trusting the legacy 120 placeholder", () => {
    const migration = source("../supabase/migrations/20260826051000_production_comp_layering_scoreboard_v3.sql");
    expect(migration).toContain("public.agent_contract_levels");
    expect(migration).toContain("greatest(v_viewer_pct - coalesce(fp.pct, v_fallback), 0)");
    expect(migration).toContain("'direct', (select direct from earnings)");
    expect(migration).toContain("'override', (select override from earnings)");
    expect(migration).toContain("'recursive_team', jsonb_build_object");
    expect(migration).toContain("'external_gap_override'");

    const component = source("components/dashboard/ScopedProductionScoreboard.tsx");
    expect(component).toContain("data.earnings.direct");
    expect(component).toContain("data.earnings.override");
    expect(component).toContain("data.earnings.team_estimated");
    expect(component).toContain("data.recursive_team.ap");
    expect(component).toContain("data.imo.ap");
  });

  it("places the same scoreboard before agent and manager command views", () => {
    const dashboard = source("pages/Dashboard.tsx");
    expect(dashboard.match(/<ScopedProductionScoreboard \/>/g)).toHaveLength(2);
    expect(source("components/dashboard/AgentCloudHome.tsx")).toContain("<ScopedProductionScoreboard />");
  });
});
