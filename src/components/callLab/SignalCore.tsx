import { useEffect, useRef } from "react";
import { useLevelSnapshot } from "./useLevelSnapshot";
import type { Levels } from "@/lib/callLab/useCallLabSession";
import type { SessionState, Speaker } from "@/lib/callLab/events";

const hsl = (v: string) => `hsl(${v.trim()})`;

/** Radial energy form driven by real analyser levels: inner ring = you (gold), outer field = prospect. Reduced motion collapses it to steady rings. */
export function SignalCore({ levelsRef, speaker, session, muted, size = 200 }: { levelsRef: React.MutableRefObject<Levels>; speaker: Speaker | "none"; session: SessionState; muted: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const smooth = useRef({ i: 0, o: 0, phase: 0 });
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = size * dpr; canvas.height = size * dpr; ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const gold = hsl(css.getPropertyValue("--primary")); const line = hsl(css.getPropertyValue("--border")); const muted2 = hsl(css.getPropertyValue("--muted-foreground")); const ok = hsl(css.getPropertyValue("--success")); const warn = hsl(css.getPropertyValue("--destructive"));
    let raf = 0;
    const draw = () => {
      const lv = levelsRef.current; const s = smooth.current;
      s.i += ((muted ? 0 : lv.input) - s.i) * 0.25; s.o += (lv.output - s.o) * 0.2; s.phase += 0.02 + s.o * 0.05;
      const c = size / 2; const base = size * 0.22; ctx.clearRect(0, 0, size, size);
      const oR = base + size * 0.16 * (reduced ? 0.5 : s.o);
      ctx.strokeStyle = speaker === "prospect" ? muted2 : line; ctx.lineWidth = speaker === "prospect" ? 2 : 1; ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 90) { const w = reduced ? 0 : Math.sin(a * 5 + s.phase) * s.o * 6 + Math.sin(a * 11 - s.phase * 1.4) * s.o * 3; const r = oR + w; const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r; if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); ctx.stroke();
      const iR = base * (0.55 + (reduced ? 0.2 : s.i * 0.55));
      ctx.strokeStyle = speaker === "agent" ? gold : line; ctx.lineWidth = speaker === "agent" ? 2.5 : 1.2; ctx.beginPath(); ctx.arc(c, c, iR, 0, Math.PI * 2); ctx.stroke();
      if (s.i > 0.03 && !reduced) { ctx.globalAlpha = 0.15; ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(c, c, iR, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = session === "reconnecting" || session === "failed_recoverable" ? warn : session === "complete" ? ok : gold; ctx.beginPath(); ctx.arc(c, c, 4, 0, Math.PI * 2); ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw); return () => cancelAnimationFrame(raf);
  }, [levelsRef, speaker, session, muted, size]);
  const snap = useLevelSnapshot(levelsRef);
  const who = speaker === "agent" ? "You are speaking" : speaker === "prospect" ? "The prospect is speaking" : "Nobody is speaking";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <canvas ref={ref} style={{ width: size, height: size }} aria-hidden />
      <p className="sr-only" aria-live="polite">{who}. Input level {snap.input} percent.</p>
    </div>
  );
}
