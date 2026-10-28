import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import type { Tone } from "@/lib/tones";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** default is the brand gold; success is "a clear board"; warning is "needs a look". */
  variant?: "default" | "success" | "warning";
  /** Overrides the variant's tone when the page has a tone of its own. */
  tone?: Tone;
  className?: string;
}

const VARIANT_TONE: Record<NonNullable<EmptyStateProps["variant"]>, Tone> = {
  default: "gold",
  success: "good",
  warning: "warm",
};

/**
 * The empty state used on every list page when nothing matches (2026-10-28 colour layer:
 * the icon sits in a tone bubble that pops in; the halo and the gradient are gone; the title
 * is 18px and the description 15px). Variants: default (brand), success (a good thing, "clear
 * board"), warning.
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
  variant = "default",
  tone,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/60 bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <ToneBubble tone={tone ?? VARIANT_TONE[variant]} size="lg" className="apex-pop h-16 w-16 [&>svg]:h-7 [&>svg]:w-7">
          {icon}
        </ToneBubble>
        <h3 className="max-w-xs text-lg font-bold tracking-tight">{title}</h3>
        {description && (
          <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
