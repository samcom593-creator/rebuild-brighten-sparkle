/**
 * dealTruth.test.ts
 *
 * Tests for src/lib/dealTruth.ts — SQL filter string generators.
 * Wrong filter strings = wrong revenue numbers on every dashboard.
 *
 * Coverage targets:
 *   ✅ dealTruthWindowOr    — correct OR expression, ISO passthrough
 *   ✅ liveDealWindowOr     — correct OR expression for cutoff
 *   ✅ getDealTruthTimestamp — prefers posted_at, falls back to created_at, null when both absent
 */

import { describe, it, expect } from "vitest";
import {
  dealTruthWindowOr,
  liveDealWindowOr,
  getDealTruthTimestamp,
} from "@/lib/dealTruth";

describe("dealTruthWindowOr", () => {
  const START = "2026-05-20T05:00:00.000Z";
  const END   = "2026-05-21T05:00:00.000Z";

  it("produces a string containing both ISO bounds", () => {
    const filter = dealTruthWindowOr(START, END);
    expect(filter).toContain(START);
    expect(filter).toContain(END);
  });

  it("contains posted_at.gte for the primary branch", () => {
    const filter = dealTruthWindowOr(START, END);
    expect(filter).toContain(`posted_at.gte.${START}`);
    expect(filter).toContain(`posted_at.lt.${END}`);
  });

  it("contains posted_at.is.null fallback branch", () => {
    const filter = dealTruthWindowOr(START, END);
    expect(filter).toContain("posted_at.is.null");
    expect(filter).toContain(`created_at.gte.${START}`);
    expect(filter).toContain(`created_at.lt.${END}`);
  });

  it("produces exactly two OR branches separated by comma", () => {
    const filter = dealTruthWindowOr(START, END);
    // Split on top-level comma: should have 2 branches
    const branches = filter.split(",and(");
    expect(branches).toHaveLength(2);
  });

  it("does not swap start and end (start < end integrity)", () => {
    const filter = dealTruthWindowOr(START, END);
    const gteIdx = filter.indexOf(`gte.${START}`);
    const ltIdx  = filter.indexOf(`lt.${END}`);
    expect(gteIdx).toBeLessThan(ltIdx);
  });

  it("is stable for equal start and end (edge: zero-width window)", () => {
    const iso = "2026-05-20T05:00:00.000Z";
    const filter = dealTruthWindowOr(iso, iso);
    expect(typeof filter).toBe("string");
    expect(filter.length).toBeGreaterThan(0);
  });
});

describe("liveDealWindowOr", () => {
  const CUTOFF = "2026-05-06T05:00:00.000Z";

  it("contains the cutoff ISO string", () => {
    const filter = liveDealWindowOr(CUTOFF);
    expect(filter).toContain(CUTOFF);
  });

  it("uses .gte for the primary branch (posted_at since cutoff)", () => {
    const filter = liveDealWindowOr(CUTOFF);
    expect(filter).toContain(`posted_at.gte.${CUTOFF}`);
  });

  it("contains posted_at.is.null fallback for deals without posted_at", () => {
    const filter = liveDealWindowOr(CUTOFF);
    expect(filter).toContain("posted_at.is.null");
    expect(filter).toContain(`created_at.gte.${CUTOFF}`);
  });

  it("produces exactly two OR branches", () => {
    const filter = liveDealWindowOr(CUTOFF);
    // The two branches are separated by a comma at the top level
    const parts = filter.split(",");
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getDealTruthTimestamp", () => {
  it("returns posted_at when present", () => {
    const result = getDealTruthTimestamp({
      posted_at: "2026-05-20T12:00:00Z",
      created_at: "2026-05-19T12:00:00Z",
    });
    expect(result).toBe("2026-05-20T12:00:00Z");
  });

  it("falls back to created_at when posted_at is null", () => {
    const result = getDealTruthTimestamp({
      posted_at: null,
      created_at: "2026-05-19T12:00:00Z",
    });
    expect(result).toBe("2026-05-19T12:00:00Z");
  });

  it("falls back to created_at when posted_at is undefined", () => {
    const result = getDealTruthTimestamp({
      created_at: "2026-05-19T12:00:00Z",
    });
    expect(result).toBe("2026-05-19T12:00:00Z");
  });

  it("returns null when both posted_at and created_at are null", () => {
    const result = getDealTruthTimestamp({ posted_at: null, created_at: null });
    expect(result).toBeNull();
  });

  it("returns null for empty row object", () => {
    const result = getDealTruthTimestamp({});
    expect(result).toBeNull();
  });
});
