import { memo, useEffect, useRef } from "react";

/**
 * ParticleField — fixed canvas of drifting emerald/violet/amber particles
 * that sit above the AuroraBackground but below all content. Density tuned
 * so it reads as "ambient sparkle" not "screensaver". Respects
 * prefers-reduced-motion (renders the field static at half density).
 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hue: number;
  alpha: number;
  twinklePhase: number;
}

function ParticleFieldImpl() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = window.innerWidth;
    let h = window.innerHeight;
    let raf = 0;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const baseCount = Math.min(80, Math.max(28, Math.floor((w * h) / 24000)));
    const count = reduced ? Math.floor(baseCount / 2) : baseCount;
    const hues = [168, 168, 168, 265, 38, 330]; // mostly emerald, some violet/amber/pink

    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18 - 0.05, // gentle upward drift
      r: 0.6 + Math.random() * 1.8,
      hue: hues[Math.floor(Math.random() * hues.length)],
      alpha: 0.18 + Math.random() * 0.35,
      twinklePhase: Math.random() * Math.PI * 2,
    }));

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function step(t: number) {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          p.twinklePhase += 0.02;
          if (p.x < -10) p.x = w + 10;
          if (p.x > w + 10) p.x = -10;
          if (p.y < -10) p.y = h + 10;
          if (p.y > h + 10) p.y = -10;
        }
        const twinkle = 0.65 + 0.35 * Math.sin(p.twinklePhase + t * 0.001);
        const a = p.alpha * twinkle;
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        grd.addColorStop(0, `hsla(${p.hue}, 90%, 65%, ${a})`);
        grd.addColorStop(1, `hsla(${p.hue}, 90%, 65%, 0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
        ctx.fill();

        // Tight core
        ctx.fillStyle = `hsla(${p.hue}, 95%, 80%, ${Math.min(1, a * 1.4)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(step);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="fixed inset-0 pointer-events-none -z-[5]"
      style={{ mixBlendMode: "screen", contain: "strict" }}
    />
  );
}

export const ParticleField = memo(ParticleFieldImpl);
