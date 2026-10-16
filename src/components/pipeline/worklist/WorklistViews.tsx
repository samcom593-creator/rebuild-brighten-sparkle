import { useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  blockersOf,
  effectiveDueMs,
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
import type { StaffMember, StageDefinition } from "./useRecruitingWorklist";
import { formatNextAction, formatRelative, formatWhen, humanizeKey, ownerName } from "./worklistFormat";

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

function DueCell({ row, now }: { row: WorklistRow; now: number }) {
  const due = effectiveDueMs(row);
  const iso = row.next_action_due_at ?? row.next_review_at;
  if (due === null) return <span className="text-muted-foreground">—</span>;
  if (Number.isNaN(due)) return <span className="text-destructive">Unreadable</span>;
  return (
    <span className={cn("tabular-nums", due < now ? "font-semibold text-destructive" : "text-foreground")} title={formatWhen(iso)}>
      {formatRelative(iso, now)}
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

function LastContact({ row, now }: { row: WorklistRow; now: number }) {
  if (row.last_contact_outcome) {
    return (
      <span title={formatWhen(row.last_contact_outcome_at)}>
        {outcomeLabel(row.last_contact_outcome)} · {formatRelative(row.last_contact_outcome_at, now)}
      </span>
    );
  }
  if (row.last_contacted_at) return <span title={formatWhen(row.last_contacted_at)}>{formatRelative(row.last_contacted_at, now)}</span>;
  return <span className="text-muted-foreground">Never</span>;
}

function ShowMore({ total, visible, onMore }: { total: number; visible: number; onMore: () => void }) {
  if (total <= visible) return null;
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <span>Showing {visible.toLocaleString()} of {total.toLocaleString()} in this queue</span>
      <Button size="sm" variant="outline" onClick={onMore}>Show {Math.min(TABLE_WINDOW, total - visible)} more</Button>
    </div>
  );
}

/**
 * The full-width table (F28). `columns` is the viewer's choice from
 * WorklistColumnChooser; Name is always present, so a row never loses its
 * identity. Header and body both consult the same set, so they cannot drift.
 * The minimum width follows the columns shown: 980px with all ten, less as
 * columns are hidden, so hiding columns is how the table fits without panning.
 */
export function WorklistTable({
  rows, selectedId, onSelect, staff, staffAvailable, stagesByKey, now, columns = DEFAULT_WORKLIST_COLUMNS,
}: ViewProps & { columns?: readonly WorklistColumnKey[] }) {
  const [visible, setVisible] = useState(TABLE_WINDOW);
  const shown = rows.slice(0, visible);
  const show = new Set<WorklistColumnKey>(columns);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" style={{ minWidth: tableMinWidth(columns) }}>
        <thead className="sticky top-0 z-10 bg-card text-[12px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 font-semibold">Name</th>
            {show.has("phone") && <th scope="col" className="px-2 py-2 font-semibold">Phone</th>}
            {show.has("state") && <th scope="col" className="px-2 py-2 font-semibold">State</th>}
            {show.has("license") && <th scope="col" className="px-2 py-2 font-semibold">License</th>}
            {show.has("stage") && <th scope="col" className="px-2 py-2 font-semibold">Stage</th>}
            {show.has("owner") && <th scope="col" className="px-2 py-2 font-semibold">Owner</th>}
            {show.has("last_contact") && <th scope="col" className="px-2 py-2 font-semibold">Last contact</th>}
            {show.has("next_action") && <th scope="col" className="px-2 py-2 font-semibold">Next action</th>}
            {show.has("due") && <th scope="col" className="px-2 py-2 font-semibold">Due</th>}
            {show.has("blocker") && <th scope="col" className="px-2 py-2 font-semibold">Blocker</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const selected = row.id === selectedId;
            const blockers = blockersOf(row).filter((b) => b.hard || b.key === "no_phone");
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
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">{fullName(row)}</div>
                  {needsPlan && <div className="text-[11px] font-medium text-muted-foreground">Needs a plan</div>}
                </td>
                {show.has("phone") && (
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums text-foreground">{row.phone ? formatPhoneDisplay(row.phone) : "—"}</td>
                )}
                {show.has("state") && <td className="px-2 py-2 text-foreground">{row.state ?? "—"}</td>}
                {show.has("license") && <td className="px-2 py-2 text-foreground">{humanizeKey(row.license_status)}</td>}
                {show.has("stage") && <td className="px-2 py-2 text-foreground">{stageLabel(row, stagesByKey)}</td>}
                {show.has("owner") && (
                  <td className="px-2 py-2 text-foreground">{ownerName(row.recruiting_owner_user_id, staff, staffAvailable)}</td>
                )}
                {show.has("last_contact") && (
                  <td className="whitespace-nowrap px-2 py-2 text-foreground"><LastContact row={row} now={now} /></td>
                )}
                {show.has("next_action") && (
                  <td className="max-w-[200px] truncate px-2 py-2 text-foreground"><NextActionText row={row} /></td>
                )}
                {show.has("due") && <td className="whitespace-nowrap px-2 py-2"><DueCell row={row} now={now} /></td>}
                {show.has("blocker") && (
                  <td className="px-2 py-2">
                    {blockers.length === 0
                      ? <span className="text-muted-foreground">—</span>
                      : <Badge variant={blockers[0].hard ? "destructive" : "outline"}>{blockers[0].label}</Badge>}
                  </td>
                )}
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
        <Button size="sm" variant="outline" className="shrink-0">
          <SlidersHorizontal className="h-4 w-4" /> Columns{hidden > 0 ? ` (${hidden} hidden)` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-semibold text-foreground">Table columns</legend>
          {WORKLIST_TABLE_COLUMNS.map((col) => {
            const id = `worklist-column-${col.key}`;
            return (
              <div key={col.key} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={show.has(col.key)}
                  disabled={col.locked}
                  onCheckedChange={(value) => onChange(toggleColumn(columns, col.key, value === true))}
                />
                <Label htmlFor={id} className="text-xs font-normal text-foreground">
                  {col.label}{col.locked ? " (always shown)" : ""}
                </Label>
              </div>
            );
          })}
        </fieldset>
        <Button size="sm" variant="ghost" className="mt-2" disabled={hidden === 0} onClick={() => onChange([...DEFAULT_WORKLIST_COLUMNS])}>
          Show all
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The compact queue list (F28): identity with state, stage and owner, last contact,
 * next action and due. It wraps instead of scrolling sideways, so it fits beside the
 * person panel from 1024px and reads as cards on a phone. Same rows, order, selection
 * and window as the table, so switching views never changes who is next.
 */
export function WorklistQueueList({ rows, selectedId, onSelect, staff, staffAvailable, stagesByKey, now }: ViewProps) {
  const [visible, setVisible] = useState(TABLE_WINDOW);
  const shown = rows.slice(0, visible);
  return (
    <div>
      <ul aria-label="Queue" className="divide-y divide-border/60">
        {shown.map((row) => {
          const selected = row.id === selectedId;
          const blockers = blockersOf(row).filter((b) => b.hard || b.key === "no_phone");
          const needsPlan = !planCheck(row).ok;
          return (
            <li key={row.id} data-row-id={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                aria-pressed={selected}
                className={cn(
                  "block w-full px-3 py-2.5 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                  selected && "bg-primary/10 hover:bg-primary/10",
                )}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-medium text-foreground">{fullName(row)}</span>
                      {row.state && <span className="text-muted-foreground">{row.state}</span>}
                      <span className="text-muted-foreground">{row.license_status ? humanizeKey(row.license_status) : "License unknown"}</span>
                      {blockers.length > 0 && (
                        <span className={badgeVariants({ variant: blockers[0].hard ? "destructive" : "outline" })}>{blockers[0].label}</span>
                      )}
                      {needsPlan && <span className="text-[11px] font-medium text-muted-foreground">Needs a plan</span>}
                    </span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {stageLabel(row, stagesByKey)} · {ownerName(row.recruiting_owner_user_id, staff, staffAvailable)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right"><DueCell row={row} now={now} /></span>
                </span>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span>Last contact: <LastContact row={row} now={now} /></span>
                  <span className="min-w-0 max-w-full truncate">Next: <NextActionText row={row} /></span>
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

/** Same rows, filters and stage definitions as the table, grouped by recruiting stage. Read-only. */
export function WorklistBoard({ rows, selectedId, onSelect, staff, staffAvailable, stages, now }: Omit<ViewProps, "stagesByKey"> & { stages: StageDefinition[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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

  if (columns.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">Nobody in this queue.</p>;
  }

  return (
    <div className="flex gap-3 overflow-x-auto p-3">
      {columns.map((col) => {
        const open = expanded[col.key] ?? false;
        const shown = open ? col.rows : col.rows.slice(0, BOARD_COLUMN_WINDOW);
        return (
          <section key={col.key} aria-label={col.label} className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
            <header className="flex items-center justify-between border-b border-border px-3 py-2">
              <h3 className="truncate text-xs font-semibold text-foreground">{col.label}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">{col.rows.length}</span>
            </header>
            <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto p-2">
              {shown.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelect(row.id)}
                  aria-pressed={row.id === selectedId}
                  className={cn(
                    "rounded-md border border-border bg-card p-2 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                    row.id === selectedId && "border-primary/50 bg-primary/10",
                  )}
                >
                  <div className="font-medium text-foreground">{fullName(row)}</div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="truncate">{ownerName(row.recruiting_owner_user_id, staff, staffAvailable)}</span>
                    <DueCell row={row} now={now} />
                  </div>
                </button>
              ))}
              {col.rows.length > BOARD_COLUMN_WINDOW && (
                <Button size="sm" variant="ghost" onClick={() => setExpanded((p) => ({ ...p, [col.key]: !open }))}>
                  {open ? "Show fewer" : `Show all ${col.rows.length}`}
                </Button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
