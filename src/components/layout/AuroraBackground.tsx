import { memo } from "react";

/**
 * AuroraBackground — fixed, full-viewport ambient backdrop that sits behind
 * the entire authenticated shell. Three layers:
 *   1. Soft mesh gradient (emerald/violet/amber blobs that slowly orbit)
 *   2. Subtle dot grid for depth (1px dots, very low alpha)
 *   3. Vignette ring to keep content focus mid-screen
 *
 * Tuned to be invisible on cards but unmistakable in negative space.
 * Honors prefers-reduced-motion (animations stop, blobs stay static).
 * GPU-accelerated transforms only — zero layout impact.
 */
function AuroraBackgroundImpl() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
      style={{ contain: "strict" }}
    >
      {/* Dot grid base */}
      <div
        className="absolute inset-0 opacity-[0.18] dark:opacity-[0.25]"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, hsl(168 70% 50% / 0.35) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 75%)",
        }}
      />

      {/* Aurora blob 1 — emerald, top-left */}
      <div
        className="absolute -top-32 -left-32 h-[60vmin] w-[60vmin] rounded-full opacity-[0.45] dark:opacity-[0.55] aurora-blob-a"
        style={{
          background:
            "radial-gradient(circle, hsl(168 75% 45% / 0.55) 0%, hsl(168 75% 45% / 0) 65%)",
          filter: "blur(60px)",
        }}
      />

      {/* Aurora blob 2 — violet, top-right */}
      <div
        className="absolute -top-24 right-[-10vmin] h-[55vmin] w-[55vmin] rounded-full opacity-[0.35] dark:opacity-[0.45] aurora-blob-b"
        style={{
          background:
            "radial-gradient(circle, hsl(265 80% 60% / 0.45) 0%, hsl(265 80% 60% / 0) 65%)",
          filter: "blur(70px)",
        }}
      />

      {/* Aurora blob 3 — amber, bottom-center */}
      <div
        className="absolute bottom-[-20vmin] left-[20vmin] h-[60vmin] w-[60vmin] rounded-full opacity-[0.30] dark:opacity-[0.40] aurora-blob-c"
        style={{
          background:
            "radial-gradient(circle, hsl(38 95% 55% / 0.35) 0%, hsl(38 95% 55% / 0) 65%)",
          filter: "blur(70px)",
        }}
      />

      {/* Vignette ring */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, hsl(var(--background) / 0.55) 100%)",
        }}
      />

      {/* Top scanline shimmer (very faint) */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    </div>
  );
}

export const AuroraBackground = memo(AuroraBackgroundImpl);
