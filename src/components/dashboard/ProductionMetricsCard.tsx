import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Radio } from "lucide-react";
import {
  SOURCE_ROSTER, SOURCE_SEGMENTS, SOURCE_TODAY, missingSentence, sourceLabel, sourceReport, staleSentence, teamFigures, todayLine,
  type MetricSource, type ProductionMetricSnapshot, type RosterDerived, type TodayProductionSnapshot,
} from "@/lib/productionMetrics";

export type { ProductionMetricSnapshot, TodayProductionSnapshot } from "@/lib/productionMetrics";

/**
 * Team-level truth, as ONE compact strip: one line for today, one flat list for the team, no card around each figure.
 *
 * F33 (2026-10-14 Galaxy OS map): the strip reads three independent sources and each arrives with its own availability
 * (src/lib/productionMetrics.ts). A figure is a number only when the read it comes from completed. A read that is
 * still loading shows a skeleton in its own slot; a read that failed shows Unavailable, is named under the strip with
 * the reason, and can be retried; a read whose refresh failed keeps its last good figures and says when they are
 * from. The roster-derived figures (Team size, New hires no sale) no longer borrow the summary's loading flag, so a
 * failed or still-loading roster cannot render as "Team size 0" beside a successful summary. Reads are named in plain
 * English ("the team roster"), with the RPC name in parentheses or a title so support can still find it.
 *
 * Team size counts active agents working the business (sync-only placeholder seats are not people and are left out).
 * The numbers and their definitions are unchanged and live beside the RPCs.
 */
export function ProductionMetricsCard({ segments, roster, today, onRetry }: {
  segments: MetricSource<ProductionMetricSnapshot>;
  roster: MetricSource<RosterDerived>;
  today: MetricSource<TodayProductionSnapshot>;
  /** Refetches every source the strip names below the figures (sourceNeedsRetry); rendered as Retry beside them. */
  onRetry?: () => void;
}) {
  const figures = teamFigures(segments, roster);
  const line = todayLine(today);
  const report = sourceReport([
    { name: SOURCE_TODAY, source: today },
    { name: SOURCE_SEGMENTS, source: segments },
    { name: SOURCE_ROSTER, source: roster },
  ]);
  const allFiguresLoading = figures.every((figure) => figure.state === "loading");
  const streakDays = line.streakDays ?? 0;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card px-3 py-3 sm:px-4" aria-live="polite" aria-label="Team production summary">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {line.state === "loading" ? (
          <div className="flex w-full items-center justify-between gap-3" role="status" aria-label="Loading today's production">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-6 w-40 rounded-full" />
            <span className="sr-only">Loading today's production</span>
          </div>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold tabular-nums text-foreground">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Radio className="h-3.5 w-3.5" aria-hidden /> Phoenix day</span>
              {line.state === "ready" ? (
                <span>Sold Today: {line.amount} ({(line.policies ?? 0).toLocaleString()} {line.policies === 1 ? "policy" : "policies"})</span>
              ) : (
                <span className="text-muted-foreground">Sold Today: Unavailable</span>
              )}
            </p>
            {line.state === "ready" ? (
              <p className={cn("inline-flex items-center gap-1.5 text-sm", streakDays > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                <Flame className="h-4 w-4" aria-hidden />
                {streakDays > 0 ? `${streakDays}-day active selling streak` : "No active selling streak"}
              </p>
            ) : null}
          </>
        )}
      </div>

      {allFiguresLoading ? (
        <div className="flex flex-wrap gap-x-8 gap-y-2" aria-label="Loading live team production metrics" role="status">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={`production-metric-skeleton-${index}`} className="h-9 w-32" />)}
          <span className="sr-only">Loading live team production metrics</span>
        </div>
      ) : (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-2" aria-label="Live team production metrics">
          {figures.map((figure) => (
            <div key={figure.key} className="min-w-[8.5rem]">
              <dt className="text-xs text-muted-foreground">{figure.label}</dt>
              {figure.state === "loading" ? (
                <dd role="status" aria-label={`Loading ${figure.label}`}><Skeleton className="mt-1 h-6 w-16" /></dd>
              ) : figure.state === "ready" ? (
                <dd className={cn("text-xl font-semibold tabular-nums", figure.tone)}>{figure.value}</dd>
              ) : (
                <dd className="text-xl font-semibold text-muted-foreground">Unavailable</dd>
              )}
              {figure.state === "ready" && figure.note ? <dd className="text-xs text-muted-foreground">{figure.note}</dd> : null}
              {figure.state === "unavailable" ? <dd className="text-xs text-muted-foreground" title={figure.source}>from {sourceLabel(figure.source)}</dd> : null}
            </div>
          ))}
        </dl>
      )}

      {report.missing.length > 0 || report.stale.length > 0 ? (
        <div role={report.missing.length > 0 ? "alert" : "status"} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {report.missing.map((missing) => <span key={`missing-${missing.source}`}>{missingSentence(missing)}</span>)}
          {report.stale.map((stale) => <span key={`stale-${stale.source}`}>{staleSentence(stale)}</span>)}
          {onRetry ? <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onRetry}>Retry</Button> : null}
        </div>
      ) : null}
    </section>
  );
}
