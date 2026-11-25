import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDayCheckIds, isDayPlanTasks, isPendingDayChecks, MyDayStorageError, readDayCache, writeDayCache } from "@/lib/myDayStorage";

const rows = new Map<string, string>();
const storage: Storage = {
  get length() { return rows.size; },
  clear: () => rows.clear(), key: index => [...rows.keys()][index] ?? null,
  removeItem: key => { rows.delete(key); }, getItem: vi.fn(key => rows.get(key) ?? null),
  setItem: vi.fn((key, value) => { rows.set(key, value); }),
};
const pending = { task_id: "task-a", day: "2026-11-25", done: true };
const task = { id: "task-a", weekday: 3, start_min: 600, duration_min: 30, title: "Synthetic plan", detail: null, category: "sales", sort: 0, alert: true };
beforeEach(() => { rows.clear(); vi.clearAllMocks(); vi.stubGlobal("localStorage", storage); });
afterEach(() => vi.unstubAllGlobals());

describe("verified My Day browser data", () => {
  it("distinguishes absent cache from a verified empty queue", () => {
    expect(readDayCache("pending", isPendingDayChecks)).toBeNull();
    writeDayCache("pending", []);
    expect(readDayCache("pending", isPendingDayChecks)).toEqual([]);
  });
  it.each(["{", "{}", "null", JSON.stringify([{ ...pending, done: "true" }]), JSON.stringify([{ ...pending, day: "2026-02-30" }]), JSON.stringify([pending, pending])])("rejects unreadable or malformed pending data: %s", raw => {
    rows.set("pending", raw);
    expect(() => readDayCache("pending", isPendingDayChecks)).toThrow(MyDayStorageError);
    expect(rows.get("pending")).toBe(raw);
  });
  it("verifies schedule and check fields instead of trusting parsed JSON", () => {
    expect(isDayPlanTasks([task])).toBe(true);
    expect(isDayPlanTasks([{ ...task, title: {} }])).toBe(false);
    expect(isDayPlanTasks([{ ...task, duration_min: Number.NaN }])).toBe(false);
    expect(isDayPlanTasks([{ ...task, weekday: 8 }])).toBe(false);
    expect(isDayPlanTasks([task, task])).toBe(false);
    expect(isDayCheckIds(["task-a"])).toBe(true);
    expect(isDayCheckIds({})).toBe(false);
    expect(isDayCheckIds([null])).toBe(false);
  });
  it("reports write denial even when reads remain usable", () => {
    rows.set("pending", "[]");
    vi.mocked(storage.setItem).mockImplementationOnce(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    expect(() => writeDayCache("pending", [pending])).toThrow(MyDayStorageError);
    expect(readDayCache("pending", isPendingDayChecks)).toEqual([]);
  });
  it("does not consider a silently discarded write durable", () => {
    vi.mocked(storage.setItem).mockImplementationOnce(() => {});
    expect(() => writeDayCache("pending", [pending])).toThrow(MyDayStorageError);
  });
  it("reports a denied storage read instead of returning a missing queue", () => {
    vi.mocked(storage.getItem).mockImplementationOnce(() => { throw new DOMException("Denied", "SecurityError"); });
    expect(() => readDayCache("pending", isPendingDayChecks)).toThrow(MyDayStorageError);
  });
});
