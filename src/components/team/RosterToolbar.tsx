import { Network, Search, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ActiveFilter = { key: string; label: string; onRemove: () => void };

/**
 * ONE toolbar for the roster: search, group, upline and sort in a single row, and one status line that says how many of
 * how many are showing and lets each active filter be removed.
 */
export function RosterToolbar({
  q, onQ, managers, manager, onManager, groups, group, onGroup, sort, onSort, sortOptions,
  shown, groupTotal, groupLabel, activeFilters, onClearAll,
}: {
  q: string; onQ: (v: string) => void;
  managers: [string, string][]; manager: string; onManager: (v: string) => void;
  groups: { key: string; label: string; count: number }[]; group: string; onGroup: (v: string) => void;
  sort: string; onSort: (v: string) => void; sortOptions: { value: string; label: string }[];
  shown: number; groupTotal: number; groupLabel: string;
  activeFilters: ActiveFilter[]; onClearAll: () => void;
}) {
  return (
    <div className="space-y-2" role="search" aria-label="Filter the roster">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Search name, email, phone, code, upline" aria-label="Search the roster" className="h-10 pl-9 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:contents">
        <div className="col-span-2 sm:col-span-1">
        <Select value={group} onValueChange={onGroup}>
          <SelectTrigger aria-label="Roster group" className="h-10 w-full text-sm sm:w-[220px]"><Users className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><SelectValue /></SelectTrigger>
          <SelectContent>
            {groups.map((g) => <SelectItem key={g.key} value={g.key}>{g.label} · {g.count}</SelectItem>)}
          </SelectContent>
        </Select>
        </div>
        {managers.length > 0 ? (
          <Select value={manager} onValueChange={onManager}>
            <SelectTrigger aria-label="Filter roster by upline" className="h-10 w-full text-sm sm:w-[170px]"><Network className="mr-1.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><SelectValue placeholder="All uplines" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All uplines</SelectItem>
              {managers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={sort} onValueChange={onSort}>
          <SelectTrigger aria-label="Sort the roster" className="h-10 w-full text-sm sm:w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {sortOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        </div>
      </div>

      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" role="status">
          <span>Showing <b className="text-foreground">{shown}</b> of {groupTotal} in {groupLabel}.</span>
          {activeFilters.map((f) => (
            <button key={f.key} type="button" onClick={f.onRemove} aria-label={`Remove filter: ${f.label}`}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 text-xs font-medium text-foreground hover:border-primary">
              {f.label} <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
          <button type="button" onClick={onClearAll} className="min-h-[32px] px-1 text-xs font-semibold underline underline-offset-2 hover:text-foreground">Clear all</button>
        </div>
      ) : null}
    </div>
  );
}
