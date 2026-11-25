import { isSoundEnabled, subscribeSoundPreference } from "@/lib/soundPreference";

export type SoundType = "success" | "error" | "whoosh" | "click" | "celebrate" | "pop" | "tick" | "chime" | "fanfare" | "deal";
export type SoundReadiness = "locked" | "ready" | "unavailable";

type Note = { freq: number; to?: number; at?: number; dur: number; type?: OscillatorType; gain?: number };
type Voice = { source: AudioScheduledSourceNode; gain: GainNode; extras: AudioNode[]; kind?: SoundType };

let context: AudioContext | null = null;
let resumePending: Promise<boolean> | null = null;
let gestureUsers = 0;
let removeGestures: (() => void) | null = null;
let removePreference: (() => void) | null = null;
const voices = new Set<Voice>();
const listeners = new Set<() => void>();

function audioConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function getSoundReadiness(): SoundReadiness {
  if (!audioConstructor()) return "unavailable";
  return context?.state === "running" ? "ready" : "locked";
}

export function subscribeSoundReadiness(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

function notifyReadiness(): void {
  listeners.forEach((listener) => listener());
}

function release(voice: Voice): void {
  voices.delete(voice);
  voice.source.onended = null;
  voice.source.disconnect();
  voice.gain.disconnect();
  voice.extras.forEach((node) => node.disconnect());
}

/** Mute also stops a cheer already in progress; scheduled notes cannot survive a suspension. */
export function stopSoundEffects(kind?: SoundType): void {
  for (const voice of voices) {
    if (kind && voice.kind !== kind) continue;
    voice.gain.gain.cancelScheduledValues(0);
    voice.gain.gain.setValueAtTime(0, context?.currentTime ?? 0);
    try { voice.source.stop(); } catch { /* already ended */ } // empty-catch-allow:audio-node-already-ended
    release(voice);
  }
}

function watchPreference(): void {
  if (removePreference) return;
  removePreference = subscribeSoundPreference(() => {
    if (!isSoundEnabled()) stopSoundEffects();
    notifyReadiness();
  });
}

function ensureContext(): AudioContext | null {
  const Ctor = audioConstructor();
  if (!Ctor) return null;
  if (!context || context.state === "closed") {
    const created = new Ctor();
    context = created;
    created.onstatechange = () => {
      if (context !== created) return;
      if (created.state !== "running") stopSoundEffects();
      notifyReadiness();
    };
  }
  watchPreference();
  return context;
}

function hasActiveGesture(): boolean {
  return typeof navigator !== "undefined" && navigator.userActivation?.isActive === true;
}

/** Call during a real tap/key press. Unlocking is silent and never replays an earlier event. */
export async function unlockSoundFromGesture(event?: Event): Promise<boolean> {
  if (!isSoundEnabled() || (event ? !event.isTrusted : !hasActiveGesture())) return false;
  try {
    const ctx = ensureContext();
    if (!ctx) return false;
    if (ctx.state === "running") {
      notifyReadiness();
      return true;
    }
    if (!resumePending) {
      const pending = ctx.resume().then(() => {
        notifyReadiness();
        return context === ctx && ctx.state === "running" && isSoundEnabled();
      }).catch(() => false).finally(() => { if (resumePending === pending) resumePending = null; });
      resumePending = pending;
    }
    return await resumePending;
  } catch {
    return false; // Audio is optional; browser/device denial never interrupts the workflow.
  }
}

/** Ref-counted because the authenticated provider and both responsive sound controls mount it. */
export function registerSoundGestures(): () => void {
  if (typeof window === "undefined") return () => undefined;
  gestureUsers += 1;
  if (!removeGestures) {
    watchPreference();
    const unlock = (event: Event) => { void unlockSoundFromGesture(event); };
    const onVisibility = () => { if (document.visibilityState === "hidden") stopSoundEffects(); };
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("touchend", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    removeGestures = () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("touchend", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    gestureUsers -= 1;
    if (gestureUsers !== 0) return;
    removeGestures?.();
    removeGestures = null;
    removePreference?.();
    removePreference = null;
    stopSoundEffects();
    const previous = context;
    context = null;
    resumePending = null;
    if (previous) {
      previous.onstatechange = null;
      // empty-catch-allow:optional-audio-context-already-closed
      void previous.close().catch(() => undefined);
    }
    notifyReadiness();
  };
}

function schedule(ctx: AudioContext, source: AudioScheduledSourceNode, at: number, duration: number, peak: number, extras: AudioNode[] = [], kind?: SoundType): void {
  const gain = ctx.createGain();
  const start = ctx.currentTime + at;
  const end = start + duration;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  if (extras.length) {
    source.connect(extras[0]);
    extras.forEach((node, index) => node.connect(extras[index + 1] ?? gain));
  } else source.connect(gain);
  gain.connect(ctx.destination);
  const voice = { source, gain, extras, kind };
  voices.add(voice);
  source.onended = () => release(voice);
  source.start(start);
  source.stop(end + 0.02);
}

function playNotes(ctx: AudioContext, notes: Note[], kind?: SoundType): void {
  for (const note of notes) {
    const oscillator = ctx.createOscillator();
    const start = ctx.currentTime + (note.at ?? 0);
    oscillator.type = note.type ?? "sine";
    oscillator.frequency.setValueAtTime(note.freq, start);
    if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, start + note.dur);
    schedule(ctx, oscillator, note.at ?? 0, note.dur, note.gain ?? 0.1, [], kind);
  }
}

const RECIPES: Record<Exclude<SoundType, "deal">, Note[]> = {
  pop: [{ freq: 420, to: 920, dur: 0.1, gain: 0.12 }, { freq: 1800, dur: 0.035, at: 0.01, type: "triangle", gain: 0.03 }],
  tick: [{ freq: 1500, dur: 0.035, type: "triangle", gain: 0.05 }],
  click: [{ freq: 800, dur: 0.05, gain: 0.08 }],
  chime: [{ freq: 659.25, dur: 0.36, gain: 0.1 }, { freq: 987.77, dur: 0.42, at: 0.11, gain: 0.09 }],
  success: [{ freq: 523.25, dur: 0.16, gain: 0.1 }, { freq: 659.25, dur: 0.16, at: 0.1, gain: 0.1 }, { freq: 783.99, dur: 0.24, at: 0.2, gain: 0.12 }],
  fanfare: [{ freq: 523.25, dur: 0.12, gain: 0.1 }, { freq: 659.25, dur: 0.12, at: 0.09, gain: 0.1 }, { freq: 783.99, dur: 0.12, at: 0.18, gain: 0.1 }, { freq: 1046.5, dur: 0.46, at: 0.27, gain: 0.13 }, { freq: 1318.5, dur: 0.4, at: 0.33, gain: 0.05 }],
  celebrate: [],
  whoosh: [{ freq: 800, to: 200, dur: 0.16, gain: 0.07 }],
  error: [{ freq: 330, dur: 0.14, gain: 0.07 }, { freq: 262, dur: 0.22, at: 0.13, gain: 0.06 }],
};
RECIPES.celebrate = RECIPES.fanfare;

/** Original, short balloon pop + layered "woo" glides and applause. No downloaded audio. */
function playDealCheer(ctx: AudioContext): void {
  playNotes(ctx, RECIPES.pop, "deal");
  playNotes(ctx, [
    { freq: 260, to: 540, at: 0.1, dur: 0.65, type: "triangle", gain: 0.035 },
    { freq: 330, to: 690, at: 0.18, dur: 0.75, type: "triangle", gain: 0.03 },
    { freq: 420, to: 820, at: 0.24, dur: 0.6, type: "sine", gain: 0.035 },
  ], "deal");
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.12), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  for (const at of [0, 0.16, 0.31, 0.47, 0.64, 0.81, 0.97]) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = at === 0 ? 2100 : 1300;
    filter.Q.value = 0.7;
    schedule(ctx, source, at, at === 0 ? 0.06 : 0.1, at === 0 ? 0.12 : 0.055, [filter], "deal");
  }
}

/** A blocked or suspended context drops the event. It never queues sound for a later tap. */
export function playSoundEffect(kind: SoundType): void {
  if (!isSoundEnabled() || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
  try {
    if ((!context || context.state !== "running") && hasActiveGesture()) void unlockSoundFromGesture();
    const ctx = context;
    if (!ctx || ctx.state !== "running" || voices.size > 40) return;
    if (kind === "deal") playDealCheer(ctx);
    else playNotes(ctx, RECIPES[kind], kind);
  } catch {
    stopSoundEffects(); // An unavailable audio device must never fail a saved action.
  }
}
