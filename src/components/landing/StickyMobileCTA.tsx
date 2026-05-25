import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { track } from "@/lib/analytics";

export function StickyMobileCTA() {
  const loc = useLocation();
  if (loc.pathname.startsWith("/apply")) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 md:hidden p-3 bg-black/90 backdrop-blur-xl border-t border-primary/30 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      <Link
        to="/apply"
        onClick={() => track("hero_cta_click", { position: "sticky_mobile", cta_label: "Apply Now" })}
        className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-br from-primary via-primary to-emerald-600 text-primary-foreground font-bold font-display text-base shadow-[0_5px_25px_hsl(168_80%_50%/0.5)] active:scale-95 transition-transform"
      >
        Start My Application
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
