/**
 * The strip that makes demo mode impossible to mistake for production.
 *
 * A masking layer with no indicator is a liability in both directions: Sam
 * could screenshot fake numbers believing they are real, or read a real number
 * off a screen he thinks is masked. It is deliberately loud, fixed to the top,
 * present on every route, and carries its own exit.
 *
 * It is driven by the demo flag itself, not by whether masking succeeded —
 * demoFetch falls back to the unmasked response if the mask throws, so the only
 * honest thing the banner can say is "demo mode is on", which is exactly what
 * governs the request path.
 *
 * MP-533: one clause of that sentence IS conditional, and now says so. Names
 * spoken inside prose ("Aisha Kebbeh · $1,284 Deal Win") are rewritten only for
 * people the session map knows, and the map is seeded from the roster. When
 * that seed does not land — an unauthenticated session reads `agents` as `[]`,
 * a network failure, a 403 — prose names are NOT covered, and a banner that
 * kept saying "every name on screen is fake" would be telling the room the one
 * thing that is no longer true. The words shrink to the claim that survives.
 * Numbers and name COLUMNS are masked by key and are unaffected either way.
 */

import { useSyncExternalStore } from "react";
import { EyeOff } from "lucide-react";
import {
  isDemoMode,
  setDemoMode,
  getDemoPrimeState,
  subscribeDemoPrime,
} from "@/lib/demoMode";

export function DemoModeBanner() {
  // Subscribed, not sampled once: priming resolves after mount, so a banner
  // that read the state in a useState initializer would be frozen on
  // "unprimed" forever and could never tell the truth about either outcome.
  const primeState = useSyncExternalStore(subscribeDemoPrime, getDemoPrimeState, getDemoPrimeState);
  const on = isDemoMode();
  if (!on) return null;

  // Only a landed roster licenses the claim about names inside sentences.
  const namesCovered = primeState === "primed";

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] w-full bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-center gap-3 text-sm font-medium shadow"
    >
      <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {namesCovered
          ? "Demo mode — every number and name on screen is fake. Nothing here is live client data."
          : "Demo mode — numbers and name fields on screen are fake. Names written inside sentences may still be real."}
      </span>
      <button
        type="button"
        onClick={() => {
          setDemoMode(false);
          // Full reload: React Query holds masked rows in cache, and clearing
          // the flag without discarding them would leave fake numbers on screen
          // with no banner explaining them — the one state worse than either.
          window.location.href = window.location.pathname;
        }}
        className="underline underline-offset-2 hover:no-underline whitespace-nowrap"
      >
        Exit demo
      </button>
    </div>
  );
}
