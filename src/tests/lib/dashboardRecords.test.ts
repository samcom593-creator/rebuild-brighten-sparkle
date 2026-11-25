import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { loadManagerProduction, loadPlaqueFacts, rankPlaqueHonorees, summarizePlaques } from "@/lib/dashboardRecords";

type Request = { relation: string; columns: string; filters: [string, string, string][]; from: number; to: number };
function paged(rows: Record<string, unknown>[], failAt = -1) {
  const requests: Request[] = [];
  vi.mocked(supabase.from).mockImplementation(relation => {
    const request: Request = { relation, columns: "", filters: [], from: 0, to: 499 }; requests.push(request);
    const query = {
      select: (columns: string) => { request.columns = columns; return query; },
      gte: (column: string, value: string) => { request.filters.push(["gte", column, value]); return query; },
      lte: (column: string, value: string) => { request.filters.push(["lte", column, value]); return query; },
      order: () => query,
      range: (from: number, to: number) => { request.from = from; request.to = to; return query; },
      abortSignal: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(request.from === failAt
        ? { data: null, error: new Error("History unavailable") }
        : { data: rows.slice(request.from, request.to + 1), error: null })),
    };
    return query as never;
  });
  return requests;
}
beforeEach(() => { vi.mocked(supabase.from).mockReset(); });
describe("complete dashboard records", () => {
  it("uses canonical posted dates and annual premium beyond the old 100-row window", async () => {
    const requests = paged(Array.from({ length: 501 }, (_, i) => ({ row_key: `deal-${i}`, annual_premium: 100, agent_id: "producer-a", posted_date: "2026-11-24" })));
    const rows = await loadManagerProduction("2026-11-24");
    expect(rows).toHaveLength(501);
    expect(rows.reduce((sum, row) => sum + Number(row.annual_premium), 0)).toBe(50100);
    expect(requests.map(r => [r.from, r.to])).toEqual([[0, 499], [500, 999]]);
    expect(requests[0].relation).toBe("v_production_canonical");
    expect(requests[0].columns).toContain("annual_premium");
    expect(requests[0].filters).toEqual([["gte", "posted_date", "2026-10-26"], ["lte", "posted_date", "2026-11-24"]]);
  });

  it("refuses a partial total when a later page fails", async () => {
    paged(Array.from({ length: 501 }, (_, i) => ({ row_key: `deal-${i}`, annual_premium: 100 })), 500);
    await expect(loadManagerProduction("2026-11-24")).rejects.toThrow("History unavailable");
  });

  it("does not count duplicate rows when a list moves while loading", async () => {
    paged(Array.from({ length: 501 }, (_, i) => ({ row_key: i === 500 ? "deal-0" : `deal-${i}` })));
    await expect(loadManagerProduction("2026-11-24")).rejects.toThrow("changed while loading");
  });

  it("includes awards beyond 1000 rows in totals and honorees", async () => {
    const requests = paged(Array.from({ length: 1001 }, (_, i) => ({ id: `award-${i}`, agent_id: i === 1000 ? "producer-b" : "producer-a", milestone_type: i === 1000 ? "day_hiring_champion" : "first_deal_ever", amount: 100, awarded_at: "2026-11-24T18:00:00Z" })));
    const facts = await loadPlaqueFacts();
    expect(summarizePlaques(facts, "2026-11-24")).toEqual({ total: 1001, milestoneTypes: 2, honorees: 2, thisMonth: 1001 });
    expect(requests[0].columns).toContain("milestone_type");
  });

  it("uses Phoenix month boundaries and leaves undated awards out of this-month counts", () => {
    const rows = [
      { id: "old", agent_id: "a", milestone_type: "single_day", amount: 100, awarded_at: "2026-11-01T06:59:59Z" },
      { id: "new", agent_id: "a", milestone_type: "single_day", amount: 200, awarded_at: "2026-11-01T07:00:00Z" },
      { id: "undated", agent_id: "a", milestone_type: "monthly_20k", amount: null, awarded_at: null },
    ];
    expect(summarizePlaques(rows, "2026-11-01")).toEqual({ total: 3, milestoneTypes: 2, honorees: 1, thisMonth: 1 });
  });

  it("counts recognition without summing mixed units or overlapping premium awards", () => {
    const rows = [
      { id: "alp", agent_id: "b", milestone_type: "monthly_20k", amount: 20000, awarded_at: null },
      { id: "same-premium", agent_id: "b", milestone_type: "monthly_top6", amount: 20000, awarded_at: null },
      { id: "hires", agent_id: "a", milestone_type: "month_builder", amount: 5, awarded_at: null },
      { id: "hires-again", agent_id: "a", milestone_type: "month_builder", amount: 6, awarded_at: null },
      { id: "streak", agent_id: "c", milestone_type: "streak_5", amount: 5, awarded_at: null },
    ];
    expect(summarizePlaques(rows, "2026-11-25")).toEqual({ total: 5, milestoneTypes: 4, honorees: 3, thisMonth: 0 });
    expect(rankPlaqueHonorees(rows)).toEqual([
      { agent_id: "a", plaque_count: 2, milestone_types: 1 },
      { agent_id: "b", plaque_count: 2, milestone_types: 2 },
      { agent_id: "c", plaque_count: 1, milestone_types: 1 },
    ]);
    expect(rankPlaqueHonorees([...rows].reverse())).toEqual(rankPlaqueHonorees(rows));
  });
});
