/**
 * Resell evidence (OVERHAUL-resells, 2026-10-29). Sam: "rank opportunities by evidence (recently
 * lapsed, a sold ReadyMode call on file, gave SSN and bank, reachable phone). Show why each one ranks
 * where it does." These pin every number a card shows: the points per piece of evidence, the score they
 * add up to, the words on each chip, the order, and the tile counts that must equal the list they open.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_EVIDENCE, EVIDENCE_KEYS, EVIDENCE_META, NO_ANSWER_CALLS, POINTS, evidenceCounts, evidenceDay, evidenceFor, evidenceSummary,
  hasEvidence, indexEvidence, lapseSignal, monthsSinceStart, nameKey, phoneKey, type EvidenceRow,
} from "@/lib/resellEvidence";
import { evidenceRequest } from "@/hooks/useResellEvidence";
import { BUCKET_TONE, rankResells, resellSubject } from "@/lib/easyResells";
import { FLIP_TONE, groupTone, isCallable, policySubject, sortPolicies, type BookPolicy } from "@/lib/bookFlips";
import { evidenceTone, flipStatusTone, resellBucketTone } from "@/lib/tones";

const NOW = new Date("2026-10-29T19:00:00Z");

const phoneRow = (o: Partial<EvidenceRow>): EvidenceRow => ({
  kind: "phone", match_key: "6025550101", dials: 0, answered: 0, last_answered_at: null, sold_calls: 0, last_sold_at: null, gave_ssn_and_bank: false, ...o,
});
const nameRow = (o: Partial<EvidenceRow>): EvidenceRow => ({
  kind: "name", match_key: "patdoe", dials: null, answered: null, last_answered_at: null, sold_calls: 0, last_sold_at: null, gave_ssn_and_bank: false, ...o,
});

describe("keys: the same ones the dialer files its calls under", () => {
  it("a number is its last ten digits, or nothing when it is shorter", () => {
    expect(phoneKey("(602) 555-0101")).toBe("6025550101");
    expect(phoneKey("+1 602 555 0101")).toBe("6025550101");
    expect(phoneKey("555-0101")).toBe("");
    expect(phoneKey(null)).toBe("");
  });

  it("a name is first + last, lower case, letters and digits, six characters at least", () => {
    expect(nameKey("Pat", "Doe")).toBe("patdoe");
    expect(nameKey(null, null, "Mary-Ann O'Neil")).toBe("maryannoneil");
    // A first name alone is not first + last: the full name is used instead.
    expect(nameKey("Mary", "", "Mary Ann Smith")).toBe("maryannsmith");
    expect(nameKey("Jo", "Li")).toBe("");
  });

  it("asks once per number and name, and the cache key does not depend on the order of the rows", () => {
    const a = evidenceRequest([{ phone: "602-555-0101", fullName: "Pat Doe" }, { phone: "(602) 555 0101", firstName: "Pat", lastName: "Doe" }, { phone: "480 555 0199", fullName: "Lee Left" }]);
    const b = evidenceRequest([{ phone: "4805550199", fullName: "Lee Left" }, { phone: "6025550101", fullName: "Pat Doe" }]);
    expect(a.phones).toEqual(["4805550199", "6025550101"]);
    expect(a.names).toEqual(["leeleft", "patdoe"]);
    expect(a.signature).toBe(b.signature);
    expect(evidenceRequest([{ phone: "4805550198", fullName: "Lee Left" }]).signature).not.toBe(b.signature);
  });
});

describe("points: each piece of evidence is worth a fixed number, and the score is their sum", () => {
  it("everything on file by number adds up to 110, strongest first", () => {
    const index = indexEvidence([phoneRow({ dials: 5, answered: 3, last_answered_at: "2026-10-22T18:30:00Z", sold_calls: 2, last_sold_at: "2026-09-21T20:11:00Z", gave_ssn_and_bank: true })]);
    const e = evidenceFor({ phone: "602-555-0101", fullName: "Pat Doe", lapse: { status: "Lapse Pending", startedOn: "2026-06-21" } }, index, NOW);
    expect(e.signals.map((s) => s.key)).toEqual(["ssn_bank", "sold_call", "lapse", "answered"]);
    expect(e.signals.map((s) => s.points)).toEqual([40, 30, 25, 15]);
    expect(e.score).toBe(110);
    expect(e.signals.map((s) => s.label)).toEqual(["Gave SSN and bank", "Sold on a call Sep 21", "Lapse pending", "Answered Oct 22"]);
  });

  it("a match on the name only counts half and says so, and never adds to a match by number", () => {
    const byName = evidenceFor({ phone: "480-555-0199", fullName: "Pat Doe" }, indexEvidence([nameRow({ sold_calls: 1, gave_ssn_and_bank: true })]), NOW);
    expect(byName.signals.map((s) => [s.label, s.points, s.byNameOnly])).toEqual([
      ["Gave SSN and bank · same name", 20, true],
      ["Sold on a call · same name", 15, true],
    ]);
    expect(byName.score).toBe(35);
    const both = evidenceFor(
      { phone: "602-555-0101", fullName: "Pat Doe" },
      indexEvidence([phoneRow({ sold_calls: 1, gave_ssn_and_bank: true, last_sold_at: "2026-09-21T20:11:00Z" }), nameRow({ sold_calls: 3, gave_ssn_and_bank: true })]),
      NOW,
    );
    expect(both.score).toBe(POINTS.ssnBank + POINTS.soldCall);
    expect(both.signals.some((s) => s.byNameOnly)).toBe(false);
  });

  it("a number nobody answers counts against them only after three calls", () => {
    const two = evidenceFor({ phone: "6025550101" }, indexEvidence([phoneRow({ dials: 2, answered: 0 })]), NOW);
    expect(two.signals).toEqual([]);
    const five = evidenceFor({ phone: "6025550101" }, indexEvidence([phoneRow({ dials: 5, answered: 0 })]), NOW);
    expect(five.signals.map((s) => [s.label, s.points])).toEqual([["No answer in 5 calls", -10]]);
    expect(five.score).toBe(-10);
    expect(NO_ANSWER_CALLS).toBe(3);
    // Answered once out of many is answered: a live line.
    const once = evidenceFor({ phone: "6025550101" }, indexEvidence([phoneRow({ dials: 9, answered: 1, last_answered_at: null })]), NOW);
    expect(once.signals.map((s) => [s.label, s.points])).toEqual([["Answered before", 15]]);
  });

  it("nothing on file is zero points with no chips, never a guess", () => {
    const e = evidenceFor({ phone: "6025550101", fullName: "Pat Doe" }, EMPTY_EVIDENCE, NOW);
    expect(e).toEqual({ score: 0, signals: [] });
    expect(evidenceSummary(e)).toBe("0 points: no call evidence on file.");
  });
});

describe("lapse: recently is measured from the day the policy started, the only date the book has", () => {
  it("lapse pending (or a grace period) is still savable and worth the most", () => {
    expect(lapseSignal({ status: "Lapse Pending", startedOn: "2025-01-01" }, NOW)?.points).toBe(25);
    expect(lapseSignal({ status: "Grace Period", startedOn: null }, NOW)?.label).toBe("Lapse pending");
  });

  it("a lapsed policy that started months ago lapsed within those months, rounded up so it is never overstated", () => {
    expect(monthsSinceStart("2026-06-21", NOW)).toBe(5);
    const recent = lapseSignal({ status: "Lapsed", startedOn: "2026-06-21" }, NOW);
    expect([recent?.label, recent?.points]).toEqual(["Lapsed within 5 months", 20]);
    expect(recent?.detail).toBe("The policy started Jun 21, 2026, so it lapsed in the last 5 months.");
    const year = lapseSignal({ status: "Lapsed", startedOn: "2026-01-15" }, NOW);
    expect([year?.label, year?.points]).toEqual(["Lapsed within 10 months", 15]);
    const old = lapseSignal({ status: "Lapsed", startedOn: "2025-06-01" }, NOW);
    expect([old?.label, old?.points]).toEqual(["Lapsed", 10]);
  });

  it("an unknown or future start date is a plain lapse, never a recent one", () => {
    expect(lapseSignal({ status: "Lapsed", startedOn: null }, NOW)?.detail).toBe("The policy has lapsed. The book does not say when it started.");
    expect(monthsSinceStart("2027-01-01", NOW)).toBeNull();
    expect(lapseSignal({ status: "Lapsed", startedOn: "2027-01-01" }, NOW)?.points).toBe(10);
    expect(monthsSinceStart("2026-10-29", NOW)).toBe(1);
    expect(lapseSignal(null, NOW)).toBeNull();
  });

  it("only a lapsing row is asked about a lapse", () => {
    expect(resellSubject({ bucket: "lapsing", phone: "1", client_name: "A", policy_status: "Lapsed", event_at: "2026-06-21T00:00:00+00:00" }).lapse)
      .toEqual({ status: "Lapsed", startedOn: "2026-06-21T00:00:00+00:00" });
    expect(resellSubject({ bucket: "dropped", phone: "1", client_name: "A", policy_status: "Declined", event_at: null }).lapse).toBeNull();
    const p = { phone: "1", client_first_name: "A", client_last_name: "B", client_name: "A B", book_status: "Lapsed", effective_date: null, posted_date: "2026-05-02" };
    expect(policySubject({ ...p, status_group: "lapsing" }).lapse).toEqual({ status: "Lapsed", startedOn: "2026-05-02" });
    expect(policySubject({ ...p, status_group: "active" }).lapse).toBeNull();
  });
});

describe("dates on chips are days in Phoenix, with the year only when it is not this year", () => {
  it("reads a call time as the Phoenix day", () => {
    // 02:30 UTC on Oct 23 is still Oct 22 in Phoenix.
    expect(evidenceDay("2026-10-23T02:30:00Z", NOW)).toBe("Oct 22");
    expect(evidenceDay("2025-12-04T18:00:00Z", NOW)).toBe("Dec 4, 2025");
    expect(evidenceDay("not a date", NOW)).toBe("");
  });
});

describe("tiles: each counts the people holding that evidence, the same rule the list filters on", () => {
  it("a number nobody answers is not counted as answering", () => {
    const index = indexEvidence([
      phoneRow({ match_key: "6025550101", dials: 4, answered: 2, gave_ssn_and_bank: true }),
      phoneRow({ match_key: "6025550102", dials: 6, answered: 0 }),
      phoneRow({ match_key: "6025550103", sold_calls: 1 }),
    ]);
    const list = ["6025550101", "6025550102", "6025550103", "6025550104"].map((phone) => evidenceFor({ phone }, index, NOW));
    expect(evidenceCounts(list)).toEqual({ ssn_bank: 1, sold_call: 1, lapse: 0, answered: 1 });
    expect(list.filter((e) => hasEvidence(e, "answered"))).toHaveLength(1);
  });

  it("the legend and the tiles name the same points the score uses", () => {
    expect(EVIDENCE_KEYS).toEqual(["ssn_bank", "sold_call", "lapse", "answered"]);
    expect(EVIDENCE_META.ssn_bank.points).toContain(String(POINTS.ssnBank));
    expect(EVIDENCE_META.sold_call.points).toContain(String(POINTS.soldCall));
    for (const n of [POINTS.lapsePending, POINTS.lapsedWithin6, POINTS.lapsedWithin12, POINTS.lapsed]) expect(EVIDENCE_META.lapse.points).toContain(String(n));
    expect(EVIDENCE_META.answered.points).toContain(String(POINTS.answered));
    expect(EVIDENCE_META.answered.points).toContain(String(Math.abs(POINTS.noAnswer)));
  });

  it("the summary a screen reader hears adds up to the score", () => {
    const e = evidenceFor({ phone: "6025550101" }, indexEvidence([phoneRow({ dials: 5, answered: 0, sold_calls: 1, last_sold_at: "2026-09-21T20:11:00Z" })]), NOW);
    expect(e.score).toBe(20);
    expect(evidenceSummary(e)).toBe("20 points: sold on a call Sep 21 30, no answer in 5 calls minus 10.");
  });
});

describe("order: the most evidence first, and the old order between equal scores", () => {
  it("Easy Resells ranks by score, then by kind, untouched first", () => {
    const rows = [
      { item_key: "a", tier: 1, last_touch_at: null, event_at: "2026-10-01T00:00:00Z" },
      { item_key: "b", tier: 5, last_touch_at: null, event_at: "2026-10-01T00:00:00Z" },
      { item_key: "c", tier: 2, last_touch_at: null, event_at: "2026-10-01T00:00:00Z" },
      { item_key: "d", tier: 2, last_touch_at: "2026-10-20T00:00:00Z", event_at: "2026-10-01T00:00:00Z" },
    ];
    const score: Record<string, number> = { a: 15, b: 85, c: 15, d: 15 };
    expect(rankResells(rows, (r) => score[r.item_key]).map((r) => r.item_key)).toEqual(["b", "a", "c", "d"]);
  });

  it("Book Flips puts somebody you can call first, then the score, then the departed-writer priority", () => {
    const base = (o: Partial<BookPolicy>) => ({
      flip_key: "k", client_name: "Ann", months_in_force: 3, monthly_premium: 40, annual_premium: 480, face_amount: 10000,
      status_group: "active" as const, agent_gone: true, book_status: "Active", phone: "6025550101", do_not_call: false, flip_status: "to_call" as const, ...o,
    });
    const list = [
      base({ flip_key: "no-phone", phone: null }),
      base({ flip_key: "low" }),
      base({ flip_key: "high" }),
      base({ flip_key: "dnc", do_not_call: true }),
      base({ flip_key: "lapsing-left", status_group: "lapsing", book_status: "Lapse Pending" }),
    ];
    const score: Record<string, number> = { "no-phone": 110, low: 0, high: 70, dnc: 110, "lapsing-left": 0 };
    expect(sortPolicies(list, "evidence", (p) => score[p.flip_key]).map((p) => p.flip_key)).toEqual(["high", "lapsing-left", "low", "dnc", "no-phone"]);
    expect(isCallable({ phone: "602-555-0101", do_not_call: false, flip_status: "bad_number" })).toBe(false);
    // Without scores (evidence not in yet), the evidence order is the old priority order for callable rows.
    expect(sortPolicies(list.slice(1, 3), "evidence").map((p) => p.flip_key)).toEqual(["high", "low"]);
  });
});

describe("colour: every pill takes its tone from a mapping, the word beside it", () => {
  it("maps evidence, resell kinds and call outcomes to the shared tones", () => {
    expect(EVIDENCE_KEYS.map((k) => evidenceTone(k))).toEqual(["good", "gold", "warm", "cool"]);
    expect(evidenceTone("none")).toBe("slate");
    expect(["ready_to_finish", "lapsing", "dropped", "vantage", "agent_left", "warm_objection"].map(resellBucketTone))
      .toEqual(["good", "warm", "hot", "royal", "slate", "cool"]);
    expect(["resold", "callback", "appointment", "no_answer", "do_not_call", "to_call"].map(flipStatusTone))
      .toEqual(["good", "cool", "royal", "warm", "hot", "slate"]);
    expect(groupTone("dead")).toBe("hot");
    expect(groupTone("lapsing")).toBe("warm");
  });

  it("no hand-picked colour is left in the pills", () => {
    for (const cls of [...Object.values(BUCKET_TONE), ...Object.values(FLIP_TONE)]) {
      expect(cls).toMatch(/text-tone-/);
      expect(cls).not.toMatch(/emerald|amber|red-|violet|sky-/);
    }
  });
});
