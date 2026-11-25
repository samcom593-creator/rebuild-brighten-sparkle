import { useEffect, useSyncExternalStore } from "react";
import { getSoundReadiness, registerSoundGestures, subscribeSoundReadiness, type SoundReadiness } from "@/lib/soundEngine";

const serverSnapshot = (): SoundReadiness => "locked";

/** All mounted sound controls share one browser context and one set of gesture listeners. */
export function useSoundSession(): SoundReadiness {
  useEffect(registerSoundGestures, []);
  return useSyncExternalStore(subscribeSoundReadiness, getSoundReadiness, serverSnapshot);
}
