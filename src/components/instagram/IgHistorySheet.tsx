// One person, the whole story (OVERHAUL-instagram, 2026-10-28): who they are and what to do next at
// the top, then the last 24 messages as a chat, oldest at the top and the newest at the bottom where
// the sheet opens, like Instagram itself. Bot messages say "Bot"; a refused send says why; a Meta mid
// says "delivered" and nothing else does.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Mail, Phone } from "lucide-react";
import { TonePill, ToneBubble } from "@/components/ui/delight/ToneBubble";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsPhone } from "@/hooks/useIsPhone";
import { formatPhoneDisplay } from "@/lib/phone";
import { TONE_CLASS } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { fetchThread } from "./igActions";
import { EMPTY, REFUSAL_WORD, SHEET } from "./igCopy";
import { agoWords } from "./igFormat";
import { rowStory } from "./igStory";
import type { IgRow, IgThread, IgThreadMessage } from "./igTypes";

export interface IgHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: IgRow | null;
  humanAgentSupported?: boolean;
  /** The row's main button, pinned at the bottom. */
  action?: ReactNode;
  now: number;
}

export function refusalWords(m: Pick<IgThreadMessage, "send_failed_kind" | "error" | "queued">): string | null {
  if (!m.error && !m.queued) return null;
  if (m.send_failed_kind && REFUSAL_WORD[m.send_failed_kind]) return REFUSAL_WORD[m.send_failed_kind];
  return m.queued === "hold" ? "held, token dead" : m.queued ? "queued" : (m.error ?? "refused").slice(0, 60);
}

export function messageMark(m: IgThreadMessage): string {
  if (m.direction === "inbound") return "";
  const refused = refusalWords(m);
  if (refused) return SHEET.refused(refused);
  if (m.mid) return SHEET.delivered;
  return m.auto_replied ? SHEET.handed : SHEET.noReceipt;
}

export function IgHistorySheet({ open, onOpenChange, row, humanAgentSupported = false, action, now }: IgHistorySheetProps) {
  const phone = useIsPhone();
  const [thread, setThread] = useState<IgThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

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

  // Land on the newest message, the one that matters.
  useEffect(() => {
    if (thread) endRef.current?.scrollIntoView?.({ block: "end" });
  }, [thread]);

  const story = row ? rowStory(row, humanAgentSupported, now) : null;
  const messages = thread ? [...thread.messages].reverse() : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={phone ? "bottom" : "right"} className={cn("flex flex-col gap-0 bg-background p-0", phone ? "h-[88dvh] rounded-t-xl" : "w-full sm:max-w-xl")}>
        {phone && <div aria-hidden className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted" />}
        <SheetHeader className="space-y-0 border-b border-border px-4 py-3 text-left">
          <div className="flex items-start gap-3 pr-10">
            {story ? <ToneBubble tone={story.pill.tone} size="md"><span className="text-base font-bold leading-none">{story.initial}</span></ToneBubble> : null}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-lg">{story ? SHEET.historyTitle(story.name) : ""}</SheetTitle>
              <SheetDescription className="truncate text-sm">{story?.alias ?? SHEET.historySubtitle}</SheetDescription>
            </div>
          </div>
          {story ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <TonePill tone={story.pill.tone} dot>{story.pill.text}</TonePill>
                {story.facts.map((f) => <TonePill key={f.key} tone={f.tone}>{f.text}</TonePill>)}
              </div>
              {story.origin ? <p className="text-[13px] leading-[18px] text-muted-foreground">{story.origin}</p> : null}
              {row?.phone || row?.email ? (
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground">
                  {row?.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4 text-muted-foreground" aria-hidden />{formatPhoneDisplay(row.phone)}</span> : null}
                  {row?.email ? <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]"><Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{row.email}</span> : null}
                </p>
              ) : null}
              <p className={cn("flex items-start gap-2 text-[15px] font-medium leading-[22px] text-foreground")}>
                <ArrowRight className={cn("mt-[3px] h-4 w-4 shrink-0", TONE_CLASS[story.next.tone].text)} aria-hidden />
                <span><span className="sr-only">Next: </span>{story.next.text}</span>
              </p>
            </div>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4" aria-label={SHEET.historySubtitle}>
          {loading && <p className="text-sm text-muted-foreground">{EMPTY.loading}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{EMPTY.couldntLoad}. {error}</p>}
          {messages.map((m) => {
            const ours = m.direction === "outbound";
            const mark = messageMark(m);
            const refused = !!refusalWords(m);
            return (
              <div key={m.id} className={cn("flex flex-col", ours ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-[22px] text-foreground [overflow-wrap:anywhere]",
                    ours ? "rounded-tr-md bg-muted" : "rounded-tl-md border border-border bg-card",
                  )}
                >
                  {m.body}
                </div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {ours ? `${m.auto_replied ? SHEET.bot : SHEET.you} · ` : `${SHEET.them} · `}
                  {agoWords(m.received_at, now)}
                  {mark ? <> · <span className={cn(refused && TONE_CLASS.hot.text, m.mid && TONE_CLASS.good.text)}>{mark}</span></> : null}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        {action ? (
          <div className="border-t border-border px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}>{action}</div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
