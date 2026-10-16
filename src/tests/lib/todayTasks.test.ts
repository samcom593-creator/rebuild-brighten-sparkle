/**
 * todayTasks (F18 / F20 / F21): the Galaxy Today ranking is a due-date
 * priority queue bucketed on the Phoenix business day, not on the viewer's
 * calendar, and the helpers never read the wall clock themselves.
 */
import { describe, expect, it } from "vitest";
import { dateKeyInZone } from "@/lib/calendarTime";
import {
  callsOnBusinessDay,
  compareTodayTasks,
  completedOnBusinessDay,
  dueBucket,
  isOnBusinessDay,
  nextMeetingAfter,
  priorityRank,
  rankTodayTasks,
  summarizePostedPremium,
  type RankClock,
  type TodayTask,
} from "@/lib/todayTasks";

// Wed 2026-10-14, 12:00 in Phoenix (UTC-7, no DST) = 19:00Z.
const NOON = Date.parse("2026-10-14T19:00:00Z");
const clock: RankClock = { nowMs: NOON, todayKey: "2026-10-14" };

let seq = 0;
function task(over: Partial<TodayTask> = {}): TodayTask {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    notes: null,
    due_at: null,
    completed_at: null,
    priority: "med",
    is_income_producing: false,
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("dueBucket", () => {
  it("puts a due time behind the clock in overdue, later today in due_today, tomorrow in due_later, none in unscheduled", () => {
    expect(dueBucket(task({ due_at: "2026-10-14T16:00:00Z" }), clock)).toBe("overdue"); // 09:00 MST
    expect(dueBucket(task({ due_at: "2026-10-14T23:30:00Z" }), clock)).toBe("due_today"); // 16:30 MST
    expect(dueBucket(task({ due_at: "2026-10-15T07:00:00Z" }), clock)).toBe("due_later"); // 00:00 MST on the 15th
    expect(dueBucket(task({ due_at: null }), clock)).toBe("unscheduled");
  });

  it("buckets on the Phoenix business day even when the viewer's calendar has already turned", () => {
    const lateTonight = "2026-10-15T06:30:00Z"; // 23:30 MST on Oct 14
    for (const zone of ["America/New_York", "UTC", "Europe/London"]) {
      expect(dateKeyInZone(lateTonight, zone)).toBe("2026-10-15");
    }
    expect(dateKeyInZone(lateTonight, "America/Phoenix")).toBe("2026-10-14");
    expect(dueBucket(task({ due_at: lateTonight }), clock)).toBe("due_today");
  });

  it("holds across the US daylight-saving transitions, which Phoenix does not observe", () => {
    // Spring forward 2026-03-08: 23:59 MST on the 8th is already 02:59 EDT on the 9th in New York.
    const spring: RankClock = { nowMs: Date.parse("2026-03-08T08:00:00Z"), todayKey: "2026-03-08" };
    expect(dateKeyInZone("2026-03-09T06:59:00Z", "America/New_York")).toBe("2026-03-09");
    expect(dueBucket(task({ due_at: "2026-03-09T06:59:00Z" }), spring)).toBe("due_today");
    expect(dueBucket(task({ due_at: "2026-03-09T07:00:00Z" }), spring)).toBe("due_later");
    // Fall back 2026-11-01: 00:30 MST on the 1st; 01:30 MST is still today, 00:00 MST on the 2nd is not.
    const fall: RankClock = { nowMs: Date.parse("2026-11-01T07:30:00Z"), todayKey: "2026-11-01" };
    expect(dueBucket(task({ due_at: "2026-11-01T08:30:00Z" }), fall)).toBe("due_today");
    expect(dueBucket(task({ due_at: "2026-11-02T07:00:00Z" }), fall)).toBe("due_later");
  });

  it("treats a due time that cannot be read as unscheduled, never as overdue", () => {
    expect(dueBucket(task({ due_at: "not a date" }), clock)).toBe("unscheduled");
  });
});

describe("priorityRank", () => {
  it("orders high before med before low and ranks anything else as med, the column default", () => {
    expect(priorityRank("high")).toBeLessThan(priorityRank("med"));
    expect(priorityRank("med")).toBeLessThan(priorityRank("low"));
    expect(priorityRank(" HIGH ")).toBe(priorityRank("high"));
    expect(priorityRank("urgent")).toBe(priorityRank("med"));
    expect(priorityRank(null)).toBe(priorityRank("med"));
    expect(priorityRank(undefined)).toBe(priorityRank("med"));
  });
});

describe("rankTodayTasks", () => {
  it("puts an overdue high-priority task created last ahead of a future low-priority task created first", () => {
    const future = task({ id: "future", priority: "low", due_at: "2026-11-14T19:00:00Z", created_at: "2026-09-01T00:00:00Z" });
    const overdue = task({ id: "overdue", priority: "high", due_at: "2026-10-13T19:00:00Z", created_at: "2026-10-14T18:00:00Z" });
    expect(rankTodayTasks([future, overdue], clock).map((t) => t.id)).toEqual(["overdue", "future"]);
  });

  it("does not make a task scheduled for next month today's first task just because it was created earlier", () => {
    const nextMonth = task({ id: "next-month", due_at: "2026-11-03T19:00:00Z", created_at: "2026-06-17T00:00:00Z" });
    const unscheduled = task({ id: "unscheduled", created_at: "2026-10-10T00:00:00Z" });
    const dueToday = task({ id: "due-today", due_at: "2026-10-14T22:00:00Z", created_at: "2026-10-14T18:00:00Z" });
    expect(rankTodayTasks([nextMonth, unscheduled, dueToday], clock).map((t) => t.id)).toEqual(["due-today", "unscheduled", "next-month"]);
  });

  it("within a bucket ranks by priority, then income-producing work, then the earlier due time, then created_at", () => {
    const base = { due_at: "2026-10-14T22:00:00Z" }; // 15:00 MST, due today
    const medLater = task({ id: "med-later", ...base, created_at: "2026-10-02T00:00:00Z" });
    const medEarlier = task({ id: "med-earlier", ...base, created_at: "2026-10-01T00:00:00Z" });
    const medIncome = task({ id: "med-income", ...base, is_income_producing: true, created_at: "2026-10-03T00:00:00Z" });
    const high = task({ id: "high", ...base, priority: "high", created_at: "2026-10-05T00:00:00Z" });
    const low = task({ id: "low", ...base, priority: "low", created_at: "2026-09-01T00:00:00Z" });
    const medSooner = task({ id: "med-sooner", due_at: "2026-10-14T20:00:00Z", created_at: "2026-10-09T00:00:00Z" }); // 13:00 MST
    expect(rankTodayTasks([medLater, low, medEarlier, high, medIncome, medSooner], clock).map((t) => t.id)).toEqual([
      "high",
      "med-income",
      "med-sooner",
      "med-earlier",
      "med-later",
      "low",
    ]);
  });

  it("breaks a full tie on id so the order is total, and leaves completed rows out without mutating the input", () => {
    const b = task({ id: "b" });
    const a = task({ id: "a" });
    const done = task({ id: "done", completed_at: "2026-10-14T18:00:00Z" });
    const input = [b, done, a];
    expect(rankTodayTasks(input, clock).map((t) => t.id)).toEqual(["a", "b"]);
    expect(input.map((t) => t.id)).toEqual(["b", "done", "a"]);
  });

  it("compareTodayTasks is antisymmetric and zero on itself", () => {
    const x = task({ id: "x", priority: "high" });
    const y = task({ id: "y" });
    expect(Math.sign(compareTodayTasks(x, y, clock))).toBe(-Math.sign(compareTodayTasks(y, x, clock)));
    expect(compareTodayTasks(x, x, clock)).toBe(0);
  });
});

describe("completedOnBusinessDay / isOnBusinessDay", () => {
  it("uses the Phoenix day of the completion instant", () => {
    expect(completedOnBusinessDay({ completed_at: "2026-10-15T06:59:00Z" }, "2026-10-14")).toBe(true); // 23:59 MST Oct 14
    expect(completedOnBusinessDay({ completed_at: "2026-10-15T07:00:00Z" }, "2026-10-14")).toBe(false); // 00:00 MST Oct 15
    expect(completedOnBusinessDay({ completed_at: null }, "2026-10-14")).toBe(false);
    expect(isOnBusinessDay("garbage", "2026-10-14")).toBe(false);
    expect(isOnBusinessDay(undefined, "2026-10-14")).toBe(false);
  });
});

describe("callsOnBusinessDay / nextMeetingAfter", () => {
  const calls = [
    { id: 3, start_at: "2026-10-15T07:30:00Z", end_at: "2026-10-15T08:00:00Z" }, // 00:30 MST Oct 15: tomorrow
    { id: 2, start_at: "2026-10-14T23:00:00Z", end_at: "2026-10-14T23:30:00Z" }, // 16:00 MST today
    { id: 1, start_at: "2026-10-14T16:00:00Z", end_at: "2026-10-14T16:30:00Z" }, // 09:00 MST today, already over
    { id: 4, start_at: null, end_at: null },
  ];

  it("keeps today's calls in start order and drops rows with no readable start", () => {
    expect(callsOnBusinessDay(calls, "2026-10-14").map((c) => c.id)).toEqual([1, 2]);
  });

  it("picks the earliest call whose end is still ahead, regardless of input order", () => {
    expect(nextMeetingAfter(calls, NOON)?.id).toBe(2);
    expect(nextMeetingAfter([calls[1], calls[2]], Date.parse("2026-10-14T23:45:00Z"))).toBeNull();
  });

  it("uses the start when no end is recorded", () => {
    const openEnded = { id: 9, start_at: "2026-10-14T20:00:00Z", end_at: null };
    expect(nextMeetingAfter([openEnded], NOON)?.id).toBe(9);
    expect(nextMeetingAfter([openEnded], Date.parse("2026-10-14T20:00:01Z"))).toBeNull();
  });
});

describe("summarizePostedPremium", () => {
  it("sums recorded premiums, numeric strings included", () => {
    expect(summarizePostedPremium([{ annual_premium: 1200 }, { annual_premium: "800" }, { annual_premium: 0 }])).toEqual({ aop: 2000, deals: 3, unpriced: 0 });
  });

  it("counts a missing, blank or unreadable premium as unpriced instead of adding it as zero", () => {
    expect(
      summarizePostedPremium([{ annual_premium: 500 }, { annual_premium: null }, { annual_premium: "" }, { annual_premium: "  " }, { annual_premium: "n/a" }]),
    ).toEqual({ aop: 500, deals: 5, unpriced: 4 });
  });

  it("reports an empty day as zero deals and zero premium", () => {
    expect(summarizePostedPremium([])).toEqual({ aop: 0, deals: 0, unpriced: 0 });
  });
});
