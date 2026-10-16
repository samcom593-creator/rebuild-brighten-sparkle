/**
 * ensureCurrentAgentRecord: resolves through the shared identity rule and provisions
 * only when no record of any kind exists. Scripted client with no maybeSingle, so a
 * regression back to "newest row for this login" surfaces as a wrong id or a throw.
 */
import { describe, expect, it, vi } from "vitest";
import { ensureCurrentAgentRecord, resolveAgentRecordWith, type EnsureAgentClient } from "@/lib/ensureCurrentAgentRecord";

type Result = { data: unknown; error: unknown };
type Invoke = (name: string, opts: { body: unknown }) => Promise<Result>;

function stub(results: Array<Result | Error>, invoke: Invoke = vi.fn(async () => ({ data: null, error: null }))) {
  let i = 0;
  const from = () => {
    const q: Record<string, unknown> = {};
    const chain = () => () => q;
    Object.assign(q, {
      select: chain(),
      eq: chain(),
      is: chain(),
      not: chain(),
      order: chain(),
      limit: chain(),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        const r = results[i++];
        if (r === undefined) return Promise.reject(new Error("stub exhausted: unexpected extra query")).then(resolve, reject);
        if (r instanceof Error) return Promise.reject(r).then(resolve, reject);
        return Promise.resolve(r).then(resolve, reject);
      },
    });
    return q;
  };
  return { client: { from, functions: { invoke } } as unknown as EnsureAgentClient, invoke, queries: () => i };
}

const live = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  user_id: "u1",
  agent_code: null,
  display_name: "Test Agent",
  status: "active",
  is_inactive: false,
  is_deactivated: false,
  created_at: "2026-01-01T00:00:00Z",
  canonical_agent_id: null,
  ...patch,
});
const ok = (rows: unknown[]): Result => ({ data: rows, error: null });

describe("resolveAgentRecordWith", () => {
  it("returns the live row's id and never calls self-enroll", async () => {
    const s = stub([ok([live("a1")])]);
    await expect(resolveAgentRecordWith(s.client, "u1")).resolves.toBe("a1");
    expect(s.invoke).not.toHaveBeenCalled();
  });

  it("follows a merge pointer to the winner instead of returning the merged-away row", async () => {
    const s = stub([
      ok([]), // live rows: none
      ok([live("old", { canonical_agent_id: "win" })]), // merged-away rows for the login
      ok([live("win")]), // the winner, read by id
    ]);
    await expect(resolveAgentRecordWith(s.client, "u1")).resolves.toBe("win");
    expect(s.invoke).not.toHaveBeenCalled();
  });

  it("two live rows: returns null and does not provision a third", async () => {
    const s = stub([ok([live("a1"), live("a2")])]);
    await expect(resolveAgentRecordWith(s.client, "u1")).resolves.toBeNull();
    expect(s.invoke).not.toHaveBeenCalled();
  });

  it("no row of any kind: provisions through self-enroll-course and returns its agentId", async () => {
    const invoke = vi.fn(async () => ({ data: { agentId: "new1" }, error: null }));
    const s = stub([ok([]), ok([])], invoke);
    await expect(resolveAgentRecordWith(s.client, "u1")).resolves.toBe("new1");
    expect(invoke).toHaveBeenCalledWith("self-enroll-course", { body: {} });
  });

  it("a self-enroll refusal yields null, never a fabricated id", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: "Multiple licensed applications match this login" } }));
    const s = stub([ok([]), ok([])], invoke);
    await expect(resolveAgentRecordWith(s.client, "u1")).resolves.toBeNull();
  });

  it("a failed read throws and never provisions", async () => {
    const s = stub([{ data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } }]);
    await expect(resolveAgentRecordWith(s.client, "u1")).rejects.toThrow(/too long/);
    expect(s.invoke).not.toHaveBeenCalled();
  });
});

describe("ensureCurrentAgentRecord", () => {
  it("dedupes concurrent calls for one login into a single resolution", async () => {
    const s = stub([ok([live("a1")])]);
    const [x, y] = await Promise.all([ensureCurrentAgentRecord("u-dedupe", s.client), ensureCurrentAgentRecord("u-dedupe", s.client)]);
    expect(x).toBe("a1");
    expect(y).toBe("a1");
    expect(s.queries()).toBe(1);
  });
});
