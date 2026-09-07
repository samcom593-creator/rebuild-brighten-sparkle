import { describe, expect, it } from "vitest";
import { ORGANIZATION_ID, snapshotRow, syncDays, validateProduction } from "../../../scripts/lib/vantage-production";
import { summarizeVantageDays } from "../../lib/vantageProductionApi";

const payload = () => ({
  organization_id: ORGANIZATION_ID,
  period: { start: "2026-09-03T00:00:00.000Z", end: "2026-09-03T23:59:59.999Z" },
  totals: { premium: 4044.72, policies: 2, placed: 2042.88, producers: 1 },
  producers: [{ agent_id: "provider-writer-id", name: "Writer", premium: 4044.72, policies: 2, placed: 2042.88 }],
});

describe("Vantage production validation", () => {
  it("accepts source-attested amounts without rounding them to Discord dollars", () => {
    const row = snapshotRow("2026-09-03", validateProduction(payload(), "2026-09-03"), "2026-09-07T00:00:00Z");
    expect(row.reported_alp).toBe(4044.72);
    expect(row.metadata.placed_premium).toBe(2042.88);
    expect(row.metadata.verified).toBe(true);
    expect(JSON.stringify(row)).not.toContain("Bearer");
  });
  it("rejects another organization and a provider ignoring the requested period", () => {
    expect(() => validateProduction({ ...payload(), organization_id: "other" }, "2026-09-03")).toThrow();
    expect(() => validateProduction(payload(), "2026-09-04")).toThrow();
  });
  it("rejects incomplete, duplicated, nonfinite and contradictory totals", () => {
    for (const invalid of [
      { ...payload(), producers: [] },
      { ...payload(), producers: [...payload().producers, ...payload().producers] },
      { ...payload(), totals: { ...payload().totals, premium: Infinity } },
      { ...payload(), totals: { ...payload().totals, policies: 0 } },
      { ...payload(), totals: { ...payload().totals, premium: 4045 } },
    ]) expect(() => validateProduction(invalid, "2026-09-03")).toThrow();
  });
  it("accepts a genuine zero day but does not mistake missing data for zero", () => {
    expect(validateProduction({ ...payload(), totals: { premium: 0, policies: 0, placed: 0, producers: 0 }, producers: [] }, "2026-09-03").totals.policies).toBe(0);
    expect(() => validateProduction({}, "2026-09-03")).toThrow();
  });
  it("bounds recurring reconciliation and rejects historical/future or excessive requests", () => {
    expect(syncDays({}, "2026-09-07")).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(syncDays({ reconcile: true }, "2026-09-07")).toHaveLength(7);
    expect(() => syncDays({ start: "2026-08-31" }, "2026-09-07")).toThrow();
    expect(() => syncDays({ end: "2026-09-08" }, "2026-09-07")).toThrow();
    expect(() => syncDays({ start: "2026-09-01" }, "2026-10-07")).toThrow();
    expect(() => syncDays({ start: "2026-09-31" }, "2026-10-07")).toThrow();
  });
  it("summarizes repeated producers once and preserves the oldest refresh time", () => {
    const one = snapshotRow("2026-09-03", payload(), "2026-09-07T00:00:00Z");
    const two = { ...one, business_date: "2026-09-04", updated_at: "2026-09-07T01:00:00Z" };
    const summary = summarizeVantageDays([one, two]);
    expect(summary.producers).toHaveLength(1);
    expect(summary.policies).toBe(4);
    expect(summary.premium).toBe(8089.44);
    expect(summary.placed).toBe(4085.76);
    expect(summary.updatedAt).toBe(one.updated_at);
  });
});
