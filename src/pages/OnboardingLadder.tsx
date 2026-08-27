// Onboarding Ladder — the month-agnostic home for "which agents are stuck, and on what".
//
// WHY THIS PAGE EXISTS:
//   Every hire climbs the same 8 rungs: intake → contracting profile → carrier
//   contracting → appointment → Discord → training → launch ready → first sale.
//   Until now the only surface that showed the gaps was the June Hires Punch
//   List, which was hard-locked to June 2026 and rendered stale rows as if they
//   were current. It was removed; this page replaces it with no month lock.
//
//   Rung 2 now means the APEX profile has the NPN and compensation needed to
//   start contracting. The fix route is the native contracting workspace.
//
// Reads public.v_onboarding_sequence — one row per active agent, one query,
// server-side sorted. No per-row fetches.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Flame,
  ListChecks,
  RotateCw,
  Target,
  UserMinus,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentNameLink } from "@/components/dashboard/AgentNameLink";

// ---------------------------------------------------------------------------
// Row shape — mirrors public.v_onboarding_sequence. The generated Supabase
// types file does not carry this view, so the query is cast at the call site.
// `days_since_progress` is a Postgres numeric, which PostgREST serialises as a
// string — always coerce before comparing or formatting.
// ---------------------------------------------------------------------------
interface LadderRow {
  agent_id: string;
  agent_name: string | null;
  manager: string | null;
  rungs_complete: number | null;
  next_missing_step: string | null;
  days_since_progress: number | string | null;
  r1_intake: boolean | null;
  r2_agentlink: boolean | null;
  r3_contracted: boolean | null;
  r4_appointment: boolean | null;
  r5_discord: boolean | null;
  r6_training: boolean | null;
  r7_launch_ready: boolean | null;
  r8_first_sale: boolean | null;
}

type RungField =
  | "r1_intake"
  | "r2_agentlink"
  | "r3_contracted"
  | "r4_appointment"
  | "r5_discord"
  | "r6_training"
  | "r7_launch_ready"
  | "r8_first_sale";

interface Rung {
  n: number;
  field: RungField;
  label: string;
}

/** The ladder, in climb order. `label` is the chip caption; row copy always
 *  renders the view's own `next_missing_step` so the two can never drift. */
const RUNGS: Rung[] = [
  { n: 1, field: "r1_intake", label: "Intake / profile" },
  { n: 2, field: "r2_agentlink", label: "Contracting profile" },
  { n: 3, field: "r3_contracted", label: "Carrier contracting" },
  { n: 4, field: "r4_appointment", label: "Carrier appointment" },
  { n: 5, field: "r5_discord", label: "Slack joined" },
  { n: 6, field: "r6_training", label: "Training course" },
  { n: 7, field: "r7_launch_ready", label: "Launch ready" },
  { n: 8, field: "r8_first_sale", label: "First sale" },
];

/** Rung 2 is the only rung with a one-click fix already built. */
const CONTRACTING_PROFILE_RUNG = 2;
const CONTRACTING_FIX_ROUTE = "/dashboard/contracting";

/** Which rung a row is parked on. The view prefixes the step with its number
 *  ("2. Contracting profile"); fall back to the first unfinished
 *  rung if that ever stops being true. */
function stuckRung(row: LadderRow): number | null {
  const parsed = Number.parseInt(row.next_missing_step ?? "", 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 8) return parsed;
  if (!row.next_missing_step) return null;
  const firstOpen = RUNGS.find((r) => row[r.field] !== true);
  return firstOpen?.n ?? null;
}

function daysStalled(row: LadderRow): number {
  const n = Number(row.days_since_progress);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/** Severity is theme-paired on purpose: the bare -400 weights wash out on the
 *  white light-theme card. */
function daysTone(days: number): string {
  if (days >= 30) return "text-rose-600 dark:text-rose-400";
  if (days >= 14) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------

interface AttentionRow {
  agent_id: string;
  agent: string | null;
  owner: string | null;
  days_stuck: number | string | null;
  next_action: string | null;
  kind: "licensed_inactive" | "no_first_sale";
}

export default function OnboardingLadder() {
  usePageTitle("Onboarding Ladder · APEX");

  const [rungFilter, setRungFilter] = useState<number | null>(null);
  const [managerFilter, setManagerFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(100);

  const ladder = useQuery<LadderRow[]>({
    queryKey: ["v_onboarding_sequence"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_onboarding_sequence")
        .select(
          "agent_id,agent_name,manager,rungs_complete,next_missing_step,days_since_progress,r1_intake,r2_agentlink,r3_contracted,r4_appointment,r5_discord,r6_training,r7_launch_ready,r8_first_sale",
        )
        .order("rungs_complete", { ascending: true })
        .order("days_since_progress", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LadderRow[];
    },
    staleTime: 60_000,
  });

  // Two populations the 8-rung ladder cannot express, because both are agents
  // who already CLEARED the ladder and then stopped. They have no other surface.
  const attention = useQuery<AttentionRow[]>({
    queryKey: ["ladder-attention-queues"],
    queryFn: async () => {
      const [inactive, noSale] = await Promise.all([
        (supabase as any)
          .from("v_queue_licensed_inactive")
          .select("agent_id,agent,owner,days_stuck,next_action")
          .order("days_stuck", { ascending: false }),
        (supabase as any)
          .from("v_queue_active_no_first_sale")
          .select("agent_id,agent,owner,days_stuck,next_action")
          .order("days_stuck", { ascending: false }),
      ]);
      if (inactive.error) throw inactive.error;
      if (noSale.error) throw noSale.error;
      const tag = (rowsIn: unknown, kind: AttentionRow["kind"]): AttentionRow[] =>
        ((rowsIn ?? []) as Omit<AttentionRow, "kind">[]).map((r) => ({ ...r, kind }));
      return [
        ...tag(inactive.data, "licensed_inactive"),
        ...tag(noSale.data, "no_first_sale"),
      ];
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => ladder.data ?? [], [ladder.data]);

  /** Dropdown options come from the full roster so picking one never empties it. */
  const managers = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) if (row.manager) set.add(row.manager);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  /** Manager is the outer scope: the rung counts describe exactly the rows the
   *  list is about to show, so a chip can never claim more than is on screen. */
  const scoped = useMemo(
    () => (managerFilter === "all" ? rows : rows.filter((r) => r.manager === managerFilter)),
    [rows, managerFilter],
  );

  /** One pass: per-rung counts, bottleneck rung, launched total. */
  const summary = useMemo(() => {
    const counts = new Map<number, number>();
    let launched = 0;
    for (const row of scoped) {
      const rung = stuckRung(row);
      if (rung === null) launched += 1;
      else counts.set(rung, (counts.get(rung) ?? 0) + 1);
    }
    let bottleneck: number | null = null;
    let peak = 0;
    for (const [rung, n] of counts) {
      if (n > peak) {
        peak = n;
        bottleneck = rung;
      }
    }
    return { counts, launched, bottleneck, stuck: scoped.length - launched };
  }, [scoped]);

  const visible = useMemo(
    () => (rungFilter === null ? scoped : scoped.filter((row) => stuckRung(row) === rungFilter)),
    [scoped, rungFilter],
  );

  const contractingProfileCount = summary.counts.get(CONTRACTING_PROFILE_RUNG) ?? 0;
  const filtered = rungFilter !== null || managerFilter !== "all";

  return (
    <div className="page-enter mx-auto w-full max-w-6xl space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader
        eyebrow="Onboarding · Throughput"
        eyebrowIcon={<ListChecks className="h-3 w-3" />}
        title="Onboarding Ladder"
        accent="amber"
        subtitle="Every active agent climbs the same eight rungs. This is where they are parked, who owns the next move, and how long they have been waiting."
      />

      {/* ---------------------------------------------------------------- */}
      {/* Error — surfaced, never swallowed.                                */}
      {/* ---------------------------------------------------------------- */}
      {ladder.isError && (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">The ladder could not load</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {(ladder.error as Error | null)?.message ?? "The onboarding view did not respond."}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-10 w-full sm:h-9 sm:w-auto"
              onClick={() => void ladder.refetch()}
            >
              <RotateCw className="mr-1.5 h-4 w-4" /> Try again
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Loading — strip + rows, shaped like the real thing.                */}
      {/* ---------------------------------------------------------------- */}
      {ladder.isLoading && (
        <>
          <GlassCard className="p-4">
            <div className="mb-3 h-4 w-44 rounded bg-muted/40 animate-pulse" />
            <div className="-mx-4 overflow-x-auto pb-1 sm:mx-0">
              <div className="flex min-w-max gap-2 px-4 sm:px-0">
                {RUNGS.map((rung) => (
                  // stable-key-allow:skeleton — static 8-rung loader, fixed order
                  <div key={rung.n} className="h-[86px] w-[136px] shrink-0 rounded-lg bg-muted/40 animate-pulse" />
                ))}
              </div>
            </div>
          </GlassCard>
          <GlassCard className="p-4">
            <div className="mb-3 h-4 w-44 rounded bg-muted/40 animate-pulse" />
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                // stable-key-allow:skeleton — static Array(N) decorative loader, no reorder
                <div key={i} className="h-[76px] rounded-lg bg-muted/30 animate-pulse" />
              ))}
            </div>
          </GlassCard>
        </>
      )}

      {!ladder.isLoading && !ladder.isError && (
        <>
          {/* ------------------------------------------------------------ */}
          {/* Rung strip — primary navigation. Scrolls inside itself so the */}
          {/* page never scrolls sideways on a phone.                       */}
          {/* ------------------------------------------------------------ */}
          <GlassCard className="p-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Where the climb stops</span>
              </h3>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              One tile per rung, counting the agents parked on it. Tap a tile to filter the list
              below to that rung.
            </p>

            <div className="-mx-4 overflow-x-auto pb-1 sm:mx-0">
              <div className="flex min-w-max gap-2 px-4 sm:px-0">
                {RUNGS.map((rung) => {
                  const count = summary.counts.get(rung.n) ?? 0;
                  const active = rungFilter === rung.n;
                  const isBottleneck = summary.bottleneck === rung.n && count > 0;
                  const clear = count === 0;
                  return (
                    <button
                      key={rung.n}
                      type="button"
                      disabled={clear}
                      aria-pressed={active}
                      aria-label={
                        clear
                          ? `Rung ${rung.n}, ${rung.label}: nobody waiting`
                          : `Rung ${rung.n}, ${rung.label}: ${count} ${count === 1 ? "agent" : "agents"} waiting. Filter the list.`
                      }
                      onClick={() => setRungFilter(active ? null : rung.n)}
                      className={cn(
                        "relative w-[136px] shrink-0 overflow-hidden rounded-lg border px-3 pb-2.5 pt-3 text-left transition-colors",
                        "focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                        clear && "cursor-default border-border/50 bg-muted/20",
                        !clear && !active && isBottleneck &&
                          "border-rose-500/35 bg-rose-500/5 hover:border-rose-500/60 hover:bg-rose-500/10",
                        !clear && !active && !isBottleneck &&
                          "border-amber-500/25 bg-amber-500/5 hover:border-amber-500/50 hover:bg-amber-500/10",
                        active && isBottleneck && "border-rose-500/70 bg-rose-500/15",
                        active && !isBottleneck && "border-amber-500/70 bg-amber-500/15",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-x-0 top-0 h-0.5",
                          clear ? "bg-emerald-500/40" : isBottleneck ? "bg-rose-500" : "bg-amber-500",
                        )}
                      />
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          Rung {rung.n}
                        </span>
                        {isBottleneck && (
                          <Flame className="h-3 w-3 shrink-0 text-rose-600 dark:text-rose-400" />
                        )}
                        {clear && (
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                      </div>
                      <div
                        className={cn(
                          "mt-1 text-2xl font-bold leading-none tabular-nums",
                          clear
                            ? "text-muted-foreground"
                            : isBottleneck
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {count}
                      </div>
                      <div
                        className={cn(
                          "mt-1 text-[11px] font-medium leading-tight",
                          clear ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {rung.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </GlassCard>

          {/* ------------------------------------------------------------ */}
          {/* The one-click bottleneck. Rung 2 already has a fix surface.    */}
          {/* ------------------------------------------------------------ */}
          {contractingProfileCount > 0 && (
            <div className="rounded-lg border border-rose-500/35 bg-rose-500/5 p-3 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {contractingProfileCount === 1
                        ? "1 agent needs contracting profile data"
                        : `${contractingProfileCount} agents need contracting profile data`}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      A manager has to send it. Contracting, appointments, and first deals all sit
                      behind this one step.
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" className="h-10 w-full sm:h-9 sm:w-auto">
                  <Link to={CONTRACTING_FIX_ROUTE}>
                    Send invites <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------ */}
          {/* The list — most stuck, longest waiting, first.                */}
          {/* ------------------------------------------------------------ */}
          <GlassCard className="p-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Agents on the ladder</span>
              </h3>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Fewest rungs cleared first, then longest wait — the top row is the oldest block in the
              business.
            </p>

            {/* Filters — manager + rung, nothing else. */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select value={managerFilter} onValueChange={setManagerFilter}>
                <SelectTrigger className="h-10 w-full bg-muted/30 sm:h-9 sm:w-[210px]">
                  <SelectValue placeholder="All managers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All managers</SelectItem>
                  {managers.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {rungFilter !== null && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 sm:h-9"
                  onClick={() => setRungFilter(null)}
                >
                  Rung {rungFilter} only
                  <span aria-hidden className="ml-1.5 text-muted-foreground">
                    ×
                  </span>
                </Button>
              )}

              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                {filtered ? `${visible.length} of ${rows.length}` : `${summary.stuck} climbing`}
                {summary.launched > 0 && !filtered && ` · ${summary.launched} launched`}
              </span>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon={<Users className="h-7 w-7" />}
                variant={rows.length === 0 ? "success" : "default"}
                title={rows.length === 0 ? "Every agent has cleared all eight rungs" : "No agent sits here"}
                description={
                  rows.length === 0
                    ? "Nobody is parked mid-onboarding. New hires will appear the moment they are added."
                    : "That rung and manager combination is clear. Widen the filter to see who is still climbing."
                }
                actions={
                  rows.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 sm:h-9"
                      onClick={() => {
                        setRungFilter(null);
                        setManagerFilter("all");
                      }}
                    >
                      Show every agent
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
              <ul className="space-y-2">
                {visible.slice(0, visibleCount).map((row) => {
                  const rung = stuckRung(row);
                  const days = daysStalled(row);
                  return (
                    <li
                      key={row.agent_id}
                      className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5 transition-colors hover:border-border hover:bg-card"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <AgentNameLink
                            agentId={row.agent_id}
                            className="min-w-0 text-sm font-medium text-foreground"
                          >
                            <span className="min-w-0 truncate">{row.agent_name || "Unnamed agent"}</span>
                          </AgentNameLink>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {row.manager || "No manager assigned"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={cn("text-sm font-bold tabular-nums", daysTone(days))}>
                            {days}d
                          </div>
                          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            waiting
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <div
                          className="flex shrink-0 items-center gap-1"
                          role="img"
                          aria-label={`${row.rungs_complete ?? 0} of 8 rungs cleared`}
                        >
                          {RUNGS.map((r) => {
                            const done = row[r.field] === true;
                            const isNext = !done && r.n === rung;
                            return (
                              <span
                                key={r.n}
                                className={cn(
                                  "h-2 w-2 rounded-full",
                                  done && "bg-emerald-500",
                                  isNext && "bg-amber-500",
                                  !done && !isNext && "bg-muted-foreground/25",
                                )}
                              />
                            );
                          })}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          {row.next_missing_step ?? "All eight rungs cleared"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {visible.length > visibleCount && (
                <div className="flex flex-wrap items-center justify-center gap-3 py-4 text-sm">
                  <span className="text-muted-foreground">Showing {visibleCount.toLocaleString()} of {visible.length.toLocaleString()}</span>
                  <button type="button" onClick={() => setVisibleCount((n) => n + 200)} className="rounded-md border border-border bg-muted/40 px-4 py-1.5 font-medium text-foreground transition hover:bg-muted">Show more ({(visible.length - visibleCount).toLocaleString()} hidden)</button>
                  <button type="button" onClick={() => setVisibleCount(visible.length)} className="rounded-md px-3 py-1.5 font-medium text-primary transition hover:underline">Show all</button>
                </div>
              )}
              </>
            )}
          </GlassCard>
        </>
      )}

      {/* Cleared the ladder, then stopped.
          These two are not rungs — they are agents who finished onboarding and
          went quiet. The ladder cannot express them (every rung is green), so
          without this they were invisible on every surface. */}
      {attention.isError && (
        <div className="rounded-lg border border-amber-500/35 bg-amber-500/5 p-3 sm:p-4">
          <div className="flex min-w-0 items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
              Could not load the attention queues — these agents are missing from
              this view, not absent from the business.
            </p>
          </div>
        </div>
      )}

      {!attention.isError && (attention.data?.length ?? 0) > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(["licensed_inactive", "no_first_sale"] as const).map((kind) => {
            const list = (attention.data ?? []).filter((r) => r.kind === kind);
            if (list.length === 0) return null;
            const title =
              kind === "licensed_inactive"
                ? "Licensed, then went inactive"
                : "Active, never made a first sale";
            const why =
              kind === "licensed_inactive"
                ? "Licensed agents flagged inactive. This is the retention leak."
                : "Fully active agents with no first deal on record.";
            const Icon = kind === "licensed_inactive" ? UserMinus : Target;
            return (
              <GlassCard key={kind} className="p-4">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{title}</span>
                  </h3>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-muted-foreground">
                    {list.length}
                  </span>
                </div>
                <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{why}</p>
                <ul className="max-h-72 space-y-2 overflow-y-auto">
                  {list.map((r) => {
                    const stuck = Math.round(Number(r.days_stuck ?? 0));
                    return (
                      <li
                        key={r.agent_id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2 transition-colors hover:border-border hover:bg-card"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {r.agent ?? "(unnamed agent)"}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {r.owner ?? "unassigned"}
                          </div>
                        </div>
                        <div
                          className={cn(
                            "shrink-0 text-sm font-bold tabular-nums",
                            daysTone(stuck),
                          )}
                        >
                          {stuck}d
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
