import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — hero-class header used across every operating-system route.
 *
 * v3 (2026-05-17): Bigger title, decorative floating orbs, gradient ring,
 * accent-aware glow. Renders identically to v2's API so 30+ existing
 * pages level up automatically.
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

const ACCENT_ORBS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "bg-primary/20",
  emerald: "bg-emerald-500/25",
  blue:    "bg-blue-500/25",
  amber:   "bg-amber-500/25",
  rose:    "bg-rose-500/25",
  purple:  "bg-purple-500/25",
  cyan:    "bg-cyan-500/25",
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
        "relative -mx-4 sm:-mx-6 mb-6 px-4 sm:px-6 lg:px-8 py-7 sm:py-10",
        "bg-gradient-to-br border-b border-border/40 overflow-hidden isolation-isolate",
        ACCENT_GRADIENTS[accent],
        className,
      )}
    >
      {/* Floating accent orb — top-right */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full blur-3xl opacity-70",
          ACCENT_ORBS[accent],
        )}
      />
      {/* Subtle scan-line at bottom */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />

      <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] font-bold mb-2 px-2.5 py-1 rounded-full bg-card/40 backdrop-blur-sm border border-border/40",
                ACCENT_TEXTS[accent],
              )}
            >
              {eyebrowIcon}
              <span>{eyebrow}</span>
            </div>
          )}
          <h1 className="text-3xl sm:text-4xl lg:text-[2.6rem] font-bold tracking-tight leading-[1.05]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2.5 max-w-3xl text-sm sm:text-base text-muted-foreground leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
}
