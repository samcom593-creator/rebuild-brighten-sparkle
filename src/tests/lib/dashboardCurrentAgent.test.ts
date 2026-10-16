/**
 * loadDashboardCurrentAgent: /dashboard scopes to the agent id the shared
 * resolver returns (via ensureCurrentAgentRecord) and reads that row by
 * primary key. It never re-reads agents by user_id, which could return a
 * merged-away row, and it never turns a failed read into "no agent".
 */
import { describe, expect, it, vi } from "vitest";
import { loadDashboardCurrentAgent, type DashboardCurrentAgentDeps } from "@/lib/dashboardCurrentAgent";

type Result = { data: unknown; error: unknown };

function clientReturning(result: Result) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "limit", "order", "is", "maybeSingle", "single"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) => Promise.resolve(result).then(onFulfilled, onRejected);
  const from = vi.fn((table: string) => {
    calls.push({ method: "from", args: [table] });
    return chain;
  });
  return { client: { from } as unknown as DashboardCurrentAgentDeps["client"], calls, from };
}

describe("loadDashboardCurrentAgent", () => {
  it("reads the row the resolver chose by its primary key, never by user_id", async () => {
    // The live winner: a login whose own row was merged away resolves to a row with another id.
    const ensure = vi.fn(async () => "agent-winner");
    const { client, calls } = clientReturning({ data: [{ id: "agent-winner", display_name: "Samuel James" }], error: null });
    await expect(loadDashboardCurrentAgent("user-1", { ensure, client })).resolves.toEqual({ id: "agent-winner", display_name: "Samuel James" });
    expect(ensure).toHaveBeenCalledWith("user-1");
    expect(calls).toContainEqual({ method: "from", args: ["agents"] });
    expect(calls).toContainEqual({ method: "eq", args: ["id", "agent-winner"] });
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "user_id")).toBe(false);
    expect(calls.some((call) => call.method === "order" || call.method === "maybeSingle")).toBe(false);
  });

  it("returns null without a read when the resolver has no single record for the login", async () => {
    const ensure = vi.fn(async () => null);
    const { client, from } = clientReturning({ data: [], error: null });
    await expect(loadDashboardCurrentAgent("user-1", { ensure, client })).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("returns null for a missing login without asking the resolver", async () => {
    const ensure = vi.fn(async () => "agent-1");
    const { client } = clientReturning({ data: [], error: null });
    await expect(loadDashboardCurrentAgent(undefined, { ensure, client })).resolves.toBeNull();
    expect(ensure).not.toHaveBeenCalled();
  });

  it("throws on a failed read instead of reporting no agent", async () => {
    const ensure = vi.fn(async () => "agent-1");
    const { client } = clientReturning({ data: null, error: { message: "permission denied for table agents", code: "42501" } });
    await expect(loadDashboardCurrentAgent("user-1", { ensure, client })).rejects.toMatchObject({ code: "42501" });
  });

  it("throws when the resolved row cannot be read back or the result is not a row set", async () => {
    const ensure = vi.fn(async () => "agent-1");
    await expect(loadDashboardCurrentAgent("user-1", { ensure, client: clientReturning({ data: [], error: null }).client })).rejects.toThrow(/could not be read/);
    await expect(loadDashboardCurrentAgent("user-1", { ensure, client: clientReturning({ data: null, error: null }).client })).rejects.toThrow(/no result set/);
  });

  it("lets a resolver failure surface as the query's error", async () => {
    const ensure = vi.fn(async () => {
      throw new Error("The agent record could not be read.");
    });
    const { client, from } = clientReturning({ data: [], error: null });
    await expect(loadDashboardCurrentAgent("user-1", { ensure, client })).rejects.toThrow(/could not be read/);
    expect(from).not.toHaveBeenCalled();
  });
});
