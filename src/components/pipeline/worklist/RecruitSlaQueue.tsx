import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, PhoneCall, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Skeleton } from "@/components/ui/skeleton";
import { TonePill } from "@/components/ui/delight/ToneBubble";
import { cn } from "@/lib/utils";
import { errorMessage } from "@/lib/queryState";
import {
  SLA_QUEUE_COLUMNS,
  SLA_STATES,
  SLA_STATE_META,
  countByState,
  licenseLabel,
  personHref,
  sortQueue,
  waitingFor,
  type SlaQueueRow,
  type SlaState,
} from "@/lib/recruitSlaQueue";

/**
 * Recruit SLA queue (WP3, 2026-11-10). The first thing on /dashboard/recruiting and
 * "My queue" on /va-team: every open recruit who needs a human, licensed first, then
 * whoever has waited longest. Each row opens the person in the worklist below, where
 * the call outcome is recorded (record_recruiting_outcome), which is what clears it.
 *
 * Reads public.v_recruit_sla_queue (staff-only, security_invoker). The view is not in
 * the generated types yet, so the client is reached through a narrow untyped call.
 */

const PREVIEW = 8;

interface QueueQuery extends PromiseLike<{ data: SlaQueueRow[] | null; error: { message: string } | null }> {
  eq(column: string, value: string): QueueQuery;
  order(column: string, options?: { ascending?: boolean }): QueueQuery;
  limit(n: number): QueueQuery;
}
interface QueueClient {
  from(relation: string): { select(columns: string): QueueQuery };
}

// The relation is named through a constant until the integrator regenerates
// src/integrations/supabase/types.ts (WP3 may not regenerate it: a partial regen can
// drop live functions). After the regen, inline it so check:supabase-relation-types
// grades it like every other literal .from().
const SLA_QUEUE_RELATION = "v_recruit_sla_queue";

async function fetchQueue(ownerId: string | null): Promise<SlaQueueRow[]> {
  const client = supabase as unknown as QueueClient;
  let query = client.from(SLA_QUEUE_RELATION).select(SLA_QUEUE_COLUMNS);
  if (ownerId) query = query.eq("owner_user_id", ownerId);
  const { data, error } = await query.order("sort_rank", { ascending: true }).order("created_at", { ascending: true }).limit(500);
  if (error) throw new Error(error.message);
  return sortQueue(data ?? []);
}

export function RecruitSlaQueue({
  mineOnly = false,
  title,
  className,
}: {
  /** Pin the queue to the signed-in user's recruits (VA portal "My queue"). */
  mineOnly?: boolean;
  title?: string;
  className?: string;
}) {
  const { user } = useAuth();
  const [mineToggle, setMineToggle] = useState(false);
  const [filter, setFilter] = useState<SlaState | "ALL">("ALL");
  const [expanded, setExpanded] = useState(false);
  const mine = mineOnly || mineToggle;
  const ownerId = mine ? user?.id ?? null : null;

  const { data, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["recruit-sla-queue", ownerId ?? "all"],
    queryFn: () => fetchQueue(ownerId),
    enabled: !mine || !!ownerId,
    staleTime: 30_000,
  });

  const rows = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => countByState(rows), [rows]);
  const visible = useMemo(() => (filter === "ALL" ? rows : rows.filter((r) => r.sla_state === filter)), [rows, filter]);
  const shown = expanded ? visible : visible.slice(0, PREVIEW);
  const now = Date.now();

  return (
    <GlassCard className={cn("space-y-4 p-4 sm:p-5", className)} aria-labelledby="recruit-sla-queue-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="recruit-sla-queue-title" className="flex items-center gap-2 text-lg font-semibold">
            <PhoneCall className="h-5 w-5 shrink-0" aria-hidden="true" />
            {title ?? "Needs a human today"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading the queue…" : `${rows.length} ${rows.length === 1 ? "recruit" : "recruits"} waiting. Licensed first, then longest wait.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!mineOnly && (
            <Button
              variant={mineToggle ? "default" : "outline"}
              size="sm"
              className="h-11"
              aria-pressed={mineToggle}
              onClick={() => setMineToggle((v) => !v)}
            >
              Mine
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-11 gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        <button
          type="button"
          onClick={() => setFilter("ALL")}
          aria-pressed={filter === "ALL"}
          className={cn("inline-flex h-11 items-center rounded-full border px-3 text-sm font-medium", filter === "ALL" ? "border-foreground" : "border-border text-muted-foreground")}
        >
          All {rows.length}
        </button>
        {SLA_STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={cn("inline-flex h-11 items-center rounded-full", filter === s ? "ring-2 ring-foreground/40" : "opacity-90")}
          >
            <TonePill tone={SLA_STATE_META[s].tone}>
              {SLA_STATE_META[s].label} {counts[s]}
            </TonePill>
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Could not load the recruit queue: {errorMessage(error)}</span>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((n) => (
            <Skeleton key={`sla-skeleton-${n}`} className="h-14 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {filter === "ALL" ? "Nobody is waiting on a human right now." : "Nobody in this state right now."}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {shown.map((row) => {
            const meta = SLA_STATE_META[row.sla_state] ?? SLA_STATE_META.FOLLOWUP_DUE;
            return (
              <li key={row.application_id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium">{row.first_name?.trim() || "No name"}</span>
                    <span className="text-sm text-muted-foreground">
                      {licenseLabel(row.license_status)}
                      {row.state ? ` · ${row.state}` : ""}
                    </span>
                    <TonePill tone={meta.tone}>{meta.label}</TonePill>
                    {row.email_bounced_at && <TonePill tone="slate">Email bounced</TonePill>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {meta.action} · waiting {waitingFor(row.created_at, now)}
                    {row.owner_first_name ? ` · owner ${row.owner_first_name}` : ""}
                  </p>
                </div>
                <Link
                  to={personHref(row.application_id)}
                  aria-label={`Open ${row.first_name?.trim() || "this recruit"}`}
                  className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md border px-3 text-sm font-medium hover:bg-muted/50 focus-visible:bg-muted/50"
                >
                  Open
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {visible.length > PREVIEW && (
        <Button variant="ghost" size="sm" className="h-11 w-full" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show all ${visible.length}`}
        </Button>
      )}
    </GlassCard>
  );
}
