import { playSoundEffect } from "@/hooks/useSoundEffects";

/**
 * Celebrations: a burst of round confetti ("bubbles") plus a sound, sized to the win
 * (2026-10-28). Fired by the component that just completed the action, from the control
 * the person pressed, so the bubbles rise from where their finger was.
 *
 *   save     a call outcome saved, a note kept, a step done        14 bubbles, a pop
 *   booked   an interview booked, an invitation created           40 bubbles, a chime
 *   hire     a new agent, a Monday start, a first deal            a full burst, a fanfare
 *   win      anything the owner wants to feel                     same as hire
 *
 * canvas-confetti is loaded on first use (about 10 KB), so pages that never celebrate never
 * pay for it. Under prefers-reduced-motion nothing moves; the sound still plays if sounds
 * are on, because the preference for sound is a separate choice.
 *
 * Motion review (2026-10-28): the burst is drawn on a fixed canvas with pointer-events: none
 * (canvas-confetti sets it), so a tap during the fall reaches the control under it; its
 * z-index of 10000 sits above sheets and dialogs (z-50) and below Sonner's toasts
 * (999999999), so a "Saved" toast is never covered. On a phone (viewport under 640px) every
 * count is scaled to 0.6 and every burst is shorter, because canvas-confetti draws on the
 * main thread, and a 160-particle burst over 2.7s is what makes a mid-range phone stutter
 * while the list behind it reloads. Nothing in here can throw into the action it followed.
 */
export type CelebrationKind = "save" | "booked" | "hire" | "win";

export type CelebrationOrigin = { x: number; y: number } | Element | null | undefined;

// Hex is what canvas-confetti reads. These are the dark-theme tones from src/styles/delight.css.
const GOLD = "#f0c330";
const GREEN = "#41d38a";
const SKY = "#64b4f7";
const CORAL = "#f3715e";
const VIOLET = "#b088f3";
const CREAM = "#faefc4";

/** Sits above sheets and dialogs (z-50), below Sonner's toasts. */
export const CELEBRATION_Z_INDEX = 10000;

/** Particle counts and durations are multiplied by this on a phone. */
export const PHONE_SCALE = 0.6;

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; } // empty-catch-allow:matchmedia-unavailable
}

/** Normalised (0..1) viewport coordinates for the burst's origin. */
function originOf(origin: CelebrationOrigin): { x: number; y: number } {
  if (!origin || typeof window === "undefined") return { x: 0.5, y: 0.6 };
  if ("getBoundingClientRect" in origin) {
    const r = origin.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return { x: 0.5, y: 0.6 };
    return {
      x: Math.min(1, Math.max(0, (r.left + r.width / 2) / window.innerWidth)),
      y: Math.min(1, Math.max(0, (r.top + r.height / 2) / window.innerHeight)),
    };
  }
  return origin;
}

export const CELEBRATION_SOUND: Record<CelebrationKind, "pop" | "chime" | "fanfare"> = {
  save: "pop",
  booked: "chime",
  hire: "fanfare",
  win: "fanfare",
};

/** The scale for this viewport: phones get fewer, shorter bubbles. */
function burstScale(): number {
  return typeof window !== "undefined" && window.innerWidth < 640 ? PHONE_SCALE : 1;
}

export async function celebrate(kind: CelebrationKind, origin?: CelebrationOrigin): Promise<void> {
  playSoundEffect(CELEBRATION_SOUND[kind]);
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  let confetti: typeof import("canvas-confetti").default;
  try {
    confetti = (await import("canvas-confetti")).default;
  } catch {
    return; // the burst is decoration; a failed chunk must never break the action it followed
  }
  const k = burstScale();
  const n = (count: number) => Math.max(6, Math.round(count * k));
  const t = (ticks: number) => Math.round(ticks * (k === 1 ? 1 : 0.8));
  const at = originOf(origin);
  const base = { origin: at, shapes: ["circle" as const], disableForReducedMotion: true, zIndex: CELEBRATION_Z_INDEX };
  try {
    switch (kind) {
      case "save":
        confetti({ ...base, particleCount: n(14), spread: 55, startVelocity: 18, gravity: 0.7, ticks: t(70), scalar: 0.85, colors: [GOLD, GREEN, SKY] });
        return;
      case "booked":
        confetti({ ...base, particleCount: n(40), spread: 75, startVelocity: 26, gravity: 0.8, ticks: t(110), scalar: 1, colors: [GOLD, SKY, VIOLET, CREAM] });
        return;
      case "hire":
      case "win":
        confetti({ ...base, particleCount: n(90), spread: 100, startVelocity: 34, gravity: 0.9, ticks: t(140), scalar: 1.1, colors: [GOLD, GREEN, SKY, CORAL, VIOLET, CREAM] });
        window.setTimeout(() => {
          try {
            confetti({ ...base, origin: { x: 0.12, y: 0.72 }, angle: 60, particleCount: n(36), spread: 60, startVelocity: 36, ticks: t(120), colors: [GOLD, GREEN, SKY, CREAM] });
            confetti({ ...base, origin: { x: 0.88, y: 0.72 }, angle: 120, particleCount: n(36), spread: 60, startVelocity: 36, ticks: t(120), colors: [GOLD, CORAL, VIOLET, CREAM] });
          } catch { // empty-catch-allow:confetti-is-decoration
            // the side bursts are decoration; see below
          }
        }, 180);
        return;
    }
  } catch { // empty-catch-allow:confetti-is-decoration
    // decoration only: a canvas that cannot be created (an old WebView, a test runner) is not an
    // error, and the action this followed has already succeeded
  }
}
