/**
 * dataLayer.test.ts
 *
 * Tests for src/lib/dataLayer.ts — forecast helpers and earnings guard.
 * Every dashboard widget that projects month-end ALP uses these functions.
 * Wrong outputs = wrong numbers shown to agents.
 *
 * Coverage targets:
 *   ✅ forecastConfidence — all three tiers + boundary values
 *   ✅ capProjection — sparse-data guard, ceiling clamp, negative clamp, within-bounds passthrough
 *   ✅ isEarningsUnavailable — zero count, zero total, both nonzero
 *   ✅ Constants: FORECAST_MIN_ACTIVE_DAYS, FORECAST_MAX_MULTIPLIER, VALID_DEAL_STATUSES
 *   ✅ SAM_AGENT_IDS — both legacy and canonical IDs present
 */

import { describe, it, expect } from "vitest";
import {
  forecastConfidence,
  capProjection,
  isEarningsUnavailable,
  FORECAST_MIN_ACTIVE_DAYS,
  FORECAST_MAX_MULTIPLIER,
  FORECAST_CONFIDENCE_BANDS,
  VALID_DEAL_STATUSES,
  SAM_AGENT_ID_LEGACY,
  SAM_AGENT_ID_CANONICAL,
  SAM_AGENT_IDS,
  ALP_LABEL,
  FORBIDDEN_FOR_ALP,
} from "@/lib/dataLayer";

// ── forecastConfidence ───────────────────────────────────────────────────────

describe("forecastConfidence", () => {
  it("returns 'low' for 0 active days", () => {
    expect(forecastConfidence(0)).toBe("low");
  });

  it("returns 'low' just below medium threshold", () => {
    expect(forecastConfidence(FORECAST_CONFIDENCE_BANDS.medium - 1)).toBe("low");
  });

  it("returns 'medium' at the medium threshold", () => {
    expect(forecastConfidence(FORECAST_CONFIDENCE_BANDS.medium)).toBe("medium");
  });

  it("returns 'medium' between medium and high thresholds", () => {
    const mid = Math.floor((FORECAST_CONFIDENCE_BANDS.medium + FORECAST_CONFIDENCE_BANDS.high) / 2);
    expect(forecastConfidence(mid)).toBe("medium");
  });

  it("returns 'high' at the high threshold", () => {
    expect(forecastConfidence(FORECAST_CONFIDENCE_BANDS.high)).toBe("high");
  });

  it("returns 'high' well above the high threshold", () => {
    expect(forecastConfidence(100)).toBe("high");
  });

  it("high threshold is greater than medium threshold", () => {
    expect(FORECAST_CONFIDENCE_BANDS.high).toBeGreaterThan(FORECAST_CONFIDENCE_BANDS.medium);
  });
});

// ── capProjection ────────────────────────────────────────────────────────────

describe("capProjection", () => {
  it("returns mtd when activeDays < FORECAST_MIN_ACTIVE_DAYS (not enough data)", () => {
    const mtd = 12_000;
    expect(capProjection(50_000, mtd, FORECAST_MIN_ACTIVE_DAYS - 1)).toBe(mtd);
  });

  it("returns mtd when activeDays is exactly FORECAST_MIN_ACTIVE_DAYS - 1", () => {
    const mtd = 5_000;
    expect(capProjection(99_999, mtd, 0)).toBe(mtd);
  });

  it("allows projection at exactly FORECAST_MIN_ACTIVE_DAYS", () => {
    const mtd = 10_000;
    const raw = 15_000;
    const result = capProjection(raw, mtd, FORECAST_MIN_ACTIVE_DAYS);
    expect(result).toBe(raw); // 15k < 10k * 5 = 50k, passes through
  });

  it("caps projection at mtd * FORECAST_MAX_MULTIPLIER", () => {
    const mtd = 10_000;
    const cap = mtd * FORECAST_MAX_MULTIPLIER;
    expect(capProjection(999_999, mtd, 20)).toBe(cap);
  });

  it("never returns a negative value when rawProjection is negative", () => {
    expect(capProjection(-5_000, 10_000, 10)).toBe(0);
  });

  it("returns rawProjection when it falls within bounds", () => {
    const mtd = 10_000;
    const raw = 12_500;
    expect(capProjection(raw, mtd, 15)).toBe(raw);
  });

  it("FORECAST_MAX_MULTIPLIER is at least 2 (sanity guard against off-by-one reset)", () => {
    expect(FORECAST_MAX_MULTIPLIER).toBeGreaterThanOrEqual(2);
  });

  it("handles mtd of 0 — projection capped at 0", () => {
    expect(capProjection(50_000, 0, 10)).toBe(0);
  });
});

// ── isEarningsUnavailable ────────────────────────────────────────────────────

describe("isEarningsUnavailable", () => {
  it("returns true when commissionRowCount is 0", () => {
    expect(isEarningsUnavailable(0, 5_000)).toBe(true);
  });

  it("returns true when total is 0", () => {
    expect(isEarningsUnavailable(5, 0)).toBe(true);
  });

  it("returns true when both are 0", () => {
    expect(isEarningsUnavailable(0, 0)).toBe(true);
  });

  it("returns false when both commissionRowCount and total are nonzero", () => {
    expect(isEarningsUnavailable(3, 4_500)).toBe(false);
  });

  it("returns false for large values", () => {
    expect(isEarningsUnavailable(100, 120_000)).toBe(false);
  });
});

// ── Constants invariants ─────────────────────────────────────────────────────

describe("VALID_DEAL_STATUSES", () => {
  it("includes 'submitted'", () => {
    expect(VALID_DEAL_STATUSES).toContain("submitted");
  });

  it("includes 'active'", () => {
    expect(VALID_DEAL_STATUSES).toContain("active");
  });
});

describe("SAM_AGENT_IDS", () => {
  it("contains the canonical Sam agent ID", () => {
    expect(SAM_AGENT_IDS).toContain(SAM_AGENT_ID_CANONICAL);
  });

  it("contains the legacy Sam agent ID", () => {
    expect(SAM_AGENT_IDS).toContain(SAM_AGENT_ID_LEGACY);
  });

  it("has exactly 2 entries (canonical + legacy)", () => {
    expect(SAM_AGENT_IDS).toHaveLength(2);
  });

  it("canonical and legacy IDs are different", () => {
    expect(SAM_AGENT_ID_CANONICAL).not.toBe(SAM_AGENT_ID_LEGACY);
  });
});

describe("ALP_LABEL", () => {
  it("is 'ALP' — never 'AOP'", () => {
    expect(ALP_LABEL).toBe("ALP");
    expect(ALP_LABEL).not.toContain("AOP");
  });
});

describe("FORBIDDEN_FOR_ALP", () => {
  it("includes daily_production (drift source)", () => {
    expect(FORBIDDEN_FOR_ALP).toContain("daily_production");
  });

  it("includes agent_lifetime_production (pollution lake)", () => {
    expect(FORBIDDEN_FOR_ALP).toContain("agent_lifetime_production");
  });
});
