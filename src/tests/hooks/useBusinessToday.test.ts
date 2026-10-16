/**
 * useBusinessToday (F32 / F21): the key advances at Phoenix midnight, re-arms
 * for the next one, and re-syncs when the tab becomes visible after the clock
 * jumped (a laptop that slept through midnight). Fake timers drive both the
 * timers and Date.now().
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBusinessToday } from "@/hooks/useBusinessToday";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
});

describe("useBusinessToday", () => {
  it("starts on the Phoenix business date, not the browser's calendar date", () => {
    vi.setSystemTime(new Date("2026-10-14T06:30:00Z")); // 23:30 on Oct 13 in Phoenix; already Oct 14 in UTC
    const { result } = renderHook(() => useBusinessToday());
    expect(result.current).toBe("2026-10-13");
  });

  it("advances at the next Phoenix midnight and re-arms for the following one", () => {
    vi.setSystemTime(new Date("2026-10-14T06:59:59.000Z"));
    const { result } = renderHook(() => useBusinessToday());
    expect(result.current).toBe("2026-10-13");

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe("2026-10-14");

    act(() => {
      vi.advanceTimersByTime(24 * 3_600_000);
    });
    expect(result.current).toBe("2026-10-15");
  });

  it("re-syncs when the document becomes visible after the clock jumped past midnight", () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00Z"));
    const { result } = renderHook(() => useBusinessToday());
    expect(result.current).toBe("2026-10-14");

    vi.setSystemTime(new Date("2026-10-15T20:00:00Z"));
    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe("2026-10-15");
  });

  it("ignores a visibilitychange to hidden", () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00Z"));
    const { result } = renderHook(() => useBusinessToday());
    vi.setSystemTime(new Date("2026-10-15T20:00:00Z"));
    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe("2026-10-14");
  });

  it("takes another zone for the legacy Chicago surfaces", () => {
    vi.setSystemTime(new Date("2026-10-14T05:30:00Z")); // 00:30 CDT, 22:30 MST
    const chicago = renderHook(() => useBusinessToday("America/Chicago"));
    const phoenix = renderHook(() => useBusinessToday());
    expect(chicago.result.current).toBe("2026-10-14");
    expect(phoenix.result.current).toBe("2026-10-13");
  });

  it("clears its timer on unmount", () => {
    vi.setSystemTime(new Date("2026-10-14T20:00:00Z"));
    const { unmount } = renderHook(() => useBusinessToday());
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
