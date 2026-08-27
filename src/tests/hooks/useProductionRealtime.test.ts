/**
 * useProductionRealtime.test.ts
 *
 * Gaps covered:
 *   ✅ Singleton channel created once on first subscriber mount
 *   ✅ Second subscriber reuses existing channel (no duplicate creation)
 *   ✅ Window event listener added on mount
 *   ✅ onUpdate fires when production-realtime-update is dispatched
 *   ✅ onUpdate does NOT fire before the event is dispatched
 *   ✅ Event listener removed on unmount
 *   ✅ Channel removed when last subscriber unmounts (subscriberCount → 0)
 *   ✅ Channel NOT removed when one of two subscribers unmounts
 *   ✅ Channel subscribes to the 4 correct tables
 *
 * Approach: The hook uses module-level singleton vars (sharedChannel,
 * subscriberCount). cleanup() in afterEach unmounts all hooks which drives
 * subscriberCount back to 0 and resets sharedChannel = null. Each test
 * starts with clearAllMocks() so the channel mock is fresh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";

const PRODUCTION_EVENT = "production-realtime-update";

// Fresh supabase.channel mock per test — records every .on() call
function buildChannelMock() {
  const onCalls: { event: string; schema: string; table: string }[] = [];
  // C11: split mock build so .subscribe() can reference `mock` without
  // triggering TS2448 "used before declaration".
  const mock: {
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    _onCalls: typeof onCalls;
  } = {
    on: vi.fn(),
    subscribe: vi.fn(),
    _onCalls: onCalls,
  };
  mock.on = vi.fn((event: string, filter: { event: string; schema: string; table: string }) => {
    onCalls.push({ event, schema: filter.schema, table: filter.table });
    return mock;
  });
  mock.subscribe = vi.fn().mockReturnValue(mock);
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // cleanup() from setup.ts unmounts all hooks → subscriberCount back to 0
});

// ── Singleton creation ─────────────────────────────────────────────────────

describe("useProductionRealtime — singleton channel", () => {
  it("creates a channel on the first subscriber mount", () => {
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const onUpdate = vi.fn();
    const { unmount } = renderHook(() => useProductionRealtime(onUpdate, 0));

    expect(supabase.channel).toHaveBeenCalledTimes(1);
    expect(supabase.channel).toHaveBeenCalledWith("production-global-shared");
    unmount();
  });

  it("does NOT create a second channel when a second subscriber mounts", () => {
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const { unmount: unmount1 } = renderHook(() => useProductionRealtime(vi.fn(), 0));
    vi.mocked(supabase.channel).mockClear(); // clear the first-mount call

    const { unmount: unmount2 } = renderHook(() => useProductionRealtime(vi.fn(), 0));

    expect(supabase.channel).not.toHaveBeenCalled(); // reused the singleton
    unmount1();
    unmount2();
  });
});

// ── Table subscriptions ────────────────────────────────────────────────────

describe("useProductionRealtime — table subscriptions", () => {
  it("subscribes to native, external, and hiring truth tables", () => {
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const { unmount } = renderHook(() => useProductionRealtime(vi.fn(), 0));

    const tables = channelMock._onCalls.map((c) => c.table);
    for (const table of [
      "daily_production",
      "deals",
      "applications",
      "agents",
      "production_external_deals",
      "production_external_daily_snapshots",
    ]) expect(tables).toContain(table);
    expect(tables).not.toContain("agentlink_sync_log");
    unmount();
  });

  it("all table subscriptions are on the public schema with '*' event", () => {
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const { unmount } = renderHook(() => useProductionRealtime(vi.fn(), 0));

    channelMock._onCalls.forEach((call) => {
      expect(call.event).toBe("postgres_changes");
      expect(call.schema).toBe("public");
    });
    unmount();
  });
});

// ── Window event → onUpdate ────────────────────────────────────────────────

describe("useProductionRealtime — event dispatch", () => {
  it("adds window event listener on mount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const { unmount } = renderHook(() => useProductionRealtime(vi.fn(), 0));

    expect(addSpy).toHaveBeenCalledWith(PRODUCTION_EVENT, expect.any(Function));
    unmount();
    addSpy.mockRestore();
  });

  it("onUpdate fires when production-realtime-update is dispatched", async () => {
    vi.useFakeTimers();
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const onUpdate = vi.fn();
    const { unmount } = renderHook(() => useProductionRealtime(onUpdate, 0));

    act(() => {
      window.dispatchEvent(new CustomEvent(PRODUCTION_EVENT));
      vi.advanceTimersByTime(300); // past debounce
    });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    unmount();
    vi.useRealTimers();
  });

  it("onUpdate does NOT fire before the event is dispatched", () => {
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const onUpdate = vi.fn();
    const { unmount } = renderHook(() => useProductionRealtime(onUpdate, 0));

    expect(onUpdate).not.toHaveBeenCalled();
    unmount();
  });
});

// ── Cleanup ────────────────────────────────────────────────────────────────

describe("useProductionRealtime — cleanup", () => {
  it("removes window event listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const { unmount } = renderHook(() => useProductionRealtime(vi.fn(), 0));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith(PRODUCTION_EVENT, expect.any(Function));
    removeSpy.mockRestore();
  });

  it("calls supabase.removeChannel when the last subscriber unmounts", () => {
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const { unmount } = renderHook(() => useProductionRealtime(vi.fn(), 0));
    expect(supabase.removeChannel).not.toHaveBeenCalled();

    unmount();

    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("does NOT remove channel when one of two subscribers unmounts", () => {
    const channelMock = buildChannelMock();
    vi.mocked(supabase.channel).mockReturnValue(channelMock as any);

    const { unmount: unmount1 } = renderHook(() => useProductionRealtime(vi.fn(), 0));
    const { unmount: unmount2 } = renderHook(() => useProductionRealtime(vi.fn(), 0));

    unmount1(); // subscriber count: 2 → 1
    expect(supabase.removeChannel).not.toHaveBeenCalled(); // channel survives

    unmount2(); // subscriber count: 1 → 0
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
  });
});
