import { playSoundEffect } from "@/hooks/useSoundEffects";

/**
 * Celebrations: a burst of round confetti ("bubbles") plus a sound, sized to the win
 * (2026-10-28). Fired by the component that just completed the action, from the control
 * the person pressed, so the bubbles rise from where their finger was.
 *
 *   save     a call outcome saved, a note kept, a step done        16 bubbles, a pop
 *   booked   an interview booked, an invitation created           48 bubbles, a chime
 *   hire     a new agent, a Monday start, a first deal            a full burst, a fanfare
 *   win      anything the owner wants to feel                     same as hire
 *
 * canvas-confetti is loaded on first use (about 10 KB), so pages that never celebrate never
 * pay for it. Under prefers-reduced-motion nothing moves; the sound still plays if sounds
 * are on, because the preference for sound is a separate choice.
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

export async function celebrate(kind: CelebrationKind, origin?: CelebrationOrigin): Promise<void> {
  playSoundEffect(CELEBRATION_SOUND[kind]);
  // Saving outcomes is a high-frequency action. Keyboard and non-gesture actions
  // keep their ordinary success receipt without decorative movement.
  if (kind === "save" || prefersReducedMotion() || typeof navigator === "undefined" || !navigator.userActivation?.hasBeenActive) return;
  if (typeof document !== "undefined" && document.activeElement?.matches(":focus-visible")) return;
  let confetti: typeof import("canvas-confetti").default;
  try {
    confetti = (await import("canvas-confetti")).default;
  } catch {
    return; // the burst is decoration; a failed chunk must never break the action it followed
  }
  const at = originOf(origin);
  const base = { origin: at, shapes: ["circle" as const], disableForReducedMotion: true, zIndex: 10000 };
  switch (kind) {
    case "save":
      confetti({ ...base, particleCount: 16, spread: 55, startVelocity: 18, gravity: 0.7, ticks: 80, scalar: 0.85, colors: [GOLD, GREEN, SKY] });
      return;
    case "booked":
      confetti({ ...base, particleCount: 48, spread: 75, startVelocity: 26, gravity: 0.8, ticks: 120, scalar: 1, colors: [GOLD, SKY, VIOLET, CREAM] });
      return;
    case "hire":
    case "win":
      confetti({ ...base, particleCount: 120, spread: 100, startVelocity: 34, gravity: 0.9, ticks: 160, scalar: 1.1, colors: [GOLD, GREEN, SKY, CORAL, VIOLET, CREAM] });
      window.setTimeout(() => {
        confetti({ ...base, origin: { x: 0.12, y: 0.72 }, angle: 60, particleCount: 48, spread: 60, startVelocity: 36, ticks: 140, colors: [GOLD, GREEN, SKY, CREAM] });
        confetti({ ...base, origin: { x: 0.88, y: 0.72 }, angle: 120, particleCount: 48, spread: 60, startVelocity: 36, ticks: 140, colors: [GOLD, CORAL, VIOLET, CREAM] });
      }, 180);
      return;
  }
}
