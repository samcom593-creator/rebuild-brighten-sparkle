/**
 * useInFlightGuard.test.ts
 *
 * Gaps covered:
 *   ✅ Allows first call through immediately
 *   ✅ Second concurrent call is swallowed (returns undefined while in-flight)
 *   ✅ Trailing refetch fires after the in-flight call completes
 *   ✅ Only one trailing refetch fires (not N for N concurrent callers)
 *   ✅ After in-flight + trailing both complete, third call goes through normally
 *
 * Missing / not yet tested:
 *   ❌ refetchFn throwing — does the guard correctly clear isInFlight on error?
 *     Current implementation uses `finally`, so it should — but worth a test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInFlightGuard } from "@/hooks/useInFlightGuard";

describe("useInFlightGuard", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("passes the first call through", async () => {
    const refetch = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() => useInFlightGuard(refetch));
    await act(async () => { await result.current(); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("swallows a second call while the first is in-flight", async () => {
    let resolveFirst!: (v: string) => void;
    const firstPromise = new Promise<string>((res) => { resolveFirst = res; });
    const refetch = vi.fn().mockReturnValueOnce(firstPromise).mockResolvedValue("later");

    const { result } = renderHook(() => useInFlightGuard(refetch));
    // Fire two calls concurrently
    let r2: any;
    await act(async () => {
      result.current(); // in-flight
      r2 = await result.current(); // should be swallowed
    });
    expect(r2).toBeUndefined();
    expect(refetch).toHaveBeenCalledTimes(1); // only the first one ran
    resolveFirst("done");
  });

  it("queues exactly one trailing refetch for multiple concurrent swallowed calls", async () => {
    let resolveFirst!: (v: string) => void;
    const firstPromise = new Promise<string>((res) => { resolveFirst = res; });
    const refetch = vi.fn().mockReturnValueOnce(firstPromise).mockResolvedValue("later");

    const { result } = renderHook(() => useInFlightGuard(refetch));
    act(() => {
      result.current(); // in-flight
      result.current(); // swallowed, sets pending
      result.current(); // swallowed again, pending already set
    });

    await act(async () => {
      resolveFirst("done");
      await vi.runAllTimersAsync();
    });

    // Should have run: original + exactly 1 trailing
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("allows a fresh call after all in-flight activity has settled", async () => {
    const refetch = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() => useInFlightGuard(refetch));

    await act(async () => { await result.current(); });
    await act(async () => { await result.current(); });

    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("clears in-flight flag even when refetchFn throws", async () => {
    const refetch = vi.fn()
      .mockRejectedValueOnce(new Error("oops"))
      .mockResolvedValue("ok");
    const { result } = renderHook(() => useInFlightGuard(refetch));

    await act(async () => {
      try { await result.current(); } catch {}
    });
    // Should be able to call again
    await act(async () => { await result.current(); });
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
