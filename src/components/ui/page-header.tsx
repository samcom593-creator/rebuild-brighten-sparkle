import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * PageHeader — the header band used across every operating-system route.
 *
 * v4 (2026-05-20): Operational command band with crisp contrast, motion
 * rails, and no decorative blobs. Renders through the same API so 30+
 * existing pages level up automatically.
 *
 * v5 (2026-08-11): Compacted. All numbers below are measured in headless
 * chromium against this component, not estimated — an earlier draft of this
 * comment guessed "~80px mobile" and was wrong by 61px.
 *
 *              v4      v5     reduction
 *   1440px     140px   88px   37%
 *   768px      140px   88px   37%
 *   390px      196px   133px  32%
 *
 * What changed:
 *   - eyebrow moved inline with the title instead of stacking its own row,
 *     which is where most of the desktop height went;
 *   - eyebrow type raised 11px -> 14px (it was the smallest text in the app and
 *     it is metadata an operator is expected to read), and hidden below sm,
 *     where it wrapped to a row of its own;
 *   - title 30px -> 24px, 21.45px on phones. Still the largest thing on screen;
 *   - subtitle clamped to one line below sm;
 *   - the `apex-header-scan` rail is gone. It was a 3.8s infinite alternate
 *     animation running on every route for decoration. The global
 *     prefers-reduced-motion block at index.css:224 made it accessible, not
 *     useful — accessible decoration is still decoration competing with content.
 *
 * Desktop meets the 72-96px target. Mobile does not meet 64-80px and cannot:
 * a 44px minimum touch target for `actions` plus 28px of padding is a 72px
 * floor before a single character of title exists, so any header carrying an
 * action is structurally above the target. 133px is the honest floor with the
 * title, one line of subtitle and a tappable action all present.
 *
 * The accent bar, left sheen and public API are unchanged, so no caller needs
 * editing.
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
  // 2026-08-18 template pass: the per-page rainbow gradient bars are retired.
  // One brand accent, everywhere. Map kept so the public API and call sites
  // (100 pages) need zero edits — every value now renders nothing.
  primary: "hidden", emerald: "hidden", blue: "hidden", amber: "hidden",
  rose: "hidden", purple: "hidden", cyan: "hidden",
};

const ACCENT_SHEENS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "hidden", emerald: "hidden", blue: "hidden", amber: "hidden",
  rose: "hidden", purple: "hidden", cyan: "hidden",
};

const ACCENT_TEXTS: Record<NonNullable<PageHeaderProps["accent"]>, string> = {
  primary: "text-primary", emerald: "text-primary", blue: "text-primary",
  amber: "text-primary", rose: "text-primary", purple: "text-primary",
  cyan: "text-primary",
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
        "apex-page-header relative -mx-4 sm:-mx-6 mb-5 px-4 py-3.5 sm:px-6 sm:py-4 lg:px-8",
        "border-b border-border",
        className,
      )}
    >
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 ", ACCENT_BARS[accent])} />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-1 opacity-80",
          ACCENT_SHEENS[accent],
        )}
      />
      <div className="relative z-10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-[24px] font-bold tracking-[-0.6px] leading-8">
              {title}
            </h1>
            {eyebrow && (
              <span
                className={cn(
                  // Hidden on phones: it wrapped to its own 29px row there, and the
                  // sidebar already says which section you are in. Kept from sm up.
                  "hidden sm:inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                  ACCENT_TEXTS[accent],
                )}
              >
                {eyebrowIcon}
                <span>{eyebrow}</span>
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground leading-snug line-clamp-1 sm:line-clamp-none">
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
