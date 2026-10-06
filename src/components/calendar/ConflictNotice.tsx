import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { fetchOwnerConflicts, type ConflictRow } from "@/components/calendar/calendarApi";
import { describeEventTime, viewerTimeZone } from "@/lib/calendarTime";

/**
 * Availability check: what the owner already has in the proposed slot.
 * A warning, not a block — two people can share a slot on purpose.
 */
export function useOwnerConflicts(params: {
  ownerUserId: string | null | undefined;
  startsAt: string | null;
  endsAt: string | null;
  excludeKey?: string | null;
}) {
  const { ownerUserId, startsAt, endsAt, excludeKey } = params;
  return useQuery({
    queryKey: ["calendar-owner-conflicts", ownerUserId, startsAt, endsAt, excludeKey ?? null],
    queryFn: () => fetchOwnerConflicts({ ownerUserId: ownerUserId as string, startsAt: startsAt as string, endsAt: endsAt as string, excludeKey }),
    enabled: !!ownerUserId && !!startsAt && !!endsAt && Date.parse(endsAt) > Date.parse(startsAt),
    staleTime: 15_000,
  });
}

export function ConflictNotice({
  conflicts,
  isLoading,
  isError,
}: {
  conflicts: ConflictRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <p className="text-xs text-muted-foreground">Checking availability…</p>;
  if (isError) return <p className="text-xs text-warning">Availability could not be checked. Booking still works; double-check the calendar.</p>;
  if (!conflicts || conflicts.length === 0) return <p className="text-xs text-muted-foreground">No overlap with the owner&apos;s other events.</p>;
  const tz = viewerTimeZone();
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-foreground" role="alert">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        Overlaps {conflicts.length} existing event{conflicts.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {conflicts.slice(0, 4).map((c) => (
          <li key={c.event_key}>
            {describeEventTime(c.starts_at, tz, tz).eventLabel} · {c.title}
            {c.scope === "unassigned" ? " (unassigned Calendly booking)" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
