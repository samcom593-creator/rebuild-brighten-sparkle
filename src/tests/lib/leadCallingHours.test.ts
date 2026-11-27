import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

// MP-LEAD-CALLING-HOURS (2026-11-10). Sam: "every day at 7 PM, hide everyone's leads in the
// portal since they can't be worked at that moment." 7 PM in the LEAD's time zone — 7 PM in
// Phoenix is 9 PM in Florida. Window boundaries are proven live in the migration's own test run
// (6:59 vs 7:00 PM, FL panhandle opens an hour after Miami, area-code fallback, unknown = strictest).
describe("calling hours in the agent portal", () => {
  const sql = read("supabase/migrations/20261111010000_lead_calling_hours.sql");
  const page = read("src/pages/MyLeads.tsx");

  it("the server decides: 8 AM to 7 PM local, closing by the eastern zone and opening by the western", () => {
    expect(sql).toContain("t.le::time < time '19:00' and t.lw::time >= time '08:00'");
    expect(sql).toContain("coalesce(t.tz_east, 'America/New_York')");
    expect(sql).toContain("coalesce(t.tz_west, 'America/Los_Angeles')");
    expect(sql).toMatch(/\('FL', 'America\/New_York', 'America\/Chicago'\)/);
    expect(sql).toMatch(/\('AZ', 'America\/Phoenix', 'America\/Phoenix'\)/);
    expect(sql).toContain("callable_now boolean, callable_at timestamptz");
  });

  it("closed leads leave To call, the pack's Work button, and work mode", () => {
    expect(page).toContain('s === "open" ? isOpenLead(r.status) && callableNow(r)');
    // Both the button snapshot and the live work-mode queue must reapply the
    // server hours/hold gate. Additional priority and valid-phone checks are
    // intentional, and must not replace callableNow.
    expect(page).toContain('const fresh = selected.filter((r) => r.status === "new" && callableNow(r) &&');
    expect(page).toContain('setWorkLeadIds(new Set(fresh.map((r) => r.item_id)))');
    expect(page).toContain('const queue = pack.filter((r) => r.status === "new" && callableNow(r) &&');
  });

  it("a closed lead has no Call link anywhere", () => {
    expect(page).toContain("canDial(l.status) && hoursOpen ? phoneHref(l.phone10) : null");
    expect(page).toContain("canDial(cur.status) && callableNow(cur) ? phoneHref(cur.phone10) : null");
  });

  it("closed leads stay under All so a 6:58 PM call can still be logged, and the agent is told why", () => {
    expect(page).toContain('const inView = (r: MyLead, s: Show) => s === "all" ||');
    expect(page).toContain('data-testid="calling-hours-closed"');
    expect(page).toContain('data-testid="work-mode-hours-closed"');
  });

  it("an older server without the clock flag still honors known contact holds", () => {
    expect(page).toContain('const callableNow = (r: Pick<MyLead, "callable_now" | "attrs" | "status">) => r.callable_now !== false && !heldReason(r);');
  });

  it("progress counts results, not leads waiting for morning", () => {
    expect(page).toContain('const workedN = pack.filter((r) => r.status !== "new").length;');
  });
});
