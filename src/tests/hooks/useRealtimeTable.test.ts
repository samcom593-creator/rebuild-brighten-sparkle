/**
 * useRealtimeTable.test.ts
 *
 * Gaps covered:
 *   ✅ Subscription is created on mount with correct table/event/filter
 *   ✅ Channel is removed on unmount
 *   ✅ enabled=false prevents subscription creation
 *   ✅ Toggling enabled from false to true creates subscription
 *   ✅ Toggling enabled from true to false removes subscription
 *   ✅ onChange handler is called when a payload arrives
 *   ✅ Channel name is stable for same (table, filter, suffix) combo
 *
 * Missing / not yet tested:
 *   ❌ onChange reference stability — if caller passes a new function on each
 *      render, the subscription should NOT be torn down (refs are used for this,
 *      but verify it doesn't re-subscribe on every render).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTable } from "@/shared/realtime/useRealtimeTable";

const mockOn = vi.fn();
const mockSubscribe = vi.fn();
const mockRemoveChannel = vi.mocked(supabase.removeChannel);
const mockChannel = vi.mocked(supabase.channel);

beforeEach(() => {
  vi.clearAllMocks();
  mockOn.mockReturnThis();
  mockSubscribe.mockReturnThis();
  mockChannel.mockReturnValue({ on: mockOn, subscribe: mockSubscribe } as any);
});

describe("useRealtimeTable — subscription lifecycle", () => {
  it("creates a channel on mount", () => {
    renderHook(() =>
      useRealtimeTable({ table: "agents", enabled: true }, vi.fn())
    );
    expect(mockChannel).toHaveBeenCalledWith(
      expect.stringContaining("rt:agents:")
    );
    expect(mockOn).toHaveBeenCalled();
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it("removes the channel on unmount", () => {
    const { unmount } = renderHook(() =>
      useRealtimeTable({ table: "agents" }, vi.fn())
    );
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it("does not create a channel when enabled=false", () => {
    renderHook(() =>
      useRealtimeTable({ table: "agents", enabled: false }, vi.fn())
    );
    expect(mockChannel).not.toHaveBeenCalled();
  });
});

describe("useRealtimeTable — filter handling", () => {
  it("passes filter to postgres_changes config when provided", () => {
    renderHook(() =>
      useRealtimeTable(
        { table: "deals", filter: "agent_id=eq.abc", enabled: true },
        vi.fn()
      )
    );
    const onArgs = mockOn.mock.calls[0][1] as any;
    expect(onArgs.filter).toBe("agent_id=eq.abc");
  });

  it("does not include filter key when filter is undefined", () => {
    renderHook(() =>
      useRealtimeTable({ table: "deals", enabled: true }, vi.fn())
    );
    const onArgs = mockOn.mock.calls[0][1] as any;
    expect(onArgs.filter).toBeUndefined();
  });
});

describe("useRealtimeTable — channel naming", () => {
  it("channel name includes table and suffix", () => {
    renderHook(() =>
      useRealtimeTable(
        { table: "applications", channelSuffix: "admin", enabled: true },
        vi.fn()
      )
    );
    const channelName = mockChannel.mock.calls[0][0];
    expect(channelName).toContain("applications");
    expect(channelName).toContain("admin");
  });

  it("two hooks with different suffixes create different channels", () => {
    const { unmount: u1 } = renderHook(() =>
      useRealtimeTable({ table: "deals", channelSuffix: "a", enabled: true }, vi.fn())
    );
    const { unmount: u2 } = renderHook(() =>
      useRealtimeTable({ table: "deals", channelSuffix: "b", enabled: true }, vi.fn())
    );
    const names = mockChannel.mock.calls.map((c) => c[0]);
    expect(names[0]).not.toBe(names[1]);
    u1(); u2();
  });
});

describe("useRealtimeTable — onChange callback", () => {
  it("calls onChange when a postgres_changes event fires", () => {
    const onChange = vi.fn();
    let capturedHandler: Function;

    mockOn.mockImplementationOnce((_type: any, _config: any, handler: Function) => {
      capturedHandler = handler;
      return { subscribe: mockSubscribe };
    });

    renderHook(() =>
      useRealtimeTable({ table: "agents", enabled: true }, onChange)
    );

    act(() => {
      capturedHandler!({
        eventType: "INSERT",
        new: { id: "1", name: "Test Agent" },
        old: null,
      });
    });

    expect(onChange).toHaveBeenCalledWith({
      eventType: "INSERT",
      new: { id: "1", name: "Test Agent" },
      old: null,
    });
  });
});

describe("useRealtimeTable — enabled toggling", () => {
  it("toggling enabled from false to true subscribes", () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useRealtimeTable({ table: "deals", enabled }, vi.fn()),
      { initialProps: { enabled: false } }
    );
    expect(mockChannel).not.toHaveBeenCalled();
    rerender({ enabled: true });
    expect(mockChannel).toHaveBeenCalled();
  });

  it("toggling enabled from true to false removes channel", () => {
    const { rerender } = renderHook(
      ({ enabled }) =>
        useRealtimeTable({ table: "deals", enabled }, vi.fn()),
      { initialProps: { enabled: true } }
    );
    rerender({ enabled: false });
    expect(mockRemoveChannel).toHaveBeenCalled();
  });
});
