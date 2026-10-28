// Zone 1: the one list. Up to five ranked business rows, '+n more' for the rest, and two collapsed
// disclosures underneath (everyone else, later). Empty = good news, with a next move.
import { useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { BUTTON, EMPTY, SECTION } from "./igCopy";
import { IgRow, type IgRowActionExtra, type IgRowActionKind } from "./IgRow";
import type { IgRow as IgRowData } from "./igTypes";

export const NEEDS_VISIBLE = 5;

export interface IgNeedsYouProps {
  needs: IgRowData[];
  everyone: IgRowData[];
  later: IgRowData[];
  humanAgentSupported: boolean;
  onAction: (kind: IgRowActionKind, row: IgRowData, extra?: IgRowActionExtra) => void;
  onMore: () => void;
  now: number;
}

function Disclosure({ label, children, open, onOpenChange }: { label: string; children: React.ReactNode; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="h-11 w-full justify-start px-2 text-sm text-muted-foreground sm:h-9">
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function IgNeedsYou({ needs, everyone, later, humanAgentSupported, onAction, onMore, now }: IgNeedsYouProps) {
  const [everyoneOpen, setEveryoneOpen] = useState(false);
  const [laterOpen, setLaterOpen] = useState(false);
  const visible = needs.slice(0, NEEDS_VISIBLE);
  const rest = needs.length - visible.length;

  return (
    <section aria-labelledby="ig-needs-heading" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ig-needs-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {SECTION.needsYou}
          <Badge variant="secondary" className="tabular-nums">{needs.length}</Badge>
        </h2>
        {rest > 0 && (
          <Button variant="ghost" className="h-9 px-2 text-sm text-muted-foreground" onClick={onMore}>
            {BUTTON.nMore(rest)}
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          variant="success"
          icon={<CheckCircle2 className="h-7 w-7" />}
          title={EMPTY.nobodyWaiting}
          description={EMPTY.goPost}
          actions={
            everyone.length > 0 ? (
              <Button variant="outline" className="h-11 sm:h-9" onClick={() => setEveryoneOpen(true)}>
                {BUTTON.seeEveryoneElse}
              </Button>
            ) : null
          }
        />
      ) : (
        <div>
          {visible.map((row) => (
            <IgRow key={row.external_id} row={row} context="list" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />
          ))}
        </div>
      )}

      <div className="space-y-1 pt-1">
        <Disclosure label={SECTION.everyoneElse(everyone.length)} open={everyoneOpen} onOpenChange={setEveryoneOpen}>
          {everyone.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{EMPTY.nobodyHere}</p>
          ) : (
            everyone.map((row) => (
              <IgRow key={row.external_id} row={row} context="everyone" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />
            ))
          )}
        </Disclosure>
        <Disclosure label={SECTION.later(later.length)} open={laterOpen} onOpenChange={setLaterOpen}>
          {later.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{EMPTY.nobodyHere}</p>
          ) : (
            later.map((row) => (
              <IgRow key={row.external_id} row={row} context="later" humanAgentSupported={humanAgentSupported} onAction={onAction} now={now} />
            ))
          )}
        </Disclosure>
      </div>
    </section>
  );
}
