import type { ReactNode } from "react";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { errorMessage, formatAsOf, type QueryStatus } from "@/lib/queryState";

export { describeQuery, errorMessage, formatAsOf, isEmptyResult, queryStale, queryStatus } from "@/lib/queryState";
export type { QueryPresentation, QueryStatus, QueryStatusInput } from "@/lib/queryState";

export interface QueryStateProps {
  status: QueryStatus;
  /** What this block shows, used in the loading and error copy: "deals", "the roster", "today's calls". */
  label?: string;
  /** The query's error (Error, PostgrestError shape, string). Rendered through errorMessage. */
  error?: unknown;
  onRetry?: () => void;
  /** Empty-state heading and body. Only rendered for status "empty", which callers reserve for a completed read with no rows. */
  title?: ReactNode;
  body?: ReactNode;
  /** True when children show the last result that loaded after a later refresh failed. */
  stale?: boolean;
  /** When the data on screen was read: ISO string, epoch ms (TanStack dataUpdatedAt), Date, or a preformatted string. */
  asOf?: string | number | Date | null;
  /** Single-line variants for tiles and widget rows. */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}

// Fixed placeholder ids, not array indexes: the rows never reorder.
const SKELETON_ROWS = ["r1", "r2", "r3"] as const;

function capitalize(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

function LoadingState({ label, compact, className }: Pick<QueryStateProps, "label" | "compact" | "className">) {
  const what = label ?? "data";
  if (compact) {
    return (
      <div role="status" aria-busy="true" aria-live="polite" className={cn("flex items-center", className)}>
        <Skeleton className="h-5 w-24" />
        <span className="sr-only">Loading {what}</span>
      </div>
    );
  }
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("space-y-2", className)}>
      {SKELETON_ROWS.map((id) => (
        <Skeleton key={id} className="h-12 w-full" />
      ))}
      <span className="sr-only">Loading {what}</span>
    </div>
  );
}

function ErrorState({ label, error, onRetry, compact, className }: Pick<QueryStateProps, "label" | "error" | "onRetry" | "compact" | "className">) {
  const message = errorMessage(error);
  if (compact) {
    return (
      <div role="alert" className={cn("flex flex-wrap items-center gap-2 text-sm", className)}>
        <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
        <span className="font-medium text-destructive">Unavailable</span>
        <span className="text-muted-foreground">{message}</span>
        {onRetry && (
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onRetry}>
            <RefreshCw aria-hidden /> Retry
          </Button>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className={cn("rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm", className)}>
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden /> {label ? `${capitalize(label)} could not load.` : "This could not load."}
      </p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          <RefreshCw aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

function EmptyState({ title, body, compact, className }: Pick<QueryStateProps, "title" | "body" | "compact" | "className">) {
  if (compact) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {title ?? "None"}
        {body ? <span className="ml-1">{body}</span> : null}
      </p>
    );
  }
  return (
    <div className={cn("rounded-lg border border-dashed border-border bg-card p-6 text-center", className)}>
      <p className="text-sm font-semibold text-foreground">{title ?? "Nothing here yet"}</p>
      {body ? <p className="mt-1 text-sm text-muted-foreground">{body}</p> : null}
    </div>
  );
}

function StaleNotice({ error, asOf, onRetry, compact }: Pick<QueryStateProps, "error" | "asOf" | "onRetry" | "compact">) {
  const when = formatAsOf(asOf);
  const reason = error ? ` ${errorMessage(error)}` : "";
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 text-xs text-muted-foreground",
        compact ? "px-2 py-1" : "mb-2 px-3 py-2",
      )}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      <span>
        {when ? `Showing data as of ${when}.` : "Showing the last data that loaded."} The latest refresh failed.{reason}
      </span>
      {onRetry && (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRetry}>
          <RefreshCw aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

/**
 * The shared loading / error / empty / ready presentation for a query
 * (F10, F15, F19, F33). Pair with describeQuery:
 *
 *   <QueryState {...describeQuery(q)} label="deals" onRetry={() => void q.refetch()} asOf={q.dataUpdatedAt}
 *               title="No deals logged yet" body="Use Post a Deal to record the first one.">
 *     <DealsTable rows={q.data} />
 *   </QueryState>
 *
 * "empty" only renders when the caller reports a completed read with no rows;
 * a failed read renders the error with its message and a Retry button, and a
 * failed refresh keeps the last good children on screen under a stale label.
 */
export function QueryState(props: QueryStateProps) {
  const { status, children, stale, asOf, error, onRetry, compact, className } = props;
  if (status === "loading") return <LoadingState label={props.label} compact={compact} className={className} />;
  if (status === "error") return <ErrorState label={props.label} error={error} onRetry={onRetry} compact={compact} className={className} />;
  if (status === "empty") return <EmptyState title={props.title} body={props.body} compact={compact} className={className} />;
  return (
    <>
      {stale ? <StaleNotice error={error} asOf={asOf} onRetry={onRetry} compact={compact} /> : null}
      {children}
    </>
  );
}
