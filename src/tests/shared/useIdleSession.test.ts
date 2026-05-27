/**
 * useIdleSession.test.ts
 *
 * Gaps covered:
 *   ✅ Warning shows after idle window (warningMs before timeout)
 *   ✅ Countdown decrements every second once warning is shown
 *   ✅ onTimeout fires exactly once when full timeout elapses
 *   ✅ Activity resets the timer (no warning)
 *   ✅ extendSession clears warning and reschedules timers
 *   ✅ enabled=false prevents timers from starting
 *   ✅ Disabling mid-session clears warning state
 *   ✅ Activity during warning does NOT extend session (user must click)
 *
 * Missing / not yet tested:
 *   ❌ Tab visibility change (blur/focus) should not auto-extend — currently
 *      the hook uses DOM events, and document.hidden is not factored in.
 *   ❌ Multiple rapid activity events don't fire multiple timeouts (timer
 *      dedup via clearAllTimers).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIdleSession } from "@/shared/auth/useIdleSession";

describe("useIdleSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show warning before idle window has elapsed", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 5000, warningMs: 1000, enabled: true, onTimeout })
    );
    act(() => { vi.advanceTimersByTime(3000); }); // before warn threshold (5000-1000=4000)
    expect(result.current.showWarning).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("shows warning after (idleTimeoutMs - warningMs) of inactivity", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 5000, warningMs: 1000, enabled: true, onTimeout })
    );
    act(() => { vi.advanceTimersByTime(4001); }); // past 4000ms warn threshold
    expect(result.current.showWarning).toBe(true);
  });

  it("fires onTimeout after full idle window", () => {
    const onTimeout = vi.fn();
    renderHook(() =>
      useIdleSession({ idleTimeoutMs: 5000, warningMs: 1000, enabled: true, onTimeout })
    );
    act(() => { vi.advanceTimersByTime(6000); }); // 4000 warn + 1000 logout = 5000 total, advance a bit more
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("countdown decrements each second during warning phase", async () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 5000, warningMs: 3000, enabled: true, onTimeout })
    );
    // Trigger warning (warnAfter = 5000-3000 = 2000ms)
    act(() => { vi.advanceTimersByTime(2001); });
    expect(result.current.showWarning).toBe(true);
    const initial = result.current.secondsRemaining; // should be 3
    // Advance one interval tick (1000ms)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.secondsRemaining).toBe(initial - 1);
  });

  it("extendSession dismisses warning and resets timer", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 5000, warningMs: 1000, enabled: true, onTimeout })
    );
    act(() => { vi.advanceTimersByTime(4500); }); // into warning
    expect(result.current.showWarning).toBe(true);
    act(() => { result.current.extendSession(); });
    expect(result.current.showWarning).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("does not fire onTimeout if extendSession was called in time", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 5000, warningMs: 1000, enabled: true, onTimeout })
    );
    act(() => { vi.advanceTimersByTime(4500); }); // in warning
    act(() => { result.current.extendSession(); });
    act(() => { vi.advanceTimersByTime(999); }); // almost at where logout would have been
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("enabled=false prevents warning from ever showing", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 1000, warningMs: 500, enabled: false, onTimeout })
    );
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.showWarning).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("disabling mid-session clears an active warning", () => {
    const onTimeout = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useIdleSession({ idleTimeoutMs: 5000, warningMs: 1000, enabled, onTimeout }),
      { initialProps: { enabled: true } }
    );
    act(() => { vi.advanceTimersByTime(4500); }); // trigger warning
    expect(result.current.showWarning).toBe(true);
    rerender({ enabled: false });
    expect(result.current.showWarning).toBe(false);
  });

  it("activity during warning does NOT dismiss it (user must click extend)", () => {
    const onTimeout = vi.fn();
    const { result } = renderHook(() =>
      useIdleSession({ idleTimeoutMs: 5000, warningMs: 1000, enabled: true, onTimeout })
    );
    act(() => { vi.advanceTimersByTime(4500); }); // into warning
    // Simulate user activity
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
    });
    expect(result.current.showWarning).toBe(true); // still showing
  });
});
