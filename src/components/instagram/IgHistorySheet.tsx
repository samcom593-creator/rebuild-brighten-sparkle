// The thread, newest first: what the bot said before Sam types. Bot rows say 'bot'; refused rows say
// why; a mid says 'delivered' and nothing else does.
import { useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import { fetchThread } from "./igActions";
import { EMPTY, SHEET } from "./igCopy";
import { shortAge } from "./igFormat";
import { who } from "./igRowLogic";
import type { IgRow, IgThread, IgThreadMessage } from "./igTypes";

export interface IgHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: IgRow | null;
  /** The row's gold button, pinned at the bottom. */
  action?: ReactNode;
  now: number;
}

export function refusalWords(m: Pick<IgThreadMessage, "send_failed_kind" | "error" | "queued">): string | null {
  if (!m.error && !m.queued) return null;
  switch (m.send_failed_kind) {
    case "window_closed": return "window closed";
    case "link_blocked": return "link blocked";
    case "token_dead": return "token dead";
    case "tag_not_permitted": return "tag not permitted";
    default: return m.queued === "hold" ? "held, token dead" : m.queued ? "queued" : (m.error ?? "refused").slice(0, 60);
  }
}

export function messageMark(m: IgThreadMessage): string {
  if (m.direction === "inbound") return "";
  const refused = refusalWords(m);
  if (refused) return SHEET.refused(refused);
  if (m.mid) return SHEET.delivered;
  return m.auto_replied ? SHEET.handed : SHEET.noReceipt;
}

export function IgHistorySheet({ open, onOpenChange, row, action, now }: IgHistorySheetProps) {
  const phone = useIsPhone();
  const [thread, setThread] = useState<IgThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    let alive = true;
    setLoading(true); setError(null); setThread(null);
    fetchThread(row.external_id)
      .then((t) => { if (alive) setThread(t); })
      .catch((e: Error) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, row?.external_id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={phone ? "bottom" : "right"} className={cn("flex flex-col gap-0 p-0", phone ? "h-[85vh] rounded-t-lg" : "w-full sm:max-w-lg")}>
        {phone && <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" />}
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-base">{row ? SHEET.historyTitle(who(row)) : ""}</SheetTitle>
          {row?.email ? <SheetDescription className="text-xs">{row.email}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loading && <p className="text-sm text-muted-foreground">loading…</p>}
          {error && <p className="text-sm text-destructive">{EMPTY.couldntLoad} {error}</p>}
          {thread?.messages.map((m) => {
            const ours = m.direction === "outbound";
            const mark = messageMark(m);
            return (
              <div key={m.id} className={cn("flex flex-col", ours ? "items-end" : "items-start")}>
                <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", ours ? "bg-muted text-foreground" : "border border-border text-foreground")}>
                  {m.body}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {ours ? (m.auto_replied ? SHEET.bot : SHEET.you) + " · " : ""}
                  {shortAge(m.received_at, now)}
                  {mark ? ` · ${mark}` : ""}
                </div>
              </div>
            );
          })}
        </div>
        {action ? (
          <div className="border-t border-border px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>{action}</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
