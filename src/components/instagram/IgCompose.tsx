// Compose for 'send' (RESPONSE, inside Meta's 24h window) and 'nudge' (HUMAN_AGENT tag, only when
// the sender supports it). Drawer from the bottom on a phone, Dialog on sm+. Five canned lines in
// Sam's register, 140 chars, a word counter that turns into words past 14, links refused unless
// proven since the last refusal, and a result line read off the sender's response.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";
import { useIsPhone } from "@/hooks/useIsPhone";
import { cn } from "@/lib/utils";
import { sendDm, type SendResult } from "./igActions";
import { BUTTON, CANNED, COMPOSE } from "./igCopy";
import { phoenixTime } from "./igFormat";
import { who } from "./igRowLogic";
import type { IgRow, IgStatus } from "./igTypes";

export interface IgComposeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: IgRow | null;
  mode: "send" | "nudge";
  status: IgStatus;
  onResult: (row: IgRow, result: SendResult) => void;
}

const MAX_CHARS = 140;
const MAX_WORDS = 14;
const URL_RE = /https?:\/\//i;

export function linksProven(status: Pick<IgStatus, "links_proven_at" | "last_link_refusal_at" | "links_blocked">): boolean {
  if (status.links_blocked) return false;
  if (!status.last_link_refusal_at) return true;
  if (!status.links_proven_at) return false;
  return new Date(status.links_proven_at).getTime() > new Date(status.last_link_refusal_at).getTime();
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function IgCompose({ open, onOpenChange, row, mode, status, onResult }: IgComposeProps) {
  const phone = useIsPhone();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    if (open) { setMessage(""); setResult(null); setSending(false); }
  }, [open, row?.external_id]);

  const words = wordCount(message);
  const hasLink = URL_RE.test(message);
  const linkRefused = hasLink && !linksProven(status);
  const canSend = !!row && message.trim().length > 0 && message.length <= MAX_CHARS && !linkRefused && !sending;

  const windowLine = useMemo(() => {
    if (!row) return "";
    if (mode === "nudge") return COMPOSE.windowClosedTag;
    if (status.links_blocked) return COMPOSE.linksBlocked;
    return COMPOSE.windowOpen(phoenixTime(row.window_closes_at ?? null));
  }, [row, mode, status.links_blocked]);

  const submit = async () => {
    if (!row || !canSend) return;
    setSending(true);
    try {
      const r = await sendDm(row, message.trim(), mode === "nudge");
      setResult(r);
      onResult(row, r);
    } catch (e) {
      setResult({ kind: "error", line: String((e as Error).message ?? "didn't send").slice(0, 140), id: null, ok: false });
    } finally {
      setSending(false);
    }
  };

  const title = COMPOSE.sendAsYou;
  const to = row ? COMPOSE.to(who(row)) : "";

  const body = (
    <div className="flex flex-col gap-3 px-4 pb-4">
      <p className="text-sm text-muted-foreground">{windowLine}</p>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{COMPOSE.quick}</p>
        <div className="grid gap-2">
          {CANNED.map((line) => (
            <Button key={line} type="button" variant="outline" className="h-11 justify-start text-left sm:h-10" onClick={() => setMessage(line)}>
              {line}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="ig-compose-message" className="text-sm font-semibold text-foreground">{COMPOSE.message}</label>
        <Textarea
          id="ig-compose-message"
          value={message}
          maxLength={MAX_CHARS}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={COMPOSE.placeholder}
          rows={3}
          enterKeyHint="send"
          className="text-base"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{words > MAX_WORDS ? COMPOSE.longForYou : COMPOSE.words(words)}</span>
        {linkRefused ? <span role="alert" className="text-destructive">{COMPOSE.linksRefused}</span> : null}
      </div>
      <div style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <Button type="button" className="h-12 w-full" disabled={!canSend} onClick={submit}>
          {sending ? COMPOSE.sending : mode === "nudge" ? BUTTON.nudge : BUTTON.send}
        </Button>
        {result ? (
          <p className={cn("mt-2 text-[15px]", result.ok ? "text-foreground" : "text-destructive")} role="status">{result.line}</p>
        ) : null}
      </div>
    </div>
  );

  if (phone) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{to}</DrawerDescription>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{to}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
