import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  badge?: string;
  title: string;
  subtitle?: string;
  centered?: boolean;
  className?: string;
}

/**
 * SectionHeading — 2026-08-23 light/dark wave.
 *
 * Every colour here was a dark-only literal: the <h2> was text-[#FFFFFF] and
 * the subtitle text-[#9A9A9A], against a light-mode --background of
 * `44 27% 92%` (warm cream). White-on-cream is invisible and #9A9A9A on cream
 * is ~2.3:1, well under WCAG AA. The badge hardcoded #C9A961, the DARK gold —
 * light mode's gold token is the deeper `41 52% 45%` precisely because the
 * bright one washes out on cream.
 *
 * Used by three landing sections (Benefits / Earnings / CareerPathway), so
 * this is reachable by any visitor who has toggled to light — not the default
 * state, but not theoretical either.
 */
export const SectionHeading = forwardRef<HTMLDivElement, SectionHeadingProps>(
  ({ badge, title, subtitle, centered = true, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("space-y-4 landing-fade-up", centered && "text-center", className)}
      >
        {badge && (
          <span
            className="landing-scale-in landing-delay-100 inline-block px-4 py-1.5 rounded-full text-sm font-bold font-display bg-primary/10 text-primary border border-primary/20"
          >
            {badge}
          </span>
        )}
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground font-display">
          {title}
        </h2>
        {subtitle && (
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            {subtitle}
          </p>
        )}
      </div>
    );
  }
);

SectionHeading.displayName = "SectionHeading";
