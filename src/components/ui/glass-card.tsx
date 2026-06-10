import { cn } from "@/lib/utils";
import { forwardRef, HTMLAttributes } from "react";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "strong" | "subtle";
  glow?: boolean;
  hoverEffect?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = "default", glow = false, hoverEffect = false, children, ...props }, ref) => {
    const variants = {
      default: "bg-white dark:bg-slate-900 border border-[#1e293b] backdrop-blur-[12px]",
      strong: "bg-white dark:bg-slate-900 border border-[#1e293b] backdrop-blur-[24px]",
      subtle: "bg-card/50 backdrop-blur-sm border border-border/50",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-md transition-all duration-300 hover:border-[#334155]",
          variants[variant],
          glow && "",
          hoverEffect && "hover:-translate-y-1 hover:shadow-[0_8px_30px_hsl(168_84%_42%/0.08)] cursor-pointer",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

GlassCard.displayName = "GlassCard";
