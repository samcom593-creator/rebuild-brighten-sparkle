import { describe, expect, it } from "vitest";
import type { ScoreboardData } from "@/components/dashboard/ScopedProductionScoreboard";
import { agencyDemoFields, applyAgencyDemo, applyProjectionDemo, applyScoreboardDemo, distributeDemoTotal, projectionDemoFields, scoreboardDemoFields } from "@/lib/productionDemoModels";

function scoreboard(): ScoreboardData {
  return {
    as_of: "2026-11-24T17:00:00Z", window: { start: "2026-11-24", end_exclusive: "2026-11-25" }, has_producer_profile: true,
    scope_label: "Authorized production", downline_agents: 2, all_members_count: 3,
    personal: { ap: 40, policies: 1 }, direct_team: { ap: 60, policies: 2, agents: 2 },
    recursive_team: { ap: 100, policies: 3, agents: 2 }, team: { ap: 100, policies: 3 }, imo: { ap: 100, policies: 3, agents: 3 },
    comp: { viewer_pct: 80, provenance: "account", unknown_levels_in_scope: 0, fallback_pct: 0, basis: "Source" },
    earnings: { direct: 20, override: 10, estimated: 30, team_estimated: 35, basis: "Estimate", external_gap_override: null },
    by_agent: [40, 30, 30].map((ap, index) => ({
      agent_id: `person-${index}`, name: `Example ${index}`, agency: "Example", ap, policies: 1,
      seller_pct: 70, seller_pct_provenance: "account", override_pct_for_viewer: 10, est_override: ap / 10,
      is_self: index === 0, first_hop_id: index === 0 ? null : `person-${index}`, first_hop_name: index === 0 ? null : `Example ${index}`,
      first_hop_pct: null, first_hop_pct_provenance: null, last_sale_date: "2026-11-24",
    })),
    reconciliation: { sources: [{ origin: "apex_native", ap: 100, policies: 3 }], agencies: [{ agency: "Example", ap: 100, policies: 3 }],
      external_unattributed: { ap: 0, policies: 0 }, duplicate_candidate_groups: 0, hierarchy_ambiguities: 0 },
    last_synced_at: null, source: "Existing canonical source",
  };
}

describe("local production demonstration models", () => {
  it("retains the original object when no field changed", () => {
    const source = scoreboard();
    const values = Object.fromEntries(scoreboardDemoFields(source).map(field => [field.key, field.value]));
    expect(applyScoreboardDemo(source, values)).toBe(source);
  });

  it("scales existing production, charts, and estimates without changing the source", () => {
    const source = scoreboard();
    const snapshot = JSON.stringify(source);
    const next = applyScoreboardDemo(source, { "production.ap": 1000 })!;
    expect(next.imo?.ap).toBe(1000);
    expect(next.by_agent.reduce((sum, row) => sum + row.ap, 0)).toBe(1000);
    expect(next.personal.ap).toBe(400);
    expect(next.recursive_team.ap).toBe(1000);
    expect(next.team.ap).toBe(next.recursive_team.ap);
    expect(next.earnings).toMatchObject({ direct: 200, override: 100, estimated: 300 });
    expect(next.reconciliation.sources[0].ap).toBe(1000);
    expect(next.by_agent.map(row => row.agent_id)).toEqual(source.by_agent.map(row => row.agent_id));
    expect(next.window).toEqual(source.window);
    expect(next.comp).toEqual(source.comp);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("keeps policy allocations integer and tied to the primary total", () => {
    const next = applyScoreboardDemo(scoreboard(), { "production.policies": 7 })!;
    expect(next.imo?.policies).toBe(7);
    expect(next.by_agent.map(row => row.policies)).toEqual([3, 2, 2]);
    expect(next.personal.policies).toBe(3);
    expect(next.direct_team.policies).toBe(4);
    expect(next.recursive_team.policies).toBe(7);
    expect(next.team.policies).toBe(7);
  });

  it("uses the edited earnings parts for the displayed total and split", () => {
    const next = applyScoreboardDemo(scoreboard(), { "earnings.direct": 700, "earnings.override": 300, "earnings.team": 1200 })!;
    expect(next.earnings).toMatchObject({ direct: 700, override: 300, estimated: 1000, team_estimated: 1200 });
    expect(next.imo?.ap).toBe(100);
  });

  it("rejects invalid, fractional-count, and unregistered edits", () => {
    const source = scoreboard();
    expect(applyScoreboardDemo(source, { "production.ap": Infinity, "production.policies": 2.5, "earnings.direct": -1, downline_agents: 999 })).toBe(source);
    expect(applyScoreboardDemo(source, { "production.ap": 1e15 })).toBe(source);
  });

  it("does not manufacture an admin scope, agents, or a missing profile", () => {
    const source = scoreboard();
    source.imo = null;
    const next = applyScoreboardDemo(source, { "production.ap": 600 })!;
    expect(next.imo).toBeNull();
    expect(next.personal.ap).toBe(600);
    expect(next.recursive_team.ap).toBe(1500);
    expect(next.by_agent).toHaveLength(source.by_agent.length);
    source.has_producer_profile = false;
    expect(scoreboardDemoFields(source)).toEqual([]);
    expect(applyScoreboardDemo(source, { "production.ap": 600 })).toBe(source);
  });

  it("reconciles complete source/agency groups in exact cents and integer counts with all field values present", () => {
    const source = scoreboard();
    source.personal = { ap: 1, policies: 1 };
    source.direct_team = { ...source.direct_team, ap: 2, policies: 2 };
    source.recursive_team = { ...source.recursive_team, ap: 3, policies: 3 };
    source.team = { ap: 3, policies: 3 };
    source.imo = { ...source.imo!, ap: 3, policies: 3 };
    source.by_agent = source.by_agent.map(row => ({ ...row, ap: 1, policies: 1 }));
    source.reconciliation.sources = [0, 1, 2].map(i => ({ origin: `source-${i}`, ap: 1, policies: 1 }));
    source.reconciliation.agencies = [0, 1, 2].map(i => ({ agency: `agency-${i}`, ap: 1, policies: 1 }));
    const values = Object.fromEntries(scoreboardDemoFields(source).map(field => [field.key, field.value]));
    const next = applyScoreboardDemo(source, { ...values, "production.ap": 10, "production.policies": 7 })!;
    for (const rows of [next.by_agent, next.reconciliation.sources, next.reconciliation.agencies]) {
      expect(rows.reduce((sum, row) => sum + Math.round(row.ap * 100), 0)).toBe(1000);
      expect(rows.reduce((sum, row) => sum + row.policies, 0)).toBe(7);
    }
    expect(next.personal.policies + next.direct_team.policies).toBe(next.recursive_team.policies);
    expect(next.recursive_team.policies).toBe(next.imo?.policies);
    expect(next.earnings.direct).toBeCloseTo(20 * 10 / 3, 2);
  });

  it("retains the authorized external agency estimate in the earnings total", () => {
    const source = scoreboard();
    source.earnings.external_gap_override = { agency: "External", agency_head_name: "Existing head", agency_head_pct: 70,
      agency_head_pct_provenance: "account", override_pct: 10, policies: 1, ap: 50, est: 5, basis: "Existing estimate" };
    source.earnings.estimated = 35;
    const values = Object.fromEntries(scoreboardDemoFields(source).map(field => [field.key, field.value]));
    const next = applyScoreboardDemo(source, { ...values, "production.ap": 1000 })!;
    expect(next.earnings).toMatchObject({ direct: 200, override: 100, estimated: 350, external_gap_override: { est: 50 } });
    const explicit = applyScoreboardDemo(source, { ...values, "earnings.override": 40 })!;
    expect(explicit.earnings).toMatchObject({ direct: 20, override: 40, estimated: 65, external_gap_override: { est: 5 } });
  });

  it("adds a zero-baseline personal demo to the containing team without fabricating a producer", () => {
    const source = scoreboard();
    source.imo = null;
    source.personal = { ap: 0, policies: 0 };
    source.by_agent = source.by_agent.filter(row => !row.is_self);
    source.recursive_team = { ...source.recursive_team, ap: 60, policies: 2 };
    source.team = { ap: 60, policies: 2 };
    const ids = source.by_agent.map(row => row.agent_id);
    const next = applyScoreboardDemo(source, { "production.ap": 10000, "production.policies": 4 })!;
    expect(next.personal).toEqual({ ap: 10000, policies: 4 });
    expect(next.recursive_team).toMatchObject({ ap: 10060, policies: 6 });
    expect(next.team).toEqual({ ap: 10060, policies: 6 });
    expect(next.by_agent.map(row => row.agent_id)).toEqual(ids);
    expect(next.by_agent.map(row => row.ap)).toEqual([30, 30]);
  });

  it("keeps zero-baseline admin IMO and recursive scope equal without inventing rows", () => {
    const source = scoreboard();
    source.imo = { ...source.imo!, ap: 0, policies: 0 };
    source.recursive_team = { ...source.recursive_team, ap: 0, policies: 0 };
    source.team = { ap: 0, policies: 0 };
    source.by_agent = [];
    const next = applyScoreboardDemo(source, { "production.ap": 10000, "production.policies": 5 })!;
    expect(next.imo).toMatchObject({ ap: 10000, policies: 5 });
    expect(next.recursive_team).toMatchObject({ ap: 10000, policies: 5 });
    expect(next.by_agent).toEqual([]);
  });

  it("does not coerce a null income component or total into known money", () => {
    const source = scoreboard();
    source.earnings.direct = null;
    source.earnings.estimated = null;
    const next = applyScoreboardDemo(source, { "production.ap": 1000 })!;
    expect(next.earnings.direct).toBeNull();
    expect(next.earnings.estimated).toBeNull();
    source.earnings.estimated = 30;
    expect(applyScoreboardDemo(source, { "production.ap": 1000 })!.earnings.estimated).toBe(30);
  });

  it("allocates exact cents without changing a malformed series into plausible data", () => {
    expect(distributeDemoTotal(10, [1, 1, 1])).toEqual([3.34, 3.33, 3.33]);
    expect(distributeDemoTotal(7, [0, 0, 0], 0)).toEqual([3, 2, 2]);
    expect(distributeDemoTotal(10, [])).toEqual([]);
    expect(distributeDemoTotal(NaN, [1, 2])).toEqual([1, 2]);
  });
});

describe("current-month demonstration pace", () => {
  const projection = () => ({
    has_producer_profile: true, elapsed_calendar_days: 15, days_in_month: 30,
    personal: { mtd_ap: 100, projected_ap: 200, policies: 1, active_days: 5 },
    team: { mtd_ap: 500, projected_ap: 1000, policies: 5, active_days: 5 },
    imo: { mtd_ap: 500, projected_ap: 1000, policies: 5, active_days: 5 },
    agencies: [{ agency: "Example", mtd_ap: 500, projected_ap: 1000, policies: 5, active_days: 5 }],
  });

  it("scales the same existing pace and agency breakdown", () => {
    const source = projection();
    const next = applyProjectionDemo(source, { "month.ap": 10000 })!;
    expect(next.imo).toMatchObject({ mtd_ap: 10000, projected_ap: 20000 });
    expect(next.agencies[0]).toMatchObject({ mtd_ap: 10000, projected_ap: 20000 });
    expect(next.elapsed_calendar_days).toBe(15);
    expect(source.imo.mtd_ap).toBe(500);
    expect(projectionDemoFields(source).map(field => field.key)).toEqual(["month.ap", "month.policies"]);
  });

  it("allocates a complete projection agency series to the same AP, count and forecast totals", () => {
    const source = projection();
    source.imo = { mtd_ap: 3, projected_ap: 6, policies: 3, active_days: 5 };
    source.team = { ...source.imo };
    source.agencies = [0, 1, 2].map(i => ({ agency: `Agency ${i}`, mtd_ap: 1, projected_ap: 2, policies: 1, active_days: 5 }));
    const values = Object.fromEntries(projectionDemoFields(source).map(field => [field.key, field.value]));
    const next = applyProjectionDemo(source, { ...values, "month.ap": 10, "month.policies": 7 })!;
    expect(next.imo).toMatchObject({ mtd_ap: 10, projected_ap: 20, policies: 7 });
    expect(next.agencies.reduce((sum, row) => sum + Math.round(row.mtd_ap * 100), 0)).toBe(1000);
    expect(next.agencies.reduce((sum, row) => sum + Math.round(row.projected_ap * 100), 0)).toBe(2000);
    expect(next.agencies.reduce((sum, row) => sum + row.policies, 0)).toBe(7);
    expect(next.team).toEqual(next.imo);
  });

  it("keeps zero personal demo production inside the team and honors existing low-history confidence", () => {
    const source = { ...projection(), imo: null };
    source.personal = { mtd_ap: 0, projected_ap: 0, policies: 0, active_days: 0 };
    const next = applyProjectionDemo(source, { "month.ap": 1000, "month.policies": 2 })!;
    expect(next.personal).toMatchObject({ mtd_ap: 1000, projected_ap: 1000, policies: 2, active_days: 0 });
    expect(next.team).toMatchObject({ mtd_ap: 1500, projected_ap: 3000, policies: 7 });
    expect(next.agencies[0]).toMatchObject({ mtd_ap: 1500, projected_ap: 3000, policies: 7 });
    expect(next.days_in_month).toBe(source.days_in_month);
    expect(next.elapsed_calendar_days).toBe(source.elapsed_calendar_days);
  });

  it("handles a real zero source without adding history or selling days", () => {
    const source = projection();
    source.imo = { mtd_ap: 0, projected_ap: 0, policies: 0, active_days: 0 };
    const next = applyProjectionDemo(source, { "month.ap": 20000 })!;
    expect(next.imo).toMatchObject({ mtd_ap: 20000, projected_ap: 20000, active_days: 0 });
    expect(next.agencies).toEqual(source.agencies);
    expect(applyProjectionDemo(source, { "month.policies": -10 })).toBe(source);
  });
});

describe("agency breakdown demonstration", () => {
  it("changes the selected row and its existing override estimate without touching source or period facts", () => {
    const rows = [{ agency: "Example agency", alp: 1000, policies: 2, est_owner_override_alp: 100, alp_mtd: 3000, policies_mtd: 6 }];
    const fields = agencyDemoFields(rows, true);
    expect(fields).toHaveLength(2);
    const next = applyAgencyDemo(rows, { [fields[0].key]: 20000, [fields[1].key]: 20 });
    expect(next[0]).toMatchObject({ alp: 20000, policies: 20, est_owner_override_alp: 2000, alp_mtd: 3000 });
    expect(rows[0].alp).toBe(1000);
  });

  it("does not edit ambiguous duplicate names or create missing amounts", () => {
    const row = { agency: "Same", alp: 0, policies: 0 };
    expect(agencyDemoFields([row, { ...row }], true)).toEqual([]);
    expect(applyAgencyDemo([row], { "agency:Same:alp_mtd": 1000 })[0]).toEqual(row);
  });
});
