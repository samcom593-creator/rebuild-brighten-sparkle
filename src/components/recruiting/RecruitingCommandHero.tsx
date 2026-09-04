import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, ArrowUpRight } from "lucide-react";

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
  eyebrow: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  metrics: RecruitingCommandMetric[];
  actions?: ReactNode;
  updatedLabel?: string | null;
};

const TONE = {
  neutral: "text-foreground",
  gold: "text-[#C9A961]",
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  info: "text-sky-300",
} as const;

/**
 * Shared operating header for the applicant → interview → hire journey.
 * The metrics are controls, not decoration: clicking one opens the exact queue
 * behind the number so leaders can move from signal to action in one tap.
 */
export function RecruitingCommandHero({
  eyebrow,
  title,
  subtitle,
  statusLabel,
  metrics,
  actions,
  updatedLabel,
}: RecruitingCommandHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[#C9A961]/25 bg-card text-foreground dark:bg-[#0A0A0A] dark:text-white shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(212,175,55,0.18),transparent_36%),radial-gradient(circle_at_90%_105%,rgba(56,189,248,0.10),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C9A961] to-transparent" />

      <div className="relative p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#C9A961]">{eyebrow}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                {statusLabel}
              </span>
              {updatedLabel && <span className="text-[11px] text-foreground/45">Updated {updatedLabel}</span>}
            </div>
            <h1 className="text-balance text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/60 sm:text-base">{subtitle}</p>
          </div>
          {actions && <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">{actions}</div>}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white/[0.05]">
                    <Icon className={cn("h-4 w-4", TONE[metric.tone ?? "neutral"])} />
                  </span>
                  {metric.onClick && <ArrowUpRight className="h-3.5 w-3.5 text-foreground/25 transition-colors group-hover:text-[#C9A961]" />}
                </div>
                <p className={cn("mt-3 text-2xl font-black leading-none tabular-nums sm:text-3xl", TONE[metric.tone ?? "neutral"])}>
                  {metric.value === null ? "—" : typeof metric.value === "number" ? metric.value.toLocaleString() : metric.value}
                </p>
                <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground/75">{metric.label}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-foreground/40">{metric.detail}</p>
              </>
            );
            const classes = cn(
              "group min-w-0 rounded-xl border p-3 text-left transition-all sm:p-4",
              metric.active
                ? "border-[#C9A961]/60 bg-[#C9A961]/10 ring-1 ring-[#C9A961]/25"
                : "border-border bg-white/[0.035]",
              metric.onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-[#C9A961]/35 hover:bg-white/[0.065] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A961]",
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

        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[11px] text-foreground/45">
          <Activity className="h-3.5 w-3.5 text-[#C9A961]" />
          Every number opens the people behind it. No vanity metrics and no dead-end cards.
        </div>
      </div>
    </section>
  );
}

export default RecruitingCommandHero;
