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
 *   - border-slate-800       (hard-coded slate hex, not theme-aware)
 *   - hover:-translate-y-1   (Y-axis lift on every card · banned per v22 §10.5)
 *   - shadow-[0_8px_30px ...]  (colored glow shadow · banned per v22 §10.7)
 *
 * Now matches AgentLink restraint: 1px theme-aware border, no backdrop
 * blur, hover = bg shift only (not Y-axis transform), shadow-sm minimal.
 * 50+ usages site-wide pick this up automatically.
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = "default", hoverEffect = false, children, ...props }, ref) => {
    const variants = {
      default: "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm",
      strong:  "bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-sm",
      subtle:  "bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md transition-base",
          variants[variant],
          hoverEffect && "hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer",
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
