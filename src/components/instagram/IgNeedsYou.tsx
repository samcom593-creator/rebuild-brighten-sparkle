// The Needs you tab (OVERHAUL-instagram, 2026-10-28): the one person to deal with first, as a big card
// with the screen's only gold button, then everyone else waiting in the server's order, every card
// with its whole story. Small talk and snoozed threads sit folded underneath, counted, one tap away.
// Empty is good news, with the next move.
import { useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RevealList } from "@/components/ui/delight/Reveal";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { BUTTON, EMPTY, SECTION } from "./igCopy";
import { IgRow, type IgRowActionExtra, type IgRowActionKind } from "./IgRow";
import type { IgRow as IgRowData } from "./igTypes";

/** Cards shown before "Show more" on each list: a long list never renders all at once. */
export const PAGE_SIZE = 20;

export interface IgNeedsYouProps {
  needs: IgRowData[];
  everyone: IgRowData[];
  later: IgRowData[];
  humanAgentSupported: boolean;
  onAction: (kind: IgRowActionKind, row: IgRowData, extra?: IgRowActionExtra) => void;
  now: number;
  /** The lever card, placed under the list. */
  footer?: ReactNode;
}

function Fold({ label, hint, children, open, onOpenChange }: { label: string; hint: string; children: ReactNode; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-foreground">{label}</span>
            <span className="block text-[13px] leading-[18px] text-muted-foreground">{hint}</span>
          </span>
          <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-3 py-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Paged({ rows, render }: { rows: IgRowData[]; render: (row: IgRowData) => ReactNode }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const rest = rows.length - shown;
  return (
    <>
      <RevealList as="ul" className="space-y-3">
        {rows.slice(0, shown).map((row) => <li key={row.external_id}>{render(row)}</li>)}
      </RevealList>
      {rest > 0 ? (
        <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => setShown((n) => n + PAGE_SIZE)}>
          {BUTTON.showMore(Math.min(PAGE_SIZE, rest))}
        </Button>
      ) : null}
    </>
  );
}

export function IgNeedsYou({ needs, everyone, later, humanAgentSupported, onAction, now, footer }: IgNeedsYouProps) {
  const [chattingOpen, setChattingOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const [first, ...rest] = needs;

  return (
    <div className="space-y-6">
      <section aria-labelledby="ig-needs-heading" className="space-y-3 scroll-mt-32">
        {first ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="ig-needs-heading" className="text-xl font-bold text-foreground">{SECTION.upNext}</h2>
              <span className="text-sm tabular-nums text-muted-foreground">1 of {needs.length}</span>
            </div>
            <IgRow row={first} context="list" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} featured />
          </>
        ) : (
          <>
            <h2 id="ig-needs-heading" className="sr-only">{SECTION.upNext}</h2>
            <EmptyState
              variant="success"
              icon={<CheckCircle2 className="h-7 w-7" />}
              title={EMPTY.nobodyWaiting}
              description={EMPTY.goPost}
              actions={everyone.length > 0 ? (
                <Button variant="outline" className="h-11" onClick={() => setChattingOpen(true)}>{BUTTON.seeChatting(everyone.length)}</Button>
              ) : null}
            />
          </>
        )}
      </section>

      {rest.length > 0 ? (
        <section aria-labelledby="ig-also-heading" className="space-y-3">
          <h2 id="ig-also-heading" className="text-xl font-bold text-foreground">{SECTION.alsoWaiting(rest.length)}</h2>
          <Paged rows={rest} render={(row) => <IgRow row={row} context="list" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />} />
        </section>
      ) : null}

      {footer}

      <div className="space-y-3">
        <Fold label={SECTION.chatting(everyone.length)} hint={SECTION.chattingHint} open={chattingOpen} onOpenChange={setChattingOpen}>
          {everyone.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">{EMPTY.nobodyHere}</p>
          ) : (
            <Paged rows={everyone} render={(row) => <IgRow row={row} context="everyone" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />} />
          )}
        </Fold>
        <Fold label={SECTION.later(later.length)} hint={SECTION.laterHint} open={laterOpen} onOpenChange={setLaterOpen}>
          {later.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">{EMPTY.nobodyHere}</p>
          ) : (
            <Paged rows={later} render={(row) => <IgRow row={row} context="later" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />} />
          )}
        </Fold>
      </div>
    </div>
  );
}
