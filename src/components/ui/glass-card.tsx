import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "strong" | "subtle";
  glow?: boolean;
  hoverEffect?: boolean;
}

/**
 * GlassCard — 2026-06-10 v24 FLATTENED.
 *
 * Audit (wj2wof7j9) flagged this component as the root cause of the
 * "Apex still looks glassy / nothing like AgentLink" complaint.
 * Every GlassCard usage inherited:
 *   - backdrop-blur-[12px]   (smoky glass · banned per v22 §10.7)
 *   - border-border       (hard-coded slate hex, not theme-aware)
 *   - hover:-translate-y-1   (Y-axis lift on every card · banned per v22 §10.5)
 *   - shadow-[0_8px_30px ...]  (colored glow shadow · banned per v22 §10.7)
 *
 * Now matches AgentLink restraint: 1px theme-aware border, no backdrop
 * blur, hover = bg shift only (not Y-axis transform), shadow-sm minimal.
 * 50+ usages site-wide pick this up automatically.
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = "default", hoverEffect = false, children, ...props }, ref) => {
    // 2026-08-23 light/dark wave: the light half of every variant was a COOL
    // slate literal (bg-white / border-slate-200 / border-slate-300 /
    // bg-slate-50) while the app's light palette is WARM — --background
    // `44 27% 92%`, --border `45 24% 86%`. So on light mode 133 cards drew
    // cool-grey hairlines on a cream page. Note bg-white and light --card are
    // both #FFFFFF, so card fills are byte-identical before/after; only the
    // borders and the subtle fill actually move.
    const variants = {
      default: "bg-card border border-border shadow-sm",
      strong:  "bg-card border border-foreground/20 shadow-sm",
      subtle:  "bg-card/50 border border-border",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md transition-base",
          variants[variant],
          hoverEffect && "hover:bg-muted/50 cursor-pointer",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

GlassCard.displayName = "GlassCard";
