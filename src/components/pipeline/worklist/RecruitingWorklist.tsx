import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Columns3, List, Phone, PhoneCall, PhoneMissed, RefreshCw, Search, SlidersHorizontal, Sparkles, Table2 } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FilterChip } from "@/components/recruiting/FilterChip";
import { GrowScoreboard } from "@/components/recruiting/GrowScoreboard";
import {
  PRIMARY_QUEUE_KEYS,
  QUEUE_DEFINITIONS,
  computeQueueCounts,
  computeScoreboard,
  defaultQueueFor,
  fullName,
  inQueue,
  isQueueKey,
  PERSON_PARAM_ALIASES,
  personFromParams,
  queueFromLegacyParams,
  queueOrderText,
  sortForQueue,
  TILE_QUEUE_KEYS,
  type QueueDefinition,
  type QueueKey,
  type WorklistRow,
} from "@/lib/recruitingQueues";
import { errorMessage } from "@/lib/queryState";
import { TONE_CLASS, type Tone } from "@/lib/tones";
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
import { UpNextCard } from "./UpNext";
import { formatWhen } from "./worklistFormat";
import { WorklistBoard, WorklistColumnChooser, WorklistQueueList, WorklistTable } from "./WorklistViews";
import { nextStepFor } from "./worklistNextStep";
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
 * What each of Today's numbers stands for, in the shared tones (src/lib/tones.ts, 2026-10-28):
 * people who need a call are "act now", new people are "new", calls made today are "going
 * well", a booked meeting is "scheduled". Written once, beside the tiles that read it, so the
 * colour and the icon can never say one thing while the label and the list say another.
 */
const TILE_LOOK: Record<"today" | "new" | "worked_today" | "booked", { tone: Tone; icon: ReactNode }> = {
  today: { tone: "hot", icon: <PhoneMissed /> },
  new: { tone: "cool", icon: <Sparkles /> },
  worked_today: { tone: "good", icon: <PhoneCall /> },
  booked: { tone: "cool", icon: <CalendarCheck /> },
};

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
  const [moreListsOpen, setMoreListsOpen] = useState(false);

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
  // (saving makes him the owner, so counts.mine went 0 -> 1). Mine opens first only when one
  // of the viewer's own people is due today or late (defaultQueueFor).
  const defaultQueue = useRef<QueueKey | null>(null);
  if (defaultQueue.current === null && rows.length > 0) defaultQueue.current = defaultQueueFor(rows, ctx);
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

  // A new person starts at the top of the panel and of the phone's sheet. After "Save & next
  // person" both kept the old scroll position and opened the next person below their name.
  const asideRef = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (asideRef.current) asideRef.current.scrollTop = 0;
    if (sheetRef.current) sheetRef.current.scrollTop = 0;
  }, [selectedId]);

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
        <Button className="mt-3 h-11" variant="outline" onClick={() => worklist.refetch()}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }

  const scopeLabel = orgWide ? "Organization-wide" : isManager ? "Your team" : "Your applicants";
  const scopeDetail = orgWide
    ? "Every eligible application, licensed or not, any age"
    : isManager
      ? "Applications attributed to you and the agents you manage"
      : "Applications attributed to you";
  const activeDef = QUEUE_DEFINITIONS.find((q) => q.key === queue);
  const scopeText = activeDef?.scope === "personal" ? "Assigned to you" : scopeLabel;
  const filtersOn = search.trim() !== "" || license !== "all";
  // The toggles read the resolved layout, not the URL: a phone opening ?view=table gets
  // the compact rows, and the List toggle says so.
  const worklistOn = layout === "split" || layout === "stack";
  const primaryQueues = QUEUE_DEFINITIONS.filter((q) => PRIMARY_QUEUE_KEYS.includes(q.key));
  // Each list has one entry point: the tile lists (Call today, New, Worked today, Booked) open
  // from Today's numbers and are not repeated here.
  const secondaryQueues = QUEUE_DEFINITIONS.filter((q) => !PRIMARY_QUEUE_KEYS.includes(q.key) && !TILE_QUEUE_KEYS.includes(q.key));
  const secondaryChosen = secondaryQueues.some((q) => q.key === queue);
  // The secondary lists stay open while one of them is chosen, so the selection is never hidden.
  const secondaryOpen = moreListsOpen || secondaryChosen;
  // A short tick when the list moves (tile, chip or the phone's picker), never on load and
  // never for a tap that changes nothing.
  const pickQueue = (key: QueueKey) => {
    if (key !== queue) playSoundEffect("tick");
    setParam({ queue: key, person: null });
  };
  const board = computeScoreboard(counts);
  const definitionOf = (key: QueueKey) => QUEUE_DEFINITIONS.find((q) => q.key === key)?.description;
  const licenseLabel = LICENSE_FILTERS.find((f) => f.value === license)?.label ?? license;
  // F29: the loaded rows are compared with the eligible count on every render, so an
  // incomplete load is a visible warning, not a clause inside a paragraph.
  const coverage = assessCoverage(rows.length, worklist.data?.coverage);
  const warning = coverageWarning(coverage);
  // Today's numbers are computed from the loaded rows, so they are only as true as the load.
  // They show once the rows reconcile with the eligible count; a short load, a disagreement
  // or a failed count shows a dash and says why, never a number that looks complete.
  const verified = coverage.kind === "complete";
  const score = (value: number): number | null => (verified ? value : null);

  const nextId = selected ? nextAfter(selected.id) : null;
  const nextRow = nextId ? filtered.find((r) => r.id === nextId) ?? null : null;
  // Where the open person sits in the list, and who Skip moves to: the next person in the same
  // order, recording nothing. The last person has nobody to skip to.
  const selectedIndex = selected ? filtered.findIndex((r) => r.id === selected.id) : -1;
  const skipTo = selectedIndex >= 0 ? filtered[selectedIndex + 1]?.id ?? null : null;
  const position = selectedIndex >= 0 && activeDef
    ? { index: selectedIndex, total: filtered.length, label: activeDef.label }
    : null;
  const skip = () => { if (skipTo) onSaved(true, skipTo); };
  // The first person in the open list, by that list's own order: who the page says to call now.
  // Not offered on the Worked today log, which lists calls already made.
  const upNext = !panelInline && queue !== "worked_today" ? filtered[0] ?? null : null;
  const upNextStep = upNext ? nextStepFor(upNext, now) : null;
  const allOpenCount = counts.all_open;

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
      nextId={nextId}
      nextName={nextRow ? fullName(nextRow) : null}
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
    <div className="space-y-5">
      {/* No header button: the one gold button is the Call on the Up next card (phones and tablets)
          or in the person panel beside the list (desktop). */}
      <PageHeader
        title="Call list"
        subtitle="Call people, record what happened, set the next step."
        icon={<Phone />}
        tone="gold"
        primaryAction={null}
      />

      {!backendReady && (
        <p role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Read-only: the workspace database update (owners, outcomes, waiting reasons) is not applied yet, so outcomes cannot be saved and
          every queue that depends on them shows people as unassigned and unplanned.
        </p>
      )}

      {worklist.isError && worklist.data !== undefined && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Showing records loaded {formatWhen(worklist.data.loadedAt)}. The latest reload failed: {errorMessage(worklist.error)}
          </p>
          <Button variant="outline" className="h-11 shrink-0" onClick={() => void worklist.refetch()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </div>
      )}

      {warning && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {warning}
          </p>
          <Button variant="outline" className="h-11 shrink-0" onClick={() => void worklist.refetch()}>
            <RefreshCw className="h-4 w-4" /> Reload
          </Button>
        </div>
      )}

      {/* Up next: who to call now and what to do, first on a phone or tablet. Keyed by person so a
          new person rises in after a save. */}
      {upNext && upNextStep && <UpNextCard key={upNext.id} row={upNext} step={upNextStep} now={now} onOpen={selectPerson} />}

      {/* The numbers that matter, over every loaded row (same rules as the lists), shown only once the load is verified complete. */}
      <GrowScoreboard
        label="Today's numbers"
        notice={verified ? null : (
          <>
            <span>
              {coverage.kind === "unknown"
                ? "Today's numbers are hidden because the record counts could not be checked."
                : "Today's numbers are hidden until every eligible record is loaded."}
            </span>
            <Button variant="outline" className="h-11 shrink-0" onClick={() => void worklist.refetch()}>
              <RefreshCw className="h-4 w-4" /> Reload
            </Button>
          </>
        )}
        tiles={[
          // Hints are measured to two lines on a 390px phone (about ten characters a line); the full
          // rule is the tile's title and the "List rule" line under Data status.
          { label: "Call today", value: score(board.callToday), hint: "Due today or late", definition: definitionOf("today"), onSelect: () => pickQueue("today"), active: queue === "today", emphasis: true, ...TILE_LOOK.today },
          { label: "New", value: score(board.newThisWeek), hint: "Not yet worked", definition: definitionOf("new"), onSelect: () => pickQueue("new"), active: queue === "new", ...TILE_LOOK.new },
          { label: "Worked today", value: score(board.workedToday), hint: "Outcome saved", definition: definitionOf("worked_today"), onSelect: () => pickQueue("worked_today"), active: queue === "worked_today", ...TILE_LOOK.worked_today },
          { label: "Booked", value: score(board.booked), hint: "Meeting booked", definition: definitionOf("booked"), onSelect: () => pickQueue("booked"), active: queue === "booked", ...TILE_LOOK.booked },
        ]}
      />

      {/* Which list, and find someone: one toolbar. From 1280px the search sits on the lists' row. */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        {/* Lists — counts are over every row loaded, not a page. Two big ones (the tiles above open
            four more); the rest one tap away. */}
        <nav aria-label="Saved queues" className="min-w-0 xl:flex-1">
          {isWide ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {primaryQueues.map((q) => (
                  <QueueButton key={q.key} def={q} count={counts[q.key]} active={queue === q.key} onPick={pickQueue} />
                ))}
                <button
                  type="button"
                  aria-expanded={secondaryOpen}
                  // While one of these lists is chosen they stay open, so the choice is never hidden.
                  disabled={secondaryChosen}
                  title={secondaryChosen ? "Pick another list to fold these away" : undefined}
                  onClick={() => setMoreListsOpen((open) => !open)}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)] disabled:cursor-default disabled:hover:bg-transparent",
                    secondaryOpen && "text-foreground",
                  )}
                >
                  More lists
                  <ChevronDown aria-hidden="true" className={cn("h-4 w-4 transition-transform", secondaryOpen && "rotate-180")} />
                </button>
              </div>
              {secondaryOpen && (
                <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/20 p-2">
                  {secondaryQueues.map((q) => (
                    <QueueButton key={q.key} def={q} count={counts[q.key]} active={queue === q.key} onPick={pickQueue} compact />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <label className="block">
              <span className="sr-only">Which list</span>
              <select
                value={queue}
                onChange={(e) => pickQueue(e.target.value as QueueKey)}
                aria-label="Which list"
                className="h-12 w-full rounded-lg border border-border bg-card px-3 text-base font-medium text-foreground focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
              >
                {QUEUE_DEFINITIONS.map((q) => (
                  <option key={q.key} value={q.key}>{q.label} ({counts[q.key].toLocaleString()})</option>
                ))}
              </select>
            </label>
          )}
        </nav>

        <div className={cn("flex gap-2 xl:shrink-0", layout === "table" ? "xl:w-[36rem]" : "xl:w-[28rem]")}>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setParam({ q: e.target.value })}
              placeholder="Search name or phone"
              className="h-12 border-border bg-card pl-11 text-base"
              aria-label="Search the queue"
            />
          </div>
          {layout === "table" && <WorklistColumnChooser columns={tableColumns} onChange={setTableColumns} />}
          {/* Same name as the Pipeline and New hires pages: "Filters" holds the view and the license filter. */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-12 shrink-0 border-border bg-card px-4 text-base" aria-label="Filters">
                <SlidersHorizontal className="h-5 w-5" /> Filters
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-5 p-4">
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-foreground">Show as</legend>
                <div className="flex flex-wrap gap-1.5">
                  <Button className="h-11 px-3" variant={worklistOn ? "secondary" : "ghost"} aria-pressed={worklistOn} onClick={() => setParam({ view: null })}>
                    <List className="h-4 w-4" /> List
                  </Button>
                  {/* The table needs 1024px, so its toggle exists only where it can render. It is a
                      full-width view with the person in a sheet, so the selection is cleared on the
                      way in; otherwise the sheet would open over the table on the first render. */}
                  {isWide && (
                    <Button className="h-11 px-3" variant={layout === "table" ? "secondary" : "ghost"} aria-pressed={layout === "table"} onClick={() => setParam({ view: "table", person: null })}>
                      <Table2 className="h-4 w-4" /> Table
                    </Button>
                  )}
                  <Button className="h-11 px-3" variant={layout === "board" ? "secondary" : "ghost"} aria-pressed={layout === "board"} onClick={() => setParam({ view: "board" })}>
                    <Columns3 className="h-4 w-4" /> Board
                  </Button>
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-foreground">License</legend>
                <div className="flex flex-wrap gap-1.5">
                  {LICENSE_FILTERS.map((f) => (
                    <Button
                      key={f.value}
                      className="h-11 px-3"
                      variant={license === f.value ? "secondary" : "ghost"}
                      aria-pressed={license === f.value}
                      onClick={() => setParam({ license: f.value === "all" ? null : f.value })}
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <Link to="/dashboard/recruiting?view=classic" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-2 hover:underline">
                Classic applicants view
              </Link>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* items-start: the list sizes to its rows. Stretched to the panel's height, a one-person
          queue drew a tall empty card beside the panel. */}
      <div className={cn("grid items-start gap-5", panelInline && "lg:grid-cols-[minmax(0,1fr)_440px]")}>
        {/* The list says what it is at its top: its name and size, whose records, and its rule in
            one plain sentence, so nobody has to hover a button to learn what "Best leads" means.
            Active filters show as removable chips on the same card. */}
        <section aria-labelledby="call-list-count" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <header className="border-b border-border px-4 py-3">
            <p id="call-list-count" className="text-base font-semibold leading-6 text-foreground">
              {activeDef?.label}: {filtered.length.toLocaleString()} {filtered.length === 1 ? "person" : "people"}
              {filtersOn ? " with these filters" : ""}.
            </p>
            <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
              <span className="font-medium text-foreground" title={activeDef?.scope === "personal" ? undefined : scopeDetail}>{scopeText}</span>
              {activeDef && activeDef.scope !== "personal" && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>{activeDef.hint}</span>
                </>
              )}
            </p>
            {(license !== "all" || layout === "board" || layout === "table") && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {license !== "all" && (
                  <FilterChip label={`License: ${licenseLabel}`} onRemove={() => setParam({ license: null })} />
                )}
                {layout === "board" && <FilterChip label="Board view" onRemove={() => setParam({ view: null })} />}
                {layout === "table" && <FilterChip label="Table view" onRemove={() => setParam({ view: null })} />}
              </div>
            )}
          </header>
          <div
            ref={listRef}
            onScroll={onScroll}
            className="max-h-[calc(100vh-14rem)] supports-[height:100dvh]:max-h-[calc(100dvh-14rem)] overflow-auto overscroll-contain"
          >
            {filtered.length === 0 ? (
              <div className="space-y-3 p-8 text-center">
                <p className="text-base text-muted-foreground">
                  Nobody in “{activeDef?.label}”{filtersOn ? " with these filters" : ""}.
                </p>
                {/* An empty list teaches where the people are: the whole open list, with its count, one tap away. */}
                {!filtersOn && queue !== "all_open" && allOpenCount > 0 && (
                  <Button variant="outline" className="h-11 border-border bg-background" onClick={() => pickQueue("all_open")}>
                    See everyone ({allOpenCount.toLocaleString()})
                  </Button>
                )}
              </div>
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
        </section>

        {panelInline ? (
          // No bottom padding: the panel's sticky save row sits flush with the container's edge
          // (the panel pads its own bottom).
          <aside ref={asideRef} aria-label="Selected person" className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-card px-5 pt-3">
            {position && (
              <div className="-mr-2 mb-3 flex items-center justify-between gap-3">
                <PositionText {...position} />
                <SkipButton disabled={!skipTo} onSkip={skip} />
              </div>
            )}
            <div className={cn(!position && "pt-2")}>{panel}</div>
          </aside>
        ) : (
          <Sheet open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) setParam({ person: null }); }}>
            {/* bg-card and px-5 match the inline panel, so the buttons inside read the same on both
                surfaces and the sticky save row (which bleeds into the side padding) lines up. No
                bottom padding, for the same reason as the aside. */}
            {/* apex-page-slot: the sheet is portalled outside the page slot, so without it the 13px
                and 15px operating type (src/styles/delight.css) would not reach the person panel. */}
            <SheetContent ref={sheetRef} side="right" className="apex-page-slot w-full overflow-y-auto overscroll-contain bg-card px-5 pt-5 pb-0 sm:max-w-lg">
              <SheetHeader className="sr-only">
                <SheetTitle>{selected ? fullName(selected) : "Person"}</SheetTitle>
                <SheetDescription>Contact, record the outcome and set the next step.</SheetDescription>
              </SheetHeader>
              {/* The sheet fills a phone screen, so the way back is a real button with words, not only the
                  corner X. Skip sits on the same row, clear of the X (pr-10). */}
              <div className="-ml-2 mb-4 flex items-center gap-2 pr-10">
                <Button type="button" variant="ghost" className="h-11 shrink-0 px-2 text-base" onClick={() => setParam({ person: null })}>
                  <ChevronLeft className="h-5 w-5" /> Back to list
                </Button>
                {position && (
                  <>
                    <span className="ml-auto min-w-0 truncate text-sm tabular-nums text-muted-foreground">
                      {(position.index + 1).toLocaleString()} of {position.total.toLocaleString()}
                    </span>
                    <SkipButton disabled={!skipTo} onSkip={skip} />
                  </>
                )}
              </div>
              {panel}
            </SheetContent>
          </Sheet>
        )}
      </div>
      <details className="group rounded-lg border border-border bg-card text-sm text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
          {/* One sentence that wraps as text: as two flex items, a phone squeezed "Data status" onto two lines. */}
          <span className="min-w-0">
            <span className="font-semibold text-foreground">Data status</span>
            <span> · {coverageSummary(coverage)}</span>
          </span>
        </summary>
        <div className="space-y-2 border-t border-border px-3 py-2">
          <p>Who is counted: {scopeDetail}.</p>
          <p>List rule: {activeDef?.description}.</p>
          <p>Order: {queueOrderText(queue)}</p>
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
            <Button variant="outline" className="h-11" onClick={() => void worklist.refetch()}>
              <RefreshCw className="h-4 w-4" /> Retry the counts
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}

/** "Up next · 1 of 19 in Best leads", or "4 of 19 in Best leads" once the caller has moved on. */
function PositionText({ index, total, label }: { index: number; total: number; label: string }) {
  return (
    <p className="min-w-0 truncate text-sm text-muted-foreground">
      {index === 0 && <span className="font-semibold text-foreground">Up next · </span>}
      <span className="tabular-nums">{(index + 1).toLocaleString()} of {total.toLocaleString()}</span> in {label}
    </p>
  );
}

/** Moves to the next person in the list without recording anything. */
function SkipButton({ disabled, onSkip }: { disabled: boolean; onSkip: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-11 shrink-0 px-3 text-base"
      disabled={disabled}
      title={disabled ? "This is the last person in the list" : "Go to the next person without saving anything"}
      onClick={onSkip}
    >
      Skip <ChevronRight className="h-5 w-5" />
    </Button>
  );
}

const LICENSE_FILTERS = [
  { value: "all", label: "Any" },
  { value: "unlicensed", label: "Unlicensed" },
  { value: "pending", label: "Pending" },
  { value: "licensed", label: "Licensed (self-reported)" },
] as const;

/**
 * One list button: the name and its count, 44px tall so it can be hit without aiming. The
 * chosen list wears the gold tint (the one brand moment on this row); its words and count
 * are unchanged and aria-pressed still says which one is open.
 */
function QueueButton({ def, count, active, onPick, compact }: {
  def: QueueDefinition;
  count: number;
  active: boolean;
  onPick: (key: QueueKey) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={def.description}
      aria-pressed={active}
      onClick={() => onPick(def.key)}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
        compact ? "px-3.5 text-sm" : "px-4 text-base",
        active
          ? cn(TONE_CLASS.gold.soft, TONE_CLASS.gold.text, TONE_CLASS.gold.border)
          : "border-border bg-card text-foreground hover:bg-muted/50",
      )}
    >
      {def.label}
      <span className={cn("tabular-nums", !active && "text-muted-foreground")}>{count.toLocaleString()}</span>
    </button>
  );
}

export default RecruitingWorklist;
