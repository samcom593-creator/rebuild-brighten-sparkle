import { useEffect, useCallback, useRef } from "react";
import confetti from "canvas-confetti";

interface ConfettiCelebrationProps {
  trigger: boolean;
  onComplete?: () => void;
}

// Detect iOS Safari which has layout issues with confetti canvas
const isIOSSafari = () => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  return isIOS && isSafari;
};

export function ConfettiCelebration({ trigger, onComplete }: ConfettiCelebrationProps) {
  const hasTriggeredRef = useRef(false);
  
  const fireConfetti = useCallback(() => {
    // On iOS Safari, skip confetti entirely to prevent layout glitches
    if (isIOSSafari()) {
      console.log("Skipping confetti on iOS Safari to prevent layout issues");
      onComplete?.();
      return;
    }

    // APEX theme colors - teal, emerald, gold
    const colors = ["#14b8a6", "#10b981", "#f59e0b", "#06b6d4", "#22d3ee"];
    
    const defaults = {
      spread: 360,
      ticks: 50, // Reduced from 60
      gravity: 1, // Slightly faster fall
      decay: 0.92, // Faster decay
      startVelocity: 25, // Lower velocity
      colors,
      disableForReducedMotion: true, // Respect user preferences
    };

    // Fire a single, smaller burst instead of multiple
    const shoot = () => {
      confetti({
        ...defaults,
        particleCount: 30, // Single burst with fewer particles
        scalar: 1,
        shapes: ["star", "circle"],
        origin: { x: 0.5, y: 0.4 },
      });
    };

    // Single burst only
    shoot();

    // Callback after animation (shorter timeout since animation is simpler)
    setTimeout(() => {
      onComplete?.();
    }, 1500);
  }, [onComplete]);

  useEffect(() => {
    if (trigger && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      // Small delay to let React finish render cycle first
      requestAnimationFrame(() => {
        fireConfetti();
      });
    } else if (!trigger) {
      hasTriggeredRef.current = false;
    }
  }, [trigger, fireConfetti]);

  return null;
}
