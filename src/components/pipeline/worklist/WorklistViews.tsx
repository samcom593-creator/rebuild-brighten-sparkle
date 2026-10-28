import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  blockersOf,
  fullName,
  outcomeLabel,
  planCheck,
  type WorklistRow,
} from "@/lib/recruitingQueues";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WORKLIST_COLUMNS,
  WORKLIST_TABLE_COLUMNS,
  hiddenColumnCount,
  tableMinWidth,
  toggleColumn,
  type WorklistColumnKey,
} from "@/lib/worklistColumns";
import { StatusPill } from "@/components/recruiting/StatusPill";
import type { StaffMember, StageDefinition } from "./useRecruitingWorklist";
import { formatAgo, formatNextAction, formatSince, formatWhen, humanizeKey, ownerName } from "./worklistFormat";
import { dueStatus, licenseWord, rowStatus, type StatusTone } from "./worklistStatus";

interface ViewProps {
  rows: WorklistRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  staff: StaffMember[];
  staffAvailable: boolean;
  stagesByKey: Map<string, StageDefinition>;
  now: number;
}

const TABLE_WINDOW = 200;

/** Text colour for a status in a table cell. The words carry the meaning; the colour only helps. */
const STATUS_TEXT: Record<StatusTone, string> = {
  danger: "font-semibold text-destructive",
  warning: "font-medium text-warning",
  primary: "font-medium text-primary",
  neutral: "text-foreground",
};

/** "Late · 2 days", "Today · 3:00 PM MST", "Nov 12": the same words as the status pill, exact time on hover. */
function DueCell({ row, now }: { row: WorklistRow; now: number }) {
  const status = dueStatus(row, now);
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn("whitespace-nowrap tabular-nums", STATUS_TEXT[status.tone])}
      title={formatWhen(row.next_action_due_at ?? row.next_review_at)}
    >
      {status.label}
    </span>
  );
}

function NextActionText({ row }: { row: WorklistRow }) {
  if (row.next_action) {
    const text = formatNextAction(row.next_action, Boolean(row.next_action_set_at));
    return <span title={text} className={row.next_action_set_at ? undefined : "text-muted-foreground"}>{text}</span>;
  }
  if (row.waiting_reason) return <span className="text-muted-foreground">Waiting: {row.waiting_reason}</span>;
  return <span className="text-muted-foreground">None</span>;
}

function stageLabel(row: WorklistRow, stagesByKey: Map<string, StageDefinition>): string {
  if (!row.next_step_stage_key) return "Not staged";
  return stagesByKey.get(row.next_step_stage_key)?.display_name ?? humanizeKey(row.next_step_stage_key);
}

/** "No answer · 4 days ago", "Yesterday", or "Never": the last recorded human contact, in words. */
function LastContact({ row, now }: { row: WorklistRow; now: number }) {
  if (row.last_contact_outcome) {
    const at = row.last_contact_outcome_at ?? row.last_contacted_at;
    return (
      <span title={formatWhen(at)}>
        {outcomeLabel(row.last_contact_outcome)} · {formatAgo(at, now)}
      </span>
    );
  }
  if (row.last_contacted_at) return <span title={formatWhen(row.last_contacted_at)}>{formatAgo(row.last_contacted_at, now)}</span>;
  return <span className="text-muted-foreground">Never</span>;
}

/** The one blocker worth a column, in words plus colour: "Phone bad" in red, "No phone" in grey. */
function BlockerWords({ row }: { row: WorklistRow }) {
  const blocker = blockersOf(row).find((b) => b.hard || b.key === "no_phone");
  if (!blocker) return <span className="text-muted-foreground">—</span>;
  return <span className={cn("font-medium", blocker.hard ? "text-destructive" : "text-muted-foreground")}>{blocker.label}</span>;
}

function ShowMore({ total, visible, onMore }: { total: number; visible: number; onMore: () => void }) {
  if (total <= visible) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <span>Showing {visible.toLocaleString()} of {total.toLocaleString()} in this queue</span>
      <Button variant="outline" className="h-11 px-4" onClick={onMore}>Show {Math.min(TABLE_WINDOW, total - visible)} more</Button>
    </div>
  );
}

/**
 * The full-width table (F28). `columns` is the viewer's choice from
 * WorklistColumnChooser; Name is always present, so a row never loses its
 * identity. Header and body both consult the same set, so they cannot drift.
 * The minimum width follows the columns shown: 980px with all ten, less as
 * columns are hidden, so hiding columns is how the table fits without panning.
 *
 * Grow review (2026-10-28): 14px cells and headers with 16px names, rows at least
 * 44px tall, and every date in words ("No answer · 4 days ago", "Late · 2 days")
 * rather than "4d ago", so the table reads like the list it sits beside.
 */
export function WorklistTable({
  rows, selectedId, onSelect, staff, staffAvailable, stagesByKey, now, columns = DEFAULT_WORKLIST_COLUMNS,
}: ViewProps & { columns?: readonly WorklistColumnKey[] }) {
  const [visible, setVisible] = useState(TABLE_WINDOW);
  const shown = rows.slice(0, visible);
  const show = new Set<WorklistColumnKey>(columns);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth: tableMinWidth(columns) }}>
        <thead className="sticky top-0 z-10 bg-card text-sm text-muted-foreground">
          <tr className="border-b border-border">
            {/* Each header carries its column's floor (the same floors that add up to the table's
                minimum width), so a 16px name or "Interview set" is not squeezed onto two lines
                while a wide neighbour takes the room. */}
            {WORKLIST_TABLE_COLUMNS.filter((col) => col.locked || show.has(col.key)).map((col) => (
              <th
                key={col.key}
                scope="col"
                style={{ minWidth: col.minWidth }}
                className={cn("py-3 font-semibold", col.key === "name" ? "px-3" : "px-2")}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const selected = row.id === selectedId;
            const needsPlan = !planCheck(row).ok;
            return (
              <tr
                key={row.id}
                tabIndex={0}
                aria-selected={selected}
                data-row-id={row.id}
                onClick={() => onSelect(row.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(row.id);
                  }
                }}
                className={cn(
                  "cursor-pointer border-b border-border/60 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60",
                  selected && "bg-primary/10 hover:bg-primary/10",
                )}
              >
                {/* py-3 around a 20px line keeps every row at least 44px tall, the same hit size as the toolbar controls. */}
                <td className="px-3 py-3">
                  <div className="text-base font-semibold leading-6 text-foreground">{fullName(row)}</div>
                  {needsPlan && <div className="text-sm text-muted-foreground">No next step</div>}
                </td>
                {show.has("phone") && (
                  <td className="whitespace-nowrap px-2 py-3 tabular-nums text-foreground">{row.phone ? formatPhoneDisplay(row.phone) : "—"}</td>
                )}
                {show.has("state") && <td className="px-2 py-3 text-foreground">{row.state ?? "—"}</td>}
                {show.has("license") && <td className="px-2 py-3 text-foreground">{humanizeKey(row.license_status)}</td>}
                {show.has("stage") && <td className="px-2 py-3 text-foreground">{stageLabel(row, stagesByKey)}</td>}
                {show.has("owner") && (
                  <td className="px-2 py-3 text-foreground">{ownerName(row.recruiting_owner_user_id, staff, staffAvailable)}</td>
                )}
                {show.has("last_contact") && (
                  <td className="whitespace-nowrap px-2 py-3 text-foreground"><LastContact row={row} now={now} /></td>
                )}
                {show.has("next_action") && (
                  <td className="max-w-[220px] truncate px-2 py-3 text-foreground"><NextActionText row={row} /></td>
                )}
                {show.has("due") && <td className="whitespace-nowrap px-2 py-3"><DueCell row={row} now={now} /></td>}
                {show.has("blocker") && <td className="px-2 py-3"><BlockerWords row={row} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <ShowMore total={rows.length} visible={visible} onMore={() => setVisible((v) => v + TABLE_WINDOW)} />
    </div>
  );
}

/**
 * Which Table columns show. One labelled checkbox per column; Name is locked so
 * a row never loses its identity. The choice is the viewer's and persists with
 * them (see src/lib/worklistColumns.ts), so the button says how many are hidden.
 * The button matches its neighbour, More, in height and face so the toolbar reads
 * as one row; each checkbox row is a 44px tap target through its label.
 */
export function WorklistColumnChooser({
  columns,
  onChange,
}: {
  columns: readonly WorklistColumnKey[];
  onChange: (next: WorklistColumnKey[]) => void;
}) {
  const show = new Set<WorklistColumnKey>(columns);
  const hidden = hiddenColumnCount(columns);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-12 shrink-0 border-border bg-card px-4 text-base">
          <Columns3 className="h-5 w-5" /> Columns{hidden > 0 ? ` (${hidden} hidden)` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-4">
        <fieldset>
          <legend className="mb-1 text-base font-semibold text-foreground">Table columns</legend>
          {WORKLIST_TABLE_COLUMNS.map((col) => {
            const id = `worklist-column-${col.key}`;
            return (
              <div key={col.key} className="flex min-h-11 items-center gap-3">
                <Checkbox
                  id={id}
                  className="h-5 w-5"
                  checked={show.has(col.key)}
                  disabled={col.locked}
                  onCheckedChange={(value) => onChange(toggleColumn(columns, col.key, value === true))}
                />
                <Label htmlFor={id} className="flex-1 cursor-pointer text-base font-normal leading-5 text-foreground">
                  {col.label}{col.locked ? " (always shown)" : ""}
                </Label>
              </div>
            );
          })}
        </fieldset>
        <Button variant="outline" className="mt-3 h-11 w-full" disabled={hidden === 0} onClick={() => onChange([...DEFAULT_WORKLIST_COLUMNS])}>
          Show all
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** "Next: Call back" in plain words, or nothing when no step is set. */
function nextLine(row: WorklistRow): string | null {
  if (row.next_action) return `Next: ${formatNextAction(row.next_action, Boolean(row.next_action_set_at))}`;
  if (row.waiting_reason) return `Waiting for: ${row.waiting_reason}`;
  return null;
}

/**
 * The queue list, redesigned for people who don't live in software (2026-10-28): the
 * name large, one line of plain facts (license, state, when they were last contacted),
 * the next step, and a status in words on the right ("Late · 2 days", "Today · 3:00 PM",
 * "New"). Stage, owner and the full dates live in the person panel and the Table view.
 * It wraps instead of scrolling sideways, so it fits beside the person panel from
 * 1024px and reads as cards on a phone. Same rows, order, selection and window as the
 * table, so switching views never changes who is next.
 */
export function WorklistQueueList({ rows, selectedId, onSelect, now }: ViewProps) {
  const [visible, setVisible] = useState(TABLE_WINDOW);
  const shown = rows.slice(0, visible);
  return (
    <div>
      <ul aria-label="Queue" className="divide-y divide-border/60">
        {shown.map((row) => {
          const selected = row.id === selectedId;
          const blocker = blockersOf(row).find((b) => b.hard || b.key === "no_phone");
          const status = rowStatus(row, now);
          const contacted = row.last_contact_outcome_at ?? row.last_contacted_at;
          const facts = [
            licenseWord(row.license_status),
            row.state,
            contacted ? `Last contact ${formatSince(contacted, now)}` : "Never contacted",
          ].filter(Boolean).join(" · ");
          const next = nextLine(row);
          return (
            <li key={row.id} data-row-id={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                aria-pressed={selected}
                className={cn(
                  "flex min-h-16 w-full items-start justify-between gap-4 border-l-[3px] border-l-transparent py-3.5 pl-[13px] pr-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  selected && "border-l-primary bg-primary/10 hover:bg-primary/10",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold leading-6 text-foreground">{fullName(row)}</span>
                  <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">{facts}</span>
                  {next && <span className="mt-0.5 block truncate text-sm leading-5 text-muted-foreground">{next}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                  <StatusPill status={status} />
                  {blocker && (
                    <span className={cn("text-[13px] font-medium", blocker.hard ? "text-destructive" : "text-muted-foreground")}>{blocker.label}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ShowMore total={rows.length} visible={visible} onMore={() => setVisible((v) => v + TABLE_WINDOW)} />
    </div>
  );
}

const BOARD_COLUMN_WINDOW = 40;
const NOT_STAGED = "__not_staged__";

/**
 * True while the lanes are wider than their scroller. Measured, not guessed, so the
 * "scroll sideways" cue appears exactly when a lane is off screen and never otherwise.
 * Re-measured when the lane count or the scroller's size changes; jsdom (no layout,
 * often no ResizeObserver) reads as not scrolling.
 */
function useScrollsSideways(ref: RefObject<HTMLDivElement>, laneCount: number): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, laneCount]);
  return scrolls;
}

/**
 * Same rows, filters and stage definitions as the table, grouped by recruiting stage.
 * Read-only. Lanes are plain columns (no box inside a box): each is at least 208px and
 * they share the width, so three fit beside the person panel at 1440px; past that the
 * lanes scroll sideways behind a one-line cue with 44px scroll buttons. Cards carry the
 * name at 16px, the owner at 14px, and the same status pill as the list.
 */
export function WorklistBoard({ rows, selectedId, onSelect, staff, staffAvailable, stages, now }: Omit<ViewProps, "stagesByKey"> & { stages: StageDefinition[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useMemo(() => {
    const known = new Set(stages.map((s) => s.stage_key));
    const groups = new Map<string, WorklistRow[]>();
    for (const row of rows) {
      const key = row.next_step_stage_key && known.has(row.next_step_stage_key) ? row.next_step_stage_key : NOT_STAGED;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const ordered = stages
      .filter((s) => (groups.get(s.stage_key)?.length ?? 0) > 0)
      .map((s) => ({ key: s.stage_key, label: s.display_name, rows: groups.get(s.stage_key) ?? [] }));
    const loose = groups.get(NOT_STAGED) ?? [];
    return loose.length > 0 ? [{ key: NOT_STAGED, label: "Not staged", rows: loose }, ...ordered] : ordered;
  }, [rows, stages]);
  const scrolls = useScrollsSideways(scroller, columns.length);

  if (columns.length === 0) {
    return <p className="p-6 text-center text-base text-muted-foreground">Nobody in this queue.</p>;
  }

  const page = (direction: -1 | 1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(208, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div>
      {scrolls && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <p className="text-sm text-muted-foreground">Scroll sideways to see all {columns.length} lists.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 w-11 p-0" aria-label="Scroll left" onClick={() => page(-1)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button variant="outline" className="h-11 w-11 p-0" aria-label="Scroll right" onClick={() => page(1)}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}
      <div ref={scroller} className="flex divide-x divide-border overflow-x-auto">
        {columns.map((col) => {
          const open = expanded[col.key] ?? false;
          const shown = open ? col.rows : col.rows.slice(0, BOARD_COLUMN_WINDOW);
          return (
            <section key={col.key} aria-label={col.label} className="flex min-w-52 flex-1 flex-col pb-2 pt-3">
              <header className="flex items-baseline justify-between gap-2 border-b border-border px-3 pb-2">
                <h3 className="truncate text-sm font-semibold text-foreground">{col.label}</h3>
                <span className="text-sm tabular-nums text-muted-foreground">{col.rows.length}</span>
              </header>
              <ul className="flex max-h-[60vh] flex-col divide-y divide-border/60 overflow-y-auto">
                {shown.map((row) => {
                  const selected = row.id === selectedId;
                  return (
                    <li key={row.id} data-row-id={row.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(row.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-16 w-full flex-col items-start gap-1 border-l-[3px] border-l-transparent py-3 pl-[9px] pr-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                          selected && "border-l-primary bg-primary/10 hover:bg-primary/10",
                        )}
                      >
                        <span className="block w-full truncate text-base font-semibold leading-6 text-foreground">{fullName(row)}</span>
                        <span className="block w-full truncate text-sm leading-5 text-muted-foreground">
                          {ownerName(row.recruiting_owner_user_id, staff, staffAvailable)}
                        </span>
                        <StatusPill status={rowStatus(row, now)} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {col.rows.length > BOARD_COLUMN_WINDOW && (
                <Button variant="ghost" className="mx-3 mt-1 h-11" onClick={() => setExpanded((p) => ({ ...p, [col.key]: !open }))}>
                  {open ? "Show fewer" : `Show all ${col.rows.length}`}
                </Button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
