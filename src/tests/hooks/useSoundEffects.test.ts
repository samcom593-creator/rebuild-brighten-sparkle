/**
 * playSoundEffect (src/hooks/useSoundEffects.ts): short synthesised sounds behind one
 * preference. The motion review (2026-10-28) made "nothing plays on page load" a property of
 * the module: while the page has never been touched (navigator.userActivation.hasBeenActive is
 * false) no AudioContext is created and nothing is scheduled, so a note can never wait on a
 * suspended context and play at the person's first unrelated tap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playSoundEffect } from "@/hooks/useSoundEffects";

type Activation = { hasBeenActive: boolean; isActive: boolean };

function setActivation(value: Activation | undefined) {
  Object.defineProperty(navigator, "userActivation", { value, configurable: true, writable: true });
}

const oscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
const contexts: unknown[] = [];

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  constructor() { contexts.push(this); }
  resume = vi.fn(() => Promise.resolve());
  createOscillator() {
    const osc = { type: "sine", frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    oscillators.push(osc);
    return osc;
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
}

beforeEach(() => {
  oscillators.length = 0;
  contexts.length = 0;
  localStorage.clear();
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  setActivation(undefined);
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe("playSoundEffect", () => {
  it("plays nothing while the page has never been touched: no context, no note", () => {
    setActivation({ hasBeenActive: false, isActive: false });
    playSoundEffect("pop");
    playSoundEffect("fanfare");
    expect(contexts).toHaveLength(0);
    expect(oscillators).toHaveLength(0);
  });

  it("after the first tap it schedules the notes of the sound asked for, and never throws", () => {
    setActivation({ hasBeenActive: true, isActive: false });
    playSoundEffect("tick");
    expect(contexts.length).toBeGreaterThanOrEqual(1);
    expect(oscillators).toHaveLength(1); // tick is one 35ms triangle note
    expect(oscillators[0].start).toHaveBeenCalledTimes(1);
    expect(oscillators[0].stop).toHaveBeenCalledTimes(1);
    playSoundEffect("chime");
    expect(oscillators).toHaveLength(3); // chime adds two notes
  });

  it("stays silent when the person turned sounds off, even after a tap", () => {
    setActivation({ hasBeenActive: true, isActive: true });
    localStorage.setItem("apex_sound_enabled", "false");
    const before = oscillators.length;
    playSoundEffect("success");
    expect(oscillators).toHaveLength(before);
  });
});
