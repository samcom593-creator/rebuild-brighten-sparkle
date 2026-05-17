import { memo } from "react";

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
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none hidden dark:block"
      style={{ contain: "strict" }}
    >
      {/* DARK MODE ONLY. Light mode renders nothing — pure cream bg, max contrast. */}

      {/* Emerald blob — top-left, tame */}
      <div
        className="absolute -top-[20vmin] -left-[20vmin] h-[70vmin] w-[70vmin] rounded-full aurora-blob-a will-change-transform"
        style={{
          background:
            "radial-gradient(circle, hsl(168 70% 45% / 0.22) 0%, hsl(168 70% 45% / 0) 65%)",
          filter: "blur(80px)",
        }}
      />
      {/* Violet blob — top-right, tame */}
      <div
        className="absolute -top-[15vmin] right-[-15vmin] h-[65vmin] w-[65vmin] rounded-full aurora-blob-b will-change-transform"
        style={{
          background:
            "radial-gradient(circle, hsl(265 70% 55% / 0.16) 0%, hsl(265 70% 55% / 0) 65%)",
          filter: "blur(90px)",
        }}
      />
      {/* Amber blob — bottom, tame */}
      <div
        className="absolute bottom-[-20vmin] left-[20vmin] h-[70vmin] w-[70vmin] rounded-full aurora-blob-c will-change-transform"
        style={{
          background:
            "radial-gradient(circle, hsl(38 75% 50% / 0.12) 0%, hsl(38 75% 50% / 0) 65%)",
          filter: "blur(100px)",
        }}
      />

      {/* Vignette ring — pushes content focus to center */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, hsl(222 60% 2% / 0.85) 100%)",
        }}
      />

      {/* Top scanline — slim */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
    </div>
  );
}

export const AuroraBackground = memo(AuroraBackgroundImpl);
