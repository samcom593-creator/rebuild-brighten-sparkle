import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductionDemoEditor } from "@/components/demo/ProductionDemoProvider";
import { ScoreboardIssuePaidStrip, type ScoreboardData } from "@/components/dashboard/ScopedProductionScoreboard";
import { demoNumberValues, ProductionDemoStore } from "@/lib/productionDemo";
import { applyScoreboardDemo, scoreboardDemoFields, scoreboardPlacementDemo } from "@/lib/productionDemoModels";

const scopeKey = "scoreboard:imo:2026-11-01:2026-11-25";
function source(): ScoreboardData {
  return {
    as_of: "2026-11-25T00:00:00Z", window: { start: "2026-11-01", end_exclusive: "2026-11-25" },
    has_producer_profile: true, scope_label: "Agency", downline_agents: 2, all_members_count: 3,
    personal: { ap: 4000, policies: 4 }, direct_team: { ap: 6000, policies: 6, agents: 2 },
    recursive_team: { ap: 10000, policies: 10, agents: 3 }, team: { ap: 10000, policies: 10 }, imo: { ap: 10000, policies: 10, agents: 3 },
    comp: { viewer_pct: 80, provenance: "account", unknown_levels_in_scope: 0, fallback_pct: 60, basis: "Estimate" },
    earnings: { direct: 3200, override: 600, estimated: 3800, team_estimated: 8000, basis: "Estimate", external_gap_override: null },
    by_agent: [], reconciliation: { sources: [], agencies: [], external_unattributed: { ap: 0, policies: 0 }, duplicate_candidate_groups: 0, hierarchy_ambiguities: 0 },
    last_synced_at: null, source: "Production ledger",
  };
}
function setup(data = source(), owner = "sam-demo", period = scopeKey) {
  const fields = scoreboardDemoFields(data);
  const store = new ProductionDemoStore(owner, null);
  store.register("scoreboard", { scopeKey: period, label: "Agency production", fields });
  const save = (values: Record<string, unknown>) => store.save(Object.entries(values).map(([key, value]) => ({ scopeKey: period, key, value })));
  const read = () => {
    const demo = demoNumberValues(period, fields, store.getSnapshot().overrides);
    const rendered = applyScoreboardDemo(data, demo.values);
    return { ...demo, metrics: scoreboardPlacementDemo(rendered, demo.values, demo.isDemo) };
  };
  return { data, fields, store, save, read };
}

describe("issued-and-paid production demonstrations", () => {
  it("starts optional inputs unknown and never creates live paid or placement figures", () => {
    const model = setup();
    expect(model.fields.find(field => field.key === "issuedPaid.ap")?.value).toBeNull();
    expect(model.fields.find(field => field.key === "issuedPaid.policies")?.value).toBeNull();
    expect(model.read().values).not.toHaveProperty("issuedPaid.ap");
    expect(model.read().metrics).toMatchObject({ isDemo: false, issuedPaidAP: null, issuedPaidPolicies: null, submittedPolicies: null, placementPct: null });
    render(<ScoreboardIssuePaidStrip metrics={model.read().metrics} />);
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.queryByText("Demo figures")).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it("derives placement from the same edited policy denominator without changing source data", () => {
    const model = setup();
    const before = structuredClone(model.data);
    expect(model.save({ "production.ap": 20000, "production.policies": 26, "issuedPaid.ap": 15000, "issuedPaid.policies": 20 })).toEqual({ ok: true });
    expect(model.read().metrics).toEqual({ scope: "Agency", isDemo: true, issuedPaidAP: 15000, issuedPaidPolicies: 20, submittedPolicies: 26, placementPct: 76.9 });
    expect(model.data).toEqual(before);
    render(<ScoreboardIssuePaidStrip metrics={model.read().metrics} />);
    expect(screen.getByText("$15,000")).toBeInTheDocument();
    expect(screen.getByText("76.9%")).toBeInTheDocument();
    expect(screen.getByText("Demo figures")).toBeInTheDocument();
    expect(screen.getByText(/20 issued-and-paid policies ÷ 26 displayed cohort policies/)).toBeInTheDocument();
  });

  it("rejects impossible paid counts and amounts atomically, including lowering an already edited denominator", () => {
    const model = setup();
    const initial = model.store.getSnapshot();
    expect(model.save({ "issuedPaid.ap": 8000, "issuedPaid.policies": 11 }).ok).toBe(false);
    expect(model.store.getSnapshot()).toBe(initial);
    expect(model.save({ "issuedPaid.ap": 10001 }).ok).toBe(false);
    expect(model.save({ "issuedPaid.policies": 2.5 }).ok).toBe(false);
    expect(model.save({ "issuedPaid.ap": 8000, "issuedPaid.policies": 8 }).ok).toBe(true);
    const edited = model.store.getSnapshot();
    expect(model.save({ "production.policies": 7 }).ok).toBe(false);
    expect(model.save({ "production.ap": 7000 }).ok).toBe(false);
    expect(model.store.getSnapshot()).toBe(edited);
    expect(model.save({ "production.policies": 7, "issuedPaid.policies": 7 }).ok).toBe(true);
    expect(model.read().metrics.placementPct).toBe(100);
  });

  it("clears optional values back to unknown while keeping ordinary source fields mandatory", () => {
    const model = setup();
    model.save({ "issuedPaid.ap": 8000, "issuedPaid.policies": 8 });
    expect(model.save({ "issuedPaid.ap": "", "issuedPaid.policies": " " })).toEqual({ ok: true });
    expect(model.read().metrics).toMatchObject({ isDemo: false, issuedPaidAP: null, issuedPaidPolicies: null, placementPct: null });
    expect(model.store.getSnapshot().hasOverrides).toBe(false);
    expect(model.save({ "production.policies": "" }).ok).toBe(false);
  });

  it("retains explicit demo zero and leaves a zero-denominator placement undefined", () => {
    const model = setup();
    expect(model.save({ "production.ap": 0, "production.policies": 0, "issuedPaid.ap": 0, "issuedPaid.policies": 0 }).ok).toBe(true);
    expect(model.read().metrics).toMatchObject({ isDemo: true, issuedPaidAP: 0, issuedPaidPolicies: 0, submittedPolicies: 0, placementPct: null });
  });

  it("keeps personal and agency scopes distinct and does not reuse another date's optional figures", () => {
    const data = source(); data.imo = null;
    const personal = setup(data, "jontay-demo", "scoreboard:personal:2026-11-01:2026-11-25");
    expect(personal.save({ "issuedPaid.policies": 5 }).ok).toBe(false);
    expect(personal.save({ "issuedPaid.policies": 3 }).ok).toBe(true);
    expect(personal.read().metrics).toMatchObject({ scope: "Personal", submittedPolicies: 4, issuedPaidPolicies: 3, placementPct: 75 });
    expect(demoNumberValues("scoreboard:personal:2026-12-01:2026-12-25", personal.fields, personal.store.getSnapshot().overrides).isDemo).toBe(false);
    expect(setup(data, "another-user").read().metrics.isDemo).toBe(false);
    expect(data.imo).toBeNull();
  });

  it("suppresses incompatible restored values instead of displaying more paid than submitted", () => {
    const model = setup();
    const demo = demoNumberValues(scopeKey, model.fields, { [scopeKey]: { "issuedPaid.policies": 11, "issuedPaid.ap": 11000 } });
    expect(demo.isDemo).toBe(false);
    expect(demo.values).not.toHaveProperty("issuedPaid.policies");
    expect(scoreboardPlacementDemo(model.data, { "issuedPaid.policies": 11 }, true).placementPct).toBeNull();
    expect(scoreboardPlacementDemo(model.data, { "issuedPaid.policies": 5 }, false).issuedPaidPolicies).toBeNull();
  });

  it("masks paid AP, policy count, placement and its denominator during Present mode", () => {
    const model = setup(); model.save({ "issuedPaid.ap": 8000, "issuedPaid.policies": 8 });
    render(<ScoreboardIssuePaidStrip metrics={model.read().metrics} hidden />);
    expect(screen.getAllByText("Hidden")).toHaveLength(3);
    expect(screen.queryByText("$8,000")).not.toBeInTheDocument();
    expect(screen.queryByText("80%")).not.toBeInTheDocument();
    expect(screen.queryByText(/8 issued-and-paid policies/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10 displayed cohort policies/)).not.toBeInTheDocument();
    expect(screen.getByText("Demo figures")).toBeInTheDocument();
  });

  it("offers blank optional inputs through the existing pencil editor and validates the final cohort", () => {
    const model = setup();
    const close = vi.fn();
    render(<ProductionDemoEditor scopes={model.store.getSnapshot().scopes} overrides={model.store.getSnapshot().overrides} onSave={model.store.save} onReset={model.store.resetAll} onClose={close} />);
    const paidCount = screen.getByRole("spinbutton", { name: "Agency issued & paid policies · demo" });
    expect(paidCount).toHaveValue(null);
    expect(screen.getByRole("spinbutton", { name: "Agency issued & paid AP · demo ($)" })).toHaveValue(null);
    fireEvent.change(paidCount, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save demo figures" }));
    expect(screen.getByRole("alert")).toHaveTextContent("cannot exceed Agency policies");
    expect(close).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Agency policies" }), { target: { value: "26" } });
    fireEvent.click(screen.getByRole("button", { name: "Save demo figures" }));
    expect(close).toHaveBeenCalledOnce();
    expect(model.read().metrics).toMatchObject({ isDemo: true, issuedPaidPolicies: 20, submittedPolicies: 26, placementPct: 76.9, issuedPaidAP: null });
  });
});
