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
          background:
            "linear-gradient(90deg, hsl(168 90% 55%) 0%, hsl(265 90% 65%) 50%, hsl(38 95% 60%) 100%)",
          boxShadow:
            "0 0 12px hsl(168 80% 55% / 0.6), 0 0 24px hsl(265 80% 65% / 0.4)",
        }}
      />
    </div>
  );
}
