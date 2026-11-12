import { useState, useEffect, useRef } from "react";

interface UseAnimatedCounterOptions {
  duration?: number;
  startOnView?: boolean;
  /**
   * Safety backstop (ms). IntersectionObserver with threshold 0.1 can MISS a
   * fast scroll-past: the element enters and leaves the viewport between the
   * frames the observer samples, `isIntersecting` is never delivered as true,
   * and `count` is stranded at its initial 0 — permanently. That is how the
   * public landing rendered "0 Active Agents" (the only landing stat routed
   * through this hook; the rest are static strings) right beside a live
   * receipts strip reading 37 applications / 22 carriers and a 10-agent
   * leaderboard. A "0" on a recruiting money page kills the trust the receipts
   * just built. If the observer has not fired within this window, start anyway
   * so the real value always renders. A counter that animates while off-screen
   * is harmless — the visitor only ever sees its settled value — so correctness
   * strictly dominates. Mirrors the gate-OR-timer resilience the
   * LiveStatsCounterStrip already documents for its RPC. 0 disables the
   * backstop (pure scroll-triggered behaviour).
   */
  startFallbackMs?: number;
}

export function useAnimatedCounter(
  end: number,
  options: UseAnimatedCounterOptions = {}
) {
  const { duration = 2000, startOnView = true, startFallbackMs = 1800 } = options;
  const [count, setCount] = useState(0);
  const [hasStarted, setHasStarted] = useState(!startOnView);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!startOnView || hasStarted) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setHasStarted(true);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    // Backstop: a missed observer must never strand the counter at a stale 0.
    const fallback =
      startFallbackMs > 0
        ? setTimeout(() => setHasStarted(true), startFallbackMs)
        : undefined;

    return () => {
      observer.disconnect();
      if (fallback !== undefined) clearTimeout(fallback);
    };
  }, [startOnView, hasStarted, startFallbackMs]);

  useEffect(() => {
    if (!hasStarted) return;

    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      
      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      setCount(Math.floor(easeOutQuart * end));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration, hasStarted]);

  return { count, ref };
}