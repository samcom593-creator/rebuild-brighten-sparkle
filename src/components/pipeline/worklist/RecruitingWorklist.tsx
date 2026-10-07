import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Columns3, List, RefreshCw, Search } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  QUEUE_DEFINITIONS,
  computeQueueCounts,
  fullName,
  inQueue,
  isQueueKey,
  PERSON_PARAM_ALIASES,
  personFromParams,
  queueFromLegacyParams,
  sortForQueue,
  type QueueKey,
  type WorklistRow,
} from "@/lib/recruitingQueues";
import { loadNumber, saveNumber, scrollKey } from "@/lib/worklistDraftStore";
import { cn } from "@/lib/utils";
import { PersonPanel } from "./PersonPanel";
import { WorklistBoard, WorklistTable } from "./WorklistViews";
import {
  useRecruitingStaff,
  useRecruitingStages,
  useRecruitingWorklist,
  type StageDefinition,
} from "./useRecruitingWorklist";

const WIDE_QUERY = "(min-width: 1024px)";

function useIsWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia?.(WIDE_QUERY).matches === true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return wide;
}

/** Search across the fields a recruiter actually types: name, email, phone digits. */
function matchesSearch(row: WorklistRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.toLowerCase();
  if (name.includes(needle)) return true;
  if ((row.email ?? "").toLowerCase().includes(needle)) return true;
  if (digits.length >= 3 && (row.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
  return false;
}

/**
 * The recruiting contact workspace: saved queues -> person -> contact -> outcome ->
 * next action -> next person. The worklist is the default; the board is the same
 * rows, filters and stage definitions grouped by stage.
 */
export function RecruitingWorklist() {
  const { user, isAdmin, isManager, isVa, isVaManager, isRecruiter } = useAuth();
  const userId = user?.id ?? null;
  const [params, setParams] = useSearchParams();
  const isWide = useIsWide();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const orgWide = isAdmin || isVa || isVaManager || isRecruiter;
  const canAssign = orgWide || isManager;

  const worklist = useRecruitingWorklist(Boolean(userId));
  const staffQuery = useRecruitingStaff(Boolean(userId) && canAssign);
  const stagesQuery = useRecruitingStages();

  // Clock for Due/Overdue membership; a minute of drift is fine, a frozen page is not.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const rows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const backendReady = worklist.data?.backendReady ?? true;
  const staff = staffQuery.data?.staff ?? [];
  const staffAvailable = staffQuery.data?.available ?? false;
  const stages: StageDefinition[] = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const stagesByKey = useMemo(() => new Map(stages.map((s) => [s.stage_key, s])), [stages]);

  const ctx = useMemo(() => ({ now: new Date(now), userId }), [now, userId]);
  const counts = useMemo(() => computeQueueCounts(rows, ctx), [rows, ctx]);

  const queueParam = params.get("queue");
  const legacyQueue = queueFromLegacyParams(params);
  const queue: QueueKey = isQueueKey(queueParam)
    ? queueParam
    : legacyQueue ?? (counts.mine > 0 ? "mine" : "likely");
  const view = params.get("view") === "board" ? "board" : "list";
  const search = params.get("q") ?? "";
  const license = params.get("license") ?? "all";
  // Other pages open a person with ?id=, ?lead= or ?focus= (all application ids).
  const selectedId = personFromParams(params);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      }, { replace: true });
    },
    [setParams],
  );

  // Rewrite an aliased deep link to ?person= once, so later selection changes (and
  // clearing the selection after the last save) are not overridden by the alias.
  // A link that names a person but no queue opens All open, so the person is in
  // the list beside the panel rather than hidden behind My queue.
  useEffect(() => {
    if (params.get("person")) return;
    const alias = PERSON_PARAM_ALIASES.find((k) => params.get(k));
    if (!alias) return;
    const patch: Record<string, string | null> = { person: params.get(alias) };
    for (const k of PERSON_PARAM_ALIASES) patch[k] = null;
    if (!isQueueKey(queueParam) && !legacyQueue) patch.queue = "all_open";
    setParam(patch);
  }, [params, queueParam, legacyQueue, setParam]);

  const filtered = useMemo(() => {
    const list = rows.filter((r) =>
      inQueue(r, queue, ctx)
      && matchesSearch(r, search.trim())
      && (license === "all" || (r.license_status ?? "unknown") === license));
    return sortForQueue(list, queue);
  }, [rows, queue, ctx, search, license]);

  const selected = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [rows, selectedId],
  );

  // On wide screens, keep someone open: the first person in the queue.
  useEffect(() => {
    if (!isWide || selectedId || filtered.length === 0) return;
    setParam({ person: filtered[0].id });
  }, [isWide, selectedId, filtered, setParam]);

  // Restore the list's scroll position for this queue once rows exist.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!listRef.current || filtered.length === 0) return;
    const key = scrollKey(userId, `${queue}:${view}`);
    if (restoredFor.current === key) return;
    restoredFor.current = key;
    const top = loadNumber(key);
    if (top !== null) listRef.current.scrollTop = top;
  }, [filtered.length, queue, view, userId]);

  const onScroll = useCallback(() => {
    if (!listRef.current) return;
    saveNumber(scrollKey(userId, `${queue}:${view}`), listRef.current.scrollTop);
  }, [queue, view, userId]);

  const selectPerson = useCallback((id: string) => setParam({ person: id }), [setParam]);

  /** The person after `id` in the current queue order, captured before a save moves rows. */
  const nextAfter = useCallback(
    (id: string): string | null => {
      const idx = filtered.findIndex((r) => r.id === id);
      if (idx === -1) return filtered[0]?.id ?? null;
      return filtered[idx + 1]?.id ?? filtered[idx - 1]?.id ?? null;
    },
    [filtered],
  );

  const onSaved = useCallback(
    (advance: boolean, next: string | null) => {
      if (!advance) return;
      setParam({ person: next });
      if (next) {
        const el = listRef.current?.querySelector(`[data-row-id="${next}"]`);
        if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
      }
    },
    [setParam],
  );

  if (worklist.isLoading) return <PageSkeleton />;

  if (worklist.isError) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <p className="flex items-center gap-2 font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" /> The recruiting worklist could not load.
        </p>
        <p className="mt-1 text-muted-foreground">{(worklist.error as Error).message}</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={() => worklist.refetch()}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }

  const coverage = worklist.data?.coverage;
  const scopeLabel = orgWide
    ? "Organization-wide — every eligible application, licensed or not, any age"
    : isManager
      ? "Your team — applications attributed to you and the agents you manage"
      : "Applications attributed to you";
  const activeDef = QUEUE_DEFINITIONS.find((q) => q.key === queue);

  const panel = selected ? (
    <PersonPanel
      key={selected.id}
      row={selected}
      userId={userId}
      backendReady={backendReady}
      canAssign={canAssign}
      staff={staff}
      staffAvailable={staffAvailable}
      stagesByKey={stagesByKey}
      nextId={nextAfter(selected.id)}
      onSaved={onSaved}
    />
  ) : selectedId ? (
    <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
      <p>This person is not in your worklist. They may be a duplicate, a test record, or outside the people you can see.</p>
      <Link
        to={`/dashboard/recruiting?view=classic&id=${encodeURIComponent(selectedId)}`}
        className="inline-block text-primary underline-offset-2 hover:underline"
      >
        Look them up in the classic applicants view
      </Link>
    </div>
  ) : (
    <p className="p-6 text-center text-sm text-muted-foreground">
      {filtered.length === 0 ? "Nobody in this queue." : "Pick a person to start."}
    </p>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Recruiting · Worklist"
        title="Who to contact next"
        subtitle="Open a person, contact them, record what happened, set the next step, move on."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <Button
              size="sm"
              variant={view === "list" ? "secondary" : "ghost"}
              aria-pressed={view === "list"}
              onClick={() => setParam({ view: null })}
            >
              <List className="h-4 w-4" /> Worklist
            </Button>
            <Button
              size="sm"
              variant={view === "board" ? "secondary" : "ghost"}
              aria-pressed={view === "board"}
              onClick={() => setParam({ view: "board" })}
            >
              <Columns3 className="h-4 w-4" /> Board
            </Button>
          </div>
        }
      />

      {!backendReady && (
        <p role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Read-only: the workspace database update (owners, outcomes, waiting reasons) is not applied yet, so outcomes cannot be saved and
          every queue that depends on them shows people as unassigned and unplanned.
        </p>
      )}

      {/* Saved queues — counts are over every row loaded, not a page. */}
      <nav aria-label="Saved queues" className="flex flex-wrap gap-1.5">
        {QUEUE_DEFINITIONS.map((q) => (
          <button
            key={q.key}
            type="button"
            title={q.description}
            aria-pressed={queue === q.key}
            onClick={() => setParam({ queue: q.key, person: null })}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
              queue === q.key
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              q.key === "needs_plan" && counts.needs_plan > 0 && queue !== q.key && "text-destructive",
            )}
          >
            {q.label}
            <span className="tabular-nums">{counts[q.key].toLocaleString()}</span>
          </button>
        ))}
      </nav>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-semibold text-foreground">{activeDef?.scope === "personal" ? "Assigned to you" : scopeLabel}.</span>{" "}
          {activeDef?.description}. {rows.length.toLocaleString()} worklist records loaded
          {coverage && coverage.live !== null
            ? ` of ${coverage.live.toLocaleString()} live records you can see (${(coverage.duplicates ?? 0).toLocaleString()} marked duplicate, ${(coverage.nonApplication ?? 0).toLocaleString()} interview bookings or tests not shown).`
            : ". Coverage count unavailable."}
          {" "}“Today” is the Phoenix business day.
        </p>
        <Link to="/dashboard/recruiting?view=classic" className="shrink-0 text-primary underline-offset-2 hover:underline">
          Classic applicants view
        </Link>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setParam({ q: e.target.value })}
            placeholder="Search name, email or phone"
            className="pl-8"
            aria-label="Search the queue"
          />
        </div>
        <Select value={license} onValueChange={(v) => setParam({ license: v === "all" ? null : v })}>
          <SelectTrigger className="sm:w-48" aria-label="License status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any license status</SelectItem>
            <SelectItem value="unlicensed">Unlicensed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="licensed">Licensed (self-reported)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="max-h-[calc(100vh-18rem)] min-h-[320px] overflow-auto rounded-xl border border-border bg-card"
        >
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nobody in “{activeDef?.label}”{search || license !== "all" ? " with these filters" : ""}.
            </p>
          ) : view === "board" ? (
            <WorklistBoard
              rows={filtered}
              selectedId={selectedId}
              onSelect={selectPerson}
              staff={staff}
              staffAvailable={staffAvailable}
              stages={stages}
              now={now}
            />
          ) : (
            <WorklistTable
              rows={filtered}
              selectedId={selectedId}
              onSelect={selectPerson}
              staff={staff}
              staffAvailable={staffAvailable}
              stagesByKey={stagesByKey}
              now={now}
            />
          )}
        </div>

        {isWide ? (
          <aside aria-label="Selected person" className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border bg-card p-4">
            {panel}
          </aside>
        ) : (
          <Sheet open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) setParam({ person: null }); }}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
              <SheetHeader className="sr-only">
                <SheetTitle>{selected ? fullName(selected) : "Person"}</SheetTitle>
                <SheetDescription>Contact, record the outcome and set the next step.</SheetDescription>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        )}
      </div>
    </div>
  );
}

export default RecruitingWorklist;
