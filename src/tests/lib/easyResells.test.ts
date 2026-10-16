import { describe, expect, it } from "vitest";
import { closesBookRow, closesCallRow, matchesResellFilter, matchesResellSearch, resellCounts, sortResells, touchedText } from "@/lib/easyResells";

const r = (o: Record<string, unknown>) => ({ item_key: "k", tier: 5, last_touch_at: null, event_at: null, bucket: "agent_left", agent_group: null, ...o }) as never;

describe("easy resell rules", () => {
  it("orders by tier, untouched before touched, the longest-untouched next, newest first", () => {
    const out = sortResells([
      r({ item_key: "t5-new", tier: 5, event_at: "2026-09-01T00:00:00Z" }),
      r({ item_key: "t1-touched", tier: 1, last_touch_at: "2026-10-16T10:00:00Z" }),
      r({ item_key: "t1-fresh", tier: 1, event_at: "2026-10-01T00:00:00Z" }),
      r({ item_key: "t1-touched-older", tier: 1, last_touch_at: "2026-10-10T10:00:00Z" }),
      r({ item_key: "t5-old", tier: 5, event_at: "2026-01-01T00:00:00Z" }),
    ]) as Array<{ item_key: string }>;
    expect(out.map((x) => x.item_key)).toEqual(["t1-fresh", "t1-touched-older", "t1-touched", "t5-new", "t5-old"]);
  });

  it("counts every bucket and everyone under Vantage across buckets", () => {
    const list = [r({ bucket: "lapsing", agent_group: "Vantage" }), r({ bucket: "vantage", agent_group: "Vantage" }), r({ bucket: "agent_left" })];
    const c = resellCounts(list);
    expect([c.all, c.lapsing, c.vantage_any, c.agent_left]).toEqual([3, 1, 2, 1]);
    expect(list.filter((x) => matchesResellFilter(x, "vantage_any"))).toHaveLength(2);
  });

  it("searches by name, agent or phone digits", () => {
    const x = { client_name: "Pat Doe", phone: "(602) 555-0101", agent_name: "KJ Vaughn", carrier: "Combined" };
    expect(matchesResellSearch(x, "vaughn")).toBe(true);
    expect(matchesResellSearch(x, "0101")).toBe(true);
    expect(matchesResellSearch(x, "zzz")).toBe(false);
  });

  it("says where a person stands", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(touchedText({ work_status: "contacted", flip_status: null, attempts: 0, last_touch_at: "2026-10-16T10:00:00Z", callback_at: null }, now)).toBe("Contacted · 2h ago");
    expect(touchedText({ work_status: null, flip_status: "no_answer", attempts: 2, last_touch_at: "2026-10-13T12:00:00Z", callback_at: null }, now)).toBe("No answer ×2 · 3d ago");
    expect(touchedText({ work_status: null, flip_status: "callback", attempts: 1, last_touch_at: null, callback_at: "2026-10-16T11:00:00Z" }, now)).toBe("Callback due");
    expect(touchedText({ work_status: null, flip_status: "to_call", attempts: 0, last_touch_at: null, callback_at: null }, now)).toBe("");
  });

  it("closes a person on the same outcomes the database blocks", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(["resold", "not_interested", "do_not_call", "bad_number", "appointment"].every((st) => closesBookRow(st, null, now))).toBe(true);
    expect(closesBookRow("no_answer", null, now)).toBe(false);
    expect(closesBookRow("callback", "2026-10-17T12:00:00Z", now)).toBe(true);
    expect(closesBookRow("callback", "2026-10-15T12:00:00Z", now)).toBe(false);
    expect([closesCallRow("resold"), closesCallRow("pushback"), closesCallRow("contacted"), closesCallRow("pushed")]).toEqual([true, true, false, false]);
  });
});
