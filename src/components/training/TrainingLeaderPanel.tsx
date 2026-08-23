import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, TriangleAlert, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * TrainingLeaderPanel — who finished and who stalled.
 *
 * Both operands are server-side aggregates, never a client array length:
 *   apex_training_rollup()          -> active_modules / enrolled / complete /
 *                                      in_progress / not_started / scope
 *   apex_training_needs_nudge(n)    -> the stalled agents, coldest first
 *
 * Both are SECURITY DEFINER and FAIL CLOSED on role: a caller who is neither
 * admin, va_manager nor manager gets ZERO ROWS, and a manager gets only their
 * own invitees (scope = 'team'). So "no row" means "not a leader", not
 * "nothing to show" — this panel renders nothing at all in that case rather
 * than painting an agent a row of zeros about an agency they cannot see.
 *
 * POPULATION: both are scoped to v_apex_roster, the canonical roster. Before
 * 2026-08-23 they were not, and because the list sorts coldest-first — and
 * people who have LEFT are by definition the coldest — 7 of the 10 names in
 * this panel's default view were terminated or inactive (16 of 25 at the
 * widest setting), plus three XAGENT test rows. A leader opened "who to
 * chase" and got a list of ex-agents. The tiles are computed over that same
 * roster, so the denominator above the list and the list itself can never
 * again describe two different populations.
 *
 * NOTE FOR ANYONE VERIFYING THIS: bot-sql runs as the service role with no
 * auth.uid(), so both functions return zero rows there and look broken while
 * they are fine. Probe through PostgREST with a real user JWT.
 */

interface Rollup {
  active_modules: number;
  enrolled: number;
  complete: number;
  in_progress: number;
  not_started: number;
  scope: string;
}

interface NudgeRow {
  agent_id: string;
  display_name: string | null;
  modules_passed: number;
  active_modules: number;
  last_activity: string | null;
}

const LIMITS = [5, 10, 25] as const;

function sinceLabel(iso: string | null): string {
  if (!iso) return "no activity on file";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "no activity on file";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "active today";
  if (days === 1) return "quiet 1 day";
  if (days < 30) return `quiet ${days} days`;
  const months = Math.floor(days / 30);
  return `quiet ${months} month${months === 1 ? "" : "s"}`;
}

function Tile({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className={cn("text-2xl font-bold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function TrainingLeaderPanel() {
  const [limit, setLimit] = useState<number>(10);

  // Both RPCs post-date the last `supabase gen types` run, so they are absent
  // from integrations/supabase/types.ts and the typed client rejects the name.
  // Same `as any` shape the rest of the repo uses for that gap; verified live
  // against PostgREST rather than trusted from the generated types.
  const rollupQ = useQuery({
    queryKey: ["apex-training-rollup"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_training_rollup" as never);
      if (error) throw error;
      return ((data as Rollup[] | null) ?? [])[0] ?? null;
    },
    staleTime: 60 * 1000,
  });

  const nudgeQ = useQuery({
    queryKey: ["apex-training-needs-nudge", limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_training_needs_nudge" as never, {
        _limit: limit,
      } as never);
      if (error) throw error;
      return (data as NudgeRow[] | null) ?? [];
    },
    // Only ask once the rollup has proven this caller is a leader — otherwise
    // every agent fires a guaranteed-empty RPC on every hub visit.
    enabled: !!rollupQ.data,
    staleTime: 60 * 1000,
  });

  if (rollupQ.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {["a", "b", "c", "d", "e"].map((k) => (
          <Skeleton key={k} className="h-20 rounded-md" />
        ))}
      </div>
    );
  }

  // A failed read must not read as an empty agency.
  if (rollupQ.isError) {
    return (
      <Card>
        <CardContent className="p-8 pt-8 text-center">
          <p className="text-lg font-bold">Couldn't load team training progress</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is a connection problem, not an empty roster.
          </p>
          <Button className="mt-4 gap-2" onClick={() => void rollupQ.refetch()}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Not a leader (or no active modules): the function fails closed and returns
  // no row. Render nothing rather than a fabricated zero.
  if (!rollupQ.data) return null;

  const r = rollupQ.data;
  const stalled = nudgeQ.data ?? [];

  return (
    <section aria-labelledby="training-leader-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="training-leader-heading" className="flex items-center gap-2 text-lg font-bold">
          <Users className="h-4 w-4 text-primary" />
          Who finished, who stalled
        </h2>
        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
          {r.scope === "agency" ? "Whole agency" : "Your team"}
        </Badge>
      </div>

      {/* State the denominator. A leader must never have to guess which people
          these five numbers are counting. */}
      <p className="-mt-1 text-xs text-muted-foreground">
        Current roster only — agents who have left, and test accounts, are
        excluded from both the tiles and the list below.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile value={r.active_modules} label="Active modules" />
        <Tile value={r.enrolled} label="Agents started" />
        <Tile value={r.complete} label="Finished all" tone={r.complete > 0 ? "text-success" : undefined} />
        <Tile value={r.in_progress} label="Part way" tone={r.in_progress > 0 ? "text-warning" : undefined} />
        <Tile
          value={r.not_started}
          label="Nothing passed"
          tone={r.not_started > 0 ? "text-destructive" : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          <TriangleAlert className="h-3.5 w-3.5 text-warning" />
          Stalled — coldest first
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Show</span>
          {LIMITS.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={limit === n}
              onClick={() => setLimit(n)}
              className={cn(
                "min-h-9 rounded-md border px-3 text-sm font-semibold tabular-nums transition-colors",
                limit === n
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {nudgeQ.isLoading ? (
        <Skeleton className="h-40 rounded-md" />
      ) : nudgeQ.isError ? (
        <Card>
          <CardContent className="p-6 pt-6 text-center">
            <p className="text-sm font-semibold">Couldn't load the stalled list</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Nobody is confirmed clear — the list failed to load.
            </p>
            <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => void nudgeQ.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : stalled.length === 0 ? (
        <Card>
          <CardContent className="p-8 pt-8 text-center">
            <p className="text-lg font-bold">Nobody is stalled</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every agent on the current roster who started the course has passed all{" "}
              {r.active_modules} active modules.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {stalled.map((row) => {
            const pct =
              row.active_modules > 0
                ? Math.round((row.modules_passed / row.active_modules) * 100)
                : 0;
            return (
              <Link
                key={row.agent_id}
                to={`/dashboard/agents/${row.agent_id}`}
                className="flex items-center gap-4 p-4 transition-colors first:rounded-t-[10px] last:rounded-b-[10px] hover:bg-muted/30"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {row.display_name?.trim() || "Name not on file"}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {row.modules_passed} of {row.active_modules} passed · {sinceLabel(row.last_activity)}
                  </span>
                </span>
                <span className="hidden w-28 sm:block">
                  <span
                    className="block h-1.5 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${row.display_name ?? "Agent"} training completion`}
                  >
                    <span
                      className="block h-full rounded-full bg-warning transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </span>
                <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                  {pct}%
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </Card>
      )}
    </section>
  );
}

export default TrainingLeaderPanel;
