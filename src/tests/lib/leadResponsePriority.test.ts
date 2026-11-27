import { describe, expect, it } from "vitest";
import { compareLeadResponse, leadResponsePriority } from "@/lib/leadResponsePriority";
import { leadsWaitingSummary } from "@/lib/myLeads";

const now = Date.parse("2026-11-27T18:00:00Z");
const row = (status = "new", attrs = {}, granted_at: string | null = "2026-11-20T12:00:00Z") => ({ status, attrs, granted_at });
describe("lead response priority", () => {
  it("separates actual due and future callback times without inventing a deadline for new leads", () => {
    expect(leadResponsePriority(row("callback", { callback_at: "2026-11-27T17:00:00Z" }), now)).toMatchObject({ kind: "overdue", rank: 0 });
    expect(leadResponsePriority(row("callback", { callback_at: "2026-11-28T17:00:00Z" }), now)).toMatchObject({ kind: "scheduled", rank: 4 });
    expect(leadResponsePriority(row("new", {}, "2020-01-01T00:00:00Z"), now)).toMatchObject({ kind: "first_outcome", dueAt: null });
  });
  it.each([undefined, null, "invalid"])("keeps a missing or invalid follow-up date out of the due count: %s", callback_at => {
    expect(leadResponsePriority(row("callback", { callback_at }), now)).toMatchObject({ kind: "followup_unplanned", dueAt: null });
  });
  it.each([null, "invalid", "2027-01-01T00:00:00Z"])("does not fabricate wait time from an unknown/future assignment: %s", date => {
    expect(leadResponsePriority(row("new", {}, date), now).assignedAt).toBeNull();
  });
  it("puts oldest due work before unplanned follow-ups, oldest untouched leads and retries", () => {
    const rows = [row("new", {}, "2026-11-26T12:00:00Z"), row("no_answer"), row("callback"),
      row("new", {}, "2026-11-01T12:00:00Z"), row("callback", { callback_at: "2026-11-26T12:00:00Z" }),
      row("appointment", { callback_at: "2026-11-20T12:00:00Z" }), row("callback", { callback_at: "2026-11-28T12:00:00Z" })];
    expect([...rows].sort((a, b) => compareLeadResponse(a, b, now))).toEqual([rows[5], rows[4], rows[2], rows[3], rows[0], rows[1], rows[6]]);
  });
  it("preserves an explicit next action and does not re-open a completed lead because of an old callback date", () => {
    expect(leadResponsePriority(row("sold", { callback_at: "2026-11-01T00:00:00Z", next_action: "Verify carrier status" }), now))
      .toMatchObject({ kind: "closed", nextAction: "Verify carrier status" });
  });
  it("Home separates future, unknown, held and after-hours leads from due work", () => {
    const result = leadsWaitingSummary([
      { item_id: "due", ...row("callback", { callback_at: "2026-11-20T12:00:00Z" }), callable_now: true },
      { item_id: "future", ...row("appointment", { callback_at: "2026-11-28T12:00:00Z" }), callable_now: true },
      { item_id: "unknown", ...row("callback", { callback_at: "bad-date" }), callable_now: true },
      { item_id: "held", ...row("new", { true_dnc: true }), callable_now: true },
      { item_id: "bad-phone", ...row(), phone10: "000", callable_now: true },
      { item_id: "hours", ...row(), callable_now: false },
    ], now);
    expect(result).toEqual({ open: 6, toCall: 2, callbacks: 1, neverCalled: 0, scheduled: 1, followupsWithoutTime: 1, closedHours: 1, held: 2 });
  });
});
