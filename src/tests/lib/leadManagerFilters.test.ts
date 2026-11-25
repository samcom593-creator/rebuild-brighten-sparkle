import { describe, expect, it } from "vitest";
import { EMPTY_WORK_FILTERS, LEAD_PACK_COLUMNS, holdLabels, leadFilterProblems, workFilterParams } from "@/lib/leadManagerFilters";

describe("lead context and holds", () => {
  it("distinguishes the old conflated client hold from a real recorded DNC", () => {
    expect(holdLabels({ dnc: true, current_client: true })).toEqual(["Existing client"]);
    expect(holdLabels({ dnc: true, true_dnc: true, current_client: true })).toEqual(["Do not call", "Existing client"]);
    expect(holdLabels({ true_dnc: false, current_client: false, import_review_required: true, in_bundle: true })).toEqual(["Already assigned", "Import review"]);
  });
  it("keeps restrictions mandatory when inspecting a held cohort", () => {
    expect(workFilterParams({ ...EMPTY_WORK_FILTERS, hold: "true_dnc" })).toEqual({ exclude_dnc: true, exclude_resold: true, hold: "true_dnc" });
  });
  it("serializes the same typed work filters without changing calendar dates", () => {
    expect(workFilterParams({ ...EMPTY_WORK_FILTERS, caller: "  Caller One ", outcome: "bank_objection", sourceFile: " veterans ",
      sourceType: "pos", policyStanding: "unverified", touchedAfter: "2026-11-01", touchedBefore: "2026-11-23", callbackBefore: "2026-11-24", minAttempts: "0", maxAttempts: "4" })).toEqual({
      exclude_dnc: true, exclude_resold: true, caller: "Caller One", outcomes: ["bank_objection"], source_file: "veterans", source_type: "pos", policy_standing: "unverified",
      touched_after: "2026-11-01", touched_before: "2026-11-23", callback_before: "2026-11-24", min_attempts: 0, max_attempts: 4,
    });
    expect(workFilterParams({ ...EMPTY_WORK_FILTERS, minAttempts: "-1", maxAttempts: "0.5", touchedAfter: "not a date" })).toEqual({ exclude_dnc: true, exclude_resold: true });
  });
  it("exports explicit provenance and useful history without raw source or credentials", () => {
    const keys = LEAD_PACK_COLUMNS.map(([key]) => key);
    expect(keys).toEqual(expect.arrayContaining(["source_batch_id", "policy_ownership_claim", "last_caller", "last_outcome", "callback_at", "next_action", "policy_standing", "work_history", "call_history", "last_summary", "hold_reasons"]));
    expect(keys.some((key) => /ssn|bank_account|raw|token/.test(key))).toBe(false);
  });
  it("rejects invalid or inverted ranges instead of silently broadening the assignment", () => {
    expect(leadFilterProblems(EMPTY_WORK_FILTERS, "", "")).toEqual([]);
    expect(leadFilterProblems({ ...EMPTY_WORK_FILTERS, minAttempts: "2", maxAttempts: "0" }, "65", "40")).toEqual([
      "Minimum age cannot exceed maximum age.", "Minimum attempts cannot exceed maximum attempts.",
    ]);
    expect(leadFilterProblems({ ...EMPTY_WORK_FILTERS, minAttempts: "1.5", touchedAfter: "2026-02-30" }, "-1", "")).toEqual([
      "Minimum age must be a whole number of zero or more.", "Minimum attempts must be a whole number of zero or more.", "First touch date must be a valid calendar date.",
    ]);
    expect(leadFilterProblems({ ...EMPTY_WORK_FILTERS, touchedAfter: "2026-11-25", touchedBefore: "2026-11-24" }, "0", "100")).toEqual([
      "The first touch date cannot be after the last touch date.",
    ]);
  });
});
