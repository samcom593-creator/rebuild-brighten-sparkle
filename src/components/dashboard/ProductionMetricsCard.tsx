import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface ProductionMetricSnapshot {
  total: number;
  active: number;
  inactive: number;
  terminated: number;
  producing_mtd: number;
  mtd_alp: number | string;
  book_last_posted: string | null;
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
}: {
  snapshot: ProductionMetricSnapshot | null;
  isLoading: boolean;
}) {
  const tiles = snapshot
    ? [
        { label: "Team size", value: snapshot.total.toLocaleString(), note: "on the canonical roster", tone: "text-foreground" },
        { label: "Active", value: snapshot.active.toLocaleString(), note: `${snapshot.inactive} inactive · ${snapshot.terminated} terminated`, tone: "text-info" },
        { label: "Producing this month", value: snapshot.producing_mtd.toLocaleString(), note: `of ${snapshot.active} active`, tone: "text-success" },
        { label: "Month-to-date ALP", value: compactUsd(snapshot.mtd_alp), note: snapshot.book_last_posted ? `book through ${snapshot.book_last_posted}` : "not on file", tone: "text-foreground" },
      ]
    : null;

  if (isLoading && !tiles) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label="Loading live team production metrics">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={`production-metric-skeleton-${index}`} className="space-y-2 rounded-md border border-border bg-card p-4">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
        <span className="sr-only">Loading live production totals</span>
      </div>
    );
  }

  const visibleTiles = tiles ?? [
    { label: "Team size", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
    { label: "Active", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
    { label: "Producing this month", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
    { label: "Month-to-date ALP", value: "Unavailable", note: "refresh to retry", tone: "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {visibleTiles.map((tile) => (
        <div key={tile.label} className="rounded-md border border-border bg-card p-4">
          <p className={cn("truncate text-2xl font-bold tabular-nums", tile.tone)}>{tile.value}</p>
          <p className="text-xs text-muted-foreground">{tile.label}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{tile.note}</p>
        </div>
      ))}
    </div>
  );
}
