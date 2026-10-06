import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-level contract for the one-event model (redesign section 7). These
// fail when a future edit reintroduces a second appointment store, a hard
// delete, or a fixed UTC offset on the write path.
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "tests" || name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("calendar one-event contract", () => {
  it("nothing in src/ writes the dead scheduled_interviews table", () => {
    const offenders = walk(path.join(ROOT, "src")).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /from\(\s*["']scheduled_interviews["'][^)]*\)\s*\.(insert|upsert|update)/.test(src.replace(/\s+/g, " "));
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("the shared scheduler books through book_interview_event with an explicit zone", () => {
    const scheduler = read("src/components/dashboard/InterviewScheduler.tsx");
    expect(scheduler).toContain("bookInterviewEvent(");
    expect(scheduler).toContain("eventTz: timeZone");
    // the booked instant must not be built in the browser's zone
    expect(scheduler).not.toMatch(/\.setHours\(hour/);
    expect(scheduler).toContain("zonedWallTimeToUtc(");
    expect(read("src/components/calendar/calendarApi.ts")).toContain('"book_interview_event"');
  });

  it("the Calendar never hard-deletes and never writes with a fixed offset", () => {
    const page = read("src/pages/CalendarPage.tsx");
    expect(page).not.toMatch(/\.delete\(\)/);
    expect(page).not.toContain("PHOENIX_OFFSET");
    expect(page).not.toMatch(/-0[0-9]:00`/);
    expect(page).toContain("v_calendar_agenda");
    expect(page).toContain("disposeInterview(");
  });

  it("the migration ships the invoker view and SECURITY DEFINER RPCs with role checks", () => {
    const sql = read("supabase/migrations/20261006130000_calendar_agenda.sql");
    expect(sql).toMatch(/create or replace view public\.v_calendar_agenda\s+with \(security_invoker = true\)/);
    for (const fn of ["book_interview_event", "reschedule_interview_event", "cancel_interview_event", "calendar_owner_conflicts", "calendar_provider_health"]) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`));
      expect(body.slice(0, 2500)).toMatch(/security definer/);
      expect(body.slice(0, 2500)).toMatch(/set search_path to 'public'/);
      expect(body.slice(0, 4000)).toMatch(/42501/);
    }
    expect(sql).not.toMatch(/\bdrop table\b|\btruncate\b|\bdelete from\b/i);
    // the new reminder branch ships OFF
    expect(sql).toContain("calendar_interview_reminders_enabled");
  });
});
