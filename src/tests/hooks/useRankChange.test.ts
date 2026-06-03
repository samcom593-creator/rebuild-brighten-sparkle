/**
 * useRankChange.test.ts
 *
 * Gaps covered:
 *   ✅ ALP ranking — sorts by aop descending, assigns correct rank positions
 *   ✅ ALP ranking — agent with 0 aop is ranked last
 *   ✅ Closing-rate ranking — only includes agents with 3+ presentations
 *   ✅ Closing-rate ranking — agents with <3 presentations are excluded
 *   ✅ Closing-rate ranking — correct rate calculation (deals / presentations * 100)
 *   ✅ Referrals ranking — only includes agents with referral_presentations > 0 OR referrals_caught > 0
 *   ✅ Referrals ranking — sorts by referral_presentations descending
 *   ✅ getRankChange — returns { change: null } for a new agent (no prior rank)
 *   ✅ getRankChange — positive change when agent moved up
 *   ✅ getRankChange — negative change when agent moved down
 *   ✅ getRankChange — zero change when rank is unchanged
 *   ✅ Empty production data → hasPreviousData false
 *   ✅ DB error → hasPreviousData false, no throw
 *
 * NOT YET TESTED:
 *   ❌ The actual Supabase query date param (getDateDaysAgoPST result) — mocking
 *      that utility would be needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { useRankChange } from "@/hooks/useRankChange";

// ── Supabase mock helpers ─────────────────────────────────────────────────────

type MockProductionRow = {
  agent_id: string;
  aop: number | null;
  deals_closed: number | null;
  presentations: number | null;
  referral_presentations: number | null;
  referrals_caught: number | null;
};

function mockFromSelect(rows: MockProductionRow[], error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  vi.mocked(supabase.from).mockReturnValue(chain as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── ALP ranking ───────────────────────────────────────────────────────────────
describe("useRankChange — ALP leaderboard", () => {
  it("assigns rank 1 to highest aop agent", async () => {
    mockFromSelect([
      { agent_id: "agent-b", aop: 3000, deals_closed: 2, presentations: 5, referral_presentations: 0, referrals_caught: 0 },
      { agent_id: "agent-a", aop: 8000, deals_closed: 4, presentations: 6, referral_presentations: 0, referrals_caught: 0 },
      { agent_id: "agent-c", aop: 1000, deals_closed: 1, presentations: 3, referral_presentations: 0, referrals_caught: 0 },
    ]);
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getRankChange("agent-a", 1)).toMatchObject({
      agentId: "agent-a",
      previousRank: 1,
      change: 0,
    });
    expect(result.current.getRankChange("agent-b", 2)).toMatchObject({
      agentId: "agent-b",
      previousRank: 2,
      change: 0,
    });
    expect(result.current.getRankChange("agent-c", 3)).toMatchObject({
      agentId: "agent-c",
      previousRank: 3,
      change: 0,
    });
  });

  it("treats null aop as 0 (agent ranked last)", async () => {
    mockFromSelect([
      { agent_id: "agent-a", aop: 5000, deals_closed: 2, presentations: 4, referral_presentations: 0, referrals_caught: 0 },
      { agent_id: "agent-z", aop: null, deals_closed: 0, presentations: 0, referral_presentations: 0, referrals_caught: 0 },
    ]);
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // agent-z with null aop should be rank 2
    expect(result.current.getRankChange("agent-z", 2).previousRank).toBe(2);
  });

  it("hasPreviousData is true when data loads successfully", async () => {
    mockFromSelect([
      { agent_id: "agent-a", aop: 5000, deals_closed: 2, presentations: 4, referral_presentations: 0, referrals_caught: 0 },
    ]);
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPreviousData).toBe(true);
  });
});

// ── Closing-rate ranking ──────────────────────────────────────────────────────
describe("useRankChange — closing-rate leaderboard", () => {
  it("excludes agents with fewer than 3 presentations", async () => {
    mockFromSelect([
      { agent_id: "agent-low", aop: 3000, deals_closed: 2, presentations: 2, referral_presentations: 0, referrals_caught: 0 },
      { agent_id: "agent-ok",  aop: 3000, deals_closed: 3, presentations: 5, referral_presentations: 0, referrals_caught: 0 },
    ]);
    const { result } = renderHook(() => useRankChange("closing-rate"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // agent-low has 2 presentations → excluded, should have no previous rank
    expect(result.current.getRankChange("agent-low", 1).previousRank).toBeNull();
    // agent-ok has 5 presentations → included at rank 1
    expect(result.current.getRankChange("agent-ok", 1).previousRank).toBe(1);
  });

  it("calculates rate as (deals / presentations) * 100", async () => {
    mockFromSelect([
      // 3/5 = 60%
      { agent_id: "agent-a", aop: 0, deals_closed: 3, presentations: 5, referral_presentations: 0, referrals_caught: 0 },
      // 4/4 = 100% → higher → rank 1
      { agent_id: "agent-b", aop: 0, deals_closed: 4, presentations: 4, referral_presentations: 0, referrals_caught: 0 },
    ]);
    const { result } = renderHook(() => useRankChange("closing-rate"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getRankChange("agent-b", 1).previousRank).toBe(1);
    expect(result.current.getRankChange("agent-a", 2).previousRank).toBe(2);
  });
});

// ── Referrals ranking ─────────────────────────────────────────────────────────
describe("useRankChange — referrals leaderboard", () => {
  it("excludes agents with 0 referrals and 0 referral_presentations", async () => {
    mockFromSelect([
      { agent_id: "agent-none", aop: 0, deals_closed: 0, presentations: 5, referral_presentations: 0, referrals_caught: 0 },
      { agent_id: "agent-ref",  aop: 0, deals_closed: 0, presentations: 4, referral_presentations: 3, referrals_caught: 1 },
    ]);
    const { result } = renderHook(() => useRankChange("referrals"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getRankChange("agent-none", 1).previousRank).toBeNull();
    expect(result.current.getRankChange("agent-ref", 1).previousRank).toBe(1);
  });

  it("includes agents with referrals_caught > 0 even if referral_presentations is 0", async () => {
    mockFromSelect([
      { agent_id: "agent-caught", aop: 0, deals_closed: 0, presentations: 3, referral_presentations: 0, referrals_caught: 2 },
    ]);
    const { result } = renderHook(() => useRankChange("referrals"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getRankChange("agent-caught", 1).previousRank).toBe(1);
  });

  it("sorts by referral_presentations descending", async () => {
    mockFromSelect([
      { agent_id: "agent-low",  aop: 0, deals_closed: 0, presentations: 3, referral_presentations: 2, referrals_caught: 1 },
      { agent_id: "agent-high", aop: 0, deals_closed: 0, presentations: 3, referral_presentations: 8, referrals_caught: 1 },
    ]);
    const { result } = renderHook(() => useRankChange("referrals"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getRankChange("agent-high", 1).previousRank).toBe(1);
    expect(result.current.getRankChange("agent-low", 2).previousRank).toBe(2);
  });
});

// ── getRankChange return values ───────────────────────────────────────────────
describe("useRankChange — getRankChange", () => {
  beforeEach(() => {
    mockFromSelect([
      { agent_id: "agent-a", aop: 8000, deals_closed: 4, presentations: 5, referral_presentations: 0, referrals_caught: 0 },
      { agent_id: "agent-b", aop: 4000, deals_closed: 2, presentations: 4, referral_presentations: 0, referrals_caught: 0 },
    ]);
  });

  it("returns null change for an agent not in yesterday's data", async () => {
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const rank = result.current.getRankChange("agent-new", 1);
    expect(rank.previousRank).toBeNull();
    expect(rank.change).toBeNull();
  });

  it("returns positive change when agent moved up (previousRank > currentRank)", async () => {
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // agent-b was rank 2 yesterday; now at currentRank 1 → moved up by 1
    const rank = result.current.getRankChange("agent-b", 1);
    expect(rank.change).toBe(1); // previousRank(2) - currentRank(1) = 1
  });

  it("returns negative change when agent moved down (previousRank < currentRank)", async () => {
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // agent-a was rank 1 yesterday; now at currentRank 2 → moved down by 1
    const rank = result.current.getRankChange("agent-a", 2);
    expect(rank.change).toBe(-1); // previousRank(1) - currentRank(2) = -1
  });

  it("returns 0 change when rank is unchanged", async () => {
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const rank = result.current.getRankChange("agent-a", 1);
    expect(rank.change).toBe(0);
  });
});

// ── Error / empty state ───────────────────────────────────────────────────────
describe("useRankChange — edge cases", () => {
  it("hasPreviousData is false when production data is empty", async () => {
    mockFromSelect([]);
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPreviousData).toBe(false);
  });

  it("hasPreviousData is false on DB error, does not throw", async () => {
    mockFromSelect([], { message: "connection refused" });
    const { result } = renderHook(() => useRankChange("alp"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasPreviousData).toBe(false);
  });
});
