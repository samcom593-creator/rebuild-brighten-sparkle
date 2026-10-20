import { describe, expect, it } from "vitest";
import {
  agentRows, carrierChecks, groupByCarrier, inPeriod, periodBounds, phoenixDay, policyPrefix, reconcile, totals, type AyroDeal,
} from "@/lib/ayroBook";

let n = 0;
const deal = (over: Partial<AyroDeal>): AyroDeal => ({
  id: `d${++n}`,
  policy_number: null,
  carrier: "Ethos",
  carrier_entered: null,
  agent_name: "Dom Yous",
  apex_agent_id: null,
  apex_agent_name: null,
  on_apex_team: false,
  counts_in_production: false,
  annual_premium: 1000,
  monthly_premium: 83.33,
  face_amount: null,
  product: null,
  status: "active",
  ayro_status: "Sold / Approved",
  submitted_at: "2026-10-19T21:59:02.275Z",
  posted_date: "2026-10-19",
  first_seen_at: null,
  ...over,
});

describe("Ayro book grouping (arranged by carrier)", () => {
  it("orders carriers by premium, biggest first, with 'Carrier not given' last", () => {
    const groups = groupByCarrier([
      deal({ carrier: "Aetna", annual_premium: 500 }),
      deal({ carrier: "Carrier not given", annual_premium: 9000 }),
      deal({ carrier: "Ethos", annual_premium: 3000 }),
      deal({ carrier: "Ethos", annual_premium: 100 }),
    ]);
    expect(groups.map((g) => g.carrier)).toEqual(["Ethos", "Aetna", "Carrier not given"]);
    expect(groups[0].policies).toBe(2);
    expect(groups[0].premium).toBe(3100);
    expect(groups.reduce((s, g) => s + g.share, 0)).toBeCloseTo(1, 6);
  });

  it("sorts a carrier's policies newest first by default and by premium on request", () => {
    const older = deal({ submitted_at: "2026-09-25T18:00:00Z", annual_premium: 5000 });
    const newer = deal({ submitted_at: "2026-10-19T18:00:00Z", annual_premium: 900 });
    expect(groupByCarrier([older, newer])[0].deals.map((d) => d.id)).toEqual([newer.id, older.id]);
    expect(groupByCarrier([newer, older], "premium")[0].deals.map((d) => d.id)).toEqual([older.id, newer.id]);
  });

  it("totals and agent rows add up to the same book", () => {
    const deals = [
      deal({ agent_name: "Nels r", carrier: "Ethos", annual_premium: 1236 }),
      deal({ agent_name: "Nels r", carrier: "Transamerica", annual_premium: 1715 }),
      deal({ agent_name: "Tyler Krejcha", carrier: "Chubb", annual_premium: 3169, counts_in_production: true }),
    ];
    const t = totals(deals);
    expect(t).toMatchObject({ policies: 3, premium: 6120, counted: 3169, agents: 2, carriers: 3 });
    const rows = agentRows(deals);
    expect(rows[0]).toMatchObject({ agent: "Tyler Krejcha", policies: 1, premium: 3169, counts: true });
    expect(rows[1].carriers.map((c) => c.carrier).sort()).toEqual(["Ethos", "Transamerica"]);
    expect(rows.reduce((s, r) => s + r.premium, 0)).toBe(t.premium);
  });
});

describe("Ayro book periods are Phoenix days", () => {
  it("dates a late-evening Phoenix deal on its Phoenix day, not the UTC day", () => {
    // 2026-10-20 03:30 UTC is 2026-10-19 20:30 in Phoenix.
    expect(phoenixDay("2026-10-20T03:30:00Z")).toBe("2026-10-19");
  });

  it("builds this month, last month and a Monday-start week", () => {
    const now = new Date("2026-10-20T19:00:00Z"); // Tuesday Oct 20 in Phoenix
    expect(periodBounds("this_month", now)).toEqual(["2026-10-01", "2026-10-20"]);
    expect(periodBounds("last_month", now)).toEqual(["2026-09-01", "2026-09-30"]);
    expect(periodBounds("this_week", now)).toEqual(["2026-10-19", "2026-10-20"]);
    expect(periodBounds("all", now)).toBeNull();
    expect(inPeriod(deal({ submitted_at: "2026-09-25T18:00:00Z" }), "last_month", now)).toBe(true);
    expect(inPeriod(deal({ submitted_at: "2026-09-25T18:00:00Z" }), "this_month", now)).toBe(false);
  });
});

describe("carrier checks come from the book itself", () => {
  it("flags a row whose policy # prefix belongs to 3+ policies of one other carrier", () => {
    const ethos = [1, 2, 3].map((i) => deal({ policy_number: `TA100000000${i}`, carrier: "Ethos" }));
    const odd = deal({ policy_number: "TA4031411107", carrier: "American Amicable" });
    const checks = carrierChecks([...ethos, odd]);
    expect(checks.get(odd.id)).toMatch(/3 Ethos policies/);
    expect(ethos.every((d) => !checks.has(d.id))).toBe(true);
  });

  it("stays quiet when the evidence is thin or split", () => {
    const two = [1, 2].map((i) => deal({ policy_number: `ACC72${i}`, carrier: "Aetna" }));
    const odd = deal({ policy_number: "ACC999", carrier: "Ethos" });
    expect(carrierChecks([...two, odd]).size).toBe(0);
    expect(policyPrefix("7GG80907")).toBe("7GG");
    expect(policyPrefix(null)).toBeNull();
  });
});

describe("reconcile against Ayro's own count", () => {
  const sync = { ok: true, error: null, at: null, updated_at: null, feed_rows: 2, ayro_policies: 2, ayro_premium: 2000, ayro_active_agents: 1 };
  it("matches when counts agree and premium is within Ayro's rounding", () => {
    expect(reconcile([deal({ annual_premium: 1000.4 }), deal({ annual_premium: 1000.4 })], sync)?.matches).toBe(true);
  });
  it("calls out a missing policy", () => {
    const r = reconcile([deal({})], sync);
    expect(r?.matches).toBe(false);
    expect(r?.text).toMatch(/this page has 1/);
  });
  it("says nothing before the first sync", () => {
    expect(reconcile([deal({})], null)).toBeNull();
  });
});
