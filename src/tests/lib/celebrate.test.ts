/**
 * celebrate(): a burst of bubbles plus a sound after an action the person just completed
 * (src/lib/celebrate.ts). These tests pin the motion-review contract (2026-10-28): the burst
 * never blocks a tap, sits under the toasts, is smaller on a phone, draws nothing under
 * prefers-reduced-motion, and can never throw into the action it followed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { confetti, playSoundEffect } = vi.hoisted(() => ({ confetti: vi.fn(), playSoundEffect: vi.fn() }));
vi.mock("canvas-confetti", () => ({ default: confetti }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect }));

import { celebrate, CELEBRATION_Z_INDEX, PHONE_SCALE } from "@/lib/celebrate";

let reduce = false;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
}

beforeEach(() => {
  confetti.mockReset();
  playSoundEffect.mockReset();
  reduce = false;
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  setViewport(1440, 900);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("celebrate", () => {
  it("a save on a desktop: 14 round bubbles from the control pressed, a pop, taps still land", async () => {
    const button = document.createElement("button");
    button.getBoundingClientRect = () => ({ left: 700, top: 400, width: 40, height: 44, right: 740, bottom: 444, x: 700, y: 400, toJSON: () => ({}) });
    await celebrate("save", button);
    expect(playSoundEffect).toHaveBeenCalledWith("pop");
    expect(confetti).toHaveBeenCalledTimes(1);
    const opts = confetti.mock.calls[0][0];
    expect(opts.particleCount).toBe(14);
    expect(opts.shapes).toEqual(["circle"]);
    expect(opts.disableForReducedMotion).toBe(true);
    // Above sheets and dialogs (z-50), below Sonner's toast region.
    expect(opts.zIndex).toBe(CELEBRATION_Z_INDEX);
    expect(opts.zIndex).toBeLessThan(999999999);
    expect(opts.origin.x).toBeCloseTo(720 / 1440, 3);
    expect(opts.origin.y).toBeCloseTo(422 / 900, 3);
  });

  it("a phone gets fewer and shorter bubbles, and a hire's side bursts shrink with it", async () => {
    vi.useFakeTimers();
    setViewport(390, 844);
    await celebrate("hire");
    expect(playSoundEffect).toHaveBeenCalledWith("fanfare");
    expect(confetti).toHaveBeenCalledTimes(1);
    const main = confetti.mock.calls[0][0];
    expect(main.particleCount).toBe(Math.round(90 * PHONE_SCALE));
    expect(main.ticks).toBe(Math.round(140 * 0.8));
    vi.advanceTimersByTime(200);
    expect(confetti).toHaveBeenCalledTimes(3);
    expect(confetti.mock.calls[1][0].particleCount).toBe(Math.round(36 * PHONE_SCALE));
    expect(confetti.mock.calls[2][0].particleCount).toBe(Math.round(36 * PHONE_SCALE));
    // A sum a mid-range phone can draw while the list behind it reloads.
    const total = confetti.mock.calls.reduce((n, call) => n + call[0].particleCount, 0);
    expect(total).toBeLessThanOrEqual(100);
  });

  it("under prefers-reduced-motion nothing is drawn; the sound is a separate choice and still plays", async () => {
    reduce = true;
    await celebrate("booked");
    expect(confetti).not.toHaveBeenCalled();
    expect(playSoundEffect).toHaveBeenCalledWith("chime");
  });

  it("never throws into the action it followed when the canvas cannot be created", async () => {
    confetti.mockImplementation(() => { throw new Error("no canvas"); });
    await expect(celebrate("win")).resolves.toBeUndefined();
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it("resolves quietly when the confetti chunk fails to load", async () => {
    vi.resetModules();
    vi.doMock("canvas-confetti", () => { throw new Error("chunk failed"); });
    const fresh = await import("@/lib/celebrate");
    await expect(fresh.celebrate("booked")).resolves.toBeUndefined();
    vi.doUnmock("canvas-confetti");
  });

  it("draws nothing without a document (a worker, a server, a test without a DOM)", async () => {
    vi.stubGlobal("document", undefined);
    await expect(celebrate("save")).resolves.toBeUndefined();
    expect(confetti).not.toHaveBeenCalled();
    expect(playSoundEffect).toHaveBeenCalledWith("pop");
  });
});
