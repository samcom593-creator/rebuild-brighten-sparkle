// One sheet for a list of people the page opens on its own (the biggest leak, a funnel step that
// has no People list). From the bottom on a phone, from the right on a wider screen. The rows are
// the same IgRow cards; the lever pre-chooses the text body.
import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import { EMPTY } from "./igCopy";
import { IgRow, type IgRowActionExtra, type IgRowActionKind } from "./IgRow";
import type { IgRow as IgRowData } from "./igTypes";

export interface IgPeopleSection { heading: string; rows: IgRowData[] }

export interface IgPeopleSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  rows?: IgRowData[];
  sections?: IgPeopleSection[];
  emptyTitle?: string;
  emptyDescription?: string;
  humanAgentSupported: boolean;
  onAction: (kind: IgRowActionKind, row: IgRowData, extra?: IgRowActionExtra) => void;
  smsBody?: string;
  now: number;
  footer?: ReactNode;
}

export function IgPeopleSheet({
  open, onOpenChange, title, subtitle, rows, sections, emptyTitle, emptyDescription, humanAgentSupported, onAction, smsBody, now, footer,
}: IgPeopleSheetProps) {
  const phone = useIsPhone();
  const groups: IgPeopleSection[] = sections ?? [{ heading: "", rows: rows ?? [] }];
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        className={cn("flex flex-col gap-0 bg-background p-0", phone ? "h-[88dvh] rounded-t-xl" : "w-full sm:max-w-xl")}
      >
        {phone && <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted" />}
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {subtitle ? <SheetDescription className="text-sm">{subtitle}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" style={{ paddingBottom: footer ? undefined : "max(1rem, env(safe-area-inset-bottom, 0px))" }}>
          {total === 0 ? (
            <EmptyState icon={<Users className="h-7 w-7" />} title={emptyTitle ?? EMPTY.nobodyHere} description={emptyDescription} />
          ) : (
            <div className="space-y-5">
              {groups.filter((g) => g.rows.length > 0 || !g.heading).map((g, i) => (
                <section key={`${g.heading}-${i}`} aria-label={g.heading || undefined} className="space-y-3">
                  {g.heading ? <h3 className="text-base font-semibold text-foreground">{g.heading} · {g.rows.length}</h3> : null}
                  <ul className="space-y-3">
                    {g.rows.map((row) => (
                      <li key={row.external_id}>
                        <IgRow row={row} context="sheet" humanAgentSupported={humanAgentSupported} onAction={onAction} smsBody={smsBody} now={now} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
        {footer ? <div className="border-t border-border px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
