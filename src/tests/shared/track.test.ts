/**
 * track.test.ts
 *
 * Gaps covered:
 *   ✅ track() in SSR (window undefined) is a no-op
 *   ✅ Events are batched and flushed after FLUSH_INTERVAL_MS
 *   ✅ When queue reaches MAX_BATCH (20), flush fires immediately
 *   ✅ setTelemetryUser updates the user attached to queued events
 *   ✅ Flush is swallowed when supabase insert throws (telemetry never throws)
 *   ✅ initTelemetry() registers visibilitychange + pagehide listeners
 *   ✅ pagehide sends the terminal batch through the beacon (MP-514)
 *   ✅ beacon refusal hands the batch back to the async path without dropping it
 *
 * Missing / not yet tested:
 *   ❌ session_id persistence across track() calls within the same session
 *   ❌ user_agent is attached in browser env (navigator.userAgent mock)
 *
 * MP-523: the terminal test used to assert `mockInsert` — the supabase-js sink
 * MP-514 deliberately REMOVED from the pagehide path. It went red against
 * correct code, and while red it could not tell a working beacon from a
 * `flushTerminal` deleted outright: both produce the identical failure line.
 * A test is graded on the sink the code actually writes to, or it has stopped
 * measuring. See beacon.ts for why that sink cannot be the awaited import.
 *
 * fetch is stubbed for the whole file. The beacon issues a REAL request to
 * PostgREST, and nothing here mocked it: measured, no row has ever landed
 * (0 rows named `last_event` against a table taking 493 in 24h), because the
 * vitest worker exits before a fire-and-forget request completes. That is a
 * race this suite happens to win, not a property it holds — one `await` added
 * after the dispatch and the suite starts writing to Sam's analytics table.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supabase } from "@/integrations/supabase/client";

// Re-import module fresh each test to avoid shared queue state
async function freshTrack() {
  vi.resetModules();
  return import("@/shared/telemetry/track");
}

// wave-19 (2026-06-04): flush() now does `await import(supabase/client)` before
// the insert call so vendor-supabase is no longer on the eager landing graph.
// Under vi.useFakeTimers(), dynamic-import resolution may queue behind the
// fake-timer scheduler. Cycling real-timer setImmediate after fake-advance is
// the canonical drain: it lets the import-promise settle, then any awaited
// insert. Bumping fake → real briefly is safe because we are post-timer-fire.
async function flushMicrotasks() {
  // Allow the fake-timer scheduler's microtask queue to drain first
  for (let i = 0; i < 4; i++) await Promise.resolve();
  // Then bridge to real microtasks (dynamic-import is resolved off fake scheduler)
  await new Promise<void>((resolve) => {
    // Use queueMicrotask which is not faked by vi.useFakeTimers
    queueMicrotask(() => resolve());
  });
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.mocked(supabase.from);

/** Stands in for the network the beacon writes to. See the file header. */
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ insert: mockInsert } as any);
  sessionStorage.clear();
  // beacon.ts reads these at module scope, so they must be stubbed before
  // freshTrack()'s resetModules re-imports it. A test that leaves them to the
  // ambient environment is grading the environment: locally .env.local supplies
  // them and the beacon runs; in CI that file is gitignored and absent, the
  // beacon returns false at its credential check, and every assertion here
  // quietly changes meaning. That is not hypothetical -- it is how MP-523
  // first went green on this machine and red on main.
  vi.stubEnv("VITE_SUPABASE_URL", "https://stub.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response(null, { status: 201 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fetchSpy.mockRestore();
});

/**
 * Every analytics_events row the beacon handed to PostgREST, across all calls.
 *
 * Deliberately NOT `fetchSpy.mock.calls[0]` with an exact-count assertion.
 * initTelemetry() registers window listeners that vi.resetModules() cannot
 * take back, so each test leaves a listener behind closed over its own module
 * queue. A sibling test that ends with an undrained queue then fires on the
 * next dispatch and inflates the count here -- PROVEN: under the
 * delete-the-pagehide-listener mutation this test went red in the suite and
 * green in isolation, and the contract it owns had not changed either time.
 * Grade what the beacon carried, not how many neighbours also spoke.
 */
function beaconRows(): Array<Record<string, unknown>> {
  return fetchSpy.mock.calls.flatMap((c) =>
    JSON.parse(String((c[1] as RequestInit | undefined)?.body ?? "[]"))
  );
}

/** True when the beacon carried an event by this name. */
function beaconCarried(eventName: string): boolean {
  return beaconRows().some((r) => r.event_name === eventName);
}

describe("track — basic queueing", () => {
  it("does not call supabase before flush interval", async () => {
    const { track } = await freshTrack();
    track("page_view", "navigation");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("flushes after FLUSH_INTERVAL_MS (5000ms)", async () => {
    const { track } = await freshTrack();
    track("button_click", "interaction", { btn: "apply" });
    vi.advanceTimersByTime(5001);
    await flushMicrotasks();
    expect(mockInsert).toHaveBeenCalled();
    const batch = mockInsert.mock.calls[0][0] as any[];
    expect(batch).toHaveLength(1);
    expect(batch[0].event_name).toBe("button_click");
    expect(batch[0].properties).toEqual({ btn: "apply" });
  });

  it("flushes immediately when MAX_BATCH (20) events are queued", async () => {
    const { track } = await freshTrack();
    for (let i = 0; i < 20; i++) {
      track(`event_${i}`, "interaction");
    }
    await flushMicrotasks();
    expect(mockInsert).toHaveBeenCalled();
    const batch = mockInsert.mock.calls[0][0] as any[];
    expect(batch).toHaveLength(20);
  });

  it("19 events do not trigger immediate flush", async () => {
    const { track } = await freshTrack();
    for (let i = 0; i < 19; i++) {
      track(`event_${i}`, "interaction");
    }
    await Promise.resolve();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("track — error resilience", () => {
  it("does not throw when supabase insert rejects", async () => {
    const { track } = await freshTrack();
    mockInsert.mockRejectedValueOnce(new Error("db dead"));
    track("any", "system");
    vi.advanceTimersByTime(5001);
    await flushMicrotasks();
    // No unhandled rejection, no throw — telemetry is fire-and-forget
    expect(true).toBe(true);
  });
});

describe("setTelemetryUser", () => {
  it("attaches userId to flushed events", async () => {
    const { track, setTelemetryUser } = await freshTrack();
    setTelemetryUser("user-abc");
    track("signed_in", "auth");
    vi.advanceTimersByTime(5001);
    await flushMicrotasks();
    const batch = mockInsert.mock.calls[0][0] as any[];
    expect(batch[0].user_id).toBe("user-abc");
  });

  it("setting user to null clears userId from subsequent events", async () => {
    const { track, setTelemetryUser } = await freshTrack();
    setTelemetryUser("user-abc");
    setTelemetryUser(null);
    track("signed_out", "auth");
    vi.advanceTimersByTime(5001);
    await flushMicrotasks();
    const batch = mockInsert.mock.calls[0][0] as any[];
    expect(batch[0].user_id).toBeNull();
  });
});

describe("initTelemetry — flush on page lifecycle", () => {
  it("registers visibilitychange listener", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const { initTelemetry } = await freshTrack();
    initTelemetry();
    const calls = addSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain("visibilitychange");
    addSpy.mockRestore();
  });

  it("registers pagehide listener", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const { initTelemetry } = await freshTrack();
    initTelemetry();
    const calls = addSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain("pagehide");
    addSpy.mockRestore();
  });

  it("pagehide sends the terminal batch through the beacon, carrying the event", async () => {
    const { track, initTelemetry } = await freshTrack();
    initTelemetry();
    track("last_event", "system");

    window.dispatchEvent(new Event("pagehide"));

    // No await before the assertion, deliberately. MP-514's whole finding is
    // that a request placed after an await in a pagehide handler is never
    // issued at all, so "was it already on the wire when the handler returned"
    // IS the contract -- not "does it arrive eventually".
    expect(fetchSpy).toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/rest/v1/analytics_events");
    expect(beaconCarried("last_event")).toBe(true);
  });

  it("pagehide does not route the terminal batch through the awaited import", async () => {
    const { track, initTelemetry } = await freshTrack();
    initTelemetry();
    track("last_event", "system");

    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();

    // The supabase-js path is the FALLBACK now. If it ran here the beacon
    // did not, which is the bug MP-514 shipped to end.
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("a beacon that cannot be issued hands the batch back instead of dropping it", async () => {
    // A real refusal, not a stubbed return value: beaconAnalyticsRows catches
    // a throwing fetch and reports false, which is the branch under test.
    fetchSpy.mockImplementation(() => {
      throw new Error("network stack refused the request");
    });

    const { track, initTelemetry } = await freshTrack();
    initTelemetry();
    track("last_event", "system");

    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();

    // beacon.ts: "a false return means the caller still owns those rows".
    // On a tab-switch hide the document survives and the async path still
    // works, so the batch must be written late -- never silently discarded.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const batch = mockInsert.mock.calls[0][0] as any[];
    expect(batch).toHaveLength(1);
    expect(batch[0].event_name).toBe("last_event");
  });

  it("a build with no supabase credentials degrades to the async path, not to silence", async () => {
    // The condition CI runs in. beacon.ts returns false when either credential
    // is missing, so the terminal batch takes the awaited path MP-514 proved
    // never lands on a real unload -- the rows are not dropped, but on a true
    // page exit they would not arrive either. Graded here so a credential-less
    // build is a known, named degradation rather than something a future
    // author rediscovers from a red pipeline.
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    const { track, initTelemetry } = await freshTrack();
    initTelemetry();
    track("last_event", "system");

    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange to hidden takes the same terminal path", async () => {
    const { track, initTelemetry } = await freshTrack();
    initTelemetry();
    track("last_event", "system");

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    window.dispatchEvent(new Event("visibilitychange"));

    expect(beaconCarried("last_event")).toBe(true);
  });
});
