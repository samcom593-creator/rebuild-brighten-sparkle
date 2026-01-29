import { useEffect, useCallback, useRef } from "react";
import confetti from "canvas-confetti";

interface ConfettiCelebrationProps {
  trigger: boolean;
  onComplete?: () => void;
}

// Detect ANY iOS device (Safari, Chrome, Firefox on iOS are all WebKit)
const isIOSDevice = () => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  
  // Check for iPhone/iPad/iPod
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  
  // Check for iPadOS (reports as Mac but has touch)
  const isIPadOS = 
    navigator.platform === "MacIntel" && 
    navigator.maxTouchPoints > 1;
  
  return isIOS || isIPadOS;
};

export function ConfettiCelebration({ trigger, onComplete }: ConfettiCelebrationProps) {
  const hasTriggeredRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const confettiInstanceRef = useRef<ReturnType<typeof confetti.create> | null>(null);
  
  // Create canvas and confetti instance on mount
  useEffect(() => {
    // Skip setup on iOS devices entirely
    if (isIOSDevice()) return;
    
    // Create a fixed-position canvas that won't affect layout
    const canvas = document.createElement("canvas");
    canvas.style.cssText = `
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
    `;
    document.body.appendChild(canvas);
    canvasRef.current = canvas;
    
    // Create confetti instance bound to our canvas
    confettiInstanceRef.current = confetti.create(canvas, {
      resize: true,
      useWorker: true,
    });
    
    return () => {
      // Cleanup on unmount
      if (canvasRef.current && document.body.contains(canvasRef.current)) {
        document.body.removeChild(canvasRef.current);
      }
      canvasRef.current = null;
      confettiInstanceRef.current = null;
    };
  }, []);
  
  const fireConfetti = useCallback(() => {
    // On iOS devices, skip confetti entirely to prevent layout issues
    if (isIOSDevice()) {
      console.log("Skipping confetti on iOS device to prevent layout issues");
      onComplete?.();
      return;
    }

    // Use our own confetti instance if available
    const fire = confettiInstanceRef.current || confetti;

    // APEX theme colors - teal, emerald, gold
    const colors = ["#14b8a6", "#10b981", "#f59e0b", "#06b6d4", "#22d3ee"];
    
    const defaults = {
      spread: 360,
      ticks: 50,
      gravity: 1,
      decay: 0.92,
      startVelocity: 25,
      colors,
      disableForReducedMotion: true,
    };

    // Fire a single, smaller burst
    fire({
      ...defaults,
      particleCount: 30,
      scalar: 1,
      shapes: ["star", "circle"],
      origin: { x: 0.5, y: 0.4 },
    });

    // Callback after animation
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
