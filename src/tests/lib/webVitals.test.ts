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

describe("web-vitals telemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    insert.mockClear();
    FakePerformanceObserver.callbacks.clear();
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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
