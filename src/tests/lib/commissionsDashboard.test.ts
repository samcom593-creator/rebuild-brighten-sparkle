import { describe, expect, it } from "vitest";
import {
  EMPTY_DEAL_FILTER,
  LANE_META,
  bookFreshnessSentence,
  dealsCsv,
  estText,
  filterDeals,
  laneStrip,
  paidFeedSentence,
  parseCommissionsDashboard,
  rateSentence,
  sumAp,
  sumEst,
  type DashboardDeal,
} from "@/lib/commissionsDashboard";

const lanesZero = Object.fromEntries(["in_force", "pending", "awaiting_feed", "not_in_feed", "lost", "no_feed"].map((l) => [l, { n: 0, ap: 0, est: null }]));

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    as_of: "2026-11-27T19:00:00Z",
    today: "2026-11-27",
    agent: { agent_id: "a1", name: "Pat Example", npn: "12345678", rate_pct: 85, rate_provenance: "admin_ui", rate_on_file: true, record_ids: ["a1"] },
    kpis: {
      mtd_est: 1200.5, mtd_deals: 2, mtd_ap: 1500, last_month_est: 800, last_month_deals: 1, ytd_est: 9000, ytd_deals: 12, ytd_ap: 11000,
      deals_12m: 12, ap_12m: 11000, est_12m: 9000,
      lanes: { ...lanesZero, in_force: { n: 5, ap: 5000, est: 4250 }, awaiting_feed: { n: 2, ap: 1500, est: 1275 } },
    },
    months: [{ month: "2026-11", deals: 2, ap: 1500, est: 1200.5, est_in_force: 500, est_pending: 700.5, est_lost: null, est_unknown: null }],
    deals: [
      { row_key: "d1", posted_date: "2026-11-25", client_name: "Client One", carrier: "Ethos", product: "Life", policy_number: "P1", annual_premium: 1000, est: 850, deal_status: "submitted", origin: "apex_native", lane: "awaiting_feed", book_carrier: null, status_bucket: null, status_raw: null, status_changed_on: null, issued_on: null, lost_on: null, close_reason: null },
      { row_key: "d2", posted_date: "2026-10-03", client_name: "Client Two", carrier: "Chubb", product: "Accident", policy_number: "P2", annual_premium: 500, est: 425, deal_status: "active", origin: "agentlink", lane: "in_force", book_carrier: "Chubb", status_bucket: "active", status_raw: "Active", status_changed_on: "2026-10-10", issued_on: "2026-10-09", lost_on: null, close_reason: null },
    ],
    chargebacks: [{ carrier: "Ethos", policy_number: "P9", amount: 120, original_amount: 300, chargeback_on: "2026-11-01", reason: "lapse", status: "open" }],
    chargeback_open_total: 120,
    ethos: { snapshot_on: "2026-11-23", issued_annual_premium: 17970.84, inforce_issued_premium: 15681.84, persistency_m4: 0.9, persistency_m7: null, persistency_m13: null, outstanding_chargeback: 258.3, on_advanced_pay: true },
    book: { last_run_at: "2026-11-24T00:17:29Z", last_read_on: "2026-11-23", carriers: ["Chubb", "Ethos"] },
    sources: { commission_ledger_rows: 10, paid_feed: false },
    ...over,
  };
}

describe("commissionsDashboard: parsing is strict", () => {
  it("parses a full payload and keeps null estimates as null", () => {
    const p = parseCommissionsDashboard(payload());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.agent.rate_pct).toBe(85);
    expect(p.kpis.lanes.lost.est).toBeNull();
    expect(p.kpis.lanes.in_force).toEqual({ n: 5, ap: 5000, est: 4250 });
    expect(p.deals[0].lane).toBe("awaiting_feed");
    expect(p.months[0].est_lost).toBeNull();
    expect(p.ethos?.outstanding_chargeback).toBe(258.3);
  });

  it("passes the no-record answer through as ok:false instead of an empty book", () => {
    const p = parseCommissionsDashboard({ ok: false, reason: "no_agent_record", as_of: "x" });
    expect(p).toEqual({ ok: false, reason: "no_agent_record", as_of: "x" });
  });

  it("throws on a shape it does not understand", () => {
    expect(() => parseCommissionsDashboard(null)).toThrow();
    expect(() => parseCommissionsDashboard({ ok: true })).toThrow();
    expect(() => parseCommissionsDashboard(payload({ kpis: { lanes: {} } }))).toThrow(/not a number/);
    expect(() => parseCommissionsDashboard(payload({ deals: [{ posted_date: "2026-11-01" }] }))).toThrow(/without a key/);
  });

  it("maps an unknown lane to no_feed rather than inventing a status", () => {
    const p = parseCommissionsDashboard(payload({ deals: [{ row_key: "x", lane: "weird" }] }));
    if (!p.ok) throw new Error("expected ok");
    expect(p.deals[0].lane).toBe("no_feed");
  });
});

describe("commissionsDashboard: wording never dresses a missing rate as a figure", () => {
  it("shows the estimate when the rate is on file and the honest words when it is not", () => {
    expect(estText(1234.5, true)).toBe("$1,235");
    expect(estText(null, true)).toBe("$0");
    expect(estText(1234.5, false)).toBe("Rate not on file");
    expect(rateSentence({ rate_pct: 85, rate_provenance: "admin_ui", rate_on_file: true })).toContain("Contract rate 85% (admin ui)");
    expect(rateSentence({ rate_pct: null, rate_provenance: "unknown", rate_on_file: false })).toContain("not on file");
  });

  it("says how stale the carrier portal read is", () => {
    expect(bookFreshnessSentence("2026-11-23", "2026-11-27", ["Chubb", "Ethos"])).toBe("Policy statuses come from Chubb and Ethos, last read 4 days ago. That is stale; statuses may have moved since.");
    expect(bookFreshnessSentence("2026-11-27", "2026-11-27", ["Ethos"])).toBe("Policy statuses come from Ethos, last read today.");
    expect(bookFreshnessSentence(null, "2026-11-27", [])).toContain("has not been read yet");
  });

  it("states that nothing is money received while no paid feed exists, and names the retired ledger", () => {
    expect(paidFeedSentence({ commission_ledger_rows: 10, paid_feed: false })).toContain("nothing here is money received");
    expect(paidFeedSentence({ commission_ledger_rows: 10, paid_feed: false })).toContain("10 rows");
    expect(paidFeedSentence({ commission_ledger_rows: 0, paid_feed: false })).not.toContain("ledger");
    expect(paidFeedSentence({ commission_ledger_rows: 0, paid_feed: true })).toContain("carrier statements");
  });
});

describe("commissionsDashboard: filters, totals and export", () => {
  const p = parseCommissionsDashboard(payload());
  const deals: DashboardDeal[] = p.ok ? p.deals : [];

  it("filters by month, lane and search", () => {
    expect(filterDeals(deals, EMPTY_DEAL_FILTER)).toHaveLength(2);
    expect(filterDeals(deals, { ...EMPTY_DEAL_FILTER, month: "2026-11" }).map((d) => d.row_key)).toEqual(["d1"]);
    expect(filterDeals(deals, { ...EMPTY_DEAL_FILTER, lane: "in_force" }).map((d) => d.row_key)).toEqual(["d2"]);
    expect(filterDeals(deals, { ...EMPTY_DEAL_FILTER, search: "chubb" }).map((d) => d.row_key)).toEqual(["d2"]);
    expect(filterDeals(deals, { ...EMPTY_DEAL_FILTER, search: "p1" }).map((d) => d.row_key)).toEqual(["d1"]);
  });

  it("totals premium always and estimates only when at least one deal carries one", () => {
    expect(sumAp(deals)).toBe(1500);
    expect(sumEst(deals)).toBe(1275);
    expect(sumEst(deals.map((d) => ({ ...d, est: null })))).toBeNull();
  });

  it("drops the ones with nothing in them from the lane strip, in lane order", () => {
    if (!p.ok) throw new Error("expected ok");
    expect(laneStrip(p.kpis.lanes).map((x) => x.lane)).toEqual(["in_force", "awaiting_feed"]);
  });

  it("exports a CSV with the carrier status words and blanks the estimate when the rate is off", () => {
    const csv = dealsCsv(deals, true);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain(`"${LANE_META.in_force.label}"`);
    expect(csv).toContain('"850"');
    const noRate = dealsCsv(deals, false);
    expect(noRate).not.toContain('"850"');
    expect(noRate.split("\n")[1]).toContain('"","Awaiting carrier feed"');
  });
});
