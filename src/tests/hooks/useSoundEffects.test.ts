import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let engine: typeof import("@/lib/soundEngine");
let preference: typeof import("@/lib/soundPreference");
let initialState: AudioContextState = "running";
let resumeAllowed = true;
const contexts: FakeAudioContext[] = [];
type FakeSource = { kind: string; type: string; buffer: null; frequency: ReturnType<typeof parameter>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null };
type FakeGain = { gain: ReturnType<typeof parameter>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
const nodes: FakeSource[] = [];
const gains: FakeGain[] = [];

function parameter() { return { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }; }
function makeSource(kind: string): FakeSource {
  const source = { kind, type: "sine", buffer: null, frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  nodes.push(source);
  return source;
}
function makeGain(): FakeGain {
  const gain = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  gains.push(gain);
  return gain;
}
class FakeAudioContext {
  state: AudioContextState = initialState;
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  onstatechange: (() => void) | null = null;
  constructor() { contexts.push(this); }
  resume = vi.fn(async () => { if (resumeAllowed) this.state = "running"; this.onstatechange?.(); });
  close = vi.fn(async () => { this.state = "closed"; });
  createOscillator = () => makeSource("oscillator");
  createBufferSource = () => makeSource("buffer");
  createGain = makeGain;
  createBiquadFilter = () => ({ type: "bandpass", frequency: parameter(), Q: parameter(), connect: vi.fn(), disconnect: vi.fn() });
  createBuffer = (_channels: number, frames: number) => ({ getChannelData: () => new Float32Array(frames) });
}
function activation(active: boolean, previous = active) {
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: active, hasBeenActive: previous } });
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  initialState = "running";
  resumeAllowed = true;
  contexts.length = nodes.length = gains.length = 0;
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  activation(false);
  engine = await import("@/lib/soundEngine");
  preference = await import("@/lib/soundPreference");
});
afterEach(() => {
  const release = engine.registerSoundGestures();
  release();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "userActivation");
  Reflect.deleteProperty(window, "AudioContext");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("gesture-unlocked sound", () => {
  it("does not create a context or queue notes before the first real gesture", () => {
    engine.playSoundEffect("deal");
    activation(false, true); // past activity is not permission to create an audio context now
    engine.playSoundEffect("fanfare");
    expect(contexts).toHaveLength(0);
    expect(nodes).toHaveLength(0);
  });

  it("arms silently during a gesture and plays only new events afterward", async () => {
    engine.playSoundEffect("deal");
    activation(true);
    expect(await engine.unlockSoundFromGesture()).toBe(true);
    expect(nodes).toHaveLength(0);
    activation(false, true);
    engine.playSoundEffect("tick");
    engine.playSoundEffect("chime");
    expect(contexts).toHaveLength(1);
    expect(nodes).toHaveLength(3);
    expect(nodes.every((node) => node.start.mock.calls.length === 1)).toBe(true);
  });

  it("drops a blocked-context event and never replays it after resume", async () => {
    initialState = "suspended";
    resumeAllowed = false;
    activation(true);
    expect(await engine.unlockSoundFromGesture()).toBe(false);
    activation(false, true);
    engine.playSoundEffect("deal");
    expect(nodes).toHaveLength(0);
    contexts[0].state = "running";
    contexts[0].onstatechange?.();
    expect(nodes).toHaveLength(0);
    engine.playSoundEffect("tick");
    expect(nodes).toHaveLength(1);
  });

  it("keeps the prior mute and stops an in-progress cheer immediately when muted", async () => {
    preference.setSoundEnabled(false);
    activation(true);
    expect(await engine.unlockSoundFromGesture()).toBe(false);
    expect(contexts).toHaveLength(0);
    preference.setSoundEnabled(true);
    await engine.unlockSoundFromGesture();
    engine.playSoundEffect("deal");
    expect(nodes.filter((node) => node.kind === "buffer")).toHaveLength(7);
    expect(nodes.filter((node) => node.kind === "oscillator")).toHaveLength(5);
    const count = nodes.length;
    preference.setSoundEnabled(false);
    expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    expect(gains.every((gain) => gain.gain.cancelScheduledValues.mock.calls.length === 1)).toBe(true);
    engine.playSoundEffect("deal");
    expect(nodes).toHaveLength(count);
  });

  it("disconnects finished voices and cuts off pending notes on suspension", async () => {
    activation(true);
    await engine.unlockSoundFromGesture();
    engine.playSoundEffect("chime");
    nodes[0].onended?.();
    expect(nodes[0].disconnect).toHaveBeenCalledOnce();
    contexts[0].state = "suspended";
    contexts[0].onstatechange?.();
    expect(nodes[1].disconnect).toHaveBeenCalledOnce();
    expect(gains[1].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
  });

  it("can stop a presentation's deal cheer without cutting off another action's sound", async () => {
    activation(true);
    await engine.unlockSoundFromGesture();
    engine.playSoundEffect("tick");
    engine.playSoundEffect("deal");
    engine.stopSoundEffects("deal");
    expect(nodes[0].disconnect).not.toHaveBeenCalled();
    expect(nodes.slice(1).every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it("stops immediately when mute cannot persist but storage remains readable", async () => {
    activation(true);
    await engine.unlockSoundFromGesture();
    engine.playSoundEffect("deal");
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    preference.setSoundEnabled(false);
    expect(preference.isSoundEnabled()).toBe(false);
    expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    set.mockRestore();
  });

  it("shares one gesture listener set across desktop/mobile/provider and closes at the last unmount", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const first = engine.registerSoundGestures();
    const second = engine.registerSoundGestures();
    expect(add.mock.calls.filter(([name]) => name === "pointerdown")).toHaveLength(1);
    window.dispatchEvent(new Event("pointerdown")); // a script cannot synthesize browser activation
    expect(contexts).toHaveLength(0);
    activation(true);
    await engine.unlockSoundFromGesture();
    first();
    expect(contexts[0].close).not.toHaveBeenCalled();
    second();
    expect(remove.mock.calls.filter(([name]) => name === "pointerdown")).toHaveLength(1);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(engine.getSoundReadiness()).toBe("locked");
  });

  it("silences hidden tabs and cross-tab mute changes", async () => {
    const release = engine.registerSoundGestures();
    activation(true);
    await engine.unlockSoundFromGesture();
    engine.playSoundEffect("tick");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(nodes[0].disconnect).toHaveBeenCalledOnce();
    engine.playSoundEffect("deal");
    expect(nodes).toHaveLength(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    localStorage.setItem("apex_sound_enabled", "false");
    window.dispatchEvent(new StorageEvent("storage", { key: "apex_sound_enabled" }));
    engine.playSoundEffect("deal");
    expect(nodes).toHaveLength(1);
    release();
  });

  it("contains a browser audio denial without failing the saved action", async () => {
    Object.defineProperty(window, "AudioContext", { configurable: true, value: class { constructor() { throw new Error("blocked"); } } });
    activation(true);
    expect(await engine.unlockSoundFromGesture()).toBe(false);
    expect(() => engine.playSoundEffect("deal")).not.toThrow();
  });
});
