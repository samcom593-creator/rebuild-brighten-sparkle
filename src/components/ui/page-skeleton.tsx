import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Fixed placeholder ids, not array indexes: the rows never reorder and the
// stale-key guard reads an index key as a defect.
const ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;

/**
 * The one loading state for a whole page: route chunk, auth check, shell
 * transition. It is shaped like the page about to render (header, toolbar,
 * rows), so the swap reads as content arriving rather than a splash screen.
 * It stays invisible for the first ~180ms (see .page-skeleton in index.css),
 * so a fast load shows nothing at all.
 */
export function PageSkeleton({ fullScreen = false, className }: { fullScreen?: boolean; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("page-skeleton w-full", fullScreen && "min-h-screen bg-background", className)}
    >
      <div className="page-skeleton-bar" aria-hidden="true" />
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6" aria-hidden="true">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56 max-w-[60vw]" />
            <Skeleton className="h-4 w-80 max-w-[70vw]" />
          </div>
          <Skeleton className="hidden h-9 w-28 sm:block" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-64 max-w-[50vw]" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          {ROWS.map((id) => (
            <div key={id} className="flex items-center gap-4 border-b border-border/60 px-4 py-3 last:border-b-0">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default PageSkeleton;
