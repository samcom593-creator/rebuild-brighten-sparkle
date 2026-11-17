import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Fixed placeholder ids, not array indexes: the rows never reorder and the
// stale-key guard reads an index key as a defect.
const ROWS = ["r1", "r2", "r3", "r4", "r5", "r6"] as const;

/** After this long on one uninterrupted skeleton, the page is stuck, not slow. */
export const SKELETON_STUCK_MS = 10_000;

/**
 * The one loading state for a whole page: route chunk, auth check, shell
 * transition. It is shaped like the page about to render (header, toolbar,
 * rows), so the swap reads as content arriving rather than a splash screen.
 * It stays invisible for the first ~180ms (see .page-skeleton in index.css),
 * so a fast load shows nothing at all.
 *
 * Escape hatch (Sam, 2026-11-17: "a lot of bugs with the load screens"): a
 * skeleton that is still on screen after SKELETON_STUCK_MS is a wedged load
 * (a hung auth session restore, a dead chunk, a stuck tab lock), not a slow
 * one — nothing in this app legitimately loads that long. At that point the
 * person gets a reload affordance instead of an infinite shimmer. The reload
 * goes through location.reload(), which also re-runs the stale-client
 * self-heal in main.tsx, so a wedged service worker is cleared on the same
 * tap.
 */
export function PageSkeleton({ fullScreen = false, className }: { fullScreen?: boolean; className?: string }) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const handle = window.setTimeout(() => setStuck(true), SKELETON_STUCK_MS);
    return () => window.clearTimeout(handle);
  }, []);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn("page-skeleton w-full", fullScreen && "min-h-screen bg-background", className)}
    >
      <div className="page-skeleton-bar" aria-hidden="true" />
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
        <div aria-hidden="true" className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56 max-w-[60vw]" />
            <Skeleton className="h-4 w-80 max-w-[70vw]" />
          </div>
          <Skeleton className="hidden h-9 w-28 sm:block" />
        </div>
        {stuck ? (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">This is taking longer than it should.</p>
            <p className="mt-1 text-xs text-muted-foreground">Your work is saved. Reloading usually fixes it.</p>
            <button
              type="button"
              className="mt-3 inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
          </div>
        ) : null}
        <div aria-hidden="true" className="flex gap-2">
          <Skeleton className="h-9 w-64 max-w-[50vw]" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div aria-hidden="true" className="overflow-hidden rounded-lg border border-border">
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
