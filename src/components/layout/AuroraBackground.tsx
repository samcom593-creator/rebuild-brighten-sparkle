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
          // Whisper-quiet gold hint, top-left only. Was hsl(168 50% 30%) teal
          // left over from before the black+gold rebrand (2026-08-06).
          "radial-gradient(ellipse 50% 35% at 10% 5%, hsl(var(--primary) / 0.08) 0%, transparent 65%)",
          // Vignette toward center
          "radial-gradient(ellipse 100% 80% at center, transparent 50%, hsl(222 60% 2% / 0.55) 100%)",
        ].join(", "),
      }}
    >
      {/* Single scanline at top — pure CSS, no animation */}
      <div className="absolute inset-x-0 top-0 h-px bg-border dark:bg-card" />
    </div>
  );
}

export const AuroraBackground = memo(AuroraBackgroundImpl);
