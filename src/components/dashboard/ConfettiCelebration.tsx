import { useEffect, useCallback } from "react";
import confetti from "canvas-confetti";

interface ConfettiCelebrationProps {
  trigger: boolean;
  onComplete?: () => void;
}

export function ConfettiCelebration({ trigger, onComplete }: ConfettiCelebrationProps) {
  const fireConfetti = useCallback(() => {
    // APEX theme colors - teal, emerald, gold
    const colors = ["#14b8a6", "#10b981", "#f59e0b", "#06b6d4", "#22d3ee"];
    
    const defaults = {
      spread: 360,
      ticks: 100,
      gravity: 0.8,
      decay: 0.94,
      startVelocity: 30,
      colors,
    };

    // Fire multiple bursts for a dramatic effect
    const shoot = () => {
      confetti({
        ...defaults,
        particleCount: 40,
        scalar: 1.2,
        shapes: ["star"],
        origin: { x: 0.5, y: 0.3 },
      });

      confetti({
        ...defaults,
        particleCount: 25,
        scalar: 0.75,
        shapes: ["circle"],
        origin: { x: 0.3, y: 0.5 },
      });

      confetti({
        ...defaults,
        particleCount: 25,
        scalar: 0.75,
        shapes: ["circle"],
        origin: { x: 0.7, y: 0.5 },
      });
    };

    // Staggered bursts
    shoot();
    setTimeout(shoot, 100);
    setTimeout(shoot, 200);

    // Callback after animation
    setTimeout(() => {
      onComplete?.();
    }, 2000);
  }, [onComplete]);

  useEffect(() => {
    if (trigger) {
      fireConfetti();
    }
  }, [trigger, fireConfetti]);

  return null;
}
