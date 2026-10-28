/**
 * One sound preference for the whole app (2026-10-28).
 *
 * Stored under the key Profile settings has used since the first sound effects shipped, so
 * nobody's earlier choice is lost. The header toggle, Profile settings and every sound
 * effect read and write it through here, and a change made in one place reaches the
 * others at once (same tab through a window event, other tabs through the storage event).
 */
const KEY = "apex_sound_enabled";
const EVENT = "apex:sound-preference";

let memoryChoice: boolean | undefined;

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "false";
  } catch { return memoryChoice ?? true; } // empty-catch-allow:localstorage-incognito
}

export function setSoundEnabled(on: boolean): void {
  memoryChoice = on;
  try {
    localStorage.setItem(KEY, String(on));
  } catch { /* private mode: the choice lasts for this page */ } // empty-catch-allow:localstorage-incognito
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

/** Calls back whenever the preference changes, in this tab or another. Returns the unsubscribe. */
export function subscribeSoundPreference(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) onChange(); };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
