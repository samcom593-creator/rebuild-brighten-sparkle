import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { track } from "@/lib/analytics";
// S11 fix (2026-06-15): relay ?ref= through the sticky mobile CTA so the
// slug survives the landing -> /apply hop on the phone-first path.
import { applyHrefWithRef } from "@/lib/refSlug";

export function StickyMobileCTA() {
  const loc = useLocation();
  const [searchParams] = useSearchParams();
  if (loc.pathname.startsWith("/apply")) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 md:hidden p-3 bg-white dark:bg-black/90 backdrop-blur-xl border-t border-primary/30 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      <Link
        to={applyHrefWithRef(searchParams.get("ref"))}
        onClick={() => track("hero_cta_click", { position: "sticky_mobile", cta_label: "Apply Now" })}
        className="flex items-center justify-center gap-2 py-3.5 rounded-md bg-white dark:bg-slate-900 text-primary-foreground font-bold font-display text-base shadow-[0_5px_25px_hsl(168_80%_50%/0.5)] active:scale-95 transition-base"
      >
        Start My Application
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
