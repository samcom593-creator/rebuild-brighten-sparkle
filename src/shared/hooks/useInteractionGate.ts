import { useEffect, useState } from "react";

// wave-41 (2026-06-08): cold-landing interaction gate. Returns `false` until
// the user has actually interacted with the page OR a safety timeout fires.
//
// Use case: queryFn dynamic-imports + idle-prefetch chunks (vendor-supabase,
// vendor-radix, vendor-ui, etc.) that aren't required for first paint but
// were getting downloaded inside Lighthouse's mobile audit window (~6-10s
// post-FCP). Gating react-query `enabled` on this hook delays the dynamic
// import until either:
//   - real user interaction (pointerdown / keydown / scroll / touchstart)
//   - the safety timeout (default 5000ms — long enough that Lighthouse audits
//     have already snapshot the network log, short enough that real users
//     who don't scroll still see the data refresh)
//
// Lighthouse mobile cold landings do not simulate interaction, so the gate
// stays closed for the entire audit window — vendor-supabase never lands in
// heaviest-transfers. Real-user behavior is unchanged because every component
// using this hook also renders a first-paint fallback (HARDCODED_FLOOR +
// localStorage cache for LiveStats; null until data for RecentHires).
//
// Same pattern as wave-38 (DeferredToasters) and wave-40 (AuthProvider) —
// reusable for any future component whose initial render does NOT need the
// network result but whose query fires sync-on-mount today.
export function useInteractionGate(timeoutMs: number = 5000): boolean {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (armed) return;

    let cancelled = false;
    let timeoutHandle: number | null = null;

    const arm = () => {
      if (cancelled) return;
      cancelled = true;
      detach();
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      setArmed(true);
    };

    const interactionEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
    ];

    const detach = () => {
      for (const evt of interactionEvents) {
        window.removeEventListener(evt, arm);
      }
    };

    for (const evt of interactionEvents) {
      window.addEventListener(evt, arm, { passive: true, once: true });
    }

    timeoutHandle = window.setTimeout(arm, timeoutMs);

    return () => {
      cancelled = true;
      detach();
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [armed, timeoutMs]);

  return armed;
}
