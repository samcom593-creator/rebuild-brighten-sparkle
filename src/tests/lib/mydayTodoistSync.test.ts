import { describe, expect, it } from "vitest";
import { blockKey, buildDesired, clock24, planSync, type PlanTask } from "../../../supabase/functions/_shared/myday-sync.ts";

const t = (o: Partial<PlanTask>): PlanTask => ({
  weekday: 1, start_min: 420, duration_min: 30, title: "Record a clip", detail: null, category: "content", active: true, ...o,
});

describe("My Day -> Todoist planning", () => {
  it("folds a block that repeats Monday to Friday into one recurring task with explicit weekdays", () => {
    const d = buildDesired([1, 2, 3, 4, 5].map((w) => t({ weekday: w, title: "Gym", start_min: 360 })));
    expect(d).toHaveLength(1);
    expect(d[0].due_string).toBe("every mon,tue,wed,thu,fri at 6:00");
    expect(d[0].due_string).not.toContain("weekday");
  });

  it("keeps blocks with the same title but different weekdays or times apart", () => {
    const d = buildDesired([t({ weekday: 1, title: "Production review", start_min: 1230 }), t({ weekday: 4, title: "Production review", start_min: 1230 }), t({ weekday: 1, title: "Production review", start_min: 1260 })]);
    expect(d.map((x) => x.due_string).sort()).toEqual(["every mon at 21:00", "every mon,thu at 20:30"]);
  });

  it("ignores inactive and untitled blocks", () => {
    expect(buildDesired([t({ active: false }), t({ title: "   " })])).toHaveLength(0);
  });

  it("leaves out rest blocks, alert-off blocks, and the two tasks Todoist already has", () => {
    const d = buildDesired([
      t({ title: "Sleep", category: "rest" }),
      t({ title: "Lunch", category: "health", alert: false }),
      t({ title: "Shutdown: inbox zero + tomorrow's top 3", category: "planning" }),
      t({ title: "CEO planning: week review", category: "ceo", weekday: 7 }),
      t({ title: "Gym", category: "health", start_min: 360 }),
    ]);
    expect(d.map((x) => x.content)).toEqual(["Gym"]);
  });

  it("formats 24 hour clock times, including after midnight", () => {
    expect(clock24(0)).toBe("0:00");
    expect(clock24(1410)).toBe("23:30");
    expect(clock24(1500)).toBe("1:00");
  });

  it("plans create, update and remove, and never touches anything outside the map", () => {
    const desired = buildDesired([t({ weekday: 1, title: "Gym", start_min: 360 }), t({ weekday: 1, title: "Lunch", start_min: 720 })]);
    const existing = [
      { key: blockKey({ title: "Gym", start_min: 360 }), todoist_id: "A", content: "Gym", due_string: "every mon at 5:00" },
      { key: blockKey({ title: "Old block", start_min: 100 }), todoist_id: "B", content: "Old block", due_string: "every mon at 1:40" },
    ];
    const p = planSync(desired, existing);
    expect(p.create.map((x) => x.content)).toEqual(["Lunch"]);
    expect(p.update.map((x) => x.todoist_id)).toEqual(["A"]);
    expect(p.remove.map((x) => x.todoist_id)).toEqual(["B"]);
  });

  it("is a no-op when nothing changed", () => {
    const desired = buildDesired([t({ weekday: 2, title: "Gym", start_min: 360 })]);
    const p = planSync(desired, desired.map((d, i) => ({ key: d.key, todoist_id: String(i), content: d.content, due_string: d.due_string })));
    expect(p).toMatchObject({ create: [], update: [], remove: [], unchanged: 1 });
  });
});
