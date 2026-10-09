import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Radio } from "lucide-react";

export interface ProductionMetricSnapshot {
  total: number;
  active: number;
  inactive: number;
  terminated: number;
  producing_mtd: number;
  mtd_alp: number | string;
  book_last_posted: string | null;
}

export interface TodayProductionSnapshot {
  today_alp: number | string;
  today_policies: number;
  selling_streak_days: number;
  business_date: string;
}

function compactUsd(value: number | string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "Nothing posted yet";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * Team-level truth, as ONE compact strip. Until the aggregate RPC returns, values are omitted completely and
 * represented by accessible loading text plus skeletons. The numbers and their definitions are unchanged; only the
 * presentation is: one line for today, one flat list for the team, no card around each figure.
 *
 * Team size counts active agents working the business. "Active" is the wider count of active seats and also includes
 * sync-only placeholder seats, so when the two differ the note says exactly why instead of leaving two near-equal
 * numbers to explain themselves.
 */
export function ProductionMetricsCard({
  snapshot,
  isLoading,
  todayProduction,
  isTodayLoading,
  teamSize,
  newHires30dNoSale,
}: {
  snapshot: ProductionMetricSnapshot | null;
  isLoading: boolean;
  todayProduction: TodayProductionSnapshot | null;
  isTodayLoading: boolean;
  // Row-derived overrides (Sam: Team size should be active agents actually working the business,
  // not the canonical-roster total). When provided they win over the segment snapshot.
  teamSize?: number | null;
  newHires30dNoSale?: number | null;
}) {
  const placeholderSeats = snapshot && teamSize != null ? Math.max(0, snapshot.active - teamSize) : 0;
  const stats = snapshot
    ? [
        { label: "Team size", value: (teamSize ?? snapshot.total).toLocaleString(), note: teamSize != null ? "active, working the business" : "on the canonical roster", tone: "text-foreground" },
        { label: "Active", value: snapshot.active.toLocaleString(), note: `${snapshot.inactive} inactive · ${snapshot.terminated} terminated`, tone: "text-info" },
        { label: "Producing this month", value: snapshot.producing_mtd.toLocaleString(), note: `of ${snapshot.active} active`, tone: "text-success" },
        ...(newHires30dNoSale != null ? [{ label: "New hires, no sale", value: newHires30dNoSale.toLocaleString(), note: "joined ≤30d, not selling yet", tone: "text-amber-700 dark:text-amber-400" }] : []),
        { label: "Month-to-date ALP", value: compactUsd(snapshot.mtd_alp), note: snapshot.book_last_posted ? `book through ${snapshot.book_last_posted}` : "not on file", tone: "text-foreground" },
      ]
    : null;

  const visibleStats = stats ?? [
    { label: "Team size", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
    { label: "Active", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
    { label: "Producing this month", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
    { label: "Month-to-date ALP", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
  ];

  const todayAmount = todayProduction
    ? compactUsd(todayProduction.today_alp).replace("Nothing posted yet", "$0")
    : "Unavailable";
  const todayPolicies = Number(todayProduction?.today_policies ?? 0);
  const streakDays = Number(todayProduction?.selling_streak_days ?? 0);

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card px-3 py-3 sm:px-4" aria-live="polite" aria-label="Team production summary">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {isTodayLoading && !todayProduction ? (
          <div className="flex w-full items-center justify-between gap-3" role="status" aria-label="Loading today's production">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-6 w-40 rounded-full" />
            <span className="sr-only">Loading today's production</span>
          </div>
        ) : (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold tabular-nums text-foreground">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Radio className="h-3.5 w-3.5" aria-hidden /> Phoenix day</span>
              <span>Sold Today: {todayAmount} ({todayPolicies.toLocaleString()} {todayPolicies === 1 ? "policy" : "policies"})</span>
            </p>
            <p className={cn("inline-flex items-center gap-1.5 text-sm", streakDays > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
              <Flame className="h-4 w-4" aria-hidden />
              {streakDays > 0 ? `${streakDays}-day active selling streak` : "No active selling streak"}
            </p>
          </>
        )}
      </div>

      {isLoading && !stats ? (
        <div className="flex flex-wrap gap-x-8 gap-y-2" aria-label="Loading live team production metrics" role="status">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={`production-metric-skeleton-${index}`} className="h-9 w-32" />)}
          <span className="sr-only">Loading live team production metrics</span>
        </div>
      ) : (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-2" aria-label="Live team production metrics">
          {visibleStats.map((stat) => (
            <div key={stat.label} className="min-w-[8.5rem]">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className={cn("text-xl font-semibold tabular-nums", stat.tone)}>{stat.value}</dd>
              <dd className="text-xs text-muted-foreground">{stat.note}</dd>
            </div>
          ))}
        </dl>
      )}
      {snapshot && placeholderSeats > 0 ? (
        <p className="text-xs text-muted-foreground">Active counts {placeholderSeats} placeholder {placeholderSeats === 1 ? "seat" : "seats"} that team size leaves out. Placeholders hold production the deal feed could not match to a person.</p>
      ) : null}
    </section>
  );
}
