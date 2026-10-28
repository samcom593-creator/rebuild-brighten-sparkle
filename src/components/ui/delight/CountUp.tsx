import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/lib/celebrate";

/** Feedback, not a show: the count settles inside the 300ms UI budget (was 520ms). */
const TWEEN_MS = 280;

/**
 * A number that counts from its last value to its new one (2026-10-28).
 *
 * The first paint shows the real number at once: a dashboard that counted up from zero on
 * every visit would hide the truth for half a second and get old by the third visit. When
 * the number later changes (a save, a reload, a filter) it tweens for 280ms on a cubic
 * ease-out and then gives a small bump (apex-bump, 240ms). `null` renders a dash: unknown is
 * never shown as zero. Under prefers-reduced-motion the number simply changes, in the same
 * commit as the data; the CSS turns the bump into a short dip in opacity.
 *
 * The value on screen is derived in render: `tween` holds the in-between number only while
 * a tween runs, so a change that needs no tween (from a dash, to a dash, reduced motion) is
 * on screen in the same commit as the data that caused it. The first version adopted every
 * new value inside an effect, one render late, and a test that read a tile right after its
 * row appeared saw the dash on Node 20 and the number on Node 22.
 *
 * A tween that is interrupted (two saves inside 280ms) retargets from the number on screen,
 * not from the last target, so the count never jumps; `live` is that number, written on
 * every frame. The tween is state on this leaf only, so each frame re-renders one <span>.
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
  /** The number on screen right now: the settled value, or the frame of a running tween. */
  const live = useRef<number | null>(value);

  useEffect(() => {
    const from = live.current;
    if (value === null || from === null || from === value || prefersReducedMotion()) {
      live.current = value;
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
        const next = Math.round(from + (value - from) * eased);
        live.current = next;
        setTween(next);
        frame = requestAnimationFrame(step);
      } else {
        live.current = value;
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
