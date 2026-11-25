import { useCallback } from "react";
import { playSoundEffect, type SoundType } from "@/lib/soundEngine";

export { playSoundEffect, type SoundType } from "@/lib/soundEngine";

/** Shared, gesture-unlocked audio; the stored mute applies to every caller. */
export const useSoundEffects = () => {
  const playSound = useCallback((kind: SoundType) => playSoundEffect(kind), []);
  return { playSound };
};
