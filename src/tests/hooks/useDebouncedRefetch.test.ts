/**
 * useDebouncedRefetch.test.ts
 *
 * Gaps covered:
 *   ✅ First call fires after a short jitter delay
 *   ✅ Calls within delay window are coalesced into one
 *   ✅ Calls after delay window fire again
 *   ✅ Cancels the pending timeout on a new call (no double-fire)
 *   ✅ Custom delay is respected
 *
 * Missing / not yet tested:
 *   ❌ Jitter is random (0–200ms) — makes deterministic assertion tricky.
 *      At minimum verify that refetch fires within delay + 200ms window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedRefetch } from "@/hooks/useDebouncedRefetch";

describe("useDebouncedRefetch", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires the refetch function within the allowed window", () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useDebouncedRefetch(refetch, 1000));
    act(() => { result.current(); });
    act(() => { vi.advanceTimersByTime(1300); }); // delay + max jitter
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("multiple rapid calls coalesce into a single refetch", () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useDebouncedRefetch(refetch, 1000));
    act(() => {
      result.current();
      result.current();
      result.current();
    });
    act(() => { vi.advanceTimersByTime(1300); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("second call after delay passes fires a second refetch", () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useDebouncedRefetch(refetch, 500));
    act(() => { result.current(); });
    act(() => { vi.advanceTimersByTime(800); }); // past delay
    act(() => { result.current(); });
    act(() => { vi.advanceTimersByTime(800); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("refetch is never called before any timer fires", () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useDebouncedRefetch(refetch, 1000));
    act(() => { result.current(); });
    // Don't advance timers
    expect(refetch).not.toHaveBeenCalled();
  });

  it("custom delay 200ms is respected", () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useDebouncedRefetch(refetch, 200));
    act(() => { result.current(); });
    act(() => { vi.advanceTimersByTime(450); }); // 200 + 200 jitter max + buffer
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
