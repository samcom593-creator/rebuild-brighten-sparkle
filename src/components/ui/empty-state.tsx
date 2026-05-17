import { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  variant?: "default" | "success" | "warning";
  className?: string;
}

const ICON_RING: Record<NonNullable<EmptyStateProps["variant"]>, string> = {
  default: "from-primary/15 to-primary/0 text-primary",
  success: "from-emerald-500/15 to-emerald-500/0 text-emerald-400",
  warning: "from-amber-500/15 to-amber-500/0 text-amber-400",
};

/**
 * Premium empty state — used on every list page when nothing matches.
 * Variants: default (neutral), success (good thing — "clear board"), warning.
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  variant = "default",
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/40 px-6 py-14 text-center backdrop-blur-md",
        "bg-gradient-to-b from-card/60 to-card/30",
        className,
      )}
    >
      {/* Soft accent halo behind the icon */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b blur-xl opacity-60",
          ICON_RING[variant],
        )}
      />
      <div className="relative z-10 flex flex-col items-center gap-3">
        <div className={cn(
          "h-16 w-16 rounded-2xl border border-border/40 flex items-center justify-center bg-background/60",
          ICON_RING[variant],
        )}>
          {icon}
        </div>
        <h3 className="text-lg font-bold tracking-tight max-w-xs">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            {description}
          </p>
        )}
        {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </motion.div>
  );
}
