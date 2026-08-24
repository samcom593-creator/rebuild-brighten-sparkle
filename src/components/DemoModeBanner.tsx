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
 */

import { useState } from "react";
import { EyeOff } from "lucide-react";
import { isDemoMode, setDemoMode } from "@/lib/demoMode";

export function DemoModeBanner() {
  const [on] = useState(() => isDemoMode());
  if (!on) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] w-full bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-center gap-3 text-sm font-medium shadow"
    >
      <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Demo mode — every number and name on screen is fake. Nothing here is live client data.
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
