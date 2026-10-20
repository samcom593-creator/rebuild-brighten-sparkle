import { describe, expect, it } from "vitest";
import {
  agentListText, matchClientList, parseClientList, tidyName,
  agentRows, carrierChecks, groupByCarrier, inPeriod, periodBounds, phoenixDay, policyPrefix, reconcile, totals, type AyroDeal,
} from "@/lib/ayroBook";

let n = 0;
const deal = (over: Partial<AyroDeal>): AyroDeal => ({
  id: `d${++n}`,
  policy_number: null,
  carrier: "Ethos",
  carrier_entered: null,
  agent_name: "Dom Yous",
  client_name: null,
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

describe("the agent list in Sam's format", () => {
  const SAM_PASTE = [
    "Robert burns-1812AP", "Lynn Scott-1367AP", "William Hanily-1313AP", "Norice taylor-1480AP",
    "Tracy Nash-1051AP", "David Pollard-1378AP", "Susan Vincent-1710AP", "Pamela Hoelscher-2235AP", "All Ethos",
  ].join("\n");

  it("reads Sam's pasted list, carrier from the All line, names tidied", () => {
    const { entries, unreadable } = parseClientList(SAM_PASTE);
    expect(unreadable).toEqual([]);
    expect(entries).toHaveLength(8);
    expect(entries[0]).toMatchObject({ name: "Robert Burns", ap: 1812, carrier: "Ethos" });
    expect(entries[3].name).toBe("Norice Taylor");
    expect(entries.every((e) => e.carrier === "Ethos")).toBe(true);
  });

  it("accepts spacing, dollar signs and commas, and reports lines it cannot read", () => {
    const { entries, unreadable } = parseClientList("Mary-Jane O'Neil - $1,206 AP\nJo Lee 980\nhello there\nAll trans");
    expect(entries.map((e) => [e.name, e.ap, e.carrier])).toEqual([["Mary-Jane O'Neil", 1206, "trans"], ["Jo Lee", 980, "trans"]]);
    expect(unreadable).toEqual(["hello there"]);
    expect(tidyName("  pamela   hoelscher ")).toBe("Pamela Hoelscher");
    expect(tidyName("McDonald")).toBe("McDonald");
  });

  it("matches each line to one policy by premium and carrier", () => {
    const deals = [
      deal({ id: "a", agent_name: "Michael Kayembe", carrier: "Ethos", annual_premium: 1812 }),
      deal({ id: "b", agent_name: "Michael Kayembe", carrier: "Ethos", annual_premium: 1378 }),
      deal({ id: "c", agent_name: "Michael Kayembe", carrier: "Aetna", annual_premium: 1378 }),
    ];
    const r = matchClientList(parseClientList("Robert burns-1812AP\nDavid Pollard-1378AP\nAll Ethos").entries, deals);
    expect(r.matched.map((m) => [m.entry.name, m.deal.id])).toEqual([["Robert Burns", "a"], ["David Pollard", "b"]]);
    expect(r.ambiguous).toEqual([]);
    expect(r.unmatched).toEqual([]);
  });

  it("never guesses between two policies with the same premium", () => {
    const deals = [deal({ id: "x", carrier: "Chubb", annual_premium: 3169 }), deal({ id: "y", carrier: "Chubb", annual_premium: 3169 })];
    const r = matchClientList(parseClientList("Ann Ray-3169AP\nBo Ray-3169AP").entries, deals);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toHaveLength(2);
    expect(matchClientList(parseClientList("Zed-4000AP").entries, deals).unmatched).toHaveLength(1);
  });

  it("a unique match frees the next line: two policies, one claimed, the other line resolves", () => {
    const deals = [deal({ id: "e", carrier: "Ethos", annual_premium: 1500 }), deal({ id: "t", carrier: "Transamerica", annual_premium: 1500 })];
    const r = matchClientList(parseClientList("Al One-1500AP\nAll Ethos\nBo Two-1500AP").entries, deals);
    expect(r.matched.map((m) => [m.entry.name, m.deal.id])).toEqual([["Al One", "e"], ["Bo Two", "t"]]);
  });

  it("writes the list back out with both policy # and name, one block per carrier", () => {
    const text = agentListText([
      deal({ client_name: "Robert Burns", policy_number: "TA2377165821", annual_premium: 1812, carrier: "Ethos", submitted_at: "2026-10-02T20:53:26Z" }),
      deal({ client_name: null, policy_number: "TA2893772642", annual_premium: 2594, carrier: "Ethos", submitted_at: "2026-10-16T23:30:00Z" }),
      deal({ client_name: "Jo Lee", policy_number: "GA222", annual_premium: 980.4, carrier: "Aetna", submitted_at: "2026-10-01T20:00:00Z" }),
    ]);
    expect(text).toBe("TA2893772642-2594AP\nRobert Burns \u00b7 TA2377165821-1812AP\nAll Ethos\n\nJo Lee \u00b7 GA222-980AP\nAll Aetna");
  });

  it("a pasted line that is a policy number already on the book adds no name", () => {
    const deals = [deal({ id: "j", policy_number: "TA1432627407", carrier: "Ethos", annual_premium: 2296 })];
    const r = matchClientList(parseClientList("TA1432627407-2296AP\nAll Ethos").entries, deals);
    expect(r.matched).toEqual([]);
    expect(r.unmatched).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    // a real name at the same premium still lands
    const r2 = matchClientList(parseClientList("Jane Roe-2296AP\nAll Ethos").entries, deals);
    expect(r2.matched.map((m) => m.deal.id)).toEqual(["j"]);
  });
});
