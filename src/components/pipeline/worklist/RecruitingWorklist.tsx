import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChevronRight, Columns3, List, RefreshCw, Search, Table2 } from "lucide-react";

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
import { errorMessage } from "@/lib/queryState";
import { loadNumber, saveNumber, scrollKey } from "@/lib/worklistDraftStore";
import { cn } from "@/lib/utils";
import { loadColumns, saveColumns, type WorklistColumnKey } from "@/lib/worklistColumns";
import {
  assessCoverage,
  coverageFacts,
  coverageSummary,
  coverageWarning,
  panelPlacement,
  resolveWorklistLayout,
  worklistViewFromParam,
} from "@/lib/worklistLayout";
import { PersonPanel } from "./PersonPanel";
import { formatWhen } from "./worklistFormat";
import { WorklistBoard, WorklistColumnChooser, WorklistQueueList, WorklistTable } from "./WorklistViews";
import {
  useRecruitingStaff,
  useRecruitingStages,
  useRecruitingWorklist,
  type StageDefinition,
} from "./useRecruitingWorklist";

/**
 * Room for the list and the 400px person panel side by side, and the only width where
 * the 980px table fits. Same breakpoint as the lg: grid below. Under it every screen,
 * phone or tablet, gets the compact cards with the person in a sheet.
 */
const WIDE_QUERY = "(min-width: 1024px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
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
  const isWide = useMediaQuery(WIDE_QUERY);
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
  // The default is decided once, from the first load. Re-deciding on every render made the
  // page jump from "Likely to join" to a one-person "My queue" after Sam's first save
  // (saving makes him the owner, so counts.mine went 0 -> 1).
  const defaultQueue = useRef<QueueKey | null>(null);
  if (defaultQueue.current === null && rows.length > 0) defaultQueue.current = counts.mine > 0 ? "mine" : "likely";
  const queue: QueueKey = isQueueKey(queueParam)
    ? queueParam
    : legacyQueue ?? defaultQueue.current ?? "likely";
  const view = worklistViewFromParam(params.get("view"));
  // F28: the compact list beside the panel is the default; the 980px table is its own
  // full-width view and only resolves where it fits.
  const layout = resolveWorklistLayout({ view, isWide });
  const panelInline = panelPlacement(layout, isWide) === "inline";
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

  // When the panel sits beside the list, keep someone open: the first person in the
  // queue. A sheet is never opened by the page itself, only by a tap.
  useEffect(() => {
    if (!panelInline || selectedId || filtered.length === 0) return;
    setParam({ person: filtered[0].id });
  }, [panelInline, selectedId, filtered, setParam]);

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

  // F28: which Table columns show, a per-viewer preference. Storage is read once per
  // viewer; a change lives in state and is written through, so a blocked storage still
  // honours the choice for this visit.
  const storedColumns = useMemo(() => loadColumns(userId), [userId]);
  const [columnChoice, setColumnChoice] = useState<{ userId: string | null; keys: WorklistColumnKey[] } | null>(null);
  const tableColumns = columnChoice !== null && columnChoice.userId === userId ? columnChoice.keys : storedColumns;
  const setTableColumns = useCallback(
    (keys: WorklistColumnKey[]) => {
      setColumnChoice({ userId, keys });
      saveColumns(userId, keys);
    },
    [userId],
  );

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

  // Only a load that never produced rows replaces the page. A refetch that fails keeps
  // the last good rows on screen (TanStack keeps data on a failed refetch) behind a
  // stale notice below, so Reload and Retry cannot wipe the queue someone is working.
  if (worklist.isError && worklist.data === undefined) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm">
        <p className="flex items-center gap-2 font-semibold text-destructive">
          <AlertTriangle className="h-4 w-4" /> The recruiting worklist could not load.
        </p>
        <p className="mt-1 text-muted-foreground">{errorMessage(worklist.error)}</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={() => worklist.refetch()}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }

  const scopeLabel = orgWide
    ? "Organization-wide: every eligible application, licensed or not, any age"
    : isManager
      ? "Your team: applications attributed to you and the agents you manage"
      : "Applications attributed to you";
  const activeDef = QUEUE_DEFINITIONS.find((q) => q.key === queue);
  const scopeText = activeDef?.scope === "personal" ? "Assigned to you" : scopeLabel;
  const filtersOn = search.trim() !== "" || license !== "all";
  // The toggles read the resolved layout, not the URL: a phone opening ?view=table gets
  // the compact rows, and the Worklist toggle says so.
  const worklistOn = layout === "split" || layout === "stack";
  // F29: the loaded rows are compared with the eligible count on every render, so an
  // incomplete load is a visible warning, not a clause inside a paragraph.
  const coverage = assessCoverage(rows.length, worklist.data?.coverage);
  const warning = coverageWarning(coverage);

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
        title="Recruiting"
        subtitle="Contact applicants, save outcomes, and schedule the next step."
        viewControls={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <Button
              size="sm"
              variant={worklistOn ? "secondary" : "ghost"}
              aria-pressed={worklistOn}
              onClick={() => setParam({ view: null })}
            >
              <List className="h-4 w-4" /> Worklist
            </Button>
            {/* The table needs 1024px, so its toggle exists only where it can render. It is a
                full-width view with the person in a sheet, so the selection is cleared on the
                way in; otherwise the sheet would open over the table on the first render. */}
            {isWide && (
              <Button
                size="sm"
                variant={layout === "table" ? "secondary" : "ghost"}
                aria-pressed={layout === "table"}
                onClick={() => setParam({ view: "table", person: null })}
              >
                <Table2 className="h-4 w-4" /> Table
              </Button>
            )}
            <Button
              size="sm"
              variant={layout === "board" ? "secondary" : "ghost"}
              aria-pressed={layout === "board"}
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

      {worklist.isError && worklist.data !== undefined && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Showing records loaded {formatWhen(worklist.data.loadedAt)}. The latest reload failed: {errorMessage(worklist.error)}
          </p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void worklist.refetch()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      )}

      {/* Saved queues — counts are over every row loaded, not a page. */}
      <nav aria-label="Saved queues" className="flex gap-1.5 overflow-x-auto py-1 [scrollbar-width:thin]">
        {QUEUE_DEFINITIONS.map((q) => (
          <button
            key={q.key}
            type="button"
            title={q.description}
            aria-pressed={queue === q.key}
            onClick={() => setParam({ queue: q.key, person: null })}
            className={cn(
              "inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
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

      {/* One scope and count line. Provenance lives in the Data status disclosure below;
          an incomplete load is a warning of its own and is never folded into it. */}
      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0">
          <span className="font-semibold text-foreground">{scopeText}.</span>{" "}
          {activeDef?.label}: {filtered.length.toLocaleString()} {filtered.length === 1 ? "person" : "people"}
          {filtersOn ? " with these filters" : ""}.
        </p>
        <Link to="/dashboard/recruiting?view=classic" className="shrink-0 text-primary underline-offset-2 hover:underline">
          Classic applicants view
        </Link>
      </div>

      {warning && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {warning}
          </p>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void worklist.refetch()}>
            <RefreshCw className="h-4 w-4" /> Reload
          </Button>
        </div>
      )}

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
        {layout === "table" && <WorklistColumnChooser columns={tableColumns} onChange={setTableColumns} />}
      </div>

      {/* items-start: the list sizes to its rows. Stretched to the panel's height, a one-person
          queue drew a tall empty card beside the panel. */}
      <div className={cn("grid items-start gap-4", panelInline && "lg:grid-cols-[minmax(0,1fr)_400px]")}>
        <div
          ref={listRef}
          onScroll={onScroll}
          className="max-h-[calc(100vh-18rem)] overflow-auto rounded-xl border border-border bg-card"
        >
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nobody in “{activeDef?.label}”{search || license !== "all" ? " with these filters" : ""}.
            </p>
          ) : layout === "board" ? (
            <WorklistBoard
              rows={filtered}
              selectedId={selectedId}
              onSelect={selectPerson}
              staff={staff}
              staffAvailable={staffAvailable}
              stages={stages}
              now={now}
            />
          ) : layout === "table" ? (
            <WorklistTable
              rows={filtered}
              selectedId={selectedId}
              onSelect={selectPerson}
              staff={staff}
              staffAvailable={staffAvailable}
              stagesByKey={stagesByKey}
              now={now}
              columns={tableColumns}
            />
          ) : (
            <WorklistQueueList
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

        {panelInline ? (
          <aside aria-label="Selected person" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border bg-card p-4">
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
      <details className="group rounded-lg border border-border bg-card text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
          <span className="font-semibold text-foreground">Data status</span>
          <span>· {coverageSummary(coverage)}</span>
        </summary>
        <div className="space-y-2 border-t border-border px-3 py-2">
          <p>Queue rule: {activeDef?.description}.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {coverageFacts(rows.length, worklist.data?.coverage).map((fact) => (
              <Fragment key={fact.label}>
                <dt>{fact.label}</dt>
                <dd className="tabular-nums text-foreground">{fact.value}</dd>
              </Fragment>
            ))}
          </dl>
          <p>“Today” is the Phoenix business day. Loaded {formatWhen(worklist.data?.loadedAt)}.</p>
          {coverage.kind === "unknown" && (
            <Button size="sm" variant="outline" onClick={() => void worklist.refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry the counts
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}

export default RecruitingWorklist;
