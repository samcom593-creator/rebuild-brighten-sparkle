import { describe, expect, it } from "vitest";
import { assertRecognitionSent, buildRecognitionCandidates, readRecognitionProduction, RECOGNITION_MILESTONES } from "@/lib/recognitionQueue";
import { trophyProgression } from "@/lib/trophyProgression";
import { shiftDateKey } from "@/lib/businessClock";

const row = (ap: number) => ({ agent_id: "synthetic-agent", name: "Synthetic Agent", ap });
describe("recognition evidence and delivery", () => {
  it("awards the correct tier without rounding an unfinished threshold up", () => {
    const candidates = buildRecognitionCandidates("2026-11-26", { day: [row(4999.99)], week: [], month: [] }, []);
    expect(candidates[0].achievement).toBe("gold");
    expect(RECOGNITION_MILESTONES.platinum).toBe("single_day_platinum");
    expect(buildRecognitionCandidates("2026-11-26", { day: [row(5000)], week: [], month: [] }, [])[0].achievement).toBe("platinum");
  });
  it("omits a sent period even when the old award stored the period's end date", () => {
    const candidates = buildRecognitionCandidates("2026-11-26", { day: [], week: [row(10000)], month: [row(25000)] }, [{
      agent_id: "synthetic-agent", milestone_type: "weekly", milestone_date: "2026-11-25",
      email_sent_at: "2026-11-25T18:00:00Z", email_delivery_status: "sent",
    }]);
    expect(candidates.map((c) => c.achievement)).toEqual(["monthly"]);
  });
  it("does not turn missing production into an empty award queue", () => {
    expect(() => readRecognitionProduction(null)).toThrow(/unavailable/);
    expect(() => readRecognitionProduction({ by_agent: [{ ...row(1000), ap: null }] })).toThrow(/incomplete/);
    expect(readRecognitionProduction({ by_agent: [{ external: true }, row(1000)] })).toEqual([row(1000)]);
  });
  it("requires explicit email acceptance, not just a generated plaque", () => {
    for (const value of [null, { success: true }, { success: true, email_status: "skipped" }, { success: false, email_status: "sent" }]) {
      expect(() => assertRecognitionSent(value)).toThrow();
    }
    expect(() => assertRecognitionSent({ success: true, email_status: "sent" })).not.toThrow();
    expect(() => assertRecognitionSent({ success: true, email_status: "already_sent" })).not.toThrow();
  });
});

function days(start: string, end: string) {
  const rows = [];
  for (let day = start; day <= end; day = shiftDateKey(day, 1)) rows.push({ day, scheduled: true, production_ap: 0, deals: 0 });
  return rows;
}
describe("personal trophy progression", () => {
  it("includes the previous month in a crossing week and excludes future production", () => {
    const rows = days("2026-10-26", "2026-11-02");
    rows[0].production_ap = 9000;
    rows[6].production_ap = 1000;
    rows[7].production_ap = 100000;
    const levels = trophyProgression(rows, "2026-11-01");
    expect(levels.find((l) => l.key === "weekly")).toMatchObject({ amount: 10000, reached: true });
    expect(levels.find((l) => l.key === "monthly")).toMatchObject({ amount: 1000, reached: false });
    expect(levels[0]).toMatchObject({ reached: true, remaining: 0, percent: 100 });
  });
  it("shows exact remaining progress and never rounds a trophy into existence", () => {
    const rows = days("2026-11-01", "2026-11-26");
    rows.at(-1)!.production_ap = 999.99;
    const bronze = trophyProgression(rows, "2026-11-26")[0];
    expect(bronze.reached).toBe(false);
    expect(bronze.remaining).toBeCloseTo(.01);
  });
  it("refuses incomplete and duplicate timeline evidence", () => {
    const rows = days("2026-11-01", "2026-11-26");
    expect(() => trophyProgression(rows.slice(1), "2026-11-26")).toThrow(/complete/);
    expect(() => trophyProgression([...rows, rows[0]], "2026-11-26")).toThrow(/duplicate/);
  });
});
