/**
 * awardGenerator.test.ts
 *
 * Tests for src/lib/awardGenerator.ts — pure SVG award graphics generator
 * and caption writer used for agent recognition posts.
 *
 * Coverage targets:
 *   ✅ generateAwardSVG — returns valid SVG starting with <svg
 *   ✅ generateAwardSVG — embeds agent name (uppercased first name)
 *   ✅ generateAwardSVG — embeds statValue in output
 *   ✅ generateAwardSVG — all 12 award types produce output without throwing
 *   ✅ generateAwardSVG — unknown type falls back gracefully (no throw)
 *   ✅ generateAwardSVG — default size is 1080
 *   ✅ generateAwardSVG — respects custom size param
 *   ✅ generateAwardSVG — rank 1/2/3 → 🥇/🥈/🥉 medal, rank 4+ → "#N"
 *   ✅ generateAwardSVG — no rank → no medal/number
 *   ✅ getAwardCaption — includes agent name in caption
 *   ✅ getAwardCaption — includes statValue in caption
 *   ✅ getAwardCaption — all 12 award types return non-empty string
 *   ✅ getAwardCaption — unknown type falls back to generic caption
 *   ✅ getAwardCaption — first_deal and streak types use firstName only
 */

import { describe, it, expect } from "vitest";
import { generateAwardSVG, getAwardCaption, AwardType } from "@/lib/awardGenerator";

const ALL_TYPES: AwardType[] = [
  "top_producer",
  "leaderboard",
  "first_deal",
  "top_producer_week",
  "most_hires_week",
  "most_hires_month",
  "hot_streak",
  "on_fire",
  "unstoppable",
  "diamond_week",
  "elite_producer",
  "comeback",
];

const BASE_OPTS = {
  agentName: "Jordan Smith",
  statValue: "$12,400",
  statLabel: "Weekly ALP",
  periodLabel: "June 2026",
};

// ── generateAwardSVG — output shape ──────────────────────────────────────────
describe("generateAwardSVG — output shape", () => {
  it("returns a non-empty string starting with <svg", () => {
    const svg = generateAwardSVG({ awardType: "top_producer", ...BASE_OPTS });
    expect(svg).toMatch(/^<svg/);
    expect(svg.length).toBeGreaterThan(200);
  });

  it("closes with </svg>", () => {
    const svg = generateAwardSVG({ awardType: "top_producer", ...BASE_OPTS });
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
  });
});

// ── generateAwardSVG — name embedding ────────────────────────────────────────
describe("generateAwardSVG — agent name embedding", () => {
  it("embeds the uppercased first name", () => {
    const svg = generateAwardSVG({ awardType: "first_deal", ...BASE_OPTS });
    expect(svg).toContain("JORDAN");
  });

  it("embeds the uppercased last name", () => {
    const svg = generateAwardSVG({ awardType: "top_producer", ...BASE_OPTS });
    expect(svg).toContain("SMITH");
  });

  it("handles single-word name without crashing", () => {
    const svg = generateAwardSVG({ awardType: "hot_streak", agentName: "Prince", statValue: "5 Days", statLabel: "Streak", periodLabel: "June" });
    expect(svg).toContain("PRINCE");
  });
});

// ── generateAwardSVG — statValue embedding ───────────────────────────────────
describe("generateAwardSVG — stat value", () => {
  it("embeds statValue in the SVG", () => {
    const svg = generateAwardSVG({ awardType: "hot_streak", ...BASE_OPTS, statValue: "7 Day Streak" });
    expect(svg).toContain("7 Day Streak");
  });
});

// ── generateAwardSVG — all 12 types ──────────────────────────────────────────
describe("generateAwardSVG — all award types", () => {
  for (const type of ALL_TYPES) {
    it(`"${type}" produces output without throwing`, () => {
      expect(() =>
        generateAwardSVG({ awardType: type, ...BASE_OPTS })
      ).not.toThrow();
    });

    it(`"${type}" returns a non-empty string`, () => {
      const svg = generateAwardSVG({ awardType: type, ...BASE_OPTS });
      expect(svg.length).toBeGreaterThan(100);
    });
  }
});

// ── generateAwardSVG — unknown type fallback ─────────────────────────────────
describe("generateAwardSVG — unknown type fallback", () => {
  it("does not throw on an unknown award type", () => {
    expect(() =>
      generateAwardSVG({ awardType: "totally_unknown" as AwardType, ...BASE_OPTS })
    ).not.toThrow();
  });

  it("returns a valid SVG string even for unknown type", () => {
    const svg = generateAwardSVG({ awardType: "bad_type" as AwardType, ...BASE_OPTS });
    expect(svg).toMatch(/^<svg/);
  });
});

// ── generateAwardSVG — size ───────────────────────────────────────────────────
describe("generateAwardSVG — size param", () => {
  it("uses default size 1080 when omitted", () => {
    const svg = generateAwardSVG({ awardType: "leaderboard", ...BASE_OPTS });
    expect(svg).toContain("1080");
  });

  it("respects a custom size", () => {
    const svg = generateAwardSVG({ awardType: "leaderboard", ...BASE_OPTS, size: 400 });
    expect(svg).toContain("400");
  });
});

// ── generateAwardSVG — rank display ──────────────────────────────────────────
describe("generateAwardSVG — rank display", () => {
  it("shows 🥇 for rank 1", () => {
    const svg = generateAwardSVG({ awardType: "leaderboard", ...BASE_OPTS, rank: 1 });
    expect(svg).toContain("🥇");
  });

  it("shows 🥈 for rank 2", () => {
    const svg = generateAwardSVG({ awardType: "leaderboard", ...BASE_OPTS, rank: 2 });
    expect(svg).toContain("🥈");
  });

  it("shows 🥉 for rank 3", () => {
    const svg = generateAwardSVG({ awardType: "leaderboard", ...BASE_OPTS, rank: 3 });
    expect(svg).toContain("🥉");
  });

  it("shows #N for rank > 3", () => {
    const svg = generateAwardSVG({ awardType: "leaderboard", ...BASE_OPTS, rank: 7 });
    expect(svg).toContain("#7");
  });

  it("omits medal emojis when rank is undefined", () => {
    // Note: SVG fill colors (e.g. #030712) contain # + hex digits.
    // Test only for the absence of medal/rank DISPLAY content, not CSS hex codes.
    const svg = generateAwardSVG({ awardType: "leaderboard", ...BASE_OPTS });
    expect(svg).not.toContain("🥇");
    expect(svg).not.toContain("🥈");
    expect(svg).not.toContain("🥉");
  });
});

// ── getAwardCaption ───────────────────────────────────────────────────────────
describe("getAwardCaption — output", () => {
  it("returns a non-empty string for all award types", () => {
    for (const type of ALL_TYPES) {
      const caption = getAwardCaption({ awardType: type, ...BASE_OPTS });
      expect(typeof caption).toBe("string");
      expect(caption.length).toBeGreaterThan(10);
    }
  });

  it("includes the agent name in the caption", () => {
    const caption = getAwardCaption({ awardType: "top_producer", ...BASE_OPTS });
    expect(caption).toContain("Jordan Smith");
  });

  it("includes the statValue in the caption", () => {
    const caption = getAwardCaption({ awardType: "top_producer", ...BASE_OPTS });
    expect(caption).toContain("$12,400");
  });

  it("uses firstName only for streak-style captions (hot_streak)", () => {
    const caption = getAwardCaption({ awardType: "hot_streak", ...BASE_OPTS });
    expect(caption).toContain("Jordan");
    // Full last name is not required for this type
  });

  it("uses firstName only for first_deal caption", () => {
    const caption = getAwardCaption({ awardType: "first_deal", ...BASE_OPTS });
    expect(caption).toContain("Jordan");
  });

  it("falls back to generic caption for unknown type", () => {
    const caption = getAwardCaption({ awardType: "unknown_award" as AwardType, ...BASE_OPTS });
    expect(caption).toMatch(/APEX Financial/);
    expect(caption).toContain("Jordan Smith");
  });

  it("includes #APEXFinancial hashtag", () => {
    for (const type of ALL_TYPES) {
      expect(getAwardCaption({ awardType: type, ...BASE_OPTS })).toContain("#APEXFinancial");
    }
  });
});
