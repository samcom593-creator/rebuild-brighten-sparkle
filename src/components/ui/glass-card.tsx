import { cn } from "@/lib/utils";
import { motion, HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";

interface GlassCardProps extends HTMLMotionProps<"div"> {
  variant?: "default" | "strong" | "subtle";
  glow?: boolean;
  hoverEffect?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant = "default", glow = false, hoverEffect = false, children, ...props }, ref) => {
    const variants = {
      default: "bg-gradient-to-br from-[#0f172a] to-[#070d1b] border border-[#1e293b] backdrop-blur-[12px]",
      strong: "bg-gradient-to-br from-[#0f172a] to-[#070d1b] border border-[#1e293b] backdrop-blur-[24px]",
      subtle: "bg-card/50 backdrop-blur-sm border border-border/50",
    };

    return (
      <motion.div
        ref={ref}
        className={cn(
          "rounded-xl transition-all duration-300 hover:border-[#334155]",
          variants[variant],
          glow && "shadow-[0_0_20px_hsl(168_84%_42%/0.15)]",
          hoverEffect && "hover:-translate-y-1 hover:shadow-[0_8px_30px_hsl(168_84%_42%/0.08)] cursor-pointer",
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

GlassCard.displayName = "GlassCard";
