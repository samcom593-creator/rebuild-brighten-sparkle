// Renders ONLY when something is broken. Precedence top to bottom, one wins; the words say what
// broke and the button is the fix. The full health detail lives on the Numbers tab.
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToneBubble } from "@/components/ui/delight/ToneBubble";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ALERT, BUTTON } from "./igCopy";
import { agoWords, shortAge, shortAgo } from "./igFormat";
import type { IgStatus } from "./igTypes";

export type IgAlertKind = "token_dead" | "links_blocked" | "bot_silent" | "followups_stale";

export interface IgAlertVerdict { kind: IgAlertKind; sentence: string }

const H = 3_600_000;

export function alertVerdict(status: IgStatus, waiting: number, now: number = Date.now()): IgAlertVerdict | null {
  if (status.token_ok === false) {
    return { kind: "token_dead", sentence: ALERT.tokenDead(agoWords(status.token_checked_at ?? now, now)) };
  }
  if (status.links_blocked) {
    return { kind: "links_blocked", sentence: ALERT.linksBlocked(shortAgo(status.links_blocked_at, now)) };
  }
  const lastBot = status.last_bot_delivered_at ? new Date(status.last_bot_delivered_at).getTime() : null;
  const lastIn = status.last_inbound_at ? new Date(status.last_inbound_at).getTime() : null;
  if (lastBot != null && lastIn != null && now - lastBot > 24 * H && lastIn > lastBot) {
    return { kind: "bot_silent", sentence: ALERT.botSilent(shortAge(lastBot, now), waiting) };
  }
  const lastRun = status.nudge_cron_last_at ? new Date(status.nudge_cron_last_at).getTime() : null;
  if (status.nudge_cron_last_status !== "succeeded" || lastRun == null || now - lastRun > 30 * 60_000) {
    return { kind: "followups_stale", sentence: ALERT.followupsDidntRun(lastRun == null ? "never" : shortAgo(lastRun, now)) };
  }
  return null;
}

export function IgHowToFixSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-xl" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))" }}>
        <SheetHeader className="text-left">
          <SheetTitle className="text-lg">{ALERT.howToFixTitle}</SheetTitle>
          <SheetDescription className="text-[15px]">{ALERT.howToFixHint}</SheetDescription>
        </SheetHeader>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-base text-foreground">
          {ALERT.howToFixSteps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </SheetContent>
    </Sheet>
  );
}

export interface IgHealthAlertProps {
  status: IgStatus;
  waiting: number;
  reconnectHref: string;
  onHowToFix: () => void;
  onSeeThem: () => void;
  onSeeWhy: () => void;
  now: number;
}

export function IgHealthAlert({ status, waiting, reconnectHref, onHowToFix, onSeeThem, onSeeWhy, now }: IgHealthAlertProps) {
  const v = alertVerdict(status, waiting, now);
  if (!v) return null;
  const fix = "h-11 shrink-0 sm:h-10";
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-tone-hot/35 bg-tone-hot/8 px-4 py-3">
      <ToneBubble tone="hot" size="sm"><AlertTriangle /></ToneBubble>
      <p className="min-w-0 flex-1 text-[15px] font-medium leading-[22px] text-foreground">{v.sentence}</p>
      {v.kind === "token_dead" && (
        <Button asChild variant="outline" className={fix}>
          <a href={reconnectHref} target="_blank" rel="noopener noreferrer">{BUTTON.reconnect}</a>
        </Button>
      )}
      {v.kind === "links_blocked" && <Button variant="outline" className={fix} onClick={onHowToFix}>{BUTTON.howToFix}</Button>}
      {v.kind === "bot_silent" && <Button variant="outline" className={fix} onClick={onSeeThem}>{BUTTON.seeThem}</Button>}
      {v.kind === "followups_stale" && <Button variant="outline" className={fix} onClick={onSeeWhy}>{BUTTON.seeWhy}</Button>}
    </div>
  );
}
