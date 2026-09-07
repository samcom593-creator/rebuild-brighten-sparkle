import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCallLabSession } from "@/lib/callLab/useCallLabSession";
const mocks = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn(), invoke: vi.fn(), onEvent: null as null | ((e: unknown) => void), dispose: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ upsert: mocks.upsert, update: () => ({ eq: mocks.update }) }), functions: { invoke: mocks.invoke } } }));
vi.mock("@/lib/callLab/providers", () => ({
  DemoProvider: class {
    inputAnalyser = null; outputAnalyser = null; syntheticLevel = 0;
    connect(o: { onEvent: (e: unknown) => void }) { mocks.onEvent = o.onEvent; o.onEvent({ type: "connection.changed", state: "connected", atMs: 0 }); }
    disconnect() { mocks.onEvent?.({ type: "session.ended", reason: "agent_ended", atMs: 10 }); }
    dispose() { mocks.dispose(); }
  }, ComposedProvider: class {},
}));
const meta = { id: "practice-session", provider: "demo" as const, mode: "practice" as const, status: "created", voice: {}, openingLine: "Hello", objectionIdsByKey: {} };
beforeEach(() => { vi.clearAllMocks(); mocks.upsert.mockResolvedValue({ error: null }); mocks.update.mockResolvedValue({ error: null }); mocks.invoke.mockResolvedValue({ error: null }); });
describe("durable scoring handoff", () => {
  it("waits for a pending save and drains every batch before invoking evaluation", async () => {
    const { result, unmount } = renderHook(() => useCallLabSession(meta, null));
    await act(async () => { await result.current.start(); });
    let finishSave!: (v: unknown) => void;
    mocks.upsert.mockImplementationOnce(() => new Promise(r => { finishSave = r; }));
    act(() => {
      for (let i = 0; i < 205; i++) mocks.onEvent?.({ type: "transcript.final", turnId: `turn${i}`, speaker: "agent", text: "Test response", startMs: i, endMs: i + 1 });
      mocks.onEvent?.({ type: "connection.changed", state: "connected", atMs: 206 });
    });
    let ended!: Promise<boolean>;
    act(() => { ended = result.current.end(); });
    expect(mocks.invoke).not.toHaveBeenCalled();
    await act(async () => { finishSave({ error: null }); await ended; });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    const persisted = mocks.upsert.mock.calls.flatMap(c => c[0]);
    expect(persisted.filter((e: {type: string}) => e.type === "transcript.final")).toHaveLength(205);
    unmount(); expect(mocks.dispose).toHaveBeenCalled();
  });
  it("does not score an incomplete transcript and lets the same session retry", async () => {
    const { result } = renderHook(() => useCallLabSession(meta, null));
    await act(async () => { await result.current.start(); });
    mocks.upsert.mockResolvedValue({ error: { message: "network unavailable" } });
    act(() => { mocks.onEvent?.({ type: "transcript.final", turnId: "one", speaker: "agent", text: "Hello", startMs: 1, endMs: 2 }); });
    await act(async () => { expect(await result.current.end()).toBe(false); });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(result.current.error).toContain("not finished saving");
    mocks.upsert.mockResolvedValue({ error: null });
    await act(async () => { expect(await result.current.end()).toBe(true); });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
  });
});
