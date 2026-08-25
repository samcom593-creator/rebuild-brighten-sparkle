import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { useWeeklyBadges } from "@/hooks/useWeeklyBadges";

const rpc = vi.mocked(supabase.rpc);

const badgeRows = [
  { id: "alp-champion", name: "ALP Champion", description: "Top ALP", icon: "crown", color: "amber", week_start: "2026-08-24", value: "10000" },
  { id: "deal-machine", name: "Deal Machine", description: "Most deals", icon: "zap", color: "primary", week_start: "2026-08-24", value: 7 },
  { id: "referral-king", name: "Referral King", description: "Most referrals", icon: "star", color: "violet", week_start: "2026-08-24", value: 8 },
  { id: "presentation-pro", name: "Presentation Pro", description: "Most presentations", icon: "flame", color: "rose", week_start: "2026-08-24", value: 12 },
  { id: "top-closer", name: "Top Closer", description: "Best close rate", icon: "target", color: "emerald", week_start: "2026-08-24", value: 60 },
  { id: "rising-star", name: "Rising Star", description: "Top 3", icon: "trophy", color: "cyan", week_start: "2026-08-24", value: 2 },
];

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [], error: null } as never);
});

describe("useWeeklyBadges — private RPC contract", () => {
  it("does not query without an agent", async () => {
    const { result } = renderHook(() => useWeeklyBadges(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.badges).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks only for the caller's server-computed badges", async () => {
    rpc.mockResolvedValue({ data: badgeRows, error: null } as never);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(rpc).toHaveBeenCalledWith("my_weekly_badges");
    expect(rpc.mock.calls[0]).toHaveLength(1);
    expect(result.current.badges.map((badge) => badge.id)).toEqual(badgeRows.map((badge) => badge.id));
    expect(result.current.badges[0]).toMatchObject({ weekStart: "2026-08-24", value: 10000 });
  });

  it("normalizes nullable numeric values", async () => {
    rpc.mockResolvedValue({ data: [{ ...badgeRows[0], value: null }], error: null } as never);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.badges[0].value).toBe(0);
  });

  it("fails closed without leaking an exception", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "DB error" } } as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.badges).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("can refresh after a transient failure", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "temporary" } } as never)
      .mockResolvedValueOnce({ data: [badgeRows[1]], error: null } as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { result } = renderHook(() => useWeeklyBadges("agent-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.refetch());
    expect(result.current.badges[0]?.id).toBe("deal-machine");
    expect(rpc).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

describe("my_weekly_badges SQL authority", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260824150000_view_leak_lockdown_part2.sql"),
    "utf8",
  );

  it.each(badgeRows.map((row) => row.id))("defines %s on the server", (id) => {
    expect(sql).toContain(`'${id}'`);
  });

  it("resolves the caller from auth.uid and denies anonymous execution", () => {
    expect(sql).toContain("where a.user_id = auth.uid()");
    expect(sql).toContain("revoke all on function public.my_weekly_badges() from public, anon");
  });
});
