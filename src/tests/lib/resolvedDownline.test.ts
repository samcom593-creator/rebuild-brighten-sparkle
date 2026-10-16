/**
 * resolvedDownline (F10 / F17, 2026-10-15): a manager's team is read under the
 * row the shared identity resolver chose, and a bad answer is an error, never
 * a smaller or empty team.
 */
import { describe, expect, it } from "vitest";
import type { AgentIdentity, AgentIdentityRow } from "@/lib/agentIdentity";
import { downlineSourceFor, parseDownlineIds } from "@/lib/resolvedDownline";

const row = (id: string): AgentIdentityRow => ({
  id,
  user_id: "user-1",
  agent_code: "A1",
  display_name: "Test Manager",
  status: "active",
  is_inactive: false,
  is_deactivated: false,
  created_at: "2026-01-01T00:00:00Z",
  canonical_agent_id: null,
});

describe("downlineSourceFor", () => {
  it("reads the team under the resolved row, including one reached through a merge pointer", () => {
    const resolved: AgentIdentity = { status: "resolved", agentId: "agent-1", row: row("agent-1") };
    expect(downlineSourceFor(resolved)).toEqual({ kind: "root", agentId: "agent-1" });
    const merged: AgentIdentity = { status: "resolved", agentId: "winner", row: row("winner"), mergedFromAgentId: "loser", note: "merged" };
    expect(downlineSourceFor(merged)).toEqual({ kind: "root", agentId: "winner" });
  });

  it("falls back to the server's own lookup only when the resolver failed", () => {
    expect(downlineSourceFor({ status: "error", message: "Network request failed." })).toEqual({ kind: "server" });
  });

  it("has nothing to read while loading, for no agent row, or for an ambiguous login", () => {
    expect(downlineSourceFor(undefined)).toEqual({ kind: "none" });
    expect(downlineSourceFor({ status: "none" })).toEqual({ kind: "none" });
    // Quarantined: the server's LIMIT 1 would pick one of the candidates at random.
    expect(downlineSourceFor({ status: "ambiguous", candidates: [row("a"), row("b")] })).toEqual({ kind: "none" });
  });
});

describe("parseDownlineIds", () => {
  it("returns the agent ids in order, once each", () => {
    expect(parseDownlineIds([{ agent_id: "root" }, { agent_id: "a" }, { agent_id: "root" }, { agent_id: "b" }])).toEqual(["root", "a", "b"]);
    expect(parseDownlineIds([])).toEqual([]);
  });

  it("throws on anything that is not the RPC's row set, instead of returning a smaller team", () => {
    expect(() => parseDownlineIds(null)).toThrow("no result set");
    expect(() => parseDownlineIds({ agent_id: "a" })).toThrow("no result set");
    expect(() => parseDownlineIds([{ agent_id: "a" }, { id: "b" }])).toThrow("without an agent id");
    expect(() => parseDownlineIds([{ agent_id: "" }])).toThrow("without an agent id");
    expect(() => parseDownlineIds([null])).toThrow("without an agent id");
    expect(() => parseDownlineIds(["a"])).toThrow("without an agent id");
  });
});
