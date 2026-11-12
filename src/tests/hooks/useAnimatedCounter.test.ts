/**
 * useAnimatedCounter.test.ts
 *
 * THE BUG (live on apex-financial.org, found 2026-11-12 by the website
 * integrity bot):
 *   The public landing rendered "0 Active Agents" on the recruiting money page,
 *   next to a live receipts strip reading 37 applications / 22 carriers and a
 *   leaderboard of 10 agents writing $4K–$37K. The RPC was healthy — the anon
 *   browser received active_agents: 84 in a 200 response. The counter is the
 *   ONLY landing stat routed through useAnimatedCounter (every other stat is a
 *   static string), and it was stranded at its initial 0: the hook starts
 *   count=0 and only animates once an IntersectionObserver (threshold 0.1)
 *   reports the element intersecting. A fast scroll-past delivers the element
 *   into and out of the viewport between the frames the observer samples, so
 *   `isIntersecting` is never seen as true, hasStarted never flips, and the
 *   counter sits at 0 forever. A "0" on a recruiting page destroys the trust
 *   the receipts just built.
 *
 * THE FIX:
 *   A safety-timeout backstop (startFallbackMs, default 1800ms). If the
 *   observer has not fired within the window, start anyway so the real value
 *   always renders. A counter that animates off-screen is harmless — the
 *   visitor only ever sees its settled value. Mirrors the gate-OR-timer
 *   resilience the LiveStatsCounterStrip already documents for its RPC.
 *
 * These tests drive the REAL hook. The key regression — "observer never fires
 * -> the backstop still lands the real number" — is RED on the pre-fix hook
 * (no backstop existed, so count stays 0) and GREEN after.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnimatedCounter } from "@/hooks/useAnimatedCounter";

// ── IntersectionObserver mock ────────────────────────────────────────────────
// jsdom ships no IntersectionObserver. This stand-in records every instance and
// its callback and NEVER auto-fires — exactly the "observer that misses a fast
// scroll-past" the bug depends on. Tests that want the scroll path call
// `.trigger()` explicitly.
type IOEntry = { isIntersecting: boolean; target: Element | null };
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  private cb: (entries: IOEntry[], obs: MockIntersectionObserver) => void;
  private elements: Element[] = [];
  constructor(cb: (entries: IOEntry[], obs: MockIntersectionObserver) => void) {
    this.cb = cb;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.elements.push(el); }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
  takeRecords(): IOEntry[] { return []; }
  trigger(isIntersecting = true) {
    this.cb([{ isIntersecting, target: this.elements[0] ?? null }], this);
  }
}

// ── requestAnimationFrame stub ───────────────────────────────────────────────
// Drives the hook's rAF animation SYNCHRONOUSLY with monotonically increasing
// timestamps, so each render deterministically settles on the final value
// (easeOutQuart -> 1 once elapsed >= duration). No wall-clock flake.
function stubRaf(stepMs = 1000) {
  let t = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    t += stepMs;
    cb(t);
    return t;
  });
  vi.stubGlobal("cancelAnimationFrame", () => { /* no-op */ });
}

describe("useAnimatedCounter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver as unknown as typeof IntersectionObserver);
    MockIntersectionObserver.instances = [];
    stubRaf();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("REGRESSION: a never-firing observer still lands the real value via the backstop (not a stale 0)", () => {
    const { result } = renderHook(() =>
      useAnimatedCounter(84, { duration: 2000, startFallbackMs: 1800 })
    );
    // Before anything fires, the counter is at its honest initial 0.
    expect(result.current.count).toBe(0);
    // The observer NEVER reports intersection (fast scroll-past). On the pre-fix
    // hook this is where the number was stranded at 0 forever.
    act(() => { vi.advanceTimersByTime(1800); });
    expect(result.current.count).toBe(84);
  });

  it("the backstop does not fire before its window elapses", () => {
    const { result } = renderHook(() =>
      useAnimatedCounter(84, { duration: 2000, startFallbackMs: 1800 })
    );
    act(() => { vi.advanceTimersByTime(1700); }); // one tick short
    expect(result.current.count).toBe(0);
  });

  it("the scroll path still works: an intersecting observer animates to the real value", () => {
    const { result } = renderHook(() =>
      useAnimatedCounter(84, { duration: 2000, startFallbackMs: 1800 })
    );
    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger(true);
    });
    expect(result.current.count).toBe(84);
  });

  it("startOnView:false animates immediately with no observer and no timer", () => {
    const { result } = renderHook(() =>
      useAnimatedCounter(42, { duration: 2000, startOnView: false })
    );
    // No observer was even created; value is live on mount.
    expect(MockIntersectionObserver.instances.length).toBe(0);
    expect(result.current.count).toBe(42);
  });

  it("startFallbackMs:0 disables the backstop (pure scroll-triggered behaviour)", () => {
    const { result } = renderHook(() =>
      useAnimatedCounter(84, { duration: 2000, startFallbackMs: 0 })
    );
    // No backstop timer, observer never fires -> stays 0 until a real scroll.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current.count).toBe(0);
    act(() => {
      MockIntersectionObserver.instances.at(-1)!.trigger(true);
    });
    expect(result.current.count).toBe(84);
  });

  it("a later value change re-animates to the new target (RPC resolves after first paint)", () => {
    let end = 40; // cold-render default
    const { result, rerender } = renderHook(() =>
      useAnimatedCounter(end, { duration: 2000, startFallbackMs: 1800 })
    );
    act(() => { vi.advanceTimersByTime(1800); }); // backstop lands the default
    expect(result.current.count).toBe(40);
    end = 84; // RPC resolves to the real count
    act(() => { rerender(); });
    expect(result.current.count).toBe(84);
  });
});
