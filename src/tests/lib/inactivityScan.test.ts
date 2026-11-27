import { describe, expect, it, vi } from "vitest";
import { inactivityState, readAll, scanInactivity } from "../../../supabase/functions/detect-inactive-agents/scan";

const now = new Date("2026-11-27T12:00:00Z");
const agent = (id = "a", fields = {}) => ({ id, user_id: `user-${id}`, canonical_agent_id: null, status: "active", is_deactivated: false, is_inactive: false, created_at: "2026-01-01T12:00:00Z", ...fields });
const signal = (id = "a", fields = {}) => ({ agent_id: id, last_dial_at: null, app_last_activity_at: null, ...fields });
const queue = (fields = {}) => ({ id: "q", agent_id: "a", status: "open", reason: "no_production_14d", resolved_at: null, updated_at: "2026-11-01T12:00:00Z", ...fields });

function dbFixture(overrides: Record<string, any[]> = {}, failRead?: string, failWrite = false) {
  const tables: Record<string, any[]> = { agents: [agent()], v_production_canonical: [], v_agent_dialer_state: [signal()], inactive_agent_queue: [], roster_exclusions: [], agent_access_suspensions: [], ...overrides };
  const writes: { table: string; verb: string; payload: any; filters: any[] }[] = [];
  const db = {
    rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: false as unknown, error: null as unknown })),
    from: (table: string) => {
      let write: typeof writes[number] | undefined;
      const chain: any = {};
      for (const method of ["select", "order", "in", "is"]) chain[method] = () => chain;
      chain.eq = (...args: any[]) => { write?.filters.push(args); return chain; };
      chain.range = (from: number, to: number) => Promise.resolve({ data: failRead === table ? null : tables[table].slice(from, to + 1), error: failRead === table ? new Error("unavailable") : null });
      for (const verb of ["update", "insert"]) chain[verb] = (payload: any) => { write = { table, verb, payload, filters: [] }; writes.push(write); return chain; };
      chain.then = (resolve: any, reject: any) => Promise.resolve({ data: failWrite ? null : (Array.isArray(write?.payload) ? write!.payload : [write?.payload]).map((_, i) => ({ id: `saved-${i}` })), error: failWrite ? new Error("write failed") : null }).then(resolve, reject);
      return chain;
    },
  };
  return { db, writes };
}

describe("inactivity evidence", () => {
  it.each([[6, "warning"], [7, "warning"], [13, "warning"], [14, "critical"], [29, "critical"], [30, "abandoned"], [90, "abandoned"]])("uses actual last activity at %s days", (days, severity) => {
    const date = new Date(now.getTime() - Number(days) * 86400000).toISOString();
    const result = inactivityState("2020-01-01", [date], signal(), now);
    expect(result).toMatchObject({ days_inactive: days, severity, reason: Number(days) < 7 ? "activity_resumed" : "no_recorded_activity" });
  });
  it("prefers recent canonical calling activity over older production", () => {
    expect(inactivityState("2020-01-01", ["2026-08-01"], signal("a", { app_last_activity_at: "2026-11-26T12:00:00Z" }), now)?.days_inactive).toBe(1);
  });
  it.each([[null], ["invalid"], ["2027-01-01"]])("keeps undated, invalid and future evidence unknown: %j", dates => {
    expect(inactivityState("2020-01-01", [dates], signal(), now)).toBeNull();
  });
  it("reads beyond the default page before making a decision", async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id }));
    const ranges: number[] = [];
    const result = await readAll(() => ({ range: (start: number, end: number) => { ranges.push(start); return Promise.resolve({ data: rows.slice(start, end + 1), error: null }); } }));
    expect(result).toHaveLength(1001); expect(ranges).toEqual([0, 500, 1000]);
  });
});

describe("inactivity scan", () => {
  it.each(["agents", "v_production_canonical", "v_agent_dialer_state", "inactive_agent_queue", "roster_exclusions", "agent_access_suspensions"])("makes no writes when %s cannot be read", async table => {
    const { db, writes } = dbFixture({}, table);
    await expect(scanInactivity(db, now)).rejects.toThrow("evidence");
    expect(writes).toEqual([]);
  });
  it("uses a canonical alias's production older than 30 days, without age-of-account fallback", async () => {
    const { db, writes } = dbFixture({ agents: [agent(), agent("alias", { canonical_agent_id: "a", is_deactivated: true })], v_production_canonical: [{ agent_id: "alias", posted_date: "2026-10-01T12:00:00Z" }] });
    expect(await scanInactivity(db, now)).toMatchObject({ inserted: 1, updated: 0 });
    expect(writes[0].payload[0]).toMatchObject({ agent_id: "a", days_inactive: 57, severity: "abandoned", last_production_date: "2026-10-01" });
  });
  it("ages existing open cases and preserves recovery notes through scoped updates", async () => {
    const { db, writes } = dbFixture({ inactive_agent_queue: [queue()], v_production_canonical: [{ agent_id: "a", posted_date: "2026-11-01T12:00:00Z" }] });
    expect(await scanInactivity(db, now)).toMatchObject({ inserted: 0, updated: 1 });
    expect(writes[0].payload).toMatchObject({ days_inactive: 26, severity: "critical" });
    expect(writes[0].payload).not.toHaveProperty("recovery_notes");
    expect(writes[0].filters).toContainEqual(["updated_at", queue().updated_at]);
  });
  it("keeps resumed activity visible for review instead of changing account or case status", async () => {
    const { db, writes } = dbFixture({ inactive_agent_queue: [queue()], v_agent_dialer_state: [signal("a", { last_dial_at: "2026-11-26T12:00:00Z" })] });
    await scanInactivity(db, now);
    expect(writes[0].payload.reason).toBe("activity_resumed");
    expect(writes[0].payload).not.toHaveProperty("status");
    expect(writes.every(write => write.table === "inactive_agent_queue")).toBe(true);
  });
  it("preserves manual flags and honors the existing 14-day snooze", async () => {
    const { db, writes } = dbFixture({ agents: [agent(), agent("b")], v_agent_dialer_state: [signal(), signal("b")], inactive_agent_queue: [queue({ reason: "manual_flag" }), queue({ id: "s", agent_id: "b", status: "snoozed", resolved_at: "2026-11-20T12:00:00Z" })] });
    await scanInactivity(db, now); expect(writes).toEqual([]);
  });
  it("does not queue departed, deactivated, inactive, excluded, suspended or banned people", async () => {
    const agents = [agent("terminated", { status: "terminated" }), agent("deactivated", { is_deactivated: true }), agent("inactive", { is_inactive: true }), agent("excluded"), agent("suspended"), agent("banned")];
    const { db, writes } = dbFixture({ agents, v_agent_dialer_state: agents.map(a => signal(a.id)), roster_exclusions: [{ agent_id: "excluded" }], agent_access_suspensions: [{ user_id: "user-suspended" }] });
    db.rpc.mockImplementation(async (_name, args) => ({ data: args.p_user_id === "user-banned", error: null }));
    await scanInactivity(db, now); expect(writes).toEqual([]);
  });
  it("does not queue ambiguous identities or missing evidence", async () => {
    const { db, writes } = dbFixture({ agents: [agent(), agent("b", { user_id: "user-a" }), agent("missing")], v_agent_dialer_state: [signal(), signal("b")] });
    expect(await scanInactivity(db, now)).toMatchObject({ evidence_unknown: 1 });
    expect(writes).toEqual([]);
  });
  it("leaves a chained identity unchanged when activity views cannot consolidate its evidence", async () => {
    const { db, writes } = dbFixture({ agents: [agent(), agent("middle", { canonical_agent_id: "a" }), agent("old", { canonical_agent_id: "middle" })], v_production_canonical: [{ agent_id: "old", posted_date: "2026-11-26T12:00:00Z" }] });
    await scanInactivity(db, now); expect(writes).toEqual([]);
  });
  it("fails closed before writes when a login guard is unavailable", async () => {
    const { db, writes } = dbFixture(); db.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") });
    await expect(scanInactivity(db, now)).rejects.toThrow("eligibility"); expect(writes).toEqual([]);
  });
  it("does not return a successful scan on an unconfirmed write", async () => {
    const { db } = dbFixture({}, undefined, true);
    await expect(scanInactivity(db, now)).rejects.toThrow("could not be confirmed");
  });
});
