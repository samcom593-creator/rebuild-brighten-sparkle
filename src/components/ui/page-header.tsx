import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — hero-class header used across every operating-system route.
 *
 * v4 (2026-05-20): Operational command band with crisp contrast, motion
 * rails, and no decorative blobs. Renders through the same API so 30+
 * existing pages level up automatically.
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

const ACCENT_BARS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "from-primary via-emerald-400 to-amber-400",
  emerald: "from-emerald-500 via-teal-300 to-amber-400",
  blue: "from-blue-500 via-cyan-300 to-amber-400",
  amber: "from-amber-500 via-orange-300 to-emerald-400",
  rose: "from-rose-500 via-fuchsia-400 to-amber-400",
  purple: "from-purple-500 via-violet-300 to-cyan-300",
  cyan: "from-cyan-500 via-teal-300 to-amber-400",
};

const ACCENT_SHEENS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "bg-primary",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  purple: "bg-purple-500",
  cyan: "bg-cyan-500",
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
        "apex-page-header relative -mx-4 sm:-mx-6 mb-6 overflow-hidden px-4 py-5 sm:px-6 lg:px-8",
        "border-b border-border/70 bg-card/95 shadow-[0_16px_50px_hsl(var(--foreground)/0.08)] isolation-isolate",
        className,
      )}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", ACCENT_BARS[accent])} />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-1 opacity-80",
          ACCENT_SHEENS[accent],
        )}
      />
      <span
        aria-hidden
        className="apex-header-scan pointer-events-none absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"
      />

      <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-normal shadow-sm",
                ACCENT_TEXTS[accent],
              )}
            >
              {eyebrowIcon}
              <span>{eyebrow}</span>
            </div>
          )}
          <h1 className="text-3xl font-extrabold tracking-normal leading-tight">
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
