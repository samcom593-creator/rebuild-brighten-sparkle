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

  it("MP-372: last month is the whole previous calendar month regardless of the through-date's day", () => {
    expect(scoreboardWindow("last_month", "2026-09-02")).toMatchObject({ start: "2026-08-01", end: "2026-09-01", label: "Aug 1, 2026 – Aug 31, 2026" });
    expect(scoreboardWindow("last_month", "2026-09-30")).toMatchObject({ start: "2026-08-01", end: "2026-09-01" });
    // January rolls back a year.
    expect(scoreboardWindow("last_month", "2027-01-15")).toMatchObject({ start: "2026-12-01", end: "2027-01-01" });
    // March follows a 28-day month.
    expect(scoreboardWindow("last_month", "2026-03-01")).toMatchObject({ start: "2026-02-01", end: "2026-03-01" });
  });

  it("MP-372: an empty window explains itself instead of reading as broken", () => {
    const component = source("components/dashboard/ScopedProductionScoreboard.tsx");
    expect(component).toContain('{ key: "last_month", label: "Last month" }');
    expect(component).toContain('supabase.rpc("production_book_freshness"');
    expect(component).toContain("Nothing posted in this window yet");
    expect(component).toContain("Show last month");
    expect(component).not.toContain("No policies posted in this window</p>");
    const migration = source("../supabase/migrations/20260902144800_production_book_freshness.sql");
    // Same truth view + same visibility predicate as the boards, or the line disagrees with the board it sits under.
    expect(migration).toContain("public.v_production_comp_truth");
    expect(migration).toContain("origin is distinct from 'external_daily_gap'");
    expect(migration).toContain("public.apex_is_admin() or public.crm_can_read_agent_scope(t.agent_id)");
    expect(source("pages/Leaderboard.tsx")).toContain('<TabsTrigger value="last_month">Last Month</TabsTrigger>');
  });

  it("MP-394: warns staff when Discord-only production cannot reach the ledger", () => {
    const component = source("components/dashboard/ScopedProductionScoreboard.tsx");
    const migration = source("../supabase/migrations/20260903170000_discord_deal_feed_health_rpc.sql");

    expect(component).toContain('supabase.rpc("discord_deal_feed_health"');
    expect(component).toContain('f.status !== "healthy"');
    expect(component).toContain("Deals posted only in that chat are not on this board.");
    expect(component).toContain("Deal-feed health could not be checked.");
    expect(component).toContain("void feed.refetch()");
    expect(migration).toContain("security definer");
    expect(migration).toContain("public.apex_is_admin() or public.apex_has_any_role(array['manager'])");
    expect(migration).toContain("revoke all on function public.discord_deal_feed_health() from public");
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

  it("places the same scoreboard before agent, manager and agency-owner command views", () => {
    const dashboard = source("pages/Dashboard.tsx");
    // MP-332: agent, manager, AND agency_owner homes all open with the one
    // hierarchy-scoped scoreboard — the single production source on /dashboard.
    expect(dashboard.match(/<ScopedProductionScoreboard \/>/g)).toHaveLength(3);
    expect(source("components/dashboard/AgentCloudHome.tsx")).toContain("<ScopedProductionScoreboard />");
  });
});
