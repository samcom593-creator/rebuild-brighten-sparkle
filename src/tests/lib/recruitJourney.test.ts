/**
 * Recruit tracking definitions (src/lib/recruitJourney.ts, OVERHAUL-recruits 2026-10-29). Every
 * number on the New hires page counts through these, so each rule is pinned here: the seven steps
 * and the engine stages placed on them, the interview booking and the license that move an
 * applicant on, days on the step, the application date, licensed or not, and the Xcel badge with
 * its three honesty rules (email or phone is bought, a name alone is only possible, and "has not
 * bought" waits for a fresh report).
 */
import { describe, expect, it } from "vitest";
import {
  RECRUIT_STEPS,
  STEP_COUNT,
  appliedWords,
  formatCalendarDay,
  formatRecruitDay,
  licenseWords,
  recruitStep,
  shouldHaveXcel,
  stepDays,
  xcelFeed,
  xcelMatchesFilter,
  xcelStatus,
  type JourneyRow,
  type XcelFeed,
} from "@/lib/recruitJourney";
import { recruitStepTone, xcelTone, licenseStatusTone } from "@/lib/tones";

const NOW = Date.parse("2026-10-29T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const FRESH: XcelFeed = { state: "fresh", reportOn: "2026-10-28" };

function row(over: Partial<JourneyRow> = {}): JourneyRow {
  return {
    person_type: "applicant",
    stage_key: "applied",
    stage_name: "Applied",
    status: "active",
    entered_at: iso(5 * DAY),
    days_in_stage: 5,
    license_status: "unlicensed",
    license_progress: null,
    applied_at: iso(5 * DAY),
    interview_at: null,
    interview_booked_at: null,
    xcel_match: null,
    xcel_enrolled_on: null,
    xcel_pct: null,
    xcel_completed_on: null,
    xcel_last_login_on: null,
    xcel_course: null,
    xcel_report_on: "2026-10-28",
    ...over,
  };
}

describe("the seven steps", () => {
  it("are applied, contacted, interview, licensing, licensed, contracted, first deal, each with a plain meaning and its own tone where the palette allows", () => {
    expect(RECRUIT_STEPS.map((s) => s.label)).toEqual(["Applied", "Contacted", "Interview", "Licensing", "Licensed", "Contracted", "First deal"]);
    expect(STEP_COUNT).toBe(7);
    for (const s of RECRUIT_STEPS) expect(s.means.length).toBeGreaterThan(10);
    expect(RECRUIT_STEPS.map((s) => recruitStepTone(s.key))).toEqual(["slate", "cool", "warm", "royal", "good", "gold", "good"]);
    expect(recruitStepTone("nonsense")).toBe("slate");
  });

  it("place every live engine stage on a step, in ladder order", () => {
    const at = (stage_key: string, person_type: JourneyRow["person_type"] = "applicant") =>
      recruitStep(row({ stage_key, stage_name: stage_key, person_type }), NOW).index;
    expect(at("applied")).toBe(1);
    expect(at("watched_vsl")).toBe(1);
    expect(at("completed_application")).toBe(1);
    expect(at("contacted")).toBe(2);
    expect(at("started_prelicense")).toBe(4);
    expect(at("finished_prelicense")).toBe(4);
    expect(at("exam_scheduled")).toBe(4);
    expect(at("passed_exam")).toBe(4);
    expect(at("contracting")).toBe(5);
    // A hire who still needs the license is getting licensed, not contracted.
    expect(at("hired_unlicensed", "agent")).toBe(4);
    for (const s of ["hired", "course_started", "course_completed", "infield_training", "first_appointment"]) expect(at(s, "agent")).toBe(6);
    expect(at("first_deal", "agent")).toBe(7);
    expect(at("first_10k_week", "agent")).toBe(7);
  });

  it("say the engine's own stage beside the step only when it adds something", () => {
    expect(recruitStep(row(), NOW)).toMatchObject({ index: 1, key: "applied", label: "Applied", detail: null, reason: "stage" });
    expect(recruitStep(row({ stage_key: "contacted", stage_name: "Contacted" }), NOW).detail).toBeNull();
    expect(recruitStep(row({ stage_key: "started_prelicense", stage_name: "In Pre-License" }), NOW)).toMatchObject({ label: "Licensing", detail: "In Pre-License" });
    expect(recruitStep(row({ person_type: "agent", stage_key: "course_started", stage_name: "Galaxy Course Started" }), NOW)).toMatchObject({ label: "Contracted", detail: "Galaxy Course Started" });
  });

  it("never invent a step: a closed person, a completed applicant and an unknown stage have none", () => {
    expect(recruitStep(row({ status: "closed_lost", stage_key: "closed_lost", stage_name: "Closed (Lost / Dropped)" }), NOW)).toMatchObject({ index: null, key: null, label: "Closed", detail: null });
    expect(recruitStep(row({ status: "completed" }), NOW)).toMatchObject({ index: null, label: "Completed", detail: "Applied" });
    expect(recruitStep(row({ stage_key: "brand_new_stage", stage_name: "Brand New Stage" }), NOW)).toMatchObject({ index: null, key: null, label: "Brand New Stage" });
    // Closed outranks an interview booking.
    expect(recruitStep(row({ status: "closed_lost", stage_key: "closed_lost", interview_at: iso(DAY) }), NOW).index).toBeNull();
  });
});

describe("an interview booking and a license move an applicant on", () => {
  it("a booked Licensed or Leader Call puts an applicant at Interview, from the day it was booked", () => {
    const booked = row({ interview_at: iso(-2 * DAY), interview_booked_at: iso(1 * DAY), days_in_stage: 40 });
    const step = recruitStep(booked, NOW);
    expect(step).toMatchObject({ index: 3, key: "interview", reason: "interview", since: booked.interview_booked_at });
    expect(step.detail).toMatch(/^booked for Oct 31$/);
    // Days on the step count from the booking, not the 40 days the engine has them at Applied.
    expect(stepDays(booked, step, NOW)).toBeCloseTo(1, 5);
  });

  it("an interview in the past reads as was, and an unlicensed applicant stays at Interview", () => {
    const step = recruitStep(row({ stage_key: "contacted", stage_name: "Contacted", interview_at: iso(3 * DAY), interview_booked_at: iso(9 * DAY) }), NOW);
    expect(step).toMatchObject({ index: 3, detail: "was on Oct 26" });
  });

  it("a licensed applicant whose interview has passed is at Licensed, counted from the interview", () => {
    const r = row({ license_status: "licensed", interview_at: iso(4 * DAY), interview_booked_at: iso(10 * DAY), days_in_stage: 30 });
    const step = recruitStep(r, NOW);
    expect(step).toMatchObject({ index: 5, key: "licensed", label: "Licensed", reason: "licensed_interview", detail: "interview was on Oct 25" });
    expect(stepDays(r, step, NOW)).toBeCloseTo(4, 5);
  });

  it("a licensed applicant with the interview still ahead is at Interview, not Licensed", () => {
    expect(recruitStep(row({ license_status: "licensed", interview_at: iso(-DAY) }), NOW).index).toBe(3);
  });

  it("never moves anyone back, and never moves a hire: the booking only lifts an applicant who is not yet further along", () => {
    expect(recruitStep(row({ stage_key: "started_prelicense", stage_name: "In Pre-License", interview_at: iso(DAY) }), NOW)).toMatchObject({ index: 4, reason: "stage" });
    expect(recruitStep(row({ person_type: "agent", stage_key: "hired", stage_name: "Hired — Agent", license_status: "licensed", interview_at: iso(DAY) }), NOW)).toMatchObject({ index: 6, reason: "stage" });
    // A licensed applicant at Licensing with a past interview is at Licensed.
    expect(recruitStep(row({ stage_key: "passed_exam", stage_name: "Passed Exam", license_status: "licensed", interview_at: iso(DAY) }), NOW).index).toBe(5);
  });

  it("a booking with no time on file still counts, and says so plainly", () => {
    expect(recruitStep(row({ interview_booked_at: iso(DAY) }), NOW)).toMatchObject({ index: 3, detail: "booked" });
  });
});

describe("days on the step", () => {
  it("are the engine's days for its own stage, never negative, and unreadable dates fall back to them", () => {
    const r = row({ days_in_stage: 12.4 });
    expect(stepDays(r, recruitStep(r, NOW), NOW)).toBe(12.4);
    const odd = row({ days_in_stage: -3 });
    expect(stepDays(odd, recruitStep(odd, NOW), NOW)).toBe(0);
    const future = row({ interview_booked_at: iso(-5 * DAY), interview_at: iso(-6 * DAY) });
    expect(stepDays(future, recruitStep(future, NOW), NOW)).toBe(0);
    const unreadable = row({ interview_booked_at: "not a date", interview_at: null, days_in_stage: 8 });
    expect(stepDays(unreadable, recruitStep(unreadable, NOW), NOW)).toBe(8);
  });
});

describe("the application date and the license", () => {
  it("says the day they applied in the recruiting zone, the year only when it is not this year", () => {
    expect(appliedWords(row({ applied_at: "2026-10-02T18:00:00Z" }), NOW)).toBe("Applied Oct 2");
    // 03:00 UTC on Oct 3 is still Oct 2 in Phoenix.
    expect(appliedWords(row({ applied_at: "2026-10-03T03:00:00Z" }), NOW)).toBe("Applied Oct 2");
    expect(appliedWords(row({ applied_at: "2025-11-15T18:00:00Z" }), NOW)).toBe("Applied Nov 15, 2025");
  });

  it("a hire with no application says so instead of a date, and an old list without the column says nothing", () => {
    expect(appliedWords(row({ person_type: "agent", applied_at: null }), NOW)).toBe("No application on file");
    expect(appliedWords(row({ applied_at: "garbage" }), NOW)).toBe("Application date unreadable");
    const old = row();
    delete (old as Partial<JourneyRow>).applied_at;
    expect(appliedWords(old, NOW)).toBeNull();
    expect(formatRecruitDay(null, NOW)).toBeNull();
  });

  it("licensed or not in words, and nothing claimed when the record is silent", () => {
    expect(licenseWords({ license_status: "licensed" })).toEqual({ key: "licensed", label: "Licensed" });
    expect(licenseWords({ license_status: " Unlicensed " })).toEqual({ key: "unlicensed", label: "Not licensed" });
    expect(licenseWords({ license_status: "pending" })).toEqual({ key: "pending", label: "License pending" });
    expect(licenseWords({ license_status: null })).toBeNull();
    expect([licenseStatusTone("licensed"), licenseStatusTone("unlicensed"), licenseStatusTone("pending"), licenseStatusTone(null)]).toEqual(["good", "cool", "warm", "slate"]);
  });
});

describe("Xcel", () => {
  const bought = (over: Partial<JourneyRow> = {}) => {
    const r = row({ stage_key: "contacted", stage_name: "Contacted", ...over });
    return xcelStatus(r, recruitStep(r, NOW), FRESH, NOW);
  };

  it("a purchase matched by email or phone is bought, with the enrollment and progress in words", () => {
    expect(bought({ xcel_match: "email", xcel_enrolled_on: "2026-10-02", xcel_pct: "45.0" })).toEqual({ kind: "bought", label: "Bought Xcel", detail: "enrolled Oct 2, 45% done", matchedBy: "email" });
    expect(bought({ xcel_match: "phone", xcel_enrolled_on: "2025-12-01", xcel_pct: 0 })).toMatchObject({ kind: "bought", detail: "enrolled Dec 1, 2025, 0% done", matchedBy: "phone" });
    expect(bought({ xcel_match: "email", xcel_enrolled_on: "2026-09-01", xcel_pct: 100, xcel_completed_on: "2026-10-20" }).detail).toBe("course finished Oct 20");
    expect(bought({ xcel_match: "email", xcel_pct: 100 }).detail).toBe("course finished");
    expect(bought({ xcel_match: "email" }).detail).toBeNull();
    // A licensed hire who bought it still shows it: the badge is a fact, not a nudge.
    expect(bought({ xcel_match: "email", license_status: "licensed" }).kind).toBe("bought");
  });

  it("a name alone is a possible match, never bought", () => {
    expect(bought({ xcel_match: "name", xcel_enrolled_on: "2026-10-02" })).toEqual({ kind: "possible", label: "Possible Xcel match", detail: "matched on the name only", matchedBy: "name" });
  });

  it("nudges someone who should have bought it by now: not licensed, talked to us, not past the course", () => {
    expect(bought()).toEqual({ kind: "missing", label: "Has not bought Xcel yet", detail: null, matchedBy: null });
    const at = (over: Partial<JourneyRow>) => {
      const r = row(over);
      return shouldHaveXcel(r, recruitStep(r, NOW));
    };
    expect(at({ stage_key: "contacted", stage_name: "Contacted" })).toBe(true);
    expect(at({ interview_at: iso(DAY) })).toBe(true);
    expect(at({ stage_key: "started_prelicense", stage_name: "In Pre-License" })).toBe(true);
    expect(at({ person_type: "agent", stage_key: "hired_unlicensed", stage_name: "Hired — Needs License" })).toBe(true);
    // Not yet: nobody has talked to them.
    expect(at({})).toBe(false);
    // Not needed: licensed, pending, or the record is silent.
    expect(at({ stage_key: "contacted", license_status: "licensed" })).toBe(false);
    expect(at({ stage_key: "contacted", license_status: "pending" })).toBe(false);
    expect(at({ stage_key: "contacted", license_status: null })).toBe(false);
    // Not needed: the course is behind them by the record.
    expect(at({ stage_key: "finished_prelicense" })).toBe(false);
    expect(at({ stage_key: "exam_scheduled" })).toBe(false);
    expect(at({ stage_key: "passed_exam" })).toBe(false);
    expect(at({ stage_key: "contacted", license_progress: "finished_course" })).toBe(false);
    expect(at({ stage_key: "contacted", license_progress: "course_purchased" })).toBe(false);
    expect(at({ stage_key: "contacted", license_progress: "unlicensed" })).toBe(true);
    // Not active: no nudge.
    expect(at({ stage_key: "contacted", status: "closed_lost" })).toBe(false);
  });

  it('never says "has not bought" from a report that stopped arriving, or without the Xcel columns', () => {
    const r = row({ stage_key: "contacted", stage_name: "Contacted" });
    const step = recruitStep(r, NOW);
    expect(xcelStatus(r, step, { state: "stale", reportOn: "2026-10-20" }, NOW).kind).toBe("unknown");
    expect(xcelStatus(r, step, { state: "none", reportOn: null }, NOW).kind).toBe("unknown");
    expect(xcelStatus(r, step, { state: "unavailable", reportOn: null }, NOW)).toEqual({ kind: "unknown", label: null, detail: null, matchedBy: null });
    // A purchase on file is still true when the feed is stale.
    expect(xcelStatus({ ...r, xcel_match: "email" }, step, { state: "stale", reportOn: "2026-10-20" }, NOW).kind).toBe("bought");
  });

  it("the feed is fresh for a report up to three days old, stale after, none without one, unavailable when the list has no Xcel columns", () => {
    expect(xcelFeed([row({ xcel_report_on: "2026-10-28" })], NOW)).toEqual({ state: "fresh", reportOn: "2026-10-28" });
    expect(xcelFeed([row({ xcel_report_on: "2026-10-26" })], NOW).state).toBe("fresh");
    expect(xcelFeed([row({ xcel_report_on: "2026-10-25" })], NOW).state).toBe("stale");
    expect(xcelFeed([row({ xcel_report_on: null })], NOW)).toEqual({ state: "none", reportOn: null });
    const old = row();
    delete (old as Partial<JourneyRow>).xcel_report_on;
    expect(xcelFeed([old], NOW).state).toBe("unavailable");
    expect(xcelFeed([], NOW).state).toBe("empty");
  });

  it("filters by kind, and the tones say bought is good and the nudge needs a nudge", () => {
    expect(xcelMatchesFilter("bought", "all")).toBe(true);
    expect(xcelMatchesFilter("unknown", "all")).toBe(true);
    expect(xcelMatchesFilter("bought", "bought")).toBe(true);
    expect(xcelMatchesFilter("possible", "bought")).toBe(false);
    expect(xcelMatchesFilter("missing", "missing")).toBe(true);
    expect(xcelMatchesFilter("unknown", "missing")).toBe(false);
    expect([xcelTone("bought"), xcelTone("missing"), xcelTone("possible")]).toEqual(["good", "warm", "slate"]);
  });

  it("calendar dates are read without a time-zone shift", () => {
    expect(formatCalendarDay("2026-01-01", NOW)).toBe("Jan 1");
    expect(formatCalendarDay("2025-12-31", NOW)).toBe("Dec 31, 2025");
    expect(formatCalendarDay("31/12/2025", NOW)).toBeNull();
    expect(formatCalendarDay(null, NOW)).toBeNull();
  });
});
