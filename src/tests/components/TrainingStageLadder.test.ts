import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { STAGE_LADDER, stageLadderIndex } from "@/components/dashboard/TrainingNextStep";

// MP-411 (2026-09-03). TrainingNextStep renders a six-rung licensing ladder and picks the
// current rung from applications.license_progress, a TWELVE-value enum. The lookup used
// `Math.max(0, findIndex(...))`, so every one of the six values not on the ladder resolved
// to rung 0 and the panel told a mid-licensing agent they were still at "Enrolled".
//
// This test grades the ladder against the enum snapshot the repo already keeps
// (scripts/data/enum-catalog.json, refreshed by scripts/refresh-enum-catalog and watched
// for prod drift by apex-doctor Check #29), so it cannot pass off a stale vocabulary as a
// current one and needs no database of its own.

const catalog = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scripts/data/enum-catalog.json"), "utf8"),
) as { enums: Record<string, string[]> };

const LICENSE_PROGRESS = catalog.enums["public.license_progress"];

// The six the ladder deliberately does not carry. Named, not silently excluded: adding a
// value to the enum without deciding which bucket it belongs in fails the coverage test
// below rather than quietly resolving to rung 0 the way the bug did.
const DELIBERATELY_OFF_LADDER = [
  "fingerprints_done",
  "waiting_fingerprints",
  "failed_test",
  "exam_passed",
  "in_field_training",
  "licensed",
];

describe("TrainingNextStep licensing ladder", () => {
  it("reads a non-empty license_progress vocabulary from the enum catalog", () => {
    expect(Array.isArray(LICENSE_PROGRESS)).toBe(true);
    expect(LICENSE_PROGRESS.length).toBeGreaterThan(0);
  });

  it("every rung is a real license_progress enum member", () => {
    // A typo'd rung never matches, so it would silently behave exactly like the bug.
    for (const rung of STAGE_LADDER) {
      expect(LICENSE_PROGRESS).toContain(rung.key);
    }
  });

  it("accounts for every enum value as either a rung or a declared exclusion", () => {
    const known = new Set([...STAGE_LADDER.map((s) => s.key), ...DELIBERATELY_OFF_LADDER]);
    const unaccounted = LICENSE_PROGRESS.filter((v) => !known.has(v));
    expect(unaccounted).toEqual([]);
  });

  it("resolves each on-ladder stage to its own rung", () => {
    STAGE_LADDER.forEach((rung, i) => {
      expect(stageLadderIndex(rung.key)).toBe(i);
    });
  });

  it("returns -1 for every off-ladder enum value instead of coercing to rung 0", () => {
    // This is the assertion the bug failed. -1 highlights no rung, because the renderer
    // tests `i <= stageIdx`; 0 highlights "Enrolled" and states a position we do not know.
    for (const value of DELIBERATELY_OFF_LADDER) {
      expect(stageLadderIndex(value)).toBe(-1);
    }
  });

  it("treats a null stage as the first rung, which is what the function's own default says", () => {
    // my_training_next_step emits coalesce(v_stage,'unlicensed'), so absent really is rung 0.
    expect(stageLadderIndex(null)).toBe(0);
    expect(stageLadderIndex(undefined)).toBe(0);
  });

  it("returns -1 for a word that is not in the vocabulary at all", () => {
    expect(stageLadderIndex("not_a_real_stage")).toBe(-1);
  });
});
