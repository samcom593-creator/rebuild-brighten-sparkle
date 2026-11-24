import { describe, expect, it } from "vitest";
import { clientCallsSchema, producerMilestones, producerPace, producerWorkspaceSchema, productionStreak, type ProducerDay } from "@/lib/producerWorkspace";
import { producerWorkspaceFixture } from "@/tests/helpers/producerWorkspaceFixture";

describe("personal production pace", () => {
  it("uses personal posted AP and measured samples to round up the remaining work", () => {
    const result = producerPace(producerWorkspaceFixture());
    expect(result).toMatchObject({ remaining: 15000, completionPct: 25, averagePolicy: 1500, dealsRemaining: 10, callsRemaining: 100, callsPerSellingDay: 20, apPerSellingDay: 3000, status: "Behind pace" });
    expect(result.targetToday).toBeCloseTo(20000 * 17 / 21);
  });

  it("never guesses a conversion rate or average policy when personal evidence is insufficient", () => {
    const d = producerWorkspaceFixture();
    d.activity.sample_calls = 29;
    expect(producerPace(d).callsRemaining).toBeNull();
    d.activity.sample_calls = 60; d.activity.sample_sold_calls = 2;
    expect(producerPace(d).callsPerSellingDay).toBeNull();
    d.activity.sample_sold_calls = 6; d.activity.sample_policies = 2;
    expect(producerPace(d).dealsRemaining).toBeNull();
    d.activity.sample_policies = 6; d.activity.avg_policy_ap = 0;
    expect(producerPace(d).dealsRemaining).toBeNull();
  });

  it("rounds fractional policies and calls up without adding posted production", () => {
    const d = producerWorkspaceFixture();
    d.production_ap = 19000; d.activity.avg_policy_ap = 600;
    d.activity.sample_calls = 31; d.activity.sample_sold_calls = 3;
    expect(producerPace(d)).toMatchObject({ dealsRemaining: 2, callsRemaining: 21, callsPerSellingDay: 5, completionPct: 95 });
    expect(d.production_ap).toBe(19000);
  });

  it("handles completed goals and no remaining selling days without infinity or invented work", () => {
    const d = producerWorkspaceFixture();
    d.production_ap = 25000; d.activity.sample_calls = 0; d.activity.sample_sold_calls = 0;
    expect(producerPace(d)).toMatchObject({ remaining: 0, dealsRemaining: 0, callsRemaining: 0, completionPct: 100, status: "Goal hit" });
    d.production_ap = 5000; d.selling_days_remaining = 0;
    expect(producerPace(d).apPerSellingDay).toBeNull();
    expect(producerPace(d).callsPerSellingDay).toBeNull();
    d.selling_days_elapsed = 0; d.selling_days_total = 0;
    expect(producerPace(d).status).toBe("Ready to start");
  });

  it("scales milestones with a higher assigned personal goal", () => {
    expect(producerMilestones(15000, 40000)).toEqual([
      { amount: 10000, achieved: true }, { amount: 20000, achieved: false },
      { amount: 30000, achieved: false }, { amount: 40000, achieved: false },
    ]);
  });
});

describe("scheduled-day production streak", () => {
  it("holds through rest days and leaves today open without falsely awarding it", () => {
    const d = producerWorkspaceFixture();
    expect(productionStreak(d.days, d.today)).toEqual({ current: 2, best: 2, todayScheduled: true, todayEarned: false });
    expect(productionStreak(d.days, "2026-11-22")).toEqual({ current: 1, best: 1, todayScheduled: false, todayEarned: false });
  });

  it("breaks on a completed missed selling day even if the current schedule later changes", () => {
    const d = producerWorkspaceFixture();
    d.days[3].production_ap = 0; d.days[3].deals = 0;
    d.schedule = [2, 3, 4]; // Current preferences cannot rewrite the historical scheduled flag.
    expect(productionStreak(d.days, d.today)).toMatchObject({ current: 0, best: 1 });
  });

  it("requires a positive posted policy and never counts multiple sales as multiple days", () => {
    const days: ProducerDay[] = [
      { day: "2026-11-20", scheduled: true, production_ap: 0, deals: 12 },
      { day: "2026-11-21", scheduled: false, production_ap: 5000, deals: 3 },
      { day: "2026-11-23", scheduled: true, production_ap: 3000, deals: 3 },
      { day: "2026-11-24", scheduled: true, production_ap: 2000, deals: 2 },
      { day: "2026-11-25", scheduled: true, production_ap: 9000, deals: 4 },
    ];
    expect(productionStreak(days, "2026-11-24")).toEqual({ current: 2, best: 2, todayScheduled: true, todayEarned: true });
    expect(productionStreak([], "2026-11-24").current).toBe(0);
  });
});

describe("producer source boundary", () => {
  it("keeps absent carrier/payment evidence null and rejects invalid metrics", () => {
    const d = producerWorkspaceFixture();
    expect(producerWorkspaceSchema.parse(d).carrier.paid_ap).toBeNull();
    d.activity.sample_sold_calls = 61;
    expect(producerWorkspaceSchema.safeParse(d).success).toBe(false);
    d.activity.sample_sold_calls = 6; d.production_ap = NaN;
    expect(producerWorkspaceSchema.safeParse(d).success).toBe(false);
  });

  it("rejects malformed call dates before they reach rendering", () => {
    expect(clientCallsSchema.safeParse({ client_id: "client-a", raw_provider_access: false, ambiguous_phone: false, next_cursor: null, calls: [{ key: "manual:a", source_id: "a", source: "manual", happened_at: "bad-date", category: "discovery", outcome: null, duration_seconds: null, transcript: "A saved transcript", audio_url: null, transcript_access: "available" }] }).success).toBe(false);
  });
});
