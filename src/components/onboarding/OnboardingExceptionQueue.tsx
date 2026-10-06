import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { AgentNameLink } from "@/components/dashboard/AgentNameLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { formatTimeAgo } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { AGENT_NAME_FALLBACK } from "@/shared/api/agentDisplayNames";
import {
  TRACK_LABEL,
  buildExceptionQueue,
  daysWaiting,
  expectedStartText,
  trackCounts,
  type OnboardingException,
  type OnboardingFacts,
  type RecruitExceptions,
  type Track,
} from "@/lib/onboardingExceptions";
import { ExceptionResolution, type ResolutionPermissions } from "./ExceptionResolution";

const TRACK_ORDER: Track[] = ["contracting", "licensing", "start", "access", "training", "production"];
const SKELETON_ROWS = ["s1", "s2", "s3", "s4"] as const;

function waitingText(e: OnboardingException, now: Date): string {
  const d = daysWaiting(e.waitingSince, now);
  return d === null ? "unknown" : `${d}d`;
}

function ExceptionLine({
  facts,
  exception,
  perms,
  now,
  showRecruit,
  expanded,
  onToggle,
  extraCount,
}: {
  facts: OnboardingFacts;
  exception: OnboardingException;
  perms: ResolutionPermissions;
  now: Date;
  showRecruit: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  extraCount?: number;
}) {
  const days = daysWaiting(exception.waitingSince, now);
  return (
    <div className="grid gap-x-4 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_8rem_6rem_minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        {showRecruit ? (
          <>
            <AgentNameLink agentId={facts.agent_id} className="text-sm font-medium">
              <span className="truncate">{facts.agent_name?.trim() || AGENT_NAME_FALLBACK}</span>
            </AgentNameLink>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{expectedStartText(facts) ?? "No expected start"}</span>
              {onToggle && (extraCount ?? 0) > 0 && (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                  onClick={onToggle}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? "Hide" : "Show"} ${extraCount} more open items for ${facts.agent_name ?? "this hire"}`}
                >
                  {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {extraCount} more
                </button>
              )}
            </div>
          </>
        ) : (
          <span className="pl-3 text-xs text-muted-foreground">{TRACK_LABEL[exception.track]}</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm">
          {showRecruit && <span className="mr-1.5 text-xs font-medium text-muted-foreground">{TRACK_LABEL[exception.track]}</span>}
          <span className={cn(exception.blocking && "font-medium text-foreground")}>{exception.label}</span>
        </p>
        <p className="text-xs text-muted-foreground">{exception.why}</p>
      </div>
      <div className={cn("text-xs", exception.owner === "Unassigned" ? "text-destructive" : "text-foreground")}>{exception.owner}</div>
      <div className="text-xs tabular-nums" title={exception.waitingSince ? `${exception.waitingBasis} (${exception.waitingSince.slice(0, 10)})` : "No record says when this started"}>
        <span className={cn(days !== null && days >= 14 ? "font-medium text-destructive" : days === null ? "text-muted-foreground" : "text-foreground")}>
          {waitingText(exception, now)}
        </span>
        <span className="block text-[11px] text-muted-foreground">{exception.waitingBasis}</span>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        {facts.last_outreach_at ? (
          <>
            <span className="text-foreground">{formatTimeAgo(facts.last_outreach_at)}</span>
            <span className="block truncate">{facts.last_outreach_kind}</span>
          </>
        ) : (
          <span>No outreach on record</span>
        )}
      </div>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <span className="text-xs text-muted-foreground sm:text-right">{exception.nextAction}</span>
        <ExceptionResolution facts={facts} exception={exception} perms={perms} />
      </div>
    </div>
  );
}

/**
 * The onboarding exception queue: one row per stalled hire, led by the most
 * urgent open requirement (contracting first), with every other open item one
 * click away. Each item names the exact gap, why it matters, the accountable
 * owner, time waiting from a real record ("unknown" when none exists), the last
 * real outreach, the next action and the control that resolves it.
 */
export function OnboardingExceptionQueue({
  rows,
  isLoading,
  error,
  mode,
  limit,
}: {
  rows: OnboardingFacts[] | undefined;
  isLoading: boolean;
  error: unknown;
  mode: "compact" | "full";
  limit?: number;
}) {
  const { isAdmin, isManager } = useAuth();
  const perms: ResolutionPermissions = { canSendLogin: !!(isAdmin || isManager), canOpenContracting: !!isAdmin };
  const [now] = useState(() => new Date());
  const [track, setTrack] = useState<Track | "all">("all");
  const [owner, setOwner] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const queue = useMemo(() => buildExceptionQueue(rows ?? [], now), [rows, now]);
  const counts = useMemo(() => trackCounts(queue), [queue]);
  const owners = useMemo(
    () => Array.from(new Set(queue.flatMap((q) => q.exceptions.map((e) => e.owner)))).sort((a, b) => a.localeCompare(b)),
    [queue],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: RecruitExceptions[] = [];
    for (const item of queue) {
      const matching = item.exceptions.filter(
        (e) => (track === "all" || e.track === track) && (owner === "all" || e.owner === owner),
      );
      if (matching.length === 0) continue;
      if (q && !`${item.facts.agent_name ?? ""} ${matching.map((e) => e.label).join(" ")}`.toLowerCase().includes(q)) continue;
      out.push({ ...item, exceptions: matching, primary: matching[0] });
    }
    return out;
  }, [queue, track, owner, search]);

  const shown = limit ? filtered.slice(0, limit) : filtered;

  if (isLoading) {
    return (
      <div className="divide-y divide-border rounded-lg border border-border" role="status" aria-busy="true">
        {SKELETON_ROWS.map((id) => (
          <div key={id} className="flex items-center gap-4 px-3 py-3">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
        <span className="sr-only">Loading onboarding exceptions…</span>
      </div>
    );
  }

  if (error) {
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        The onboarding exception queue did not load ({(error as Error)?.message ?? "unknown error"}). This is an outage, not zero stalled hires.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {mode === "full" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={track === "all" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setTrack("all")}>
              All hires <span className="ml-1 tabular-nums opacity-70">{queue.length}</span>
            </Button>
            {TRACK_ORDER.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={track === t ? "default" : "outline"}
                className="h-8 text-xs"
                disabled={counts[t] === 0}
                onClick={() => setTrack(track === t ? "all" : t)}
              >
                {TRACK_LABEL[t]} <span className="ml-1 tabular-nums opacity-70">{counts[t]}</span>
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search hire or requirement" className="h-9 pl-8" aria-label="Search hires" />
            </div>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-48" aria-label="Filter by owner"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All owners</SelectItem>
                {owners.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="ml-auto text-xs text-muted-foreground">{filtered.length} hires · {filtered.reduce((n, r) => n + r.exceptions.length, 0)} open items</span>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {queue.length === 0 ? "No live hire has an open onboarding requirement on record." : "Nobody matches these filters."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="hidden border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_8rem_6rem_minmax(0,1fr)_auto] sm:gap-x-4">
            <span>Hire</span><span>Missing requirement</span><span>Owner</span><span>Waiting</span><span>Last outreach</span><span className="text-right">Next action</span>
          </div>
          <div className="divide-y divide-border">
            {shown.map((item) => {
              const isOpen = open.has(item.facts.agent_id);
              const rest = item.exceptions.slice(1);
              return (
                <div key={item.facts.agent_id}>
                  <ExceptionLine
                    facts={item.facts}
                    exception={item.primary!}
                    perms={perms}
                    now={now}
                    showRecruit
                    expanded={isOpen}
                    extraCount={rest.length}
                    onToggle={() => setOpen((prev) => {
                      const n = new Set(prev);
                      if (n.has(item.facts.agent_id)) n.delete(item.facts.agent_id); else n.add(item.facts.agent_id);
                      return n;
                    })}
                  />
                  {isOpen && (
                    <div className="divide-y divide-border/60 bg-muted/20">
                      {rest.map((e) => (
                        <ExceptionLine key={`${item.facts.agent_id}:${e.key}`} facts={item.facts} exception={e} perms={perms} now={now} showRecruit={false} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {limit && filtered.length > shown.length && (
        <p className="text-xs text-muted-foreground">Showing the {shown.length} most urgent of {filtered.length} hires with open items.</p>
      )}
    </div>
  );
}
