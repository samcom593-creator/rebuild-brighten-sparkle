import { useEffect, useState } from "react";

/**
 * ScrollProgress — slim gradient bar pinned to top of viewport, fills
 * left→right as you scroll the page. Sits above everything (z-50).
 * 2px tall, brand-gradient.
 */
export function ScrollProgress() {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let raf = 0;
    function onScroll() {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const next = max > 0 ? (doc.scrollTop / max) * 100 : 0;
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          setPct(next);
          raf = 0;
        });
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 h-[3px] z-[60] pointer-events-none"
      style={{
        background: "transparent",
      }}
    >
      <div
        className="h-full transition-[width] duration-100 ease-out"
        style={{
          width: `${pct}%`,
          // 2026-08-06: was a teal → purple → amber rainbow, the last of the
          // pre-rebrand three-hue gradients and flagged as outstanding in the
          // perf/site-wide-optimization receipt. Now a gold ramp: --primary
          // into the deeper gold that --gradient-primary already ends on, so
          // the scrubber reads as one brand colour gaining intensity.
          background:
            "linear-gradient(90deg, hsl(var(--primary) / 0.55) 0%, hsl(var(--primary)) 55%, hsl(38 88% 46%) 100%)",
          boxShadow:
            "0 0 12px hsl(var(--primary) / 0.6), 0 0 24px hsl(var(--primary) / 0.3)",
        }}
      />
    </div>
  );
}
