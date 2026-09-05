/**
 * productionRealtimeFeedbackLoop.test.ts — MP-436
 *
 * THE BUG (live 2026-08-27 `55b494e4` -> 2026-09-05):
 *   `invalidateOperationalTruth()` ends by dispatching the window event
 *   "production-realtime-update". `useProductionRealtime()` LISTENS for that
 *   exact event. AgentCloudHome wired the listener straight back to the
 *   dispatcher:
 *
 *     useProductionRealtime(() => invalidateOperationalTruth(queryClient), 350);
 *
 *   handler -> invalidate -> dispatch -> handler -> ... a self-sustaining ring
 *   that needs ZERO database row changes to keep running. Every lap
 *   invalidates "apex-home-dashboard", "scoped-production-scoreboard" and
 *   "imo-by-agency" — the three most expensive RPCs on the platform.
 *
 *   This is why MP-388's channel coalescer "had not held": the ring never
 *   passes through onRowChange, so no amount of row-event coalescing can see
 *   it, and why MP-427 measured the drops ANTI-correlated with sync hours.
 *
 * These tests drive the REAL hook and the REAL invalidator. Math.random is
 * pinned so the debounce jitter cannot make the cycle count flaky.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { supabase } from "@/integrations/supabase/client";
import { useProductionRealtime } from "@/hooks/useProductionRealtime";
import {
  invalidateOperationalTruth,
  OPERATIONAL_TRUTH_QUERY_KEYS,
} from "@/lib/invalidateOperationalTruth";
import type { QueryClient } from "@tanstack/react-query";

const PRODUCTION_EVENT = "production-realtime-update";
const DEBOUNCE_MS = 350;

function buildChannelMock() {
  const mock: Record<string, unknown> = {};
  mock.on = vi.fn(() => mock);
  mock.subscribe = vi.fn(() => mock);
  return mock;
}

/** Stub QueryClient — we only care how MANY times invalidation is driven. */
function buildQueryClient() {
  const invalidateQueries = vi.fn();
  return {
    client: { invalidateQueries } as unknown as QueryClient,
    /** one lap of the ring = one invalidateQueries per key */
    laps: () => invalidateQueries.mock.calls.length / OPERATIONAL_TRUTH_QUERY_KEYS.length,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Pin the 0-200ms jitter in useDebouncedRefetch so lap timing is exact.
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(supabase, "channel").mockReturnValue(buildChannelMock() as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MP-436 — the realtime listener must not re-enter its own event", () => {
  it("ONE seed event produces ONE lap, not a self-driving ring", () => {
    const qc = buildQueryClient();
    renderHook(() =>
      useProductionRealtime(
        () => invalidateOperationalTruth(qc.client, { broadcast: false }),
        DEBOUNCE_MS,
      ),
    );

    // One real row change arrives.
    window.dispatchEvent(new CustomEvent(PRODUCTION_EVENT));

    // Ten seconds of wall clock with NO further database activity.
    vi.advanceTimersByTime(10_000);

    // The seed is honoured exactly once. Pre-fix this was ~28 laps
    // (10_000 / 350) and would have continued forever.
    expect(qc.laps()).toBe(1);
  });

  it("REPRODUCTION: a broadcasting listener rings forever on zero row changes", () => {
    const qc = buildQueryClient();
    // This is verbatim the pre-fix wiring from AgentCloudHome.tsx:166.
    renderHook(() =>
      useProductionRealtime(() => invalidateOperationalTruth(qc.client), DEBOUNCE_MS),
    );

    window.dispatchEvent(new CustomEvent(PRODUCTION_EVENT));
    vi.advanceTimersByTime(10_000);

    // Proves the ring is real and self-sustaining: no row changed after the
    // seed, yet the invalidator keeps firing at the debounce period. If a
    // future refactor makes the default non-broadcasting this goes to 1 and
    // this assertion tells you the guard below is now the only thing left.
    expect(qc.laps()).toBeGreaterThan(20);
  });

  it("a mutation caller still broadcasts to other surfaces", () => {
    const qc = buildQueryClient();
    const heard = vi.fn();
    window.addEventListener(PRODUCTION_EVENT, heard);

    // DealEntryForm / SubmitDealDialog / AddAgentModal / OfflineSyncStatus
    // call it exactly like this, and MUST still wake other subscribers.
    invalidateOperationalTruth(qc.client);

    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(PRODUCTION_EVENT, heard);
  });

  it("suppressing the broadcast still invalidates every operational key", () => {
    const qc = buildQueryClient();
    invalidateOperationalTruth(qc.client, { broadcast: false });
    // Tolerance, not permissiveness: the listener path loses the echo, never
    // the refresh.
    expect(qc.laps()).toBe(1);
  });
});
