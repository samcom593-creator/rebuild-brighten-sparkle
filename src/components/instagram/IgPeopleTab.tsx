// The People tab (OVERHAUL-instagram, 2026-10-28): everyone who wrote in during the last 30 days, one
// card each with their whole story, a search that finds a person by handle, name, number or their
// words, and one chip per funnel stage. A chip's number is the rows it shows (igScore.ts), so a tap
// on "Gave a number 16" here, or on the same tile at the top of the page, lands on 16 people.
import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RevealList } from "@/components/ui/delight/Reveal";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BUTTON, EMPTY, PEOPLE } from "./igCopy";
import { IgRow, type IgRowActionExtra, type IgRowActionKind } from "./IgRow";
import { PAGE_SIZE } from "./IgNeedsYou";
import { filterPeople, type IgListKey, type IgPeopleList } from "./igScore";
import type { IgRow as IgRowData } from "./igTypes";

export interface IgPeopleTabProps {
  lists: IgPeopleList[];
  list: IgListKey;
  onList: (key: IgListKey) => void;
  humanAgentSupported: boolean;
  onAction: (kind: IgRowActionKind, row: IgRowData, extra?: IgRowActionExtra) => void;
  now: number;
}

export function IgPeopleTab({ lists, list, onList, humanAgentSupported, onAction, now }: IgPeopleTabProps) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const active = lists.find((l) => l.key === list) ?? lists[0];
  const rows = useMemo(() => filterPeople(active?.rows ?? [], q), [active, q]);
  // A new list or a new search starts from the top of that list.
  useEffect(() => setShown(PAGE_SIZE), [list, q]);
  const searching = q.trim().length > 0;
  const capped = active ? active.rows.length < active.total : false;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={PEOPLE.search}
          aria-label={PEOPLE.searchLabel}
          enterKeyHint="search"
          className="h-12 bg-card pl-10 text-base md:text-base"
        />
      </div>

      {/* On a phone the chips scroll sideways inside the page's own 12px gutter (the frame's px-3), so the
          row bleeds to the screen edge without ever widening the page. */}
      <div role="group" aria-label={PEOPLE.lists} className="-mx-3 flex gap-2 overflow-x-auto overscroll-x-contain px-3 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {lists.map((l) => {
          const on = l.key === active?.key;
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={on}
              onClick={() => onList(l.key)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                on ? "border-primary/60 bg-primary/15 text-foreground" : "border-border bg-card text-foreground hover:bg-muted/50",
              )}
            >
              {l.label}
              <span className={cn("rounded-full px-2 py-0.5 text-[13px] tabular-nums", on ? "bg-primary/20" : "bg-muted")}>{l.rows.length.toLocaleString("en-US")}</span>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        <span className="font-semibold text-foreground">{PEOPLE.shown(rows.length, active?.rows.length ?? 0)}</span>
        {active ? ` · ${active.label}` : ""}
        {!searching ? ` · ${PEOPLE.newestFirst}` : ""}
        {capped ? ` · ${PEOPLE.capped(active.rows.length, active.total)}` : ""}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title={searching ? EMPTY.noMatch(q.trim()) : (active?.total ?? 0) === 0 ? EMPTY.noOneIn : EMPTY.nobodyHere}
        />
      ) : (
        <>
          <RevealList as="ul" className="space-y-3">
            {rows.slice(0, shown).map((row) => (
              <li key={row.external_id}>
                <IgRow row={row} context="people" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />
              </li>
            ))}
          </RevealList>
          {rows.length > shown ? (
            <Button variant="outline" className="h-11 w-full" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              {BUTTON.showMore(Math.min(PAGE_SIZE, rows.length - shown))}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
