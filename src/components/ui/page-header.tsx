import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — premium hero block shared across every operating-system route.
 *
 * Visual contract:
 *   • Soft gradient backdrop tinted from the page accent color
 *   • Tiny uppercase eyebrow label with section icon
 *   • Big tracking-tight title, regular-weight subtitle
 *   • Optional right-hand action slot for buttons/badges
 *
 * Keeps every page feeling like the same product instead of 18 different ones.
 */
export interface PageHeaderProps {
  eyebrow?: string;
  eyebrowIcon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Tailwind accent color, defaults to primary. */
  accent?: "primary" | "emerald" | "blue" | "amber" | "rose" | "purple" | "cyan";
  className?: string;
}

const ACCENT_GRADIENTS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "from-primary/20 via-primary/5 to-transparent",
  emerald: "from-emerald-500/20 via-emerald-500/5 to-transparent",
  blue:    "from-blue-500/20 via-blue-500/5 to-transparent",
  amber:   "from-amber-500/20 via-amber-500/5 to-transparent",
  rose:    "from-rose-500/20 via-rose-500/5 to-transparent",
  purple:  "from-purple-500/20 via-purple-500/5 to-transparent",
  cyan:    "from-cyan-500/20 via-cyan-500/5 to-transparent",
};

const ACCENT_TEXTS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "text-primary",
  emerald: "text-emerald-400",
  blue:    "text-blue-400",
  amber:   "text-amber-400",
  rose:    "text-rose-400",
  purple:  "text-purple-400",
  cyan:    "text-cyan-400",
};

export function PageHeader({
  eyebrow,
  eyebrowIcon,
  title,
  subtitle,
  actions,
  accent = "primary",
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "relative -mx-4 sm:-mx-6 mb-5 px-4 sm:px-6 py-6 sm:py-8 bg-gradient-to-br border-b border-border/40 overflow-hidden",
        ACCENT_GRADIENTS[accent],
        className,
      )}
    >
      <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className={cn("flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] font-semibold mb-1.5", ACCENT_TEXTS[accent])}>
              {eyebrowIcon}
              <span>{eyebrow}</span>
            </div>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
