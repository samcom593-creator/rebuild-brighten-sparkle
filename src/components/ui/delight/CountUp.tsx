import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/celebrate";

const TWEEN_MS = 520;

/**
 * A number that counts from its last value to its new one (2026-10-28).
 *
 * The first paint shows the real number at once: a dashboard that counted up from zero on
 * every visit would hide the truth for half a second and get old by the third visit. When
 * the number later changes (a save, a reload, a filter) it tweens and gives a small bump.
 * `null` renders a dash: unknown is never shown as zero. Under prefers-reduced-motion the
 * number simply changes.
 *
 * The value on screen is derived in render: `tween` holds the in-between number only while
 * a tween runs, so a change that needs no tween (from a dash, to a dash, reduced motion) is
 * on screen in the same commit as the data that caused it. The first version adopted every
 * new value inside an effect, one render late, and a test that read a tile right after its
 * row appeared saw the dash on Node 20 and the number on Node 22.
 */
export function CountUp({
  value,
  className,
  format = (n: number) => n.toLocaleString(),
}: {
  value: number | null;
  className?: string;
  format?: (n: number) => string;
}) {
  const [tween, setTween] = useState<number | null>(null);
  const [bumps, setBumps] = useState(0);
  const previous = useRef<number | null>(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (value === null || from === null || from === value || prefersReducedMotion()) {
      setTween(null);
      return;
    }
    // The clock is the first frame's own timestamp, not performance.now(): browsers share one
    // time origin between the two, but jsdom hands requestAnimationFrame a different base, so a
    // start read from performance.now() made the tween run backwards under vitest.
    let started: number | null = null;
    let frame = 0;
    const step = (now: number) => {
      if (started === null) started = now;
      const progress = Math.min(1, (now - started) / TWEEN_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      if (progress < 1) {
        setTween(Math.round(from + (value - from) * eased));
        frame = requestAnimationFrame(step);
      } else {
        setTween(null);
        setBumps((n) => n + 1);
      }
    };
    setTween(from);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const shown = tween ?? value;
  return (
    <span key={bumps} className={cn("inline-block tabular-nums", bumps > 0 && "apex-bump", className)}>
      {shown === null ? "—" : format(shown)}
    </span>
  );
}
