/**
 * pureUtils.test.ts
 *
 * Tests for small pure utility functions across:
 *   - src/lib/closingRateColors.ts
 *   - src/lib/utils.ts
 *   - src/lib/samCanonical.ts (getSamExclusionIds — pure function)
 *
 * These are all zero-dependency pure functions; tests run instantly and
 * provide a cheap invariant net for future refactors.
 */

import { describe, it, expect } from "vitest";
import { getClosingRateColor } from "@/lib/closingRateColors";
import { cn, getInitials, getStorageUrl } from "@/lib/utils";
import { getSamExclusionIds } from "@/lib/samCanonical";

// ── getClosingRateColor ───────────────────────────────────────────────────────
describe("getClosingRateColor", () => {
  it("returns red tone for rate < 30", () => {
    expect(getClosingRateColor(0).tone).toBe("red");
    expect(getClosingRateColor(29).tone).toBe("red");
    expect(getClosingRateColor(29.9).tone).toBe("red");
  });

  it("returns yellow tone for rate 30–59", () => {
    expect(getClosingRateColor(30).tone).toBe("yellow");
    expect(getClosingRateColor(45).tone).toBe("yellow");
    expect(getClosingRateColor(59.9).tone).toBe("yellow");
  });

  it("returns green tone for rate >= 60", () => {
    expect(getClosingRateColor(60).tone).toBe("green");
    expect(getClosingRateColor(75).tone).toBe("green");
    expect(getClosingRateColor(100).tone).toBe("green");
  });

  it("returns non-empty textClass and bgClass for all tones", () => {
    for (const rate of [0, 29, 30, 59, 60, 100]) {
      const { textClass, bgClass } = getClosingRateColor(rate);
      expect(textClass.length).toBeGreaterThan(0);
      expect(bgClass.length).toBeGreaterThan(0);
    }
  });

  it("red textClass contains 'destructive'", () => {
    expect(getClosingRateColor(10).textClass).toContain("destructive");
  });

  it("yellow textClass contains 'amber'", () => {
    expect(getClosingRateColor(45).textClass).toContain("amber");
  });

  it("green textClass contains 'emerald'", () => {
    expect(getClosingRateColor(80).textClass).toContain("emerald");
  });
});

// ── getInitials ───────────────────────────────────────────────────────────────
describe("getInitials", () => {
  it("returns '?' for null", () => {
    expect(getInitials(null)).toBe("?");
  });

  it("returns '?' for undefined", () => {
    expect(getInitials(undefined)).toBe("?");
  });

  it("returns '?' for empty string", () => {
    expect(getInitials("")).toBe("?");
  });

  it("returns initials for a full name", () => {
    expect(getInitials("Sam James")).toBe("SJ");
  });

  it("returns single initial for single-word name", () => {
    expect(getInitials("Sam")).toBe("S");
  });

  it("uppercases initials", () => {
    expect(getInitials("sam james")).toBe("SJ");
  });

  it("truncates to 2 characters for long names", () => {
    expect(getInitials("Alice Bob Charlie")).toBe("AB");
  });
});

// ── getStorageUrl ─────────────────────────────────────────────────────────────
describe("getStorageUrl", () => {
  it("returns null for null path", () => {
    expect(getStorageUrl(null)).toBeNull();
  });

  it("returns null for undefined path", () => {
    expect(getStorageUrl(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getStorageUrl("")).toBeNull();
  });

  it("returns path unchanged when it already starts with http", () => {
    const url = "https://example.com/avatar.jpg";
    expect(getStorageUrl(url)).toBe(url);
  });

  it("returns path unchanged when it starts with https", () => {
    const url = "https://supabase.io/storage/v1/object/public/avatars/foo.jpg";
    expect(getStorageUrl(url)).toBe(url);
  });

  it("constructs Supabase storage URL for relative path", () => {
    // VITE_SUPABASE_URL is not set in test env → import.meta.env.VITE_SUPABASE_URL = undefined
    // The function should not crash, just return a path with undefined prefix
    const result = getStorageUrl("some-uuid.jpg");
    expect(result).not.toBeNull();
    expect(result).toContain("some-uuid.jpg");
    expect(result).toContain("/storage/v1/object/public/avatars/");
  });

  it("uses custom bucket name when provided", () => {
    const result = getStorageUrl("photo.png", "profile-photos");
    expect(result).toContain("profile-photos");
    expect(result).toContain("photo.png");
  });
});

// ── cn (class name merger) ────────────────────────────────────────────────────
describe("cn", () => {
  it("merges class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes (undefined/false ignored)", () => {
    expect(cn("foo", false && "bar", undefined, "baz")).toBe("foo baz");
  });

  it("deduplicates conflicting Tailwind classes (last wins)", () => {
    // twMerge should resolve p-2 vs p-4 → p-4 wins
    const result = cn("p-2", "p-4");
    expect(result).toBe("p-4");
  });

  it("handles empty call", () => {
    expect(cn()).toBe("");
  });
});

// ── getSamExclusionIds ────────────────────────────────────────────────────────
describe("getSamExclusionIds", () => {
  it("returns snapshot SAM_AGENT_IDS when canonical is null", () => {
    const ids = getSamExclusionIds(null);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    // Both Sam agent IDs should be present
    expect(ids.some((id) => id.length > 0)).toBe(true);
  });

  it("returns snapshot SAM_AGENT_IDS when canonical is undefined", () => {
    const ids = getSamExclusionIds(undefined);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  it("returns canonical agent_id and legacy_agent_id when canonical is provided", () => {
    const canonical = {
      agent_id: "canonical-uuid-001",
      legacy_agent_id: "legacy-uuid-002",
      user_id: "user-uuid",
      profile_id: null,
      display_name: "Sam James",
      agent_code: "SJAMES02",
      auth_email: "sam@example.com",
      last_sign_in_at: null,
    };
    const ids = getSamExclusionIds(canonical);
    expect(ids).toContain("canonical-uuid-001");
    expect(ids).toContain("legacy-uuid-002");
  });

  it("excludes null/empty legacy_agent_id from canonical result", () => {
    const canonical = {
      agent_id: "canonical-uuid-001",
      legacy_agent_id: null,
      user_id: "user-uuid",
      profile_id: null,
      display_name: "Sam James",
      agent_code: "SJAMES02",
      auth_email: "sam@example.com",
      last_sign_in_at: null,
    };
    const ids = getSamExclusionIds(canonical);
    expect(ids).toContain("canonical-uuid-001");
    expect(ids).toHaveLength(1); // legacy_agent_id null filtered out
  });

  it("returns a readonly array (immutable contract)", () => {
    const ids = getSamExclusionIds(null);
    // TypeScript enforces readonly, but verify the value is array-like
    expect(Array.isArray(ids)).toBe(true);
  });
});
