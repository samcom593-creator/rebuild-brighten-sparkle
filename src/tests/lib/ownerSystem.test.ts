import { describe, expect, it } from "vitest";
import { emptyDraft, formatCost, groupIntegrations, obligationCount, validateSubscription, type Integration } from "@/lib/ownerSystem";

describe("subscriptions are a manual record", () => {
  it("an unknown cost is 'not recorded', never $0", () => {
    expect(formatCost(null)).toBe("Cost not recorded");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(4900, "USD", "monthly")).toBe("$49.00 a month");
  });
  it("blank cost and dates stay null; nothing is invented", () => {
    const v = validateSubscription({ ...emptyDraft(), service: " Vercel ", status: "needs_review" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.row).toMatchObject({ service: "Vercel", cost_cents: null, renewal_date: null, last_verified: null, billing_frequency: null, source: "entered by hand" });
  });
  it("refuses a bad cost, a bad link, a bad date and a missing source", () => {
    const base = { ...emptyDraft(), service: "X" };
    expect(validateSubscription({ ...base, cost: "abc" }).ok).toBe(false);
    expect(validateSubscription({ ...base, billing_url: "http://insecure" }).ok).toBe(false);
    expect(validateSubscription({ ...base, renewal_date: "next month" }).ok).toBe(false);
    expect(validateSubscription({ ...base, source: " " }).ok).toBe(false);
    expect(validateSubscription({ ...base, service: "" }).ok).toBe(false);
    const ok = validateSubscription({ ...base, cost: "$1,089.85" });
    expect(ok.ok && ok.row.cost_cents).toBe(108985);
  });
});

describe("integrations", () => {
  const item = (group: string, service: string, health: string): Integration => ({ group, service, health, last_success: null, detail: "", affects: null, recovery: null });
  it("what is not working comes first, inside a group and across groups", () => {
    const g = groupIntegrations([item("Money", "Stripe", "idle"), item("Calling", "ReadyMode", "failing"), item("Social", "yt", "ok"), item("Social", "postiz", "not_connected")]);
    expect(g.map((x) => x.group)).toEqual(["Calling", "Social", "Money"]);
    expect(g[1].items.map((i) => i.service)).toEqual(["postiz", "yt"]);
  });
  it("review backlog counts once, however many records", () => {
    expect(obligationCount({ failed_jobs_24h: [], critical_alerts_24h: [], open_blockers: [{ title: "a", fix: null }], renewals_30d: [], subscriptions_to_review: 4 })).toBe(2);
  });
});
