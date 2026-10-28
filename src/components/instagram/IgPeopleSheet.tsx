// One sheet for stage / lever / more. Bottom at 85vh on a phone, right from sm. Rows are the same
// IgRow; the lever pre-chooses the text body.
import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";
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
        className={cn("flex flex-col gap-0 p-0", phone ? "h-[85vh] rounded-t-lg" : "w-full sm:max-w-lg")}
      >
        {phone && <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" />}
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {subtitle ? <SheetDescription className="text-xs">{subtitle}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {total === 0 ? (
            <div className="py-6">
              <EmptyState icon={<Users className="h-7 w-7" />} title={emptyTitle ?? "nobody here."} description={emptyDescription} />
            </div>
          ) : (
            groups.map((g, i) => (
              <div key={`${g.heading}-${i}`}>
                {g.heading ? <h3 className="pt-3 text-xs font-medium text-muted-foreground">{g.heading}</h3> : null}
                {g.rows.map((row) => (
                  <IgRow key={row.external_id} row={row} context="sheet" humanAgentSupported={humanAgentSupported} onAction={onAction} smsBody={smsBody} now={now} />
                ))}
              </div>
            ))
          )}
        </div>
        {footer ? <div className="border-t border-border px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
