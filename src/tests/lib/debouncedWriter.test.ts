/**
 * MP-541. Two things are pinned here:
 *
 *  1. react-hook-form's ACTUAL behaviour -- that it discards whatever a `watch`
 *     callback returns. This is the fact the original /apply bug depended on,
 *     and it is asserted against the real library rather than described in a
 *     comment, so a future dev who writes `return () => clearTimeout(...)`
 *     inside a watch callback has a failing test explaining why it does nothing.
 *
 *  2. createDebouncedWriter itself -- the real module, imported, not restated.
 *
 * Each behavioural test carries a positive control, because "nothing was
 * written" is also what a writer that never works looks like.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { createDebouncedWriter } from "@/shared/lib/debouncedWriter";

describe("react-hook-form watch() cleanup contract (the MP-541 root cause)", () => {
  it("discards the function a watch callback returns -- it is never invoked", async () => {
    const cleanup = vi.fn();
    let fires = 0;
    const { result } = renderHook(() => useForm<{ a: string }>({ defaultValues: { a: "" } }));

    act(() => {
      result.current.watch(() => {
        fires += 1;
        return cleanup;
      });
    });

    await act(async () => { result.current.setValue("a", "x"); });
    await act(async () => { result.current.setValue("a", "xy"); });
    await act(async () => { result.current.setValue("a", "xyz"); });

    // Positive control: the subscription really is live.
    expect(fires).toBe(3);
    // The contract: returning a cleanup from a watch callback does nothing.
    expect(cleanup).not.toHaveBeenCalled();
  });
});

describe("createDebouncedWriter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("coalesces a burst of schedules into exactly one write with the last value", () => {
    const write = vi.fn();
    const w = createDebouncedWriter<string>(300, write);

    w.schedule("a");
    w.schedule("ab");
    w.schedule("abc");
    expect(write).not.toHaveBeenCalled(); // nothing fires early

    vi.advanceTimersByTime(300);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("abc");
  });

  it("writes once per quiet period, not once per schedule", () => {
    const write = vi.fn();
    const w = createDebouncedWriter<string>(300, write);

    w.schedule("first");
    vi.advanceTimersByTime(300);
    w.schedule("second");
    vi.advanceTimersByTime(300);

    // Positive control: two distinct quiet periods DO produce two writes, so
    // the coalescing test above is not passing against a dead writer.
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(1, "first");
    expect(write).toHaveBeenNthCalledWith(2, "second");
  });

  it("cancel() stops a write that is already in flight", () => {
    const write = vi.fn();
    const w = createDebouncedWriter<string>(300, write);

    w.schedule("pii");
    expect(w.isPending()).toBe(true);
    w.cancel();
    expect(w.isPending()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it("cancel() is safe when nothing is pending, and does not disable the writer", () => {
    const write = vi.fn();
    const w = createDebouncedWriter<string>(300, write);

    w.cancel();
    w.schedule("after-cancel");
    vi.advanceTimersByTime(300);

    // A cancel must not be a kill switch -- the writer still works afterwards.
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("after-cancel");
  });

  it("clears its pending flag once the write has fired", () => {
    const write = vi.fn();
    const w = createDebouncedWriter<number>(300, write);

    w.schedule(1);
    expect(w.isPending()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(w.isPending()).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
