import { describe, expect, it } from "vitest";
import { proposedReason, rankDuplicateMembers } from "@/lib/agentDuplicateWinner";

// Live shape of the Tyler Krejcha pair on 2026-10-15 after the view read canonical production.
const ghost = { agent_id: "bd58ef59", lifetime_alp: "14354.00", created_at: "2026-09-23T20:06:46Z", has_login: false };
const login = { agent_id: "ce84cf2d", lifetime_alp: "1411.00", created_at: "2026-09-28T01:01:37Z", has_login: true };

describe("rankDuplicateMembers (which row the merge page proposes to keep)", () => {
  it("keeps the row with the login even when the ghost row holds more production", () => {
    expect(rankDuplicateMembers([ghost, login]).map((m) => m.agent_id)).toEqual(["ce84cf2d", "bd58ef59"]);
    expect(proposedReason(rankDuplicateMembers([ghost, login]))).toBe("login");
  });

  it("keeps the login row on a $0 tie, where the old ALP-only sort kept the older ghost", () => {
    const tie = [
      { ...ghost, lifetime_alp: "0.00" },
      { ...login, lifetime_alp: "0.00" },
    ];
    expect(rankDuplicateMembers(tie)[0].agent_id).toBe("ce84cf2d");
    expect(proposedReason(rankDuplicateMembers(tie))).toBe("production");
  });

  it("falls back to most ALP, then oldest, when login does not separate the rows", () => {
    const a = { agent_id: "a", lifetime_alp: 100, created_at: "2026-01-02T00:00:00Z", has_login: true };
    const b = { agent_id: "b", lifetime_alp: 900, created_at: "2026-01-03T00:00:00Z", has_login: true };
    const c = { agent_id: "c", lifetime_alp: 900, created_at: "2026-01-01T00:00:00Z", has_login: true };
    expect(rankDuplicateMembers([a, b, c]).map((m) => m.agent_id)).toEqual(["c", "b", "a"]);
    expect(proposedReason(rankDuplicateMembers([a, b, c]))).toBe("production");
  });

  it("treats a missing has_login (view not yet deployed) as unknown, so ALP decides", () => {
    const x = { agent_id: "x", lifetime_alp: 5, created_at: "2026-01-01T00:00:00Z" };
    const y = { agent_id: "y", lifetime_alp: 50, created_at: "2026-01-02T00:00:00Z" };
    expect(rankDuplicateMembers([x, y])[0].agent_id).toBe("y");
  });

  it("does not mutate its input", () => {
    const input = [ghost, login];
    rankDuplicateMembers(input);
    expect(input[0].agent_id).toBe("bd58ef59");
  });
});
