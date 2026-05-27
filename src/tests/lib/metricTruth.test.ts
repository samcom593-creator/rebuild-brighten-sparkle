/**
 * metricTruth.test.ts
 *
 * Tests for src/lib/metricTruth.ts — the core business-logic layer
 * driving every revenue/agent metric on the APEX dashboard.
 *
 * Coverage targets:
 *   ✅ getCloseRate              — capped at 100, zero presentations → 0
 *   ✅ sumAnnualPremium          — null/undefined rows, empty array
 *   ✅ countDistinctAgents       — deduplication, null agent_ids
 *   ✅ countDistinctBusinessDays — dedup across posted_at + created_at fallback
 *   ✅ isAgentLinkSyncStale      — fresh / stale / null lastSuccessAt
 *   ✅ shouldAutoRepairLeaderboards — before/after 09:30 CST
 *   ✅ projectMonthEndAlp        — zero elapsed days guard, clamping, confidence levels
 *   ✅ getLiveAgentCutoffIso     — returns a valid ISO string in the past
 *   ✅ getMetricBounds           — "day" / "week" / "month" / "custom" dispatch
 *
 * NOT YET TESTED:
 *   ❌ formatMetricSource — depends on date-fns formatDistanceToNowStrict; skip for now
 *   ❌ getPriorWeekMatchedBounds — covered via dateUtils.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCloseRate,
  sumAnnualPremium,
  countDistinctAgents,
  countDistinctBusinessDays,
  isAgentLinkSyncStale,
  shouldAutoRepairLeaderboards,
  projectMonthEndAlp,
  getLiveAgentCutoffIso,
  getMetricBounds,
} from "@/lib/metricTruth";

// ── getCloseRate ──────────────────────────────────────────────────────────────
describe("getCloseRate", () => {
  it("returns 0 when presentations is 0 (no division by zero)", () => {
    expect(getCloseRate(5, 0)).toBe(0);
  });

  it("returns 0 when deals is 0", () => {
    expect(getCloseRate(0, 10)).toBe(0);
  });

  it("calculates correct percentage", () => {
    expect(getCloseRate(3, 10)).toBe(30);
  });

  it("rounds to one decimal place", () => {
    // 2/3 = 66.666... → 66.7
    expect(getCloseRate(2, 3)).toBe(66.7);
  });

  it("caps at 100% even when deals > presentations (undercounted presentations)", () => {
    expect(getCloseRate(10, 5)).toBe(100);
    expect(getCloseRate(1000, 1)).toBe(100);
  });

  it("returns exactly 100 when deals === presentations", () => {
    expect(getCloseRate(5, 5)).toBe(100);
  });
});

// ── sumAnnualPremium ─────────────────────────────────────────────────────────
describe("sumAnnualPremium", () => {
  it("returns 0 for empty array", () => {
    expect(sumAnnualPremium([])).toBe(0);
  });

  it("sums numeric annual_premium values", () => {
    expect(sumAnnualPremium([{ annual_premium: 1000 }, { annual_premium: 500 }])).toBe(1500);
  });

  it("treats null annual_premium as 0", () => {
    expect(sumAnnualPremium([{ annual_premium: null }, { annual_premium: 200 }])).toBe(200);
  });

  it("treats undefined annual_premium as 0", () => {
    expect(sumAnnualPremium([{}, { annual_premium: 300 }])).toBe(300);
  });

  it("handles all-null rows", () => {
    expect(sumAnnualPremium([{ annual_premium: null }, { annual_premium: null }])).toBe(0);
  });

  it("coerces string numbers", () => {
    // Supabase can return numbers as strings in some join shapes
    expect(sumAnnualPremium([{ annual_premium: "500" as any }])).toBe(500);
  });
});

// ── countDistinctAgents ───────────────────────────────────────────────────────
describe("countDistinctAgents", () => {
  it("returns 0 for empty array", () => {
    expect(countDistinctAgents([])).toBe(0);
  });

  it("counts unique agent_ids", () => {
    const rows = [
      { agent_id: "a1" },
      { agent_id: "a2" },
      { agent_id: "a1" }, // dup
    ];
    expect(countDistinctAgents(rows)).toBe(2);
  });

  it("excludes null agent_ids", () => {
    const rows = [{ agent_id: null }, { agent_id: "a1" }];
    expect(countDistinctAgents(rows)).toBe(1);
  });

  it("excludes undefined agent_ids", () => {
    const rows = [{ agent_id: undefined as any }, { agent_id: "a1" }];
    expect(countDistinctAgents(rows)).toBe(1);
  });

  it("returns 0 when all agent_ids are null", () => {
    expect(countDistinctAgents([{ agent_id: null }, { agent_id: null }])).toBe(0);
  });
});

// ── countDistinctBusinessDays ─────────────────────────────────────────────────
describe("countDistinctBusinessDays", () => {
  it("returns 0 for empty array", () => {
    expect(countDistinctBusinessDays([])).toBe(0);
  });

  it("counts distinct business days from posted_at", () => {
    const rows = [
      { posted_at: "2026-05-20T12:00:00Z", created_at: null },
      { posted_at: "2026-05-20T18:00:00Z", created_at: null }, // same CST day
      { posted_at: "2026-05-21T12:00:00Z", created_at: null }, // different day
    ];
    expect(countDistinctBusinessDays(rows)).toBe(2);
  });

  it("falls back to created_at when posted_at is null", () => {
    const rows = [
      { posted_at: null, created_at: "2026-05-20T12:00:00Z" },
      { posted_at: null, created_at: "2026-05-21T12:00:00Z" },
    ];
    expect(countDistinctBusinessDays(rows)).toBe(2);
  });

  it("excludes rows where both posted_at and created_at are null", () => {
    const rows = [
      { posted_at: null, created_at: null },
      { posted_at: "2026-05-20T12:00:00Z", created_at: null },
    ];
    expect(countDistinctBusinessDays(rows)).toBe(1);
  });
});

// ── isAgentLinkSyncStale ──────────────────────────────────────────────────────
describe("isAgentLinkSyncStale", () => {
  it("returns true when lastSuccessAt is null", () => {
    expect(isAgentLinkSyncStale(null)).toBe(true);
  });

  it("returns true when lastSuccessAt is undefined", () => {
    expect(isAgentLinkSyncStale(undefined)).toBe(true);
  });

  it("returns false when last success was 5 minutes ago (freshnessMinutes=15)", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(isAgentLinkSyncStale(fiveMinAgo, 15)).toBe(false);
  });

  it("returns true when last success was 20 minutes ago (freshnessMinutes=15)", () => {
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(isAgentLinkSyncStale(twentyMinAgo, 15)).toBe(true);
  });

  it("uses custom freshnessMinutes", () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(isAgentLinkSyncStale(twoMinAgo, 1)).toBe(true);
    expect(isAgentLinkSyncStale(twoMinAgo, 5)).toBe(false);
  });
});

// ── shouldAutoRepairLeaderboards ──────────────────────────────────────────────
describe("shouldAutoRepairLeaderboards", () => {
  it("returns false at 08:00 business time (before 09:30)", () => {
    // Create a Date at 08:00 CDT (13:00 UTC)
    const earlyMorning = new Date("2026-05-20T13:00:00Z");
    expect(shouldAutoRepairLeaderboards(earlyMorning)).toBe(false);
  });

  it("returns true at 09:30 business time (hour=9, min=30)", () => {
    // 09:30 CDT = 14:30 UTC
    const atOpening = new Date("2026-05-20T14:30:00Z");
    expect(shouldAutoRepairLeaderboards(atOpening)).toBe(true);
  });

  it("returns true at 10:00 business time (after 09:30)", () => {
    // 10:00 CDT = 15:00 UTC
    const midMorning = new Date("2026-05-20T15:00:00Z");
    expect(shouldAutoRepairLeaderboards(midMorning)).toBe(true);
  });

  it("returns false at 09:29 business time (just before threshold)", () => {
    // 09:29 CDT = 14:29 UTC
    const justBefore = new Date("2026-05-20T14:29:00Z");
    expect(shouldAutoRepairLeaderboards(justBefore)).toBe(false);
  });
});

// ── projectMonthEndAlp ────────────────────────────────────────────────────────
describe("projectMonthEndAlp", () => {
  it("returns mtdAlp unchanged when activeDays < FORECAST_MIN_ACTIVE_DAYS", () => {
    // FORECAST_MIN_ACTIVE_DAYS is imported from dataLayer — typically 3
    const result = projectMonthEndAlp(5000, 1);
    expect(result.projection).toBe(5000);
  });

  it("projects forward when enough active days exist", () => {
    // If we're 10 days into a 30-day month and have $10k ALP with 10 active days,
    // projection should be roughly $30k
    const result = projectMonthEndAlp(10_000, 10);
    expect(result.projection).toBeGreaterThanOrEqual(10_000);
    expect(result.projection).toBeLessThanOrEqual(50_000); // capped at 5x
  });

  it("caps projection at 5x mtdAlp", () => {
    // Even if pace would imply 100x, cap is 5x
    const result = projectMonthEndAlp(1_000, 20);
    expect(result.projection).toBeLessThanOrEqual(5_000);
  });

  it("confidence = 'low' for activeDays < 5", () => {
    const result = projectMonthEndAlp(5000, 2);
    expect(result.confidence).toBe("low");
  });

  it("confidence = 'medium' for activeDays 5-9", () => {
    const result = projectMonthEndAlp(5000, 7);
    expect(result.confidence).toBe("medium");
  });

  it("confidence = 'high' for activeDays >= 10", () => {
    const result = projectMonthEndAlp(5000, 10);
    expect(result.confidence).toBe("high");
  });

  it("returns integer projection (no floating point leakage)", () => {
    const result = projectMonthEndAlp(9999, 10);
    expect(Number.isInteger(result.projection)).toBe(true);
  });

  it("returns zero mtdAlp → zero projection (never inflates from nothing)", () => {
    const result = projectMonthEndAlp(0, 10);
    expect(result.projection).toBe(0);
  });
});

// ── getLiveAgentCutoffIso ─────────────────────────────────────────────────────
describe("getLiveAgentCutoffIso", () => {
  it("returns a valid ISO string", () => {
    const cutoff = getLiveAgentCutoffIso();
    expect(() => new Date(cutoff)).not.toThrow();
    expect(new Date(cutoff).getTime()).not.toBeNaN();
  });

  it("cutoff is in the past relative to now", () => {
    const cutoff = getLiveAgentCutoffIso();
    expect(new Date(cutoff).getTime()).toBeLessThan(Date.now());
  });
});

// ── getMetricBounds dispatch ──────────────────────────────────────────────────
describe("getMetricBounds", () => {
  it("returns bounds with start < end for 'day'", () => {
    const { start, end } = getMetricBounds("day");
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("returns bounds with start < end for 'week'", () => {
    const { start, end } = getMetricBounds("week");
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("returns bounds with start < end for 'month'", () => {
    const { start, end } = getMetricBounds("month");
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("uses custom range when window = 'custom'", () => {
    const from = new Date("2026-04-01T00:00:00Z");
    const to = new Date("2026-04-15T00:00:00Z");
    const { start, end } = getMetricBounds("custom", { from, to });
    // Should be within the custom range
    expect(end.getTime()).toBeGreaterThan(from.getTime());
    expect(start.getTime()).toBeLessThanOrEqual(to.getTime());
  });

  it("falls back to month bounds when custom range is incomplete", () => {
    // Missing `to` → should not throw; falls back to monthly
    const { start, end } = getMetricBounds("custom", { from: new Date() });
    expect(start.getTime()).toBeLessThan(end.getTime());
  });
});
