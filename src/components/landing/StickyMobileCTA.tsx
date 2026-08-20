import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { track } from "@/lib/analytics";
// S11 fix (2026-06-15): relay ?ref= through the sticky mobile CTA so the
// slug survives the landing -> /apply hop on the phone-first path.
import { applyHrefWithRef } from "@/lib/refSlug";

export function StickyMobileCTA() {
  const loc = useLocation();
  const [searchParams] = useSearchParams();

  // 2026-08-18: this bar had NO visibility logic — it rendered permanently, so
  // on the landing page it sat directly on top of the hero's own "Start My
  // Application" button. A 390px screenshot showed the hero CTA half-hidden
  // behind it: two identical primary CTAs competing, which section 22 of the UI
  // directive names explicitly ("avoid multiple competing conversion paths").
  // It now appears only once the hero CTA has scrolled away, so exactly one
  // primary conversion path is on screen at any time. Passive listener; the
  // initial call covers a restored scroll position on back-navigation.
  const [past, setPast] = useState(false);
  useEffect(() => {
    const onScroll = () => setPast(window.scrollY > window.innerHeight * 0.85);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (loc.pathname.startsWith("/apply")) return null;
  if (!past) return null;
  return (
    // perf/site-wide-optimization (2026-08-06): three real bugs on the single
    // highest-traffic conversion element on the site (phone-first funnel).
    //   1. pb-[env(safe-area-inset-bottom)] — index.html sets
    //      viewport-fit=cover, so on notched iPhones this bar sat underneath
    //      the home indicator. The app already handles the TOP inset in
    //      SidebarLayout; the bottom inset was never handled anywhere.
    //   2. The button was `bg-white dark:bg-card text-primary-foreground`.
    //      --primary-foreground is near-black (40 30% 8%) because it is designed
    //      to sit ON the gold --primary fill — on a white surface it was
    //      low-contrast, and on dark:slate-900 it was black-on-near-black, i.e.
    //      an invisible label on the primary CTA. Now it is the intended
    //      gold-fill / dark-ink pairing, which is also what the hero CTA uses.
    //   3. The glow was `hsl(168 80% 50% / 0.5)` — hardcoded teal-green left
    //      over from before the black+gold rebrand. Retargeted to --primary.
    <div className="fixed bottom-0 inset-x-0 z-40 md:hidden p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] bg-white dark:bg-black/90 backdrop-blur-xl border-t border-primary/30 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      <Link
        to={applyHrefWithRef(searchParams.get("ref"))}
        onClick={() => track("hero_cta_click", { position: "sticky_mobile", cta_label: "Apply Now" })}
        aria-label="Start my application"
        className="flex items-center justify-center gap-2 py-3.5 rounded-md bg-primary text-primary-foreground font-bold font-display text-base shadow-[0_5px_25px_hsl(var(--primary)/0.45)] active:scale-95 transition-base"
      >
        Start My Application
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
