import { useCallback } from "react";
import { isSoundEnabled } from "@/lib/soundPreference";

/**
 * Sound effects, synthesised with the Web Audio API so there is nothing to download and
 * nothing to cache (2026-10-28 rewrite; the first version is from 2026-05).
 *
 * Every sound is short, soft and tied to something the person just did. Nothing plays on
 * page load. The preference lives in src/lib/soundPreference.ts: the header toggle and
 * Profile settings both write it, and `playSoundEffect` reads it on every call.
 *
 *   pop       a note was saved, a filter picked, a small thing done
 *   tick      a step moved
 *   chime     an interview booked, an invitation created
 *   success   the older three-note rise, kept for existing callers
 *   fanfare   a hire, a deal, a win (also "celebrate" for existing callers)
 *   whoosh    something sent or dismissed
 *   click     a quiet confirmation
 *   error     two soft falling notes; never harsh
 */
export type SoundType = "success" | "error" | "whoosh" | "click" | "celebrate" | "pop" | "tick" | "chime" | "fanfare";

type Wave = OscillatorType;

interface Note {
  /** Start frequency in Hz. */
  freq: number;
  /** Optional frequency to glide to by the end of the note. */
  to?: number;
  /** Offset from now in seconds. */
  at?: number;
  /** Length in seconds. */
  dur: number;
  type?: Wave;
  /** Peak gain, 0..1. Kept low on purpose. */
  gain?: number;
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  // iOS suspends a context created outside a gesture; every call here is inside one.
  // empty-catch-allow:browser-audio-denial-is-optional-feedback
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

function play(ctx: AudioContext, notes: Note[]): void {
  const now = ctx.currentTime;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const start = now + (n.at ?? 0);
    const end = start + n.dur;
    osc.type = n.type ?? "sine";
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(n.gain ?? 0.1, start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

const RECIPES: Record<SoundType, Note[]> = {
  pop: [
    { freq: 420, to: 920, dur: 0.1, gain: 0.12 },
    { freq: 1800, dur: 0.035, at: 0.01, type: "triangle", gain: 0.03 },
  ],
  tick: [{ freq: 1500, dur: 0.035, type: "triangle", gain: 0.05 }],
  click: [{ freq: 800, dur: 0.05, gain: 0.08 }],
  chime: [
    { freq: 659.25, dur: 0.36, gain: 0.1 },
    { freq: 987.77, dur: 0.42, at: 0.11, gain: 0.09 },
  ],
  success: [
    { freq: 523.25, dur: 0.16, gain: 0.1 },
    { freq: 659.25, dur: 0.16, at: 0.1, gain: 0.1 },
    { freq: 783.99, dur: 0.24, at: 0.2, gain: 0.12 },
  ],
  fanfare: [
    { freq: 523.25, dur: 0.12, gain: 0.1 },
    { freq: 659.25, dur: 0.12, at: 0.09, gain: 0.1 },
    { freq: 783.99, dur: 0.12, at: 0.18, gain: 0.1 },
    { freq: 1046.5, dur: 0.46, at: 0.27, gain: 0.13 },
    { freq: 1318.5, dur: 0.4, at: 0.33, gain: 0.05 },
  ],
  celebrate: [],
  whoosh: [{ freq: 800, to: 200, dur: 0.16, gain: 0.07 }],
  error: [
    { freq: 330, dur: 0.14, gain: 0.07 },
    { freq: 262, dur: 0.22, at: 0.13, gain: 0.06 },
  ],
};
RECIPES.celebrate = RECIPES.fanfare;

/** Play one sound if the person has sounds on. Safe to call anywhere; never throws. */
export function playSoundEffect(kind: SoundType): void {
  // A suspended or background context must never be woken by a subscription or load.
  if (!isSoundEnabled() || typeof navigator === "undefined" || !navigator.userActivation?.isActive) return;
  try {
    const ctx = audio();
    if (!ctx) return;
    play(ctx, RECIPES[kind] ?? []);
  } catch (e) {
    if (import.meta.env.DEV) console.warn("Sound effect failed:", e);
  }
}

export const useSoundEffects = () => {
  const playSound = useCallback((kind: SoundType) => playSoundEffect(kind), []);
  return { playSound };
};
