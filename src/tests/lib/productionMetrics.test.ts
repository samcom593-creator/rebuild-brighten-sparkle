/**
 * productionMetrics (F33): every figure on the Team summary strip is graded by the read it comes from. A failed
 * roster read can never produce "Team size 0" beside a successful summary, a still-loading roster shows a skeleton
 * in its own slot, a partial failure names the read that did not load (down to the part of the four-RPC roster),
 * and Retry refetches exactly the sources the strip names.
 */
import { describe, expect, it } from "vitest";
import {
  REASON_EMPTY, REASON_FAILED, ROSTER_PARTS, SOURCE_ROSTER, SOURCE_SEGMENTS, SOURCE_TODAY, compactUsd, failedReadOf,
  metricSource, missingSentence, partRows, rosterDerived, sourceError, sourceLabel, sourceNeedsRetry, sourceReport,
  staleSentence, teamFigures, todayLine,
  type MetricSource, type ProductionMetricSnapshot, type RosterDerived, type TodayProductionSnapshot,
} from "@/lib/productionMetrics";
import { errorMessage } from "@/lib/queryState";
import type { RosterRow } from "@/lib/teamRoster";

const base: RosterRow = {
  agent_id: "a", full_name: null, email: null, phone: null, avatar_url: null, agent_code: null, status: "active",
  is_deactivated: null, is_inactive: null, is_sync_only: null, license_status: null, license_progress: null,
  onboarding_stage: null, training_stage: null, manager_id: null, manager_name: null, downline_count: null,
  contracts_total: null, contracts_active: null, mtd_alp: null, mtd_deals: null, today_alp: null, today_deals: null,
  selling_streak_days: null, free_leads_qualified: false, free_leads_reason: null, free_leads_needed_for_qual: null,
  l30_alp: null, l30_deals: null, lifetime_alp: null, lifetime_deals: null, first_posted_date: null,
  last_posted_date: null, last_contacted_at: null, created_at: null, tenure_days: null,
};
const row = (over: Partial<RosterRow>): RosterRow => ({ ...base, ...over });

const summary: ProductionMetricSnapshot = { total: 215, active: 96, inactive: 62, terminated: 57, producing_mtd: 31, mtd_alp: 184_250, book_last_posted: "2026-10-14" };
const derived: RosterDerived = { teamSize: 90, newHires30dNoSale: 4 };
const todayRow: TodayProductionSnapshot = { today_alp: 2_582, today_policies: 1, selling_streak_days: 3, business_date: "2026-10-15" };

const ready = <T,>(value: T | null, extra: Partial<MetricSource<T>> = {}): MetricSource<T> => ({ status: "ready", value, stale: false, error: null, asOf: null, ...extra });
const loading = <T,>(): MetricSource<T> => ({ status: "loading", value: null, stale: false, error: null, asOf: null });
const failed = <T,>(error: unknown = new Error("Failed to fetch")): MetricSource<T> => ({ status: "error", value: null, stale: false, error, asOf: null });

describe("metricSource", () => {
  it("is loading while nothing has loaded, with no value", () => {
    expect(metricSource({ isPending: true, data: undefined })).toMatchObject({ status: "loading", value: null, stale: false });
    expect(metricSource({})).toMatchObject({ status: "loading", value: null });
  });

  it("is error, with no value, when the read failed and nothing is cached", () => {
    const err = new Error("boom");
    expect(metricSource({ isError: true, data: undefined, error: err })).toMatchObject({ status: "error", value: null, stale: false, error: err });
  });

  it("keeps the last good result as ready and stale when a refresh fails", () => {
    const source = metricSource({ isError: true, data: [1, 2], error: new Error("later"), dataUpdatedAt: 1_700_000_000_000 });
    expect(source).toMatchObject({ status: "ready", value: [1, 2], stale: true, asOf: 1_700_000_000_000 });
  });

  it("treats a completed read with no rows or no row as ready, never as empty or loading", () => {
    expect(metricSource({ isPending: false, isError: false, data: [] })).toMatchObject({ status: "ready", value: [] });
    expect(metricSource({ isPending: false, isError: false, data: null })).toMatchObject({ status: "ready", value: null });
  });

  it("reports no asOf for a query that has never completed", () => {
    expect(metricSource({ isPending: true, data: undefined, dataUpdatedAt: 0 }).asOf).toBeNull();
  });
});

describe("rosterDerived", () => {
  it("counts active people and leaves inactive, terminated and placeholder seats out", () => {
    const rows = [
      row({ agent_id: "1" }),
      row({ agent_id: "2", is_sync_only: true }),
      row({ agent_id: "3", status: "inactive" }),
      row({ agent_id: "4", status: "terminated" }),
      row({ agent_id: "5", is_sync_only: false }),
    ];
    expect(rosterDerived(rows).teamSize).toBe(2);
  });

  it("counts the activation queue as working agents 30 days in or less with no lifetime deal", () => {
    const rows = [
      row({ agent_id: "1", tenure_days: 3, lifetime_deals: 0 }),
      row({ agent_id: "2", tenure_days: 30, lifetime_deals: null }),
      row({ agent_id: "3", tenure_days: 31, lifetime_deals: 0 }),
      row({ agent_id: "4", tenure_days: 2, lifetime_deals: 1 }),
      row({ agent_id: "5", tenure_days: null, lifetime_deals: 0 }),
      row({ agent_id: "6", tenure_days: 1, lifetime_deals: 0, is_sync_only: true }),
    ];
    expect(rosterDerived(rows)).toEqual({ teamSize: 5, newHires30dNoSale: 2 });
  });

  it("is zero for a completed read with no rows", () => {
    expect(rosterDerived([])).toEqual({ teamSize: 0, newHires30dNoSale: 0 });
  });
});

describe("teamFigures", () => {
  const byKey = (figures: ReturnType<typeof teamFigures>) => Object.fromEntries(figures.map((f) => [f.key, f]));

  it("shows four numbers when both reads completed", () => {
    const f = byKey(teamFigures(ready(summary), ready(derived)));
    expect(f.team_size).toMatchObject({ state: "ready", value: "90", source: SOURCE_ROSTER });
    expect(f.producing_mtd).toMatchObject({ state: "ready", value: "31", source: SOURCE_SEGMENTS });
    expect(f.new_hires_no_sale).toMatchObject({ state: "ready", value: "4" });
    expect(f.mtd_alp).toMatchObject({ state: "ready", value: "$184.3K", note: "through 2026-10-14" });
  });

  it("never renders Team size 0 when the roster failed and the summary succeeded", () => {
    const figures = teamFigures(ready(summary), failed());
    const f = byKey(figures);
    expect(f.team_size).toMatchObject({ state: "unavailable", value: null, source: SOURCE_ROSTER });
    expect(f.new_hires_no_sale).toMatchObject({ state: "unavailable", value: null, source: SOURCE_ROSTER });
    expect(f.producing_mtd).toMatchObject({ state: "ready", value: "31" });
    expect(f.mtd_alp).toMatchObject({ state: "ready", value: "$184.3K" });
    expect(figures.some((x) => x.value === "0")).toBe(false);
  });

  it("does not borrow the summary total for Team size: it is a different quantity", () => {
    const f = byKey(teamFigures(ready(summary), failed()));
    expect(f.team_size.value).not.toBe("215");
  });

  it("shows a loading slot, not a number, while the roster is still loading beside a ready summary", () => {
    const f = byKey(teamFigures(ready(summary), loading()));
    expect(f.team_size.state).toBe("loading");
    expect(f.new_hires_no_sale.state).toBe("loading");
    expect(f.producing_mtd).toMatchObject({ state: "ready", value: "31" });
  });

  it("keeps the roster figures when the summary failed, naming the summary as the missing read", () => {
    const f = byKey(teamFigures(failed(), ready(derived)));
    expect(f.team_size).toMatchObject({ state: "ready", value: "90" });
    expect(f.producing_mtd).toMatchObject({ state: "unavailable", source: SOURCE_SEGMENTS });
    expect(f.mtd_alp).toMatchObject({ state: "unavailable", source: SOURCE_SEGMENTS });
  });

  it("treats a summary read that completed with no row as unavailable, not as zeros", () => {
    const f = byKey(teamFigures(ready<ProductionMetricSnapshot>(null), ready(derived)));
    expect(f.producing_mtd).toMatchObject({ state: "unavailable", value: null });
    expect(f.mtd_alp).toMatchObject({ state: "unavailable", value: null });
  });

  it("shows a true zero for a completed roster read with nobody working", () => {
    const f = byKey(teamFigures(ready(summary), ready({ teamSize: 0, newHires30dNoSale: 0 })));
    expect(f.team_size).toMatchObject({ state: "ready", value: "0" });
  });

  it("keeps the last good roster figures when only the refresh failed", () => {
    const f = byKey(teamFigures(ready(summary), ready(derived, { stale: true, error: new Error("later"), asOf: 1 })));
    expect(f.team_size).toMatchObject({ state: "ready", value: "90" });
  });
});

describe("todayLine", () => {
  it("gives no policy count and no streak when the read failed", () => {
    expect(todayLine(failed())).toEqual({ state: "unavailable", amount: null, policies: null, streakDays: null });
    expect(todayLine(loading())).toMatchObject({ state: "loading", policies: null });
  });

  it("renders a completed read, with $0 for a day with nothing posted", () => {
    expect(todayLine(ready(todayRow))).toEqual({ state: "ready", amount: "$2.6K", policies: 1, streakDays: 3 });
    expect(todayLine(ready({ ...todayRow, today_alp: 0, today_policies: 0, selling_streak_days: 0 }))).toMatchObject({ amount: "$0", policies: 0, streakDays: 0 });
  });
});

describe("sourceReport", () => {
  it("names each failed read with a plain-English reason", () => {
    const report = sourceReport([
      { name: SOURCE_TODAY, source: ready(todayRow) },
      { name: SOURCE_SEGMENTS, source: ready(summary) },
      { name: SOURCE_ROSTER, source: failed(new Error("Failed to fetch")) },
    ]);
    expect(report.missing).toEqual([
      { source: SOURCE_ROSTER, name: SOURCE_ROSTER, reason: REASON_FAILED, message: "Network error. Check your connection and retry." },
    ]);
    expect(report.stale).toEqual([]);
  });

  it("names a read that came back with no row, and a read showing an earlier result", () => {
    const report = sourceReport([
      { name: SOURCE_SEGMENTS, source: ready<ProductionMetricSnapshot>(null) },
      { name: SOURCE_ROSTER, source: ready(derived, { stale: true, error: { code: "57014", message: "canceling statement" }, asOf: 5 }) },
    ]);
    expect(report.missing).toEqual([{ source: SOURCE_SEGMENTS, name: SOURCE_SEGMENTS, reason: REASON_EMPTY, message: null }]);
    expect(report.stale).toEqual([{ source: SOURCE_ROSTER, name: SOURCE_ROSTER, asOf: 5, message: "The server took too long to answer. Retry in a moment." }]);
  });

  it("names the part of the roster that failed, not the composite it belongs to", () => {
    const pulseDenied = sourceError(ROSTER_PARTS.salesPulse, { message: "permission denied for function crm_agent_sales_pulse", code: "42501", details: null, hint: null });
    const report = sourceReport([
      { name: SOURCE_SEGMENTS, source: ready(summary) },
      { name: SOURCE_ROSTER, source: failed(pulseDenied) },
    ]);
    expect(report.missing).toEqual([
      { source: SOURCE_ROSTER, name: "crm_agent_sales_pulse", reason: REASON_FAILED, message: "You do not have permission to view this." },
    ]);
  });

  it("names the part whose refresh failed while an earlier roster is still shown", () => {
    const contactsDown = sourceError(ROSTER_PARTS.contacts, { message: "TypeError: Failed to fetch", code: "" });
    const report = sourceReport([{ name: SOURCE_ROSTER, source: ready(derived, { stale: true, error: contactsDown, asOf: 9 }) }]);
    expect(report.stale).toEqual([
      { source: SOURCE_ROSTER, name: "crm_agent_contacts", asOf: 9, message: "Network error. Check your connection and retry." },
    ]);
  });

  it("is clean when every read completed", () => {
    expect(sourceReport([{ name: SOURCE_SEGMENTS, source: ready(summary) }, { name: SOURCE_ROSTER, source: ready(derived) }])).toEqual({ missing: [], stale: [] });
  });
});

describe("sourceNeedsRetry", () => {
  it("selects a failed read, a read that came back with no row and a stale read; never a loading or clean one", () => {
    expect(sourceNeedsRetry(failed())).toBe(true);
    expect(sourceNeedsRetry(ready<ProductionMetricSnapshot>(null))).toBe(true);
    expect(sourceNeedsRetry(ready(derived, { stale: true, error: new Error("later"), asOf: 1 }))).toBe(true);
    expect(sourceNeedsRetry(loading())).toBe(false);
    expect(sourceNeedsRetry(ready(summary))).toBe(false);
    expect(sourceNeedsRetry(ready({ teamSize: 0, newHires30dNoSale: 0 }))).toBe(false);
  });

  it("selects exactly the sources the report names, so Retry is never shown for a source it will not refetch", () => {
    const states: MetricSource<unknown>[] = [
      loading(), failed(), ready(null), ready(summary), ready(derived, { stale: true, error: new Error("later"), asOf: 2 }),
      ready(null, { stale: true, error: new Error("later"), asOf: 3 }),
    ];
    for (const source of states) {
      const report = sourceReport([{ name: SOURCE_SEGMENTS, source }]);
      const named = report.missing.length + report.stale.length > 0;
      expect(named).toBe(sourceNeedsRetry(source));
    }
  });
});

describe("sourceError and failedReadOf", () => {
  it("tags a PostgREST error object with its read and keeps the code, so the plain-English message survives", () => {
    const tagged = sourceError(ROSTER_PARTS.freeLeads, { message: "canceling statement due to statement timeout", code: "57014", details: null, hint: null });
    expect(tagged).toBeInstanceOf(Error);
    expect(failedReadOf(tagged)).toBe("crm_agent_free_leads_status");
    expect(tagged.code).toBe("57014");
    expect(errorMessage(tagged)).toBe("The server took too long to answer. Retry in a moment.");
  });

  it("falls back to details when the message is blank, and accepts an Error or a string", () => {
    expect(sourceError(SOURCE_ROSTER, { message: "", details: "row-level security" }).message).toBe("row-level security");
    expect(sourceError(SOURCE_ROSTER, new Error("boom")).message).toBe("boom");
    expect(sourceError(SOURCE_ROSTER, "plain text").message).toBe("plain text");
  });

  it("reports no read for an untagged failure", () => {
    expect(failedReadOf(new Error("x"))).toBeNull();
    expect(failedReadOf({ message: "x" })).toBeNull();
    expect(failedReadOf(null)).toBeNull();
    expect(failedReadOf("x")).toBeNull();
  });
});

describe("partRows", () => {
  it("returns the rows of a part that answered", () => {
    expect(partRows<{ agent_id: string }>(ROSTER_PARTS.contacts, { data: [{ agent_id: "a" }], error: null })).toEqual([{ agent_id: "a" }]);
  });

  it("throws the part's own failure, tagged with the part", () => {
    const run = () => partRows(ROSTER_PARTS.salesPulse, { data: null, error: { message: "permission denied", code: "42501" } });
    expect(run).toThrow("permission denied");
    try {
      run();
      expect.unreachable("partRows should have thrown");
    } catch (err) {
      expect(failedReadOf(err)).toBe("crm_agent_sales_pulse");
      expect(errorMessage(err)).toBe("You do not have permission to view this.");
    }
  });

  it("fails a part that stops exactly at the platform page limit, tagged with the part", () => {
    const capped = Array.from({ length: 1000 }, (_, index) => ({ agent_id: `a${index}` }));
    try {
      partRows(ROSTER_PARTS.freeLeads, { data: capped, error: null });
      expect.unreachable("partRows should have thrown");
    } catch (err) {
      expect(failedReadOf(err)).toBe("crm_agent_free_leads_status");
      expect(errorMessage(err)).toContain("platform page limit");
    }
  });

  it("fails a result that is not a list instead of counting it as nobody", () => {
    try {
      partRows(ROSTER_PARTS.roster, { data: { agent_id: "a" }, error: null });
      expect.unreachable("partRows should have thrown");
    } catch (err) {
      expect(failedReadOf(err)).toBe("crm_agent_roster");
    }
  });

  it("keeps the earlier contract for a part that answered with no body: no rows", () => {
    expect(partRows(ROSTER_PARTS.contacts, { data: null, error: null })).toEqual([]);
  });
});

describe("copy", () => {
  it("names every read in plain English and keeps an unknown read's own name", () => {
    expect(sourceLabel(SOURCE_ROSTER)).toBe("the team roster");
    expect(sourceLabel(SOURCE_SEGMENTS)).toBe("the team summary");
    expect(sourceLabel(SOURCE_TODAY)).toBe("today's production");
    expect(sourceLabel(ROSTER_PARTS.contacts)).toBe("agent contact details");
    expect(sourceLabel("crm_something_new")).toBe("crm_something_new");
  });

  it("says which source is missing, with the RPC name in parentheses", () => {
    expect(missingSentence({ source: SOURCE_SEGMENTS, name: SOURCE_SEGMENTS, reason: REASON_EMPTY, message: null }))
      .toBe("Not loaded: the team summary (crm_roster_segments) came back empty.");
    expect(missingSentence({ source: SOURCE_ROSTER, name: SOURCE_ROSTER, reason: REASON_FAILED, message: "Network error. Check your connection and retry." }))
      .toBe("Not loaded: the team roster (crm_agent_roster) could not be read. Network error. Check your connection and retry.");
  });

  it("names the failing part of the roster in the sentence", () => {
    expect(missingSentence({ source: SOURCE_ROSTER, name: "crm_agent_contacts", reason: REASON_FAILED, message: "You do not have permission to view this." }))
      .toBe("Not loaded: the team roster, because agent contact details (crm_agent_contacts) could not be read. You do not have permission to view this.");
  });

  it("says what an earlier result is and why it is not current", () => {
    const at = (ms: number) => `T${ms}`;
    expect(staleSentence({ source: SOURCE_ROSTER, name: SOURCE_ROSTER, asOf: 7, message: "Network error. Check your connection and retry." }, at))
      .toBe("Showing the team roster (crm_agent_roster) as of T7. The latest refresh failed. Network error. Check your connection and retry.");
    expect(staleSentence({ source: SOURCE_ROSTER, name: "crm_agent_sales_pulse", asOf: null, message: "x" }, at))
      .toBe("Showing the team roster (crm_agent_roster) from an earlier read. The latest refresh failed because today's sales by agent (crm_agent_sales_pulse) could not be read. x");
  });
});

describe("compactUsd", () => {
  it("formats the strip's amounts", () => {
    expect(compactUsd(0)).toBe("Nothing posted yet");
    expect(compactUsd("abc")).toBe("Nothing posted yet");
    expect(compactUsd(950)).toBe("$950");
    expect(compactUsd(12_345)).toBe("$12.3K");
    expect(compactUsd(2_500_000)).toBe("$2.50M");
  });
});
