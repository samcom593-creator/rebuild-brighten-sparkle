import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { StaffMember, StageDefinition } from "./useRecruitingWorklist";
import { formatRelative, formatWhen, humanizeKey, ownerName } from "./worklistFormat";

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
    return <span>{row.next_action_set_at ? row.next_action : `System: ${humanizeKey(row.next_action)}`}</span>;
  }
  if (row.waiting_reason) return <span className="text-muted-foreground">Waiting: {row.waiting_reason}</span>;
  return <span className="text-muted-foreground">None</span>;
}

export function WorklistTable({ rows, selectedId, onSelect, staff, staffAvailable, stagesByKey, now }: ViewProps) {
  const [visible, setVisible] = useState(TABLE_WINDOW);
  const shown = rows.slice(0, visible);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left text-xs">
        <thead className="sticky top-0 z-10 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 font-semibold">Name</th>
            <th scope="col" className="px-2 py-2 font-semibold">Phone</th>
            <th scope="col" className="px-2 py-2 font-semibold">State</th>
            <th scope="col" className="px-2 py-2 font-semibold">License</th>
            <th scope="col" className="px-2 py-2 font-semibold">Stage</th>
            <th scope="col" className="px-2 py-2 font-semibold">Owner</th>
            <th scope="col" className="px-2 py-2 font-semibold">Last contact</th>
            <th scope="col" className="px-2 py-2 font-semibold">Next action</th>
            <th scope="col" className="px-2 py-2 font-semibold">Due</th>
            <th scope="col" className="px-2 py-2 font-semibold">Blocker</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const selected = row.id === selectedId;
            const blockers = blockersOf(row).filter((b) => b.hard || b.key === "no_phone");
            const needsPlan = !planCheck(row).ok;
            const stage = row.next_step_stage_key ? stagesByKey.get(row.next_step_stage_key) : null;
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
                  {needsPlan && <div className="text-[10px] font-medium text-destructive">Needs a plan</div>}
                </td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums text-foreground">{row.phone ? formatPhoneDisplay(row.phone) : "—"}</td>
                <td className="px-2 py-2 text-foreground">{row.state ?? "—"}</td>
                <td className="px-2 py-2 text-foreground">{humanizeKey(row.license_status)}</td>
                <td className="px-2 py-2 text-foreground">{row.next_step_stage_key ? stage?.display_name ?? humanizeKey(row.next_step_stage_key) : "Not staged"}</td>
                <td className="px-2 py-2 text-foreground">{ownerName(row.recruiting_owner_user_id, staff, staffAvailable)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-foreground">
                  {row.last_contact_outcome
                    ? <span title={formatWhen(row.last_contact_outcome_at)}>{outcomeLabel(row.last_contact_outcome)} · {formatRelative(row.last_contact_outcome_at, now)}</span>
                    : row.last_contacted_at
                      ? <span title={formatWhen(row.last_contacted_at)}>{formatRelative(row.last_contacted_at, now)}</span>
                      : <span className="text-muted-foreground">Never</span>}
                </td>
                <td className="max-w-[200px] truncate px-2 py-2 text-foreground"><NextActionText row={row} /></td>
                <td className="whitespace-nowrap px-2 py-2"><DueCell row={row} now={now} /></td>
                <td className="px-2 py-2">
                  {blockers.length === 0
                    ? <span className="text-muted-foreground">—</span>
                    : <Badge variant={blockers[0].hard ? "destructive" : "outline"}>{blockers[0].label}</Badge>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > visible && (
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>Showing {visible.toLocaleString()} of {rows.length.toLocaleString()} in this queue</span>
          <Button size="sm" variant="outline" onClick={() => setVisible((v) => v + TABLE_WINDOW)}>Show {Math.min(TABLE_WINDOW, rows.length - visible)} more</Button>
        </div>
      )}
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
