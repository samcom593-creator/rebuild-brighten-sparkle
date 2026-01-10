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
      default: "glass",
      strong: "glass-strong",
      subtle: "bg-card/50 backdrop-blur-sm border border-border/50",
    };

    return (
      <motion.div
        ref={ref}
        className={cn(
          "rounded-xl",
          variants[variant],
          glow && "glow-teal",
          hoverEffect && "transition-all duration-300 hover:glow-teal hover:-translate-y-1",
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