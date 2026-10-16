/**
 * resolveAgentIdentity (F17): one rule for "which agents row is this login",
 * driven against a scripted client. The stub has no maybeSingle, so any
 * regression back to it surfaces as a thrown TypeError, never a silent null.
 */
import { describe, expect, it } from "vitest";
import {
  AGENT_IDENTITY_ROW_LIMIT,
  agentIdentityQueryKey,
  isWorkingAgentRow,
  resolveAgentIdentity,
  type AgentIdentityClient,
  type AgentIdentityRow,
} from "@/lib/agentIdentity";

type Result = { data: unknown; error: unknown };

function stubClient(results: Array<Result | Error>) {
  const calls: Array<{ table: string; filters: string[] }> = [];
  let i = 0;
  const from = (table: string) => {
    const call = { table, filters: [] as string[] };
    calls.push(call);
    const q: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      call.filters.push(`${name}(${args.map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a) : String(a))).join(",")})`);
      return q;
    };
    Object.assign(q, {
      select: chain("select"),
      eq: chain("eq"),
      is: chain("is"),
      not: chain("not"),
      order: chain("order"),
      limit: chain("limit"),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        const r = results[i++];
        if (r === undefined) return Promise.reject(new Error("stub exhausted: unexpected extra query")).then(resolve, reject);
        if (r instanceof Error) return Promise.reject(r).then(resolve, reject);
        return Promise.resolve(r).then(resolve, reject);
      },
    });
    return q;
  };
  return { client: { from } as unknown as AgentIdentityClient, calls, queries: () => i };
}

function row(patch: Partial<AgentIdentityRow> & { id: string }): AgentIdentityRow {
  return {
    user_id: "user-1",
    agent_code: null,
    display_name: "Test Agent",
    status: "active",
    is_inactive: false,
    is_deactivated: false,
    created_at: "2026-01-01T00:00:00Z",
    canonical_agent_id: null,
    ...patch,
  };
}

const ok = (rows: AgentIdentityRow[]): Result => ({ data: rows, error: null });

describe("resolveAgentIdentity: the live-row rule", () => {
  it("one live row resolves, and the query is the canonical-row rule with a bounded limit, never maybeSingle", async () => {
    const { client, calls, queries } = stubClient([ok([row({ id: "a1", agent_code: "A1" })])]);
    const out = await resolveAgentIdentity(client, "user-1");
    expect(out).toEqual({ status: "resolved", agentId: "a1", row: expect.objectContaining({ id: "a1", agent_code: "A1" }) });
    expect(queries()).toBe(1);
    expect(calls[0].table).toBe("agents");
    expect(calls[0].filters).toEqual([
      expect.stringMatching(/^select\(/),
      "eq(user_id,user-1)",
      "is(canonical_agent_id,null)",
      expect.stringMatching(/^order\(created_at/),
      `limit(${AGENT_IDENTITY_ROW_LIMIT})`,
    ]);
    expect(calls[0].filters.join(" ")).not.toContain("maybeSingle");
  });

  it("no row of any kind is none, and it takes both reads to say so", async () => {
    const { client, calls } = stubClient([ok([]), ok([])]);
    expect(await resolveAgentIdentity(client, "user-1")).toEqual({ status: "none" });
    expect(calls).toHaveLength(2);
    expect(calls[1].filters).toContain("not(canonical_agent_id,is,null)");
  });

  it("two working live rows are ambiguous: it never picks one", async () => {
    const rows = [row({ id: "a1", created_at: "2026-01-01T00:00:00Z" }), row({ id: "a2", created_at: "2026-02-01T00:00:00Z" })];
    const { client, calls } = stubClient([ok(rows)]);
    expect(await resolveAgentIdentity(client, "user-1")).toEqual({ status: "ambiguous", candidates: rows });
    expect(calls).toHaveLength(1);
  });

  it("several live rows with exactly one still working resolve to that one, with a note", async () => {
    const terminated = row({ id: "a1", status: "terminated", is_inactive: true, is_deactivated: true });
    const working = row({ id: "a2", created_at: "2026-02-01T00:00:00Z" });
    const { client } = stubClient([ok([terminated, working])]);
    const out = await resolveAgentIdentity(client, "user-1");
    expect(out.status).toBe("resolved");
    if (out.status === "resolved") {
      expect(out.agentId).toBe("a2");
      expect(out.note).toMatch(/2 agent records share this login/);
    }
  });

  it("a status of active with a deactivation flag is not working, so two such rows stay ambiguous", async () => {
    const rows = [row({ id: "a1", is_deactivated: true }), row({ id: "a2", is_inactive: true })];
    const { client } = stubClient([ok(rows)]);
    expect((await resolveAgentIdentity(client, "user-1")).status).toBe("ambiguous");
  });
});

describe("resolveAgentIdentity: a failed read is an error, never none", () => {
  it("returns the PostgREST error message and stops before the merge read", async () => {
    const { client, calls } = stubClient([{ data: null, error: { message: "permission denied for table agents", code: "42501" } }]);
    expect(await resolveAgentIdentity(client, "user-1")).toEqual({ status: "error", message: "You do not have permission to view this." });
    expect(calls).toHaveLength(1);
  });

  it("a thrown transport failure is an error", async () => {
    const { client } = stubClient([new TypeError("Failed to fetch")]);
    expect(await resolveAgentIdentity(client, "user-1")).toEqual({ status: "error", message: "Network error. Check your connection and retry." });
  });

  it("a read with no result set and no error is still an error", async () => {
    const { client } = stubClient([{ data: null, error: null }]);
    expect((await resolveAgentIdentity(client, "user-1")).status).toBe("error");
  });

  it("no login is an error, not none, and nothing is read", async () => {
    const { client, calls } = stubClient([]);
    expect((await resolveAgentIdentity(client, null)).status).toBe("error");
    expect((await resolveAgentIdentity(client, "")).status).toBe("error");
    expect(calls).toHaveLength(0);
  });
});

describe("resolveAgentIdentity: merged-away logins follow the pointer", () => {
  it("a login whose only row was merged resolves to the live winner under another login", async () => {
    const loser = row({ id: "loser", agent_code: "SJAMES02", canonical_agent_id: "winner" });
    const winner = row({ id: "winner", agent_code: "SJAMES01", user_id: "user-other", display_name: "Samuel James" });
    const { client, calls } = stubClient([ok([]), ok([loser]), ok([winner])]);
    const out = await resolveAgentIdentity(client, "user-1");
    expect(out).toEqual({
      status: "resolved",
      agentId: "winner",
      row: winner,
      mergedFromAgentId: "loser",
      note: "This login's agent record was merged into Samuel James.",
    });
    expect(calls[2].filters).toEqual([expect.stringMatching(/^select\(/), "eq(id,winner)", "limit(1)"]);
  });

  it("merged rows that point at different winners are ambiguous", async () => {
    const rows = [row({ id: "l1", canonical_agent_id: "w1" }), row({ id: "l2", canonical_agent_id: "w2" })];
    const { client, calls } = stubClient([ok([]), ok(rows)]);
    expect(await resolveAgentIdentity(client, "user-1")).toEqual({ status: "ambiguous", candidates: rows });
    expect(calls).toHaveLength(2);
  });

  it("a pointer whose winner cannot be read is an error, not none", async () => {
    const { client } = stubClient([ok([]), ok([row({ id: "l1", canonical_agent_id: "w1" })]), ok([])]);
    const out = await resolveAgentIdentity(client, "user-1");
    expect(out.status).toBe("error");
    if (out.status === "error") expect(out.message).toMatch(/merged into a record that could not be read/);
  });

  it("follows a chain of pointers to the live end", async () => {
    const loser = row({ id: "l1", canonical_agent_id: "w1" });
    const middle = row({ id: "w1", canonical_agent_id: "w2" });
    const end = row({ id: "w2", display_name: "Final Row" });
    const { client, calls } = stubClient([ok([]), ok([loser]), ok([middle]), ok([end])]);
    const out = await resolveAgentIdentity(client, "user-1");
    expect(out.status).toBe("resolved");
    if (out.status === "resolved") expect(out.agentId).toBe("w2");
    expect(calls).toHaveLength(4);
  });

  it("gives up with an error on a chain deeper than it will follow", async () => {
    const loser = row({ id: "l1", canonical_agent_id: "w1" });
    const hops = [row({ id: "w1", canonical_agent_id: "w2" }), row({ id: "w2", canonical_agent_id: "w3" }), row({ id: "w3", canonical_agent_id: "w4" })];
    const { client } = stubClient([ok([]), ok([loser]), ...hops.map((h) => ok([h]))]);
    const out = await resolveAgentIdentity(client, "user-1");
    expect(out.status).toBe("error");
  });
});

describe("isWorkingAgentRow and the query key", () => {
  it("working means not terminated or inactive by status and neither deactivation flag set", () => {
    expect(isWorkingAgentRow({ status: "active", is_inactive: false, is_deactivated: false })).toBe(true);
    expect(isWorkingAgentRow({ status: "pending", is_inactive: null, is_deactivated: null })).toBe(true);
    expect(isWorkingAgentRow({ status: "terminated", is_inactive: false, is_deactivated: false })).toBe(false);
    expect(isWorkingAgentRow({ status: "inactive", is_inactive: false, is_deactivated: false })).toBe(false);
    expect(isWorkingAgentRow({ status: "active", is_inactive: true, is_deactivated: false })).toBe(false);
    expect(isWorkingAgentRow({ status: "active", is_inactive: false, is_deactivated: true })).toBe(false);
  });

  it("every consumer shares one query key per login", () => {
    expect(agentIdentityQueryKey("user-1")).toEqual(["agent-identity", "user-1"]);
    expect(agentIdentityQueryKey(undefined)).toEqual(["agent-identity", null]);
  });
});
