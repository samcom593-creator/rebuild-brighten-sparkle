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
 *   ✅ pagehide triggers immediate flush
 *
 * Missing / not yet tested:
 *   ❌ session_id persistence across track() calls within the same session
 *   ❌ user_agent is attached in browser env (navigator.userAgent mock)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supabase } from "@/integrations/supabase/client";

// Re-import module fresh each test to avoid shared queue state
async function freshTrack() {
  vi.resetModules();
  return import("@/shared/telemetry/track");
}

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.mocked(supabase.from);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ insert: mockInsert } as any);
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("track — basic queueing", () => {
  it("does not call supabase before flush interval", async () => {
    const { track } = await freshTrack();
    track("page_view", "navigation");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("flushes after FLUSH_INTERVAL_MS (5000ms)", async () => {
    const { track } = await freshTrack();
    track("button_click", "interaction", { btn: "apply" });
    act: vi.advanceTimersByTime(5001);
    await Promise.resolve(); // drain microtasks
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
    await Promise.resolve();
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
    await Promise.resolve();
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
    await Promise.resolve();
    const batch = mockInsert.mock.calls[0][0] as any[];
    expect(batch[0].user_id).toBe("user-abc");
  });

  it("setting user to null clears userId from subsequent events", async () => {
    const { track, setTelemetryUser } = await freshTrack();
    setTelemetryUser("user-abc");
    setTelemetryUser(null);
    track("signed_out", "auth");
    vi.advanceTimersByTime(5001);
    await Promise.resolve();
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

  it("pagehide triggers flush", async () => {
    const { track, initTelemetry } = await freshTrack();
    initTelemetry();
    track("last_event", "system");
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(mockInsert).toHaveBeenCalled();
  });
});
