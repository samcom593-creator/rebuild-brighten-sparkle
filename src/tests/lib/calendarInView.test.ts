/**
 * inViewCount (F31): the Calendar's "In view" tile is derived from the merged,
 * filtered rows, so it follows the "Show canceled" switch, and it is only an
 * exact number when both feeds answered and neither was cut off. The same
 * state drives the selected day's count line, the grid cells' accessible
 * names, the empty-list wording and the kind chips, so none of them prints a
 * zero or "nothing" for a read that did not happen.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dayCountAria,
  dayCountText,
  emptyQualifier,
  inViewCount,
  inViewNote,
  inViewValue,
  kindChipCount,
  tallyKinds,
  type FeedRead,
  type InViewCount,
} from "@/lib/calendarInView";
import { mergeAgenda, type AgendaViewRow, type CalendarWindowRow } from "@/lib/calendarAgenda";

const ok: FeedRead = { isPending: false, isError: false, truncated: false, painted: true };
const pending: FeedRead = { isPending: true, isError: false, truncated: false, painted: false };
const failed: FeedRead = { isPending: false, isError: true, truncated: false, painted: false };
/** A refresh that failed while the last good rows stayed on screen. */
const failedKept: FeedRead = { isPending: false, isError: true, truncated: false, painted: true };
const cut: FeedRead = { isPending: false, isError: false, truncated: true, painted: true };

const exact = (n: number): InViewCount => ({ status: "exact", n });

describe("inViewCount", () => {
  it("is loading while either feed has no result yet, whatever the other feed did", () => {
    expect(inViewCount(0, pending, ok)).toEqual({ status: "loading" });
    expect(inViewCount(0, ok, pending)).toEqual({ status: "loading" });
    expect(inViewCount(0, pending, failed)).toEqual({ status: "loading" });
  });

  it("treats a fetch paused offline (pending, not fetching) as loading, not as an empty answer", () => {
    // TanStack offlineFirst: the retry pauses with isLoading false and no data.
    // Passing isPending is what keeps this from reading as "0".
    const pausedOffline: FeedRead = { isPending: true, isError: false, truncated: false, painted: false };
    expect(inViewCount(0, pausedOffline, ok)).toEqual({ status: "loading" });
    expect(inViewValue(inViewCount(0, pausedOffline, ok))).toBeNull();
  });

  it("is unavailable, never zero, when both feeds failed and nothing is on screen", () => {
    expect(inViewCount(0, failed, failed)).toEqual({ status: "unavailable" });
    expect(inViewValue({ status: "unavailable" })).toBeNull();
    expect(inViewValue({ status: "loading" })).toBeNull();
  });

  it("reports rows kept from an earlier read as partial when both refreshes failed, instead of hiding them", () => {
    expect(inViewCount(7, failedKept, failed)).toEqual({ status: "partial", n: 7, failed: "both" });
    expect(inViewValue({ status: "partial", n: 7, failed: "both" })).toBe("7");
    expect(inViewNote({ status: "partial", n: 7, failed: "both" }, "Oct 1 - Oct 31"))
      .toBe("partial: neither feed answered; showing the last rows that loaded");
  });

  it("names the feed that did not answer and keeps the on-screen count as partial", () => {
    expect(inViewCount(12, failed, ok)).toEqual({ status: "partial", n: 12, failed: "dates" });
    expect(inViewCount(12, ok, failed)).toEqual({ status: "partial", n: 12, failed: "appointments" });
    expect(inViewNote({ status: "partial", n: 12, failed: "dates" }, "Oct 1 - Oct 31")).toBe("partial: the date feed did not answer");
    expect(inViewNote({ status: "partial", n: 12, failed: "appointments" }, "Oct 1 - Oct 31")).toBe("partial: the appointments feed did not answer");
  });

  it("reports a cut-off read as a floor, not as the total", () => {
    expect(inViewCount(1000, cut, ok)).toEqual({ status: "floor", n: 1000 });
    expect(inViewCount(1000, ok, cut)).toEqual({ status: "floor", n: 1000 });
    expect(inViewValue({ status: "floor", n: 1000 })).toBe("1,000+");
    expect(inViewNote({ status: "floor", n: 1000 }, "Oct 1 - Oct 31")).toBe("at least; the list is cut off (Oct 1 - Oct 31)");
  });

  it("a failed feed outranks a cut-off one: the bigger caveat wins", () => {
    expect(inViewCount(5, cut, failed)).toEqual({ status: "partial", n: 5, failed: "appointments" });
  });

  it("is exact when both feeds answered in full, with the range as the caption", () => {
    expect(inViewCount(179, ok, ok)).toEqual(exact(179));
    expect(inViewValue(exact(179))).toBe("179");
    expect(inViewNote(exact(179), "Oct 1 - Oct 31, 2026")).toBe("Oct 1 - Oct 31, 2026");
  });
});

describe("one day's count line and accessible name", () => {
  it("prints no number while loading or when nothing is readable, so the page shows the shared state", () => {
    expect(dayCountText({ status: "loading" }, 0)).toBeNull();
    expect(dayCountText({ status: "unavailable" }, 0)).toBeNull();
    expect(dayCountAria({ status: "unavailable" }, 0)).toBe("events unavailable");
    expect(dayCountAria({ status: "loading" }, 0)).toBe("events loading");
  });

  it("counts the painted rows when they were read, singular and plural", () => {
    expect(dayCountText(exact(40), 1)).toBe("1 event in view");
    expect(dayCountText(exact(40), 0)).toBe("0 events in view");
    expect(dayCountText(exact(40), 1200)).toBe("1,200 events in view");
    expect(dayCountAria(exact(40), 3)).toBe("3 events in view");
  });

  it("carries the partial and floor caveats onto the day", () => {
    expect(dayCountText({ status: "partial", n: 9, failed: "dates" }, 2))
      .toBe("2 events in view · partial: the date feed did not answer");
    expect(dayCountText({ status: "partial", n: 9, failed: "appointments" }, 0))
      .toBe("0 events in view · partial: the appointments feed did not answer");
    expect(dayCountText({ status: "partial", n: 9, failed: "both" }, 1))
      .toBe("1 event in view · partial: neither feed answered; showing the last rows that loaded");
    expect(dayCountText({ status: "floor", n: 25000 }, 4)).toBe("4 events in view · at least; the range is cut off");
  });

  it("says what an empty day was measured against unless both feeds answered in full", () => {
    expect(emptyQualifier(exact(0))).toBe("");
    expect(emptyQualifier({ status: "partial", n: 0, failed: "dates" })).toBe(" in the feed that answered");
    expect(emptyQualifier({ status: "partial", n: 0, failed: "appointments" })).toBe(" in the feed that answered");
    expect(emptyQualifier({ status: "partial", n: 3, failed: "both" })).toBe(" in the last rows that loaded");
    expect(emptyQualifier({ status: "floor", n: 25000 })).toBe(" in the rows that loaded; the range is cut off");
  });
});

describe("kind chips", () => {
  const server = { interview: 7, birthday: 108 };

  it("tallies kinds without touching Object.prototype keys", () => {
    const tally = tallyKinds([{ kind: "interview" }, { kind: "interview" }, { kind: "constructor" }]);
    expect(tally.interview).toBe(2);
    expect(tally.constructor).toBe(1);
    expect(tally.birthday).toBeUndefined();
  });

  it("shows no number while the rows are loading, even when the server count is in", () => {
    expect(kindChipCount("interview", { status: "loading" }, null, server)).toBeNull();
  });

  it("uses the painted-row tally when both feeds answered in full, 0 for a kind with no rows", () => {
    expect(kindChipCount("interview", exact(6), { interview: 6 }, server)).toEqual({ n: 6, from: "rows" });
    expect(kindChipCount("milestone", exact(6), { interview: 6 }, server)).toEqual({ n: 0, from: "rows" });
  });

  it("falls back to the server total, labelled as such, when the rows are not a complete read", () => {
    expect(kindChipCount("interview", { status: "floor", n: 25000 }, null, server)).toEqual({ n: 7, from: "server" });
    expect(kindChipCount("interview", { status: "partial", n: 3, failed: "dates" }, null, server)).toEqual({ n: 7, from: "server" });
    expect(kindChipCount("interview", { status: "unavailable" }, null, server)).toEqual({ n: 7, from: "server" });
  });

  it("shows nothing when neither number was read", () => {
    expect(kindChipCount("interview", { status: "unavailable" }, null, null)).toBeNull();
    expect(kindChipCount("interview", { status: "floor", n: 25000 }, null, null)).toBeNull();
  });
});

describe("In view follows the canceled switch through the merged rows", () => {
  const ME = "00000000-0000-4000-8000-000000000001";
  const windowRow = (event_id: string, over: Partial<CalendarWindowRow> = {}): CalendarWindowRow => ({
    event_id,
    event_date: "2026-10-20",
    event_at: "2026-10-20T17:00:00.000Z",
    kind: "interview",
    title: "Synthetic Person",
    subtitle: null,
    person_name: null,
    status: "scheduled",
    ref_id: null,
    link: null,
    ...over,
  });
  const agendaRow = (event_key: string, over: Partial<AgendaViewRow> = {}): AgendaViewRow => ({
    event_key,
    source_table: "interview_events",
    ref_id: event_key.slice(event_key.indexOf(":") + 1),
    kind: "interview",
    title: "Synthetic Person",
    person_name: null,
    person_email: null,
    application_id: null,
    agent_id: null,
    owner_user_id: ME,
    starts_at: "2026-10-20T17:00:00.000Z",
    ends_at: null,
    event_tz: "America/Phoenix",
    meeting_link: null,
    status: "scheduled",
    outcome: null,
    booking_source: "manual",
    call_track: null,
    reminder_state: "pending",
    reschedule_url: null,
    cancel_url: null,
    was_rescheduled: false,
    cancel_reason: null,
    notes: null,
    updated_at: null,
    ...over,
  });

  // The server counts the canceled interview (calendar_window emits it as
  // 'cancelled'); this is the October 2026 shape measured live: the counts
  // RPC says interview 7 while the list paints 6 with canceled hidden.
  const windowRows = [
    windowRow("interview:a"),
    windowRow("interview:b", { status: "cancelled" }),
    windowRow("bday:c:2026", { kind: "birthday", status: "birthday" }),
  ];
  const agendaRows = [agendaRow("interview:a"), agendaRow("interview:b", { status: "canceled" })];
  const serverCounts = { interview: 2, birthday: 1 };

  it("hides the canceled interview by default and counts exactly the rows painted", () => {
    const hidden = mergeAgenda(windowRows, agendaRows, { showCanceled: false, viewerUserId: ME });
    expect(hidden.map((i) => i.key)).toEqual(["bday:c:2026", "interview:a"]);
    expect(inViewCount(hidden.length, ok, ok)).toEqual(exact(2));
  });

  it("shows it under the switch and the number moves with the list, never with the server count", () => {
    const shown = mergeAgenda(windowRows, agendaRows, { showCanceled: true, viewerUserId: ME });
    expect(shown.map((i) => i.key)).toEqual(["bday:c:2026", "interview:a", "interview:b"]);
    expect(inViewCount(shown.length, ok, ok)).toEqual(exact(3));
  });

  it("counts a deduped provider record once, whichever feed carried it", () => {
    const merged = mergeAgenda(windowRows, agendaRows, { showCanceled: true, viewerUserId: ME });
    expect(merged.filter((i) => i.key === "interview:a")).toHaveLength(1);
    expect(inViewCount(merged.length, ok, ok)).toEqual({ status: "exact", n: windowRows.length });
  });

  it("applies the kind filter to the same rows", () => {
    const interviews = mergeAgenda(windowRows, agendaRows, { kinds: ["interview"], showCanceled: false, viewerUserId: ME });
    expect(inViewCount(interviews.length, ok, ok)).toEqual(exact(1));
  });

  it("the Interview chip follows the switch while the server total does not, and the active chips add up to In view", () => {
    for (const showCanceled of [false, true]) {
      const everyKind = mergeAgenda(windowRows, agendaRows, { kinds: null, showCanceled, viewerUserId: ME });
      const tally = tallyKinds(everyKind);
      const onlyInterviews = mergeAgenda(windowRows, agendaRows, { kinds: ["interview"], showCanceled, viewerUserId: ME });
      const count = inViewCount(onlyInterviews.length, ok, ok);
      const chip = kindChipCount("interview", count, tally, serverCounts);
      expect(chip).toEqual({ n: showCanceled ? 2 : 1, from: "rows" });
      expect(chip?.n).toBe(onlyInterviews.length);
      const all = inViewCount(everyKind.length, ok, ok);
      const sum = ["interview", "birthday"].reduce((s, k) => s + (kindChipCount(k, all, tally, serverCounts)?.n ?? 0), 0);
      expect(sum).toBe(everyKind.length);
    }
    // The server total is the same 2 either way: that is why it is only the fallback.
    expect(kindChipCount("interview", { status: "floor", n: 3 }, null, serverCounts)).toEqual({ n: 2, from: "server" });
  });

  it("when both refreshes fail, the dates kept on screen still count and still name the failure", () => {
    // The page drops the agenda's rows on error and paints the date feed's copies.
    const kept = mergeAgenda(windowRows, null, { showCanceled: false, viewerUserId: ME });
    expect(kept.map((i) => i.key).sort()).toEqual(["bday:c:2026", "interview:a"]);
    const count = inViewCount(kept.length, failedKept, { ...failed, painted: false });
    expect(count).toEqual({ status: "partial", n: 2, failed: "both" });
    expect(dayCountText(count, 2)).toBe("2 events in view · partial: neither feed answered; showing the last rows that loaded");
  });
});

describe("CalendarPage feeds these helpers the flags that see every unread state", () => {
  // Source-level, like calendarOneEventContract: the helpers above are only as
  // true as the flags the page passes in. Block comments and whole-line //
  // comments are stripped first so a comment can never satisfy or trip a check.
  const page = readFileSync(path.resolve(__dirname, "../../..", "src/pages/CalendarPage.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("keys loading on isPending, so a fetch paused offline is not read as an empty answer", () => {
    expect(page).toContain("isPending: windowQuery.isPending");
    expect(page).toContain("isPending: agendaQuery.isPending");
    expect(page).not.toContain("windowQuery.isLoading");
    expect(page).not.toContain("agendaQuery.isLoading");
  });

  it("counts the agenda as painted only while it answers, because the page drops its rows on error", () => {
    expect(page).toContain("painted: windowQuery.data !== undefined");
    expect(page).toContain("painted: !agendaQuery.isError && agendaQuery.data !== undefined");
    expect(page).toContain("agendaQuery.isError ? null : agendaQuery.data?.rows");
  });

  it("prints a day's count and a grid cell's name through the helpers, never a raw length", () => {
    expect(page).toContain("dayCountText(inView, selectedDayCount)");
    expect(page).toContain("dayCountAria(inView, rows.length)");
    expect(page).not.toMatch(/\{selectedDayCount\} event/);
    expect(page).not.toMatch(/\$\{rows\.length\} event/);
  });
});
