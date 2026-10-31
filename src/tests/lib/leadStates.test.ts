/**
 * Where to buy leads (src/lib/leadStates.ts, OVERHAUL-states 2026-10-30): the arithmetic behind the state table,
 * the Buy next / Hold / Avoid recommendation and the split of the next lead order. The database does the
 * counting (book_state_summary, lead_state_yield); these tests pin what the page does with the counts.
 */
import { describe, expect, it } from "vitest";
import {
  AVOID_ACTIVE_SHARE,
  BUY_MAX,
  BUY_MIN,
  DEFAULT_ORDER_SIZE,
  MAX_ORDER_SIZE,
  MIN_DECIDED_FOR_OWN_SHARE,
  MIN_DIALED_FOR_RATE,
  STATE_CODES,
  STATE_NOT_KNOWN,
  agencyActiveShare,
  areaCodeAccuracy,
  averagePer100,
  buildStateRows,
  costPerSale,
  orderText,
  parseLeadYield,
  parseOrderSize,
  parsePrice,
  parseStateOrder,
  parseStateParam,
  parseStateSummary,
  rankedByRate,
  recommend,
  sortStateRows,
  splitMath,
  splitOrder,
  stateLabel,
  stateTrend,
  totalsOf,
  type LeadYieldRow,
  type StateSummaryRow,
} from "@/lib/leadStates";

/** A book_state_summary() row; the standings default to every policy having no status yet. */
function srow(state: string | null, over: Partial<StateSummaryRow> = {}): StateSummaryRow {
  const policies = over.policies ?? 10;
  const active = over.active ?? 0;
  const pending = over.pending ?? 0;
  const lapsing = over.lapsing ?? 0;
  const gone = over.gone ?? 0;
  return {
    state,
    policies,
    on_file: over.on_file ?? 0,
    clients: over.clients ?? policies,
    annual_premium: over.annual_premium ?? policies * 1000,
    premium_policies: over.premium_policies ?? policies,
    active,
    pending,
    lapsing,
    gone,
    no_status: over.no_status ?? policies - active - pending - lapsing - gone,
    last_30_days: over.last_30_days ?? 0,
    last_90_days: over.last_90_days ?? 0,
    prior_90_days: over.prior_90_days ?? 0,
    licensed_agents: over.licensed_agents ?? 0,
    active_writers: over.active_writers ?? 1,
    no_client: over.no_client ?? 0,
  };
}

function yrow(state: string | null, over: Partial<LeadYieldRow> = {}): LeadYieldRow {
  return {
    state,
    leads_bought: over.leads_bought ?? 0,
    never_called: over.never_called ?? 0,
    leads_dialed: over.leads_dialed ?? 0,
    dialed_sales: over.dialed_sales ?? 0,
    area_checked: over.area_checked ?? 0,
    area_matched: over.area_matched ?? 0,
    calls_since: over.calls_since ?? "2026-04-01",
    lists_loaded: over.lists_loaded ?? "2026-08-04",
  };
}

describe("reading the state from the URL", () => {
  it("takes a two-letter state in any case, unknown, or nothing", () => {
    expect(parseStateParam("tx")).toBe("TX");
    expect(parseStateParam(" DC ")).toBe("DC");
    expect(parseStateParam("unknown")).toBe(STATE_NOT_KNOWN);
    expect(parseStateParam("UNKNOWN")).toBe(STATE_NOT_KNOWN);
    expect(parseStateParam("PR")).toBeNull(); // territories are not on the area code table
    expect(parseStateParam("XX")).toBeNull();
    expect(parseStateParam("")).toBeNull();
    expect(parseStateParam(null)).toBeNull();
  });

  it("knows the 50 states and DC by name", () => {
    expect(STATE_CODES.size).toBe(51);
    expect(stateLabel("TX")).toBe("Texas");
    expect(stateLabel("DC")).toBe("District of Columbia");
    expect(stateLabel(null)).toBe("State not known");
  });
});

describe("reading book_state_summary()", () => {
  it("accepts the database's rows, numbers as numbers or numeric strings", () => {
    const rows = parseStateSummary([{ ...srow("TX", { policies: 3, active: 1, pending: 2 }), annual_premium: "3600.50", last_90_days: "2" }]);
    expect(rows[0]).toMatchObject({ state: "TX", policies: 3, annual_premium: 3600.5, last_90_days: 2, no_status: 0 });
  });

  it("refuses a malformed answer instead of showing a number nobody can trust", () => {
    expect(() => parseStateSummary(null)).toThrow(/no result set/);
    expect(() => parseStateSummary([{ ...srow("TX"), policies: -1 }])).toThrow(/without a number for policies/);
    expect(() => parseStateSummary([{ ...srow("TX"), active: 1.5 }])).toThrow(/without a number for active/);
    expect(() => parseStateSummary([{ ...srow("TX"), annual_premium: "lots" }])).toThrow(/premium/);
    expect(() => parseStateSummary([srow("PR")])).toThrow(/not a US state/);
    expect(() => parseStateSummary([srow("TX"), srow("TX")])).toThrow(/one state twice/);
    expect(() => parseStateSummary([srow(null), srow(null)])).toThrow(/one state twice/);
    // The standings partition the policies; if they do not, the read is wrong.
    expect(() => parseStateSummary([{ ...srow("TX", { policies: 5 }), no_status: 4 }])).toThrow(/do not add up/);
  });
});

describe("reading lead_state_yield()", () => {
  it("accepts the rows and refuses malformed ones", () => {
    expect(parseLeadYield([yrow("TX", { leads_bought: 10, leads_dialed: "4" as unknown as number })])[0].leads_dialed).toBe(4);
    expect(() => parseLeadYield({})).toThrow(/no result set/);
    expect(() => parseLeadYield([{ ...yrow("TX"), dialed_sales: null }])).toThrow(/dialed_sales/);
    expect(() => parseLeadYield([yrow("TX"), yrow("TX")])).toThrow(/one state twice/);
  });
});

describe("the trend: the last 90 days against the 90 before", () => {
  it("is up, down or about the same, with a 10% dead band", () => {
    expect(stateTrend(14, 10)).toEqual({ kind: "up", pct: 40 });
    expect(stateTrend(11, 10)).toEqual({ kind: "up", pct: 10 });
    expect(stateTrend(10, 10)).toEqual({ kind: "flat", pct: 0 });
    expect(stateTrend(19, 20)).toEqual({ kind: "flat", pct: -5 });
    expect(stateTrend(9, 10)).toEqual({ kind: "down", pct: -10 });
    expect(stateTrend(29, 64)).toEqual({ kind: "down", pct: -55 });
  });

  it("is new with nothing before, and nothing with nothing at all (never a divide by zero)", () => {
    expect(stateTrend(3, 0)).toEqual({ kind: "new", pct: null });
    expect(stateTrend(0, 0)).toEqual({ kind: "none", pct: null });
    expect(stateTrend(0, 5)).toEqual({ kind: "down", pct: -100 });
  });
});

describe("the table rows", () => {
  it("computes the share still active over the policies with an outcome only, and the average premium", () => {
    const [tx] = buildStateRows([srow("TX", { policies: 12, active: 6, pending: 2, lapsing: 2, gone: 2, annual_premium: 12_000, premium_policies: 10 })]);
    expect(tx.decided).toBe(10);
    expect(tx.activeShare).toBeCloseTo(0.6);
    expect(tx.avgPremium).toBe(1200);
    expect(tx.leads).toBeNull();
  });

  it("shows a dash, never zero, when nothing is known", () => {
    const [x] = buildStateRows([srow("OH", { policies: 2, annual_premium: 0, premium_policies: 0 })]);
    expect(x.activeShare).toBeNull();
    expect(x.avgPremium).toBeNull();
  });

  it("adds the lead numbers, zeros for a state the lists never had, and a row for a state with only bought leads", () => {
    const rows = buildStateRows(
      [srow("TX", { policies: 5 }), srow("OH", { policies: 2 })],
      [yrow("TX", { leads_bought: 900, never_called: 400, leads_dialed: 500, dialed_sales: 5 }), yrow("NH", { leads_bought: 300, leads_dialed: 40 })],
    );
    expect(rows.map((r) => r.code)).toEqual(["TX", "OH", "NH"]);
    expect(rows[0].leads).toEqual({ bought: 900, neverCalled: 400, dialed: 500, sales: 5, per100: 1 });
    expect(rows[1].leads).toEqual({ bought: 0, neverCalled: 0, dialed: 0, sales: 0, per100: null });
    expect(rows[2]).toMatchObject({ code: "NH", policies: 0, leads: { bought: 300, dialed: 40, sales: 0, per100: 0 } });
  });

  it("adds up to the book: every state plus the not-known row is every policy", () => {
    const rows = buildStateRows([
      srow("TX", { policies: 214, on_file: 36 }),
      srow("OH", { policies: 205, on_file: 18 }),
      srow(null, { policies: 237, no_client: 133, last_90_days: 138 }),
    ]);
    const t = totalsOf(rows);
    expect(t.policies).toBe(214 + 205 + 237);
    expect(t.onFile).toBe(54);
    expect(t.byAreaCode).toBe(214 + 205 - 54);
    expect(t.onFile + t.byAreaCode + t.notKnown).toBe(t.policies);
    expect(t.notKnown).toBe(237);
    expect(t.notKnownNoClient).toBe(133);
    expect(t.last90NotKnown).toBe(138);
  });
});

describe("the three orders", () => {
  const rows = buildStateRows(
    [
      srow("TX", { policies: 214, last_90_days: 29 }),
      srow("OH", { policies: 205, last_90_days: 21 }),
      srow("CA", { policies: 52, last_90_days: 21 }),
      srow("MO", { policies: 96, last_90_days: 13 }),
      srow(null, { policies: 237, last_90_days: 138 }),
    ],
    [
      yrow("TX", { leads_dialed: 5949, dialed_sales: 48 }),
      yrow("OH", { leads_dialed: 3741, dialed_sales: 50 }),
      yrow("CA", { leads_dialed: 1133, dialed_sales: 11 }),
      yrow("MO", { leads_dialed: 857, dialed_sales: 19 }),
    ],
  );

  it("Most deals: policies first; the not-known row is last even though it is the biggest", () => {
    expect(sortStateRows(rows, "deals").map((r) => r.code)).toEqual(["TX", "OH", "MO", "CA", null]);
  });

  it("Most in the last 90 days: recent deals first, ties by policies", () => {
    expect(sortStateRows(rows, "recent").map((r) => r.code)).toEqual(["TX", "OH", "CA", "MO", null]);
  });

  it(`Best sales per lead: only states with ${MIN_DIALED_FOR_RATE.toLocaleString()} dialed rank by the rate; the rest by deals`, () => {
    // MO sells 2.2 per 100, the best rate here, but 857 dialed is too few to rank on, so it follows by deals.
    expect(sortStateRows(rows, "per_lead").map((r) => r.code)).toEqual(["OH", "CA", "TX", "MO", null]);
    expect(rankedByRate(rows.find((r) => r.code === "MO")!)).toBe(false);
    expect(rankedByRate(rows.find((r) => r.code === "CA")!)).toBe(true);
  });

  it("reads an order from storage, defaulting to Most deals", () => {
    expect(parseStateOrder("per_lead")).toBe("per_lead");
    expect(parseStateOrder("recent")).toBe("recent");
    expect(parseStateOrder("anything")).toBe("deals");
    expect(parseStateOrder(null)).toBe("deals");
  });
});

describe("splitting the order", () => {
  it("adds up to exactly the order size, by the largest remainder", () => {
    const split = splitOrder([{ code: "TX", weight: 11.9 }, { code: "OH", weight: 8.2 }, { code: "MO", weight: 7.3 }], 100);
    expect(split.reduce((a, s) => a + s.leads, 0)).toBe(100);
    // 43.43, 29.93, 26.64 -> 43, 29, 26 = 98; the two leads left go to the biggest fractions (OH .93, MO .64).
    expect(split).toEqual([{ code: "TX", leads: 43 }, { code: "OH", leads: 30 }, { code: "MO", leads: 27 }]);
  });

  it("adds up for every size, even tiny ones and many states", () => {
    const items = [5.1, 4.2, 4.2, 3.8, 2.2, 1.1, 0.4].map((weight, i) => ({ code: `S${i}`, weight }));
    for (const size of [1, 2, 3, 7, 9, 10, 99, 100, 101, 250, 1000, 99_999]) {
      expect(splitOrder(items, size).reduce((a, s) => a + s.leads, 0)).toBe(size);
    }
  });

  it("breaks a tie on the fraction by the bigger weight, then the code", () => {
    expect(splitOrder([{ code: "WI", weight: 1 }, { code: "AZ", weight: 1 }], 3)).toEqual([{ code: "WI", leads: 1 }, { code: "AZ", leads: 2 }]);
  });

  it("gives nothing when there is nothing to split", () => {
    expect(splitOrder([{ code: "TX", weight: 0 }], 100)).toEqual([{ code: "TX", leads: 0 }]);
    expect(splitOrder([{ code: "TX", weight: 3 }], 0)).toEqual([{ code: "TX", leads: 0 }]);
    expect(splitOrder([], 100)).toEqual([]);
  });

  it("writes the order the way a vendor reads it, leaving out a state that rounded to nothing", () => {
    const buy = [
      { code: "TX", name: "Texas", last90: 29, share: 0.41, ownShare: true, weight: 11.9, leads: 24 },
      { code: "OH", name: "Ohio", last90: 21, share: 0.39, ownShare: true, weight: 8.2, leads: 1_016 },
      { code: "GA", name: "Georgia", last90: 1, share: 0.4, ownShare: false, weight: 0.4, leads: 0 },
    ];
    expect(orderText(buy)).toBe("TX 24, OH 1,016");
  });

  it("takes an order size from what was typed: whole leads, at least 1, at most the cap", () => {
    expect(parseOrderSize("250")).toBe(250);
    expect(parseOrderSize("1,000")).toBe(1000);
    expect(parseOrderSize(12.7)).toBe(12);
    expect(parseOrderSize("0")).toBe(DEFAULT_ORDER_SIZE);
    expect(parseOrderSize("abc")).toBe(DEFAULT_ORDER_SIZE);
    expect(parseOrderSize(10 ** 9)).toBe(MAX_ORDER_SIZE);
  });
});

describe("the recommendation", () => {
  // A small agency: 3 strong states, a thin one, a state that stopped, one that does not stick, one never sold.
  const summary = [
    srow("TX", { policies: 120, active: 30, lapsing: 10, gone: 10, last_90_days: 30, prior_90_days: 40 }), // 60% of 50
    srow("OH", { policies: 100, active: 20, lapsing: 10, gone: 10, last_90_days: 20, prior_90_days: 30 }), // 50% of 40
    srow("MO", { policies: 60, active: 12, lapsing: 4, gone: 4, last_90_days: 10, prior_90_days: 9 }), // 60% of 20
    srow("AZ", { policies: 8, active: 0, gone: 2, last_90_days: 5, prior_90_days: 0 }), // 2 decided: too thin, uses the agency's
    srow("KY", { policies: 14, active: 3, lapsing: 3, gone: 3, last_90_days: 0, prior_90_days: 6 }), // nothing lately
    srow("SC", { policies: 61, active: 4, lapsing: 9, gone: 5, last_90_days: 2, prior_90_days: 17 }), // 4 of 18 still active
    srow("DE", { policies: 1, last_90_days: 0, prior_90_days: 0 }), // only an old deal
    srow(null, { policies: 237, active: 34, lapsing: 1, last_90_days: 138, prior_90_days: 93, no_client: 133 }),
  ];
  const yieldRows = [
    yrow("TX", { leads_bought: 11164, never_called: 8253, leads_dialed: 5949, dialed_sales: 48 }),
    yrow("OH", { leads_bought: 5052, never_called: 3641, leads_dialed: 3741, dialed_sales: 50 }),
    yrow("MO", { leads_bought: 3271, leads_dialed: 857, dialed_sales: 19 }),
    yrow("NH", { leads_bought: 533, leads_dialed: 90, dialed_sales: 0 }),
    yrow("RI", { leads_bought: 326, leads_dialed: 0, dialed_sales: 0 }),
  ];
  const rows = buildStateRows(summary, yieldRows);
  const rec = recommend(rows, 100);

  it("buys by deals in the last 90 days x the share still active, and the split adds up to the order", () => {
    expect(rec.buy.map((b) => b.code)).toEqual(["TX", "OH", "MO"]);
    expect(rec.buy[0]).toMatchObject({ code: "TX", last90: 30, ownShare: true });
    expect(rec.buy[0].share).toBeCloseTo(0.6);
    expect(rec.buy[0].weight).toBeCloseTo(18);
    expect(rec.buy.reduce((a, b) => a + b.leads, 0)).toBe(100);
    // 18 : 10 : 6 of 34 -> 52.9, 29.4, 17.6 -> 53, 29, 18.
    expect(rec.buy.map((b) => b.leads)).toEqual([53, 29, 18]);
    expect(orderText(rec.buy)).toBe("TX 53, OH 29, MO 18");
  });

  it("uses the agency's share still active for a state with too few outcomes", () => {
    const az = recommend(rows, 100);
    const agency = agencyActiveShare(rows) as number;
    // Agency: 103 active of 174 decided, every row including the not-known one.
    expect(agency).toBeCloseTo(103 / 174);
    // AZ is held below the 80% cut here, but its weight was computed with the agency's share.
    expect(az.hold.find((h) => h.code === "AZ")?.reason).toBe("Fewer recent deals than the states to buy");
    const all = recommend(buildStateRows(summary.filter((s) => s.state !== "TX" && s.state !== "OH")), 100);
    const azPick = all.buy.find((b) => b.code === "AZ");
    expect(azPick).toMatchObject({ ownShare: false });
    expect(azPick?.share).toBeCloseTo(agencyActiveShare(buildStateRows(summary.filter((s) => s.state !== "TX" && s.state !== "OH"))) as number);
  });

  it(`avoids a state with no deal in 180 days or under ${AVOID_ACTIVE_SHARE * 100}% still active, and says why`, () => {
    expect(rec.avoid).toEqual(expect.arrayContaining([
      { code: "SC", name: "South Carolina", reason: "Only 22% still active (4 of 18)" },
      { code: "DE", name: "Delaware", reason: "No deals in 180 days" },
      { code: "NH", name: "New Hampshire", reason: "No deals from 90 leads dialed" },
    ]));
  });

  it("holds a state with nothing lately, and a bought list nobody has called yet", () => {
    expect(rec.hold).toEqual(expect.arrayContaining([
      { code: "KY", name: "Kentucky", reason: "No deals in the last 90 days" },
      { code: "RI", name: "Rhode Island", reason: "Not tested: none of its 326 leads called yet" },
    ]));
  });

  it("never puts the not-known row in any list, and no state in two lists", () => {
    const codes = [...rec.buy.map((b) => b.code), ...rec.hold.map((h) => h.code), ...rec.avoid.map((a) => a.code)];
    expect(codes).not.toContain(null);
    expect(new Set(codes).size).toBe(codes.length);
    // Every state with policies or leads is in exactly one list.
    expect(new Set(codes)).toEqual(new Set(rows.filter((r) => r.code).map((r) => r.code)));
  });

  it("explains the split in one line, worked for the first state", () => {
    expect(splitMath(rec)).toBe("TX: 30 deals × 60% = 18.0 of 34.0 → 53 of 100");
  });

  it(`buys at least ${BUY_MIN} states when there are that many, and never more than ${BUY_MAX}`, () => {
    const many = buildStateRows(["TX", "OH", "MO", "CA", "TN", "AZ", "WI", "GA", "MI", "FL"].map((s) => srow(s, { policies: 20, active: 10, gone: 5, last_90_days: 10 })));
    const r = recommend(many, 100);
    expect(r.buy).toHaveLength(BUY_MAX);
    expect(r.hold.filter((h) => h.reason === "Fewer recent deals than the states to buy")).toHaveLength(2);
    const lopsided = buildStateRows([srow("TX", { policies: 200, active: 50, gone: 10, last_90_days: 100 }), srow("OH", { policies: 3, last_90_days: 1 }), srow("MO", { policies: 3, last_90_days: 1 })]);
    // TX alone covers 80%, but the floor keeps three; OH and MO tie, so the code breaks it.
    expect(recommend(lopsided, 100).buy.map((b) => b.code)).toEqual(["TX", "MO", "OH"]);
  });

  it("holds a state whose sales per lead are under half the average, once enough leads were dialed", () => {
    const weak = buildStateRows(
      [srow("TX", { policies: 50, last_90_days: 10 }), srow("FL", { policies: 45, last_90_days: 11 }), srow("OH", { policies: 40, last_90_days: 9 })],
      [yrow("TX", { leads_dialed: 2000, dialed_sales: 30 }), yrow("FL", { leads_dialed: 1779, dialed_sales: 7 }), yrow("OH", { leads_dialed: 1500, dialed_sales: 20 })],
    );
    const r = recommend(weak, 100);
    expect(averagePer100(weak)).toBeCloseTo((57 / 5279) * 100);
    expect(r.hold).toEqual([{ code: "FL", name: "Florida", reason: "0.4 sales per 100 leads dialed, under half the 1.1 average" }]);
    expect(r.buy.map((b) => b.code)).toEqual(["TX", "OH"]);
  });

  it("holds a state no active agent is known to write in, but only when licensing is known somewhere", () => {
    const lic = buildStateRows([srow("TX", { last_90_days: 10, active_writers: 3 }), srow("MA", { last_90_days: 10, active_writers: 0, licensed_agents: 0 })]);
    expect(recommend(lic, 100).hold).toEqual([{ code: "MA", name: "Massachusetts", reason: "No active agent known to be licensed here" }]);
    const none = buildStateRows([srow("TX", { last_90_days: 10, active_writers: 0 }), srow("MA", { last_90_days: 10, active_writers: 0 })]);
    const r = recommend(none, 100);
    expect(r.licensingApplied).toBe(false);
    expect(r.buy.map((b) => b.code).sort()).toEqual(["MA", "TX"]);
  });

  it("buys nothing when no state has a deal in the last 90 days", () => {
    const quiet = recommend(buildStateRows([srow("TX", { last_90_days: 0, prior_90_days: 4 })]), 100);
    expect(quiet.buy).toEqual([]);
    expect(splitMath(quiet)).toBeNull();
    expect(orderText(quiet.buy)).toBe("");
  });

  it(`keeps a state's own share once it has ${MIN_DECIDED_FOR_OWN_SHARE} outcomes`, () => {
    const exact = buildStateRows([srow("TX", { policies: 12, active: 5, gone: 5, last_90_days: 4 }), srow("OH", { policies: 12, active: 9, gone: 0, last_90_days: 4 })]);
    const r = recommend(exact, 10);
    expect(r.buy.find((b) => b.code === "TX")).toMatchObject({ ownShare: true, share: 0.5 });
    expect(r.buy.find((b) => b.code === "OH")?.ownShare).toBe(false);
  });
});

describe("cost per sale and the area code check", () => {
  it("costs a sale at the typed price, if every lead bought gets dialed", () => {
    expect(costPerSale(0.5, { bought: 0, neverCalled: 0, dialed: 1000, sales: 10, per100: 1 })).toBe(50);
    expect(costPerSale(null, { bought: 0, neverCalled: 0, dialed: 1000, sales: 10, per100: 1 })).toBeNull();
    expect(costPerSale(0.5, { bought: 0, neverCalled: 0, dialed: 1000, sales: 0, per100: 0 })).toBeNull();
    expect(costPerSale(0.5, null)).toBeNull();
  });

  it("reads a typed price", () => {
    expect(parsePrice("$0.35")).toBe(0.35);
    expect(parsePrice(" 1,200 ")).toBe(1200);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("0")).toBeNull();
    expect(parsePrice("-2")).toBeNull();
    expect(parsePrice("ten")).toBeNull();
  });

  it("adds up how often the area code names the list's state", () => {
    expect(areaCodeAccuracy([yrow("TX", { area_checked: 100, area_matched: 90 }), yrow("OH", { area_checked: 50, area_matched: 40 })])).toEqual({ matched: 130, checked: 150 });
    expect(areaCodeAccuracy([])).toBeNull();
    expect(areaCodeAccuracy(null)).toBeNull();
  });
});
