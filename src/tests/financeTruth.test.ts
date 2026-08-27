import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../${file}`), "utf8");

describe("unified finance truth", () => {
  it("drives every primary earnings surface from the unified production ledger", () => {
    const migration = source("../supabase/migrations/20260825213000_finance_truth_unification.sql");
    expect(migration).toContain("create or replace view public.v_production_comp_truth");
    expect(migration).toContain("from public.v_production_unified u");
    expect(migration).toContain("from public.v_production_comp_truth t");
    expect(migration).toContain("create or replace function public.finances_overview");
    expect(migration).toContain("create or replace function public.scoped_production_scoreboard");
    expect(migration).toContain("create or replace function public.leaderboard_board");
    expect(migration).toContain("create or replace view public.v_earnings_estimate");
  });

  it("keeps direct, owner override, and team gross as distinct scopes", () => {
    const migration = source("../supabase/migrations/20260825213000_finance_truth_unification.sql");
    expect(migration).toContain("when v_scope = 'imo' then t.direct_estimate");
    // NOTE: this migration's original override basis was seller-comp. It was
    // superseded 2026-08-27 by 20260827160000 (first-hop layered override) to
    // match the dashboard scoreboard to the penny — see financesLayeredOverride
    // and the not.toContain guard there. The 'imo'/team_kpis scopes are unchanged.
    expect(migration).toContain("'team_kpis', v_team_kpis");

    const finances = source("pages/Finances.tsx");
    expect(finances).toContain("p_scope: scope");
    expect(finances).toContain("My + overrides");
    expect(finances).toContain("Team gross");
  });

  it("removes zero-valued InsuraCloud snapshots from live commission widgets", () => {
    expect(source("components/finances/TeamCommissionsCard.tsx")).not.toContain("insuracloud_snapshots");
    expect(source("components/finances/LiveCommissionsLeaderboard.tsx")).not.toContain("insuracloud_snapshots");
  });
});
