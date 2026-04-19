import { cn } from "@/lib/utils";

interface PageLoadingSkeletonProps {
  variant?: "dashboard" | "table" | "list" | "detail" | "cards";
  className?: string;
}

/**
 * Consistent page-level loading skeleton.
 * Use this at the top of every heavy page to prevent content-pop flicker.
 *
 * Example:
 *   if (authLoading || dataLoading) return <PageLoadingSkeleton variant="dashboard" />;
 */
export function PageLoadingSkeleton({ variant = "dashboard", className }: PageLoadingSkeletonProps) {
  return (
    <div className={cn("space-y-6 p-4 md:p-6 animate-in fade-in duration-200", className)}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-md bg-muted/60 animate-pulse" />
          <div className="h-3 w-64 rounded-md bg-muted/40 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-md bg-muted/40 animate-pulse" />
          <div className="h-9 w-24 rounded-md bg-muted/40 animate-pulse" />
        </div>
      </div>

      {variant === "dashboard" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" style={{ animationDelay: `${i * 75}ms` }} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 h-80 rounded-xl bg-muted/40 animate-pulse" />
            <div className="h-80 rounded-xl bg-muted/40 animate-pulse" style={{ animationDelay: "150ms" }} />
          </div>
          <div className="h-64 rounded-xl bg-muted/30 animate-pulse" />
        </>
      )}

      {variant === "table" && (
        <>
          <div className="flex gap-2 flex-wrap">
            <div className="h-10 flex-1 min-w-[240px] rounded-md bg-muted/40 animate-pulse" />
            <div className="h-10 w-40 rounded-md bg-muted/40 animate-pulse" />
            <div className="h-10 w-40 rounded-md bg-muted/40 animate-pulse" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
            ))}
          </div>
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="h-12 bg-muted/50 animate-pulse" />
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-14 border-t border-border/50 bg-muted/20 animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          </div>
        </>
      )}

      {variant === "list" && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      )}

      {variant === "cards" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="h-48 rounded-xl bg-muted/40 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      )}

      {variant === "detail" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            <div className="h-40 rounded-xl bg-muted/40 animate-pulse" />
            <div className="h-64 rounded-xl bg-muted/30 animate-pulse" />
            <div className="h-48 rounded-xl bg-muted/30 animate-pulse" />
          </div>
          <div className="space-y-4">
            <div className="h-32 rounded-xl bg-muted/40 animate-pulse" />
            <div className="h-48 rounded-xl bg-muted/30 animate-pulse" />
          </div>
        </div>
      )}
    </div>
  );
}
