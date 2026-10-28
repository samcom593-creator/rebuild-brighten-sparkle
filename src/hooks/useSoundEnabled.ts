import { useSyncExternalStore } from "react";
import { isSoundEnabled, setSoundEnabled, subscribeSoundPreference } from "@/lib/soundPreference";

const serverSnapshot = () => true;

/** The app-wide sound preference as React state: `[on, setOn]`. */
export function useSoundEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeSoundPreference, isSoundEnabled, serverSnapshot);
  return [on, setSoundEnabled];
}
