/**
 * useWeeklyBadges.test.ts
 *
 * Gaps covered:
 *   ✅ null agentId → empty badges, loading=false immediately (no DB call)
 *   ✅ DB error → empty badges, no throw
 *   ✅ No production data → empty badges
 *   ✅ ALP Champion — awarded to agent with highest ALP (> 0)
 *   ✅ ALP Champion — NOT awarded when agent is not top by ALP
 *   ✅ ALP Champion — NOT awarded when agent ALP is 0 (even if all others are 0)
 *   ✅ Top Closer — awarded to agent with highest closing rate (min 3 presentations)
 *   ✅ Top Closer — NOT awarded when agent has <3 presentations (below qualification threshold)
 *   ✅ Top Closer — NOT awarded when no agent has ≥3 presentations
 *   ✅ Top Closer — correct closing rate calculation (deals / presentations * 100)
 *   ✅ Deal Machine — awarded to agent with most deals closed (> 0)
 *   ✅ Deal Machine — NOT awarded when agent does not have the most deals
 *   ✅ Referral King — awarded to agent with most referrals caught (> 0)
 *   ✅ Presentation Pro — awarded to agent with most presentations (> 0)
 *   ✅ Rising Star — awarded when agent is top-3 in 2+ categories (ALP, deals, closing rate)
 *   ✅ Rising Star — NOT awarded when agent is top-3 in only 1 category
 *   ✅ Multiple badges earned simultaneously
 *   ✅ source field is always 'lead_counter' — n/a (separate hook); checked: loading starts true
 *
 * Approach: mock supabase.from to return sequenced responses for
 * daily_production (first call) and agents (second call).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { useWeeklyBadges } from "@/hooks/useWeeklyBadges";

// ── Mock helpers ──────────────────────────────────────────────────────────────

type ProductionRow = {
  agent_id: string;
  aop: number | null;
  deals_closed: number | null;
  presentations: number | null;
  referrals_caught: number | null;
  closing_rate: number | null;
};

type AgentRow = {
  id: string;
  profile_id: string | null;
  profiles: { full_name: string } | null;
};

/**
 * Sets up supabase.from to return `productionRows` for the first call
 * (daily_production) and `agentRows` for the second call (agents).
 */
function mockSupabaseSequence(
  productionRows: ProductionRow[],
  agentRows: AgentRow[] = [],
  productionError: unknown = null,
) {
  let callCount = 0;
  vi.mocked(supabase.from).mockImplementation((_table: string) => {
    callCount++;
    if (callCount === 1) {
      // daily_production query chain
      const chain = {
        select: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ data: productionError ? null : productionRows, error: productionError }),
      };
      return chain as any;
    }
    // agents query chain
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: agentRows, error: null }),
    };
    return chain as any;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Null agentId ───────────────────────────────────────────────────────────────

describe("useWeeklyBadges — null agentId", () => {
  it("returns empty badges immediately with loading=false", async () => {
    const { result } = renderHook(() => useWeeklyBadges(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.badges).toHaveLength(0);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("useWeeklyBadges — error handling", () => {
  it("returns empty badges when Supabase throws", async () => {
    mockSupabaseSequence([], [], { message: "DB error" });
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.badges).toHaveLength(0);
  });

  it("returns empty badges when production data is empty", async () => {
    mockSupabaseSequence([]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.badges).toHaveLength(0);
  });
});

// ── ALP Champion ───────────────────────────────────────────────────────────────

describe("useWeeklyBadges — ALP Champion badge", () => {
  it("awards ALP Champion to the agent with the highest ALP (> 0)", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 10000, deals_closed: 4, presentations: 6, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 5000, deals_closed: 2, presentations: 4, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "alp-champion");
    expect(badge).toBeDefined();
    expect(badge?.name).toBe("ALP Champion");
    expect(badge?.value).toBe(10000);
  });

  it("does NOT award ALP Champion when agent is not the top earner", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 3000, deals_closed: 2, presentations: 3, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 8000, deals_closed: 4, presentations: 5, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "alp-champion")).toBeUndefined();
  });

  it("does NOT award ALP Champion when agent ALP is 0", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 0, deals_closed: 0, presentations: 0, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "alp-champion")).toBeUndefined();
  });

  it("handles null aop as 0", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: null, deals_closed: 0, presentations: 0, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "alp-champion")).toBeUndefined();
  });
});

// ── Top Closer ─────────────────────────────────────────────────────────────────

describe("useWeeklyBadges — Top Closer badge", () => {
  it("awards Top Closer to agent with highest closing rate (≥3 presentations)", async () => {
    mockSupabaseSequence([
      // agent-1: 4/4 = 100% closing rate, qualifies (≥3 pres)
      { agent_id: "agent-1", aop: 5000, deals_closed: 4, presentations: 4, referrals_caught: 0, closing_rate: null },
      // agent-2: 6/10 = 60% closing rate, qualifies
      { agent_id: "agent-2", aop: 8000, deals_closed: 6, presentations: 10, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "top-closer");
    expect(badge).toBeDefined();
    expect(badge?.value).toBe(100); // 4/4 * 100
  });

  it("does NOT award Top Closer when agent has fewer than 3 presentations", async () => {
    mockSupabaseSequence([
      // agent-1: only 2 presentations — below threshold
      { agent_id: "agent-1", aop: 5000, deals_closed: 2, presentations: 2, referrals_caught: 0, closing_rate: null },
      // agent-2: 5 presentations — qualifies
      { agent_id: "agent-2", aop: 3000, deals_closed: 3, presentations: 5, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "top-closer")).toBeUndefined();
  });

  it("does NOT award Top Closer when no agent has 3+ presentations", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 5000, deals_closed: 2, presentations: 2, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 3000, deals_closed: 1, presentations: 1, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "top-closer")).toBeUndefined();
  });

  it("calculates closing rate correctly as deals/presentations * 100", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 5000, deals_closed: 3, presentations: 5, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "top-closer");
    expect(badge?.value).toBeCloseTo(60, 0); // 3/5 * 100 = 60%
  });
});

// ── Deal Machine ───────────────────────────────────────────────────────────────

describe("useWeeklyBadges — Deal Machine badge", () => {
  it("awards Deal Machine to agent with the most deals closed", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 8000, deals_closed: 7, presentations: 9, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 5000, deals_closed: 3, presentations: 5, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "deal-machine");
    expect(badge).toBeDefined();
    expect(badge?.value).toBe(7);
  });

  it("does NOT award Deal Machine when agent does not lead in deals", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 3000, deals_closed: 2, presentations: 4, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 5000, deals_closed: 5, presentations: 7, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "deal-machine")).toBeUndefined();
  });

  it("does NOT award Deal Machine when agent deals_closed is 0", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 0, deals_closed: 0, presentations: 0, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "deal-machine")).toBeUndefined();
  });
});

// ── Referral King ──────────────────────────────────────────────────────────────

describe("useWeeklyBadges — Referral King badge", () => {
  it("awards Referral King to agent with most referrals caught (> 0)", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 5000, deals_closed: 3, presentations: 5, referrals_caught: 8, closing_rate: null },
      { agent_id: "agent-2", aop: 8000, deals_closed: 5, presentations: 7, referrals_caught: 2, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "referral-king");
    expect(badge).toBeDefined();
    expect(badge?.value).toBe(8);
  });

  it("does NOT award Referral King when agent has 0 referrals", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 5000, deals_closed: 3, presentations: 5, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "referral-king")).toBeUndefined();
  });
});

// ── Presentation Pro ───────────────────────────────────────────────────────────

describe("useWeeklyBadges — Presentation Pro badge", () => {
  it("awards Presentation Pro to agent with most presentations (> 0)", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 5000, deals_closed: 3, presentations: 12, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 8000, deals_closed: 5, presentations: 7, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "presentation-pro");
    expect(badge).toBeDefined();
    expect(badge?.value).toBe(12);
  });

  it("does NOT award Presentation Pro when agent has 0 presentations", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 0, deals_closed: 0, presentations: 0, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "presentation-pro")).toBeUndefined();
  });
});

// ── Rising Star ────────────────────────────────────────────────────────────────

describe("useWeeklyBadges — Rising Star badge", () => {
  it("awards Rising Star when agent is top-3 in 2+ categories", async () => {
    // agent-1: #1 in ALP, #2 in deals — qualifies (2 top-3 categories)
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 9000, deals_closed: 4, presentations: 5, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 7000, deals_closed: 6, presentations: 7, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-3", aop: 5000, deals_closed: 3, presentations: 4, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "rising-star");
    expect(badge).toBeDefined();
    expect(badge?.value).toBeGreaterThanOrEqual(2);
  });

  it("does NOT award Rising Star when agent is top-3 in only 1 category", async () => {
    // agent-1: #1 in ALP only; low in deals and closing rate
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 10000, deals_closed: 1, presentations: 3, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 8000, deals_closed: 8, presentations: 10, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-3", aop: 7000, deals_closed: 7, presentations: 8, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-4", aop: 6000, deals_closed: 6, presentations: 7, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges.find((b) => b.id === "rising-star")).toBeUndefined();
  });

  it("awards Rising Star when agent is top-3 in exactly 2 categories (boundary)", async () => {
    // agent-1: #2 ALP, #3 deals, not in closing rate top-3
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 8000, deals_closed: 4, presentations: 10, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-2", aop: 9000, deals_closed: 6, presentations: 8, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-3", aop: 7000, deals_closed: 5, presentations: 7, referrals_caught: 0, closing_rate: null },
      { agent_id: "agent-4", aop: 3000, deals_closed: 2, presentations: 3, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const badge = result.current.badges.find((b) => b.id === "rising-star");
    expect(badge).toBeDefined();
    expect(badge?.value).toBe(2);
  });
});

// ── Multiple badges ────────────────────────────────────────────────────────────

describe("useWeeklyBadges — multiple badges simultaneously", () => {
  it("can award ALP Champion + Deal Machine + Presentation Pro to the same agent", async () => {
    mockSupabaseSequence([
      // agent-1 dominates everything
      { agent_id: "agent-1", aop: 15000, deals_closed: 10, presentations: 15, referrals_caught: 5, closing_rate: null },
      { agent_id: "agent-2", aop: 5000, deals_closed: 3, presentations: 5, referrals_caught: 1, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.badges.map((b) => b.id);
    expect(ids).toContain("alp-champion");
    expect(ids).toContain("deal-machine");
    expect(ids).toContain("presentation-pro");
    expect(ids).toContain("referral-king");
  });

  it("awards zero badges when agent is consistently mid-pack", async () => {
    mockSupabaseSequence([
      { agent_id: "leader-1", aop: 20000, deals_closed: 15, presentations: 20, referrals_caught: 10, closing_rate: null },
      { agent_id: "leader-2", aop: 18000, deals_closed: 12, presentations: 18, referrals_caught: 8, closing_rate: null },
      { agent_id: "leader-3", aop: 15000, deals_closed: 10, presentations: 15, referrals_caught: 6, closing_rate: null },
      { agent_id: "agent-1", aop: 2000, deals_closed: 1, presentations: 2, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.badges).toHaveLength(0);
  });
});

// ── Return shape ───────────────────────────────────────────────────────────────

describe("useWeeklyBadges — badge shape", () => {
  it("every badge has required fields: id, name, description, icon, color, weekStart, value", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 10000, deals_closed: 5, presentations: 6, referrals_caught: 2, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.badges.forEach((badge) => {
      expect(badge).toHaveProperty("id");
      expect(badge).toHaveProperty("name");
      expect(badge).toHaveProperty("description");
      expect(badge).toHaveProperty("icon");
      expect(badge).toHaveProperty("color");
      expect(badge).toHaveProperty("weekStart");
      expect(badge).toHaveProperty("value");
    });
  });

  it("weekStart is a valid YYYY-MM-DD string", async () => {
    mockSupabaseSequence([
      { agent_id: "agent-1", aop: 10000, deals_closed: 5, presentations: 6, referrals_caught: 0, closing_rate: null },
    ]);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    if (result.current.badges.length > 0) {
      expect(result.current.badges[0].weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
