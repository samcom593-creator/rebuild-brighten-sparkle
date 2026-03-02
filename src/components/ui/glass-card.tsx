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
          "rounded-xl glass-hover",
          variants[variant],
          glow && "glow-teal",
          hoverEffect && "card-interactive",
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