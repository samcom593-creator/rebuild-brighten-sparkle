import { useCallback, useRef } from "react";

type SoundType = "success" | "error" | "whoosh" | "click" | "celebrate";

// Using Web Audio API for instant, reliable sound playback
export const useSoundEffects = () => {
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback((frequency: number, duration: number, type: OscillatorType = "sine", volume = 0.3) => {
    try {
      const ctx = getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

      gainNode.gain.setValueAtTime(volume, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);
    } catch (e) {
      console.log("Audio playback failed:", e);
    }
  }, [getAudioContext]);

  const playSound = useCallback((soundType: SoundType) => {
    // Respect user preference
    try {
      const soundEnabled = localStorage.getItem("apex_sound_enabled");
      if (soundEnabled === "false") return;
    } catch { /* ignore */ }

    try {
      const ctx = getAudioContext();
      
      switch (soundType) {
        case "success":
          // Upward arpeggio - cheerful success sound
          playTone(523.25, 0.15, "sine", 0.2); // C5
          setTimeout(() => playTone(659.25, 0.15, "sine", 0.2), 100); // E5
          setTimeout(() => playTone(783.99, 0.2, "sine", 0.25), 200); // G5
          break;

        case "celebrate":
          // Fanfare-like celebration
          playTone(523.25, 0.1, "sine", 0.2);
          setTimeout(() => playTone(659.25, 0.1, "sine", 0.2), 80);
          setTimeout(() => playTone(783.99, 0.1, "sine", 0.2), 160);
          setTimeout(() => playTone(1046.50, 0.3, "sine", 0.3), 240); // C6
          break;

        case "error":
          // Descending tone - error/warning
          playTone(400, 0.15, "sawtooth", 0.15);
          setTimeout(() => playTone(300, 0.2, "sawtooth", 0.1), 150);
          break;

        case "whoosh":
          // Quick swoosh effect using noise-like frequency sweep
          const oscillator = ctx.createOscillator();
          const gainNode = ctx.createGain();
          oscillator.connect(gainNode);
          gainNode.connect(ctx.destination);
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(800, ctx.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
          gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
          oscillator.start(ctx.currentTime);
          oscillator.stop(ctx.currentTime + 0.15);
          break;

        case "click":
          // Short, subtle click
          playTone(800, 0.05, "sine", 0.15);
          break;

        default:
          break;
      }
    } catch (e) {
      console.log("Sound effect failed:", e);
    }
  }, [getAudioContext, playTone]);

  return { playSound };
};
