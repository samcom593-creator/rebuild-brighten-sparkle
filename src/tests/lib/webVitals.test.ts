/**
 * webVitals.test.ts
 *
 * Gaps covered:
 *   ✅ At most one row per vital per page; worst interaction wins
 *   ✅ pagehide hands the terminal batch to the beacon (MP-514)
 *   ✅ the terminal batch does NOT go through the awaited supabase import
 *   ✅ a beacon refusal hands the batch back instead of dropping it
 *   ✅ visibilitychange -> hidden takes the same terminal path
 *   ✅ a credential-less build degrades to the async path, not to silence
 *   ✅ a vital sent terminally is not dragged into a later batch
 *
 * That last one was VACUOUS as first written. It asserted the 5s timer does not
 * re-send an already-flushed vital — but the success branch cancels that timer,
 * so the fire it named never happens and the assertion held even with
 * `pending.clear()` deleted. It passed 7/7 under the very mutation it was
 * written to catch. Caught by mutating instead of trusting the green; the
 * replacement arms a NEW timer with a fresh vital, which is what makes the
 * leftover batch observable.
 *
 * Missing / not yet tested:
 *   ❌ a batch over MAX_BEACON_BYTES (beacon refuses on size, not on network)
 *   ❌ url stamping across a route change between enqueue() and flush()
 *
 * MP-524: this file used to hold exactly one test, and it graded only the 5s
 * timer flush through the supabase insert. flushTerminal() -- the whole of the
 * MP-514 fix -- was never executed here: no pagehide, no visibilitychange, no
 * beaconAnalyticsRows. check-telemetry-unload-sync grades that path at the
 * SOURCE SHAPE (its Contract D requires the handler to hand the batch to the
 * beacon) but a shape check cannot see semantics. This passes all five of its
 * contracts and silently destroys every terminal batch the beacon refuses:
 *
 *     const batch = Array.from(pending.values());
 *     pending.clear();                                 // moved BEFORE the beacon
 *     if (beaconAnalyticsRows(buildRows(batch))) return;
 *     void flush();                                    // flushes an empty pending
 *
 * That is the darker failure Contract D's own header says it exists to prevent
 * -- going dark rather than going late. The refusal test below is the one that
 * catches it. track.ts got this coverage in MP-523; webVitals is the sibling
 * caller the sweep stopped one file short of.
 *
 * fetch is stubbed for the whole file, for the reason track.test.ts documents:
 * the beacon issues a REAL request to PostgREST and the vitest worker normally
 * exits before a fire-and-forget request completes. That is a race this suite
 * happens to win, not a property it holds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn().mockResolvedValue({ error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({ insert })),
  },
}));

type ObserverCallback = (list: { getEntries: () => unknown[] }) => void;

class FakePerformanceObserver {
  static callbacks = new Map<string, ObserverCallback>();

  constructor(private readonly callback: ObserverCallback) {}

  observe(options: { type: string }) {
    FakePerformanceObserver.callbacks.set(options.type, this.callback);
  }

  static emit(type: string, entries: unknown[]) {
    FakePerformanceObserver.callbacks.get(type)?.({ getEntries: () => entries });
  }
}

/** Stands in for the network the beacon writes to. See the file header. */
let fetchSpy: ReturnType<typeof vi.spyOn>;

/**
 * Rows the beacon actually handed to PostgREST, across every call.
 *
 * Deliberately not an exact call-count assertion. initWebVitals() registers
 * window listeners that vi.resetModules() cannot take back, so each test leaves
 * a listener behind closed over its own module-scoped `pending` map. Grade what
 * was carried, not how many neighbours also spoke -- MP-523 proved that exact
 * counts here go red in-suite and green in isolation without the contract
 * changing either time.
 */
function beaconRows(): Array<Record<string, unknown>> {
  return fetchSpy.mock.calls.flatMap((c) =>
    JSON.parse(String((c[1] as RequestInit | undefined)?.body ?? "[]"))
  );
}

/** Rows that reached the awaited supabase path, across every call. */
function insertedRows(): Array<Record<string, unknown>> {
  return insert.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>);
}

/** Find a vital row by the value it carried — unique per test by construction. */
function rowWithValue(rows: Array<Record<string, unknown>>, value: number) {
  return rows.find((r) => (r.properties as { value?: number } | undefined)?.value === value);
}

/**
 * Drain a dynamic import resolved off the fake-timer scheduler. Same bridge
 * track.test.ts uses, and for the same reason: flush() opens with
 * `await import("@/integrations/supabase/client")`.
 */
async function flushMicrotasks() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  insert.mockClear();
  FakePerformanceObserver.callbacks.clear();
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  sessionStorage.clear();
  // beacon.ts reads these at module scope, so they must be stubbed before the
  // beforeEach resetModules re-imports it. A test that leaves them to the
  // ambient environment is grading the environment: locally .env.local
  // supplies them and the beacon runs; in CI that file is gitignored and
  // absent, the beacon returns false at its credential check, and every
  // terminal assertion below quietly changes meaning. MP-523b paid for this
  // one with a red pipeline on main after a green run on this machine.
  vi.stubEnv("VITE_SUPABASE_URL", "https://stub.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key");
  fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(new Response(null, { status: 201 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchSpy.mockRestore();
  vi.useRealTimers();
});

describe("web-vitals telemetry", () => {
  it("writes at most one row per vital and keeps the worst interaction", async () => {
    const { initWebVitals } = await import("@/shared/lib/webVitals");
    initWebVitals();
    initWebVitals();

    FakePerformanceObserver.emit("event", [
      { duration: 80 },
      { duration: 420 },
      { duration: 160 },
      { duration: 20 },
    ]);
    FakePerformanceObserver.emit("largest-contentful-paint", [
      { startTime: 900 },
      { startTime: 1_800 },
    ]);
    FakePerformanceObserver.emit("layout-shift", [
      { value: 0.04, hadRecentInput: false },
      { value: 0.02, hadRecentInput: false },
      { value: 0.5, hadRecentInput: true },
    ]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.event_name === "web_vital.INP")).toMatchObject({
      properties: { value: 420, rating: "needs-improvement" },
    });
    expect(rows.every((row) => typeof row.session_id === "string")).toBe(true);

    FakePerformanceObserver.emit("event", [{ duration: 900 }]);
    FakePerformanceObserver.emit("layout-shift", [{ value: 0.3, hadRecentInput: false }]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

/**
 * The MP-514 terminal path. Every test here emits ONE LCP with a value unique
 * to that test, so rows can be attributed without counting calls.
 */
describe("web-vitals terminal flush (MP-514)", () => {
  async function initWithLcp(value: number) {
    const { initWebVitals } = await import("@/shared/lib/webVitals");
    initWebVitals();
    FakePerformanceObserver.emit("largest-contentful-paint", [{ startTime: value }]);
  }

  it("pagehide hands the terminal batch to the beacon", async () => {
    await initWithLcp(1_234);

    window.dispatchEvent(new Event("pagehide"));

    // Synchronous by construction: beaconAnalyticsRows issues the fetch with no
    // await ahead of it, which is the entire point of the module.
    const row = rowWithValue(beaconRows(), 1_234);
    expect(row).toBeDefined();
    expect(row?.event_name).toBe("web_vital.LCP");
  });

  it("does not route the terminal batch through the awaited supabase import", async () => {
    await initWithLcp(2_345);

    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();

    // The supabase-js path is the FALLBACK now. If it carried this vital, the
    // beacon did not — and MP-514 measured that path as never arriving on a
    // real unload.
    expect(rowWithValue(insertedRows(), 2_345)).toBeUndefined();
  });

  it("a beacon that cannot be issued hands the batch back instead of dropping it", async () => {
    // A real refusal, not a stubbed return value: beaconAnalyticsRows catches a
    // throwing fetch and reports false, which is the branch under test.
    fetchSpy.mockImplementation(() => {
      throw new Error("network stack refused the request");
    });

    await initWithLcp(3_456);

    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();

    // beacon.ts: "a false return means the caller still owns those rows". On a
    // tab-switch hide the document survives and the async path still works, so
    // the batch must be written late — never silently discarded. This is the
    // assertion that fails under the pending.clear()-before-the-beacon
    // refactor, which every contract in check-telemetry-unload-sync accepts.
    const row = rowWithValue(insertedRows(), 3_456);
    expect(row).toBeDefined();
    expect(row?.event_name).toBe("web_vital.LCP");
  });

  it("visibilitychange to hidden takes the same terminal path", async () => {
    await initWithLcp(4_567);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    window.dispatchEvent(new Event("visibilitychange"));

    expect(rowWithValue(beaconRows(), 4_567)).toBeDefined();
  });

  it("a build with no supabase credentials degrades to the async path, not to silence", async () => {
    // The condition CI runs in. beacon.ts returns false when either credential
    // is missing, so the terminal batch takes the awaited path MP-514 proved
    // never lands on a real unload — the rows are not dropped, but on a true
    // page exit they would not arrive either. Graded here so a credential-less
    // build is a known, named degradation rather than something a future author
    // rediscovers from a red pipeline.
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    await initWithLcp(5_678);

    window.dispatchEvent(new Event("pagehide"));
    await flushMicrotasks();

    expect(rowWithValue(beaconRows(), 5_678)).toBeUndefined();
    expect(rowWithValue(insertedRows(), 5_678)).toBeDefined();
  });

  it("a vital sent terminally is not dragged into a later batch", async () => {
    await initWithLcp(6_789);

    window.dispatchEvent(new Event("pagehide"));
    expect(rowWithValue(beaconRows(), 6_789)).toBeDefined();

    // A hide is not always an exit: the visitor tab-switches away and comes
    // back. flushTerminal must have emptied `pending`, or the next vital to
    // start a timer drags the already-sent LCP along with it and the row is
    // written twice.
    //
    // This scenario is what makes the contract observable at all. Asserting
    // "the 5s timer does not re-send it" proves nothing — the success branch
    // CANCELS that timer, so the fire never happens and the assertion holds
    // even when `pending.clear()` is deleted. A fresh vital is what arms a new
    // timer and exposes the leftover batch.
    FakePerformanceObserver.emit("event", [{ duration: 300 }]);
    await vi.advanceTimersByTimeAsync(5_000);

    const late = insertedRows();
    expect(rowWithValue(late, 300)).toBeDefined();
    expect(rowWithValue(late, 6_789)).toBeUndefined();
  });
});
