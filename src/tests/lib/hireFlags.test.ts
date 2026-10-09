import { describe, expect, it } from "vitest";
import { dayLabel, groupHirePriority, type HirePriorityRow } from "@/lib/hireFlags";

const row = (o: Partial<HirePriorityRow>): HirePriorityRow => ({
  agent_id: "a", display_name: "Ann Lee", phone: "+16025550101", email: null, manager_id: null, manager_name: null,
  hired_at: "2026-10-01T00:00:00Z", days: 8, aflac: true, ethos: false, first_contract: false, agentlink: false,
  red_count: 1, reasons: ["Aflac not sent"], last_call_at: null, called_recently: false, score: 120, priority_rank: 5, priority: 1, ...o,
});

describe("hire priority grouping", () => {
  it("puts Priority 1 first in rank order and everyone else behind them", () => {
    const g = groupHirePriority([
      row({ agent_id: "c", priority: 2, priority_rank: 12 }),
      row({ agent_id: "b", priority: 1, priority_rank: 2 }),
      row({ agent_id: "a", priority: 1, priority_rank: 1 }),
      row({ agent_id: "d", priority: 2, priority_rank: 11 }),
    ]);
    expect(g.first.map((r) => r.agent_id)).toEqual(["a", "b"]);
    expect(g.rest.map((r) => r.agent_id)).toEqual(["d", "c"]);
  });

  it("looks an agent up by id so other pages can show the same red chips", () => {
    const g = groupHirePriority([row({ agent_id: "x", aflac: true }), row({ agent_id: "y", aflac: false, ethos: true })]);
    expect(g.byAgent.get("x")?.aflac).toBe(true);
    expect(g.byAgent.get("y")?.ethos).toBe(true);
    expect(g.byAgent.get("nobody")).toBeUndefined();
  });

  it("handles an empty list without inventing anyone", () => {
    const g = groupHirePriority([]);
    expect(g.first).toEqual([]);
    expect(g.rest).toEqual([]);
  });

  it("labels the day count plainly, including a same-day hire", () => {
    expect(dayLabel(0)).toBe("Hired today");
    expect(dayLabel(-1)).toBe("Hired today");
    expect(dayLabel(6)).toBe("Day 6");
  });
});
