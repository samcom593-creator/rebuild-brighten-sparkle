import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

export type RecruitingCommandMetric = {
  label: string;
  value: number | string | null;
  detail: string;
  icon: LucideIcon;
  tone?: "neutral" | "gold" | "good" | "warn" | "bad" | "info";
  active?: boolean;
  onClick?: () => void;
};

type RecruitingCommandHeroProps = {
  /** Accepted for the callers that still pass it; the flat header renders no eyebrow. */
  eyebrow?: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  metrics: RecruitingCommandMetric[];
  actions?: ReactNode;
  updatedLabel?: string | null;
};

const TONE = {
  neutral: "text-foreground",
  gold: "text-primary",
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-rose-700 dark:text-rose-400",
  info: "text-sky-700 dark:text-sky-400",
} as const;

/**
 * Shared operating header for the applicant → interview → hire journey.
 * The metrics are controls, not decoration: clicking one opens the exact queue
 * behind the number so leaders can move from signal to action in one tap.
 */
export function RecruitingCommandHero({
  title,
  subtitle,
  statusLabel,
  metrics,
  actions,
  updatedLabel,
}: RecruitingCommandHeroProps) {
  return (
    <section className="space-y-4" aria-label="Recruiting overview">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-7 tracking-tight text-foreground sm:text-2xl">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {statusLabel}{updatedLabel ? ` · Updated ${updatedLabel}` : ""}
          </p>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {/* Cells draw their own right/bottom hairlines; the -1px pull tucks the last
          column's and last row's under the container border so every edge is single. */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const body = (
            <>
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {metric.label}
                {metric.onClick && <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </span>
              <span className={cn("mt-2 block text-2xl font-semibold leading-none tabular-nums", TONE[metric.tone ?? "neutral"])}>
                {metric.value === null ? "—" : typeof metric.value === "number" ? metric.value.toLocaleString() : metric.value}
              </span>
              {/* Visible, not tooltip-only: the detail carries live counts and the
                  Phoenix-day scope, and touch screens have no hover. */}
              <span className="mt-1 line-clamp-2 block text-xs leading-snug text-muted-foreground">{metric.detail}</span>
            </>
          );
          const classes = cn(
            "min-w-0 border-b border-r border-border p-4 text-left transition-colors",
            metric.active ? "bg-primary/10 ring-1 ring-inset ring-primary/50" : "bg-card",
            metric.onClick && "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          );
          return metric.onClick ? (
            <button key={metric.label} type="button" onClick={metric.onClick} aria-pressed={metric.active} className={classes}>
              {body}
            </button>
          ) : (
            <div key={metric.label} className={classes}>{body}</div>
          );
        })}
        </div>
      </div>
    </section>
  );
}

export default RecruitingCommandHero;
