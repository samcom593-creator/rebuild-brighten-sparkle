import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
 * Team-level truth cards. Until the aggregate RPC returns, values are omitted
 * completely and represented by accessible loading text plus visual skeletons.
 */
export function ProductionMetricsCard({
  snapshot,
  isLoading,
  todayProduction,
  isTodayLoading,
}: {
  snapshot: ProductionMetricSnapshot | null;
  isLoading: boolean;
  todayProduction: TodayProductionSnapshot | null;
  isTodayLoading: boolean;
}) {
  const tiles = snapshot
    ? [
        { label: "Team size", value: snapshot.total.toLocaleString(), note: "on the canonical roster", tone: "text-foreground" },
        { label: "Active", value: snapshot.active.toLocaleString(), note: `${snapshot.inactive} inactive · ${snapshot.terminated} terminated`, tone: "text-info" },
        { label: "Producing this month", value: snapshot.producing_mtd.toLocaleString(), note: `of ${snapshot.active} active`, tone: "text-success" },
        { label: "Month-to-date ALP", value: compactUsd(snapshot.mtd_alp), note: snapshot.book_last_posted ? `book through ${snapshot.book_last_posted}` : "not on file", tone: "text-foreground" },
      ]
    : null;

  const visibleTiles = tiles ?? [
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
    <div className="space-y-3" aria-live="polite">
      <div className="flex min-h-20 flex-col justify-center gap-3 rounded-md border border-primary/35 bg-gradient-to-r from-primary/15 via-card to-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        {isTodayLoading && !todayProduction ? (
          <div className="flex w-full items-center justify-between gap-3" role="status" aria-label="Loading today's production">
            <div className="space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-7 w-56" /></div>
            <Skeleton className="h-10 w-40 rounded-full" />
            <span className="sr-only">Loading today's production</span>
          </div>
        ) : (
          <>
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                <Radio className="h-3.5 w-3.5" aria-hidden /> Live Phoenix day
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums text-foreground sm:text-2xl">
                Sold Today: {todayAmount} ({todayPolicies.toLocaleString()} {todayPolicies === 1 ? "policy" : "policies"})
              </p>
            </div>
            <Badge variant="outline" className={cn(
              "min-h-10 w-fit gap-1.5 rounded-full px-3 text-xs",
              streakDays > 0 ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground",
            )}>
              <Flame className="h-4 w-4" aria-hidden />
              {streakDays > 0 ? `${streakDays}-day active selling streak` : "No active selling streak"}
            </Badge>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={isLoading && !tiles ? "Loading live team production metrics" : "Live team production metrics"}>
        {isLoading && !tiles ? Array.from({ length: 4 }, (_, index) => (
          <div key={`production-metric-skeleton-${index}`} className="space-y-2 rounded-md border border-border bg-card p-4" role="status">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-24" />
            <span className="sr-only">Loading live production total</span>
          </div>
        )) : visibleTiles.map((tile) => (
          <div key={tile.label} className="rounded-md border border-border bg-card p-4">
            <p className={cn("truncate text-2xl font-bold tabular-nums", tile.tone)}>{tile.value}</p>
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{tile.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
