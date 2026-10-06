import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_PREFS,
  calendarPrefsKey,
  loadCalendarPrefs,
  saveCalendarPrefs,
} from "@/components/calendar/calendarPrefs";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    map,
  };
}

const throwing = {
  getItem: () => { throw new Error("SecurityError: storage blocked"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
};

describe("calendar prefs", () => {
  it("round-trips view + filters per user", () => {
    const store = memoryStorage();
    expect(saveCalendarPrefs("u1", { view: "week", kinds: ["interview", "appointment"], showCanceled: true }, store)).toBe(true);
    expect(loadCalendarPrefs("u1", undefined, store)).toEqual({ view: "week", kinds: ["interview", "appointment"], showCanceled: true });
    // another user on the same browser keeps the defaults
    expect(loadCalendarPrefs("u2", undefined, store)).toEqual(DEFAULT_CALENDAR_PREFS);
    expect(store.map.has(calendarPrefsKey("u1"))).toBe(true);
  });

  it("defaults to the agenda view", () => {
    expect(loadCalendarPrefs("nobody", undefined, memoryStorage()).view).toBe("agenda");
  });

  it("survives blocked storage (private mode) without throwing", () => {
    expect(loadCalendarPrefs("u1", undefined, throwing)).toEqual(DEFAULT_CALENDAR_PREFS);
    expect(saveCalendarPrefs("u1", DEFAULT_CALENDAR_PREFS, throwing)).toBe(false);
    expect(loadCalendarPrefs("u1", undefined, null)).toEqual(DEFAULT_CALENDAR_PREFS);
  });

  it("ignores corrupt or stale values", () => {
    const store = memoryStorage();
    store.setItem(calendarPrefsKey("u1"), "{not json");
    expect(loadCalendarPrefs("u1", undefined, store)).toEqual(DEFAULT_CALENDAR_PREFS);
    store.setItem(calendarPrefsKey("u1"), JSON.stringify({ view: "year", kinds: ["interview", "retired_kind", 7], showCanceled: "yes" }));
    expect(loadCalendarPrefs("u1", ["interview", "appointment"], store)).toEqual({ view: "agenda", kinds: ["interview"], showCanceled: false });
  });
});
