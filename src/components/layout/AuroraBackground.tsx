import { memo, useEffect, useState } from "react";

/**
 * AuroraBackground v2 — dramatic, fixed, full-viewport ambient backdrop.
 * Four layers (visible, not subtle):
 *   1. Mesh-grid base (sharper grid + radial mask)
 *   2. THREE huge oversaturated gradient blobs orbiting (emerald/violet/amber)
 *   3. Animated noise grain overlay (gives organic shimmer)
 *   4. Mouse-following spotlight (radial follow-light)
 *
 * Sits at -z-10 with body transparent so the entire authenticated app
 * literally floats on top of moving color.
 */
function AuroraBackgroundImpl() {
  const [pt, setPt] = useState({ x: 50, y: 30 });

  useEffect(() => {
    let raf = 0;
    let last = { x: 50, y: 30 };
    const onMove = (e: MouseEvent) => {
      last = {
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      };
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          setPt(last);
          raf = 0;
        });
      }
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
      style={{ contain: "strict" }}
    >
      {/* Layer 1 — Mesh grid base, brighter */}
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.45]"
        style={{
          backgroundImage: [
            "linear-gradient(to right, hsl(168 70% 50% / 0.08) 1px, transparent 1px)",
            "linear-gradient(to bottom, hsl(168 70% 50% / 0.08) 1px, transparent 1px)",
            "radial-gradient(circle at center, hsl(168 70% 50% / 0.5) 1.5px, transparent 1.5px)",
          ].join(", "),
          backgroundSize: "60px 60px, 60px 60px, 30px 30px",
          maskImage:
            "radial-gradient(ellipse 90% 70% at 50% 30%, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 70% at 50% 30%, black 30%, transparent 80%)",
        }}
      />

      {/* Layer 2a — Massive emerald blob, top-left */}
      <div
        className="absolute -top-[20vmin] -left-[20vmin] h-[90vmin] w-[90vmin] rounded-full aurora-blob-a will-change-transform"
        style={{
          background:
            "radial-gradient(circle, hsl(168 80% 50% / 0.7) 0%, hsl(168 80% 50% / 0) 65%)",
          filter: "blur(80px)",
          mixBlendMode: "screen",
        }}
      />
      {/* Layer 2b — Massive violet blob, top-right */}
      <div
        className="absolute -top-[15vmin] right-[-25vmin] h-[85vmin] w-[85vmin] rounded-full aurora-blob-b will-change-transform"
        style={{
          background:
            "radial-gradient(circle, hsl(265 90% 65% / 0.6) 0%, hsl(265 90% 65% / 0) 65%)",
          filter: "blur(90px)",
          mixBlendMode: "screen",
        }}
      />
      {/* Layer 2c — Massive amber blob, bottom-center */}
      <div
        className="absolute bottom-[-30vmin] left-[10vmin] h-[100vmin] w-[100vmin] rounded-full aurora-blob-c will-change-transform"
        style={{
          background:
            "radial-gradient(circle, hsl(38 95% 60% / 0.5) 0%, hsl(38 95% 60% / 0) 65%)",
          filter: "blur(100px)",
          mixBlendMode: "screen",
        }}
      />
      {/* Layer 2d — Pink accent, mid-right */}
      <div
        className="absolute top-1/2 -translate-y-1/2 right-[-15vmin] h-[60vmin] w-[60vmin] rounded-full aurora-blob-a will-change-transform"
        style={{
          background:
            "radial-gradient(circle, hsl(330 90% 65% / 0.4) 0%, hsl(330 90% 65% / 0) 65%)",
          filter: "blur(80px)",
          mixBlendMode: "screen",
          animationDelay: "8s",
        }}
      />

      {/* Layer 3 — Mouse-follow spotlight (radial follow-light) */}
      <div
        className="absolute inset-0 transition-[background] duration-300 ease-out"
        style={{
          background: `radial-gradient(600px circle at ${pt.x}% ${pt.y}%, hsl(168 90% 60% / 0.10), transparent 50%)`,
        }}
      />

      {/* Layer 4 — Animated grain noise */}
      <div className="absolute inset-0 noise-grain opacity-[0.18] dark:opacity-[0.10]" />

      {/* Layer 5 — Vignette ring */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, hsl(222 60% 2% / 0.65) 100%)",
        }}
      />

      {/* Layer 6 — Top scanline */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />
    </div>
  );
}

export const AuroraBackground = memo(AuroraBackgroundImpl);
