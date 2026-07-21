import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScrollY } from "@/shared/lib/useScrollY";

interface ScrollToTopProps {
  threshold?: number;
  className?: string;
}

export function ScrollToTop({ threshold = 400, className }: ScrollToTopProps) {
  const scrollY = useScrollY();
  const isVisible = scrollY > threshold;

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  if (!isVisible) return null;

  return (
    <button
      onClick={scrollToTop}
      className={cn(
        // Stacked above the Lead-Qualification chat launcher (also bottom-6
        // right-6) so the two FABs no longer overlap.
        "fixed bottom-24 right-6 z-50 p-3 rounded-full glass-strong border border-primary/30 shadow-lg",
        "landing-scale-in hover:bg-slate-50 dark:hover:bg-slate-800/50 active:scale-95 hover:shadow-primary/20 hover:border-primary/50",
        "transition-all duration-300 group",
        className,
      )}
      aria-label="Scroll to top"
    >
      <ChevronUp className="h-5 w-5 text-primary group-hover:text-primary transition-colors" />

      {/* Glow effect on hover */}
      <div className="absolute inset-0 rounded-full bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity blur-md" />
    </button>
  );
}
