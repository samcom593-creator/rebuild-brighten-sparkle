import { describe, expect, it } from "vitest";
import { parseRecruitingCohort, recordedConversion } from "@/lib/recruitingCohort";
const base = { viewer_user_id: "viewer-a", start: "2026-11-01", end: "2026-11-24", observed_through: "2026-11-25T12:00:00Z",
  applications: 10, booked: 4, linked_producers: 3, posted: 1, without_producer_link: 7, basis: "Synthetic linked cohort" };
describe("recorded recruiting cohort conversion", () => {
  it("uses the same applicant denominator for every outcome and excludes impossible rates", () => {
    expect(recordedConversion(4, 10)).toBe(40);
    expect(recordedConversion(1, 10)).toBe(10);
    expect(recordedConversion(0, 0)).toBeNull();
    expect(recordedConversion(12, 10)).toBeNull();
  });
  it("requires outcomes and unlinked applicants to reconcile", () => {
    expect(parseRecruitingCohort(base)).toEqual(base);
    expect(parseRecruitingCohort({ ...base, booked: 11 })).toBeNull();
    expect(parseRecruitingCohort({ ...base, posted: 4 })).toBeNull();
    expect(parseRecruitingCohort({ ...base, without_producer_link: 8 })).toBeNull();
    expect(parseRecruitingCohort(undefined)).toBeNull();
  });
});
