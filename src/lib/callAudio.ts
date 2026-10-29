// callAudio: helpers for playing ReadyMode calls on the site (MP-310, 2026-10-28).
export interface AudioMoment { t: string; label: string }

/** "3:45", "[1:02:07]" or "75" to seconds; null when it is not a time. */
export function toSeconds(t: string | null | undefined): number | null {
  if (t == null) return null;
  const parts = String(t).trim().replace(/^\[|\]$/g, "").split(":");
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** Moments from a grade's key_quotes or an insight's key_moments: [{t, label | who + quote}], invalid entries dropped. */
export function momentsFrom(list: unknown): AudioMoment[] {
  if (!Array.isArray(list)) return [];
  const out: AudioMoment[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const m = item as { t?: unknown; label?: unknown; who?: unknown; quote?: unknown };
    const t = typeof m.t === "string" ? m.t : null;
    if (t == null || toSeconds(t) == null) continue;
    const quote = typeof m.quote === "string" ? m.quote : "";
    const label = typeof m.label === "string" && m.label ? m.label : quote ? `${typeof m.who === "string" ? `${m.who}: ` : ""}${quote.slice(0, 40)}` : "moment";
    out.push({ t, label });
  }
  return out;
}

/** Ask the player for this call to jump to a transcript stamp and play a snippet (it loads the audio first if needed). */
export function seekCall(callId: string, t: string | null | undefined): void {
  const seconds = toSeconds(t);
  if (seconds == null || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("call-audio-seek", { detail: { callId, seconds } }));
}
