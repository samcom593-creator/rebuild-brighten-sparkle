import { cn } from "@/lib/utils";

/**
 * Base Skeleton primitive — uses the design-system shimmer when available,
 * falls back to animate-pulse for reduced motion.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted/60 motion-safe:animate-pulse",
        "supports-[background:linear-gradient(0deg,_red,_red)]:motion-safe:bg-[linear-gradient(110deg,hsl(var(--muted)/0.5)_8%,hsl(var(--muted)/0.9)_18%,hsl(var(--muted)/0.5)_33%)]",
        "supports-[background:linear-gradient(0deg,_red,_red)]:motion-safe:bg-[length:200%_100%]",
        "supports-[background:linear-gradient(0deg,_red,_red)]:motion-safe:animate-[shimmer_var(--motion-shimmer,1.6s)_linear_infinite]",
        className
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Standardized skeleton for table rows. */
function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="w-full space-y-2">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-4" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={`r-${r}`}
          className="grid gap-3 py-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={`c-${r}-${c}`} className="h-6" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Standardized skeleton for card-grid views. */
function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border/50 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Standardized skeleton for stat tiles (dashboard). */
function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-border/50 p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export { Skeleton, TableSkeleton, CardGridSkeleton, StatSkeleton };
