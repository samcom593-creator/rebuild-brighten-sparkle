import { memo } from "react";

/**
 * AuroraBackground (perf-first) — single static SVG gradient overlay.
 * Dark mode only. No blur, no animation, no canvas. Two cheap radial
 * gradients baked into one fixed div. Negligible paint cost — gradients
 * are GPU-rasterized once and just composite per scroll.
 */
function AuroraBackgroundImpl() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 pointer-events-none hidden dark:block"
      style={{
        contain: "strict",
        background: [
          // Tame emerald glow top-left
          "radial-gradient(ellipse 60% 40% at 15% 10%, hsl(168 70% 35% / 0.22) 0%, transparent 70%)",
          // Tame violet glow top-right
          "radial-gradient(ellipse 50% 35% at 85% 5%, hsl(265 60% 45% / 0.16) 0%, transparent 65%)",
          // Tame amber glow bottom
          "radial-gradient(ellipse 70% 45% at 50% 95%, hsl(38 60% 40% / 0.12) 0%, transparent 65%)",
          // Vignette
          "radial-gradient(ellipse 100% 80% at center, transparent 40%, hsl(222 60% 2% / 0.7) 100%)",
        ].join(", "),
      }}
    >
      {/* Single scanline at top — pure CSS, no animation */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    </div>
  );
}

export const AuroraBackground = memo(AuroraBackgroundImpl);
