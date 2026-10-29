// One person on the Instagram desk (OVERHAUL-instagram, 2026-10-28). The same card on every surface
// (Needs you, People, every sheet), and it answers Sam's four questions in order: who they are
// (handle, name, what they want, what they gave us, where they came from), what they last said,
// what we last did (with its delivery truth), and what to do next, then the buttons for it.
//
// One gold button per screen: only the `featured` card (Up next) fills its main action gold. Every
// other card's main action is an outline button, so a list of twenty people reads calm.
import { useCallback, type ReactElement } from "react";
import { ArrowRight, ChevronDown, ExternalLink, MessageCircle, MessagesSquare, Phone, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TonePill, ToneBubble } from "@/components/ui/delight/ToneBubble";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { igThreadUrl } from "@/lib/instagram";
import { TONE_CLASS, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { BUTTON, MENU, SAID, SMS, TOAST } from "./igCopy";
import { phoenixDayTime, tomorrowNinePhoenix } from "./igFormat";
import { buttonPair, effectiveStatus, isThreadRow, menuVisibility, type IgButtonKind } from "./igRowLogic";
import { oursFirst, rowStory } from "./igStory";
import type { IgRow as IgRowData, IgRowContext } from "./igTypes";

export type IgRowActionKind =
  | "send" | "nudge" | "showed" | "no_show" | "done" | "bring_back" | "later" | "not_lead" | "mine" | "email_link" | "thats_lead" | "history";

export interface IgRowActionExtra { until?: string; intent?: "opportunity" | "licensed"; label?: string }

export interface IgRowProps {
  row: IgRowData;
  context: IgRowContext;
  humanAgentSupported: boolean;
  onAction: (kind: IgRowActionKind, row: IgRowData, extra?: IgRowActionExtra) => void;
  /** Lever sheets pre-choose the text; otherwise the status decides. */
  smsBody?: string;
  now?: number;
  /** The one Up next card: its main action is the screen's gold button. */
  featured?: boolean;
  className?: string;
}

/** The next-step line sits on an 8% tint of the row's tone: a tint, never a fill. */
const NEXT_TINT: Record<Tone, string> = {
  good: "bg-tone-good/8", warm: "bg-tone-warm/8", hot: "bg-tone-hot/8", cool: "bg-tone-cool/8",
  royal: "bg-tone-royal/8", gold: "bg-tone-gold/8", slate: "bg-tone-slate/8",
};

function defaultSmsBody(row: IgRowData, humanAgentSupported: boolean, now: number): string {
  const status = effectiveStatus(row, humanAgentSupported, now);
  if (status === "today" && row.booked_event) return SMS.today(phoenixDayTime(row.booked_event.scheduled_at));
  if (status === "call" || status === "booked" || status === "applied") return SMS.call;
  return SMS.numberNotBooked;
}

export function IgRow({ row, context, humanAgentSupported, onAction, smsBody, now = Date.now(), featured = false, className }: IgRowProps) {
  const story = rowStory(row, humanAgentSupported, now);
  const pair = buttonPair(row, humanAgentSupported, now);
  const vis = menuVisibility(row, context, humanAgentSupported);
  const body = smsBody ?? defaultSmsBody(row, humanAgentSupported, now);
  const tel = phoneHref(row.phone);
  const sms = smsHref(row.phone, body);
  const igUrl = igThreadUrl(row.handle);
  const name = story.name;
  const tone = story.pill.tone;
  const thread = isThreadRow(row);

  const onTextClick = useCallback(() => {
    // Google Voice's composer has no prefill, so on desktop the body is shown as copyable text.
    if (sms && sms.startsWith("https://")) {
      toast(TOAST.smsBodyCopied, { description: body, duration: 10_000 });
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(body).catch((e) => console.warn("[ig-desk] clipboard refused", e));
      }
    }
  }, [sms, body]);

  // 44px on phones (the shell's touch rule), 40px from sm.
  const sizing = "h-11 sm:h-10";

  const renderButton = (kind: IgButtonKind | null, variant: "default" | "outline", wide: boolean): ReactElement | null => {
    if (!kind) return null;
    const cls = cn(sizing, wide && "w-full sm:w-auto");
    switch (kind) {
      case "call": {
        if (!tel || !row.phone) return renderButton("open_ig", variant, wide);
        const display = formatPhoneDisplay(row.phone);
        return (
          <Button asChild variant={variant} className={cls}>
            <a href={tel} {...contactLinkProps(tel)} aria-label={`call ${name}`}>
              <Phone className="h-4 w-4" aria-hidden />
              {/* A list card on a phone says "Call" (its next-step line already prints the number) so the
                  three buttons fit one row; the featured card and wider screens print the number too. */}
              {wide ? BUTTON.call(display) : <>{BUTTON.callShort}<span className="hidden sm:inline">&nbsp;{display}</span></>}
            </a>
          </Button>
        );
      }
      case "text":
        if (!sms) return null;
        return (
          <Button asChild variant={variant} className={cls}>
            <a href={sms} {...contactLinkProps(sms)} onClick={onTextClick} aria-label={`text ${name}`}>
              <MessageCircle className="h-4 w-4" aria-hidden />
              {BUTTON.text}
            </a>
          </Button>
        );
      case "open_ig":
        return (
          <Button asChild variant={variant} className={cls}>
            <a href={igUrl} target="_blank" rel="noopener noreferrer" aria-label={`open ${name} on instagram`}>
              <ExternalLink className="h-4 w-4" aria-hidden />
              {wide ? BUTTON.openIg : <><span className="sm:hidden">{BUTTON.openIgShort}</span><span className="hidden sm:inline">{BUTTON.openIg}</span></>}
            </a>
          </Button>
        );
      case "send":
        return (
          <Button variant={variant} className={cls} onClick={() => onAction("send", row)}>
            <Send className="h-4 w-4" aria-hidden />
            {BUTTON.send}
          </Button>
        );
      case "nudge":
        return <Button variant={variant} className={cls} onClick={() => onAction("nudge", row)}>{BUTTON.nudge}</Button>;
      case "showed":
        return <Button variant={variant} className={cls} onClick={() => onAction("showed", row)}>{BUTTON.showed}</Button>;
      case "no_show":
        return <Button variant={variant} className={cls} onClick={() => onAction("no_show", row)}>{BUTTON.noShow}</Button>;
      case "done":
        return <Button variant={variant} className={cls} onClick={() => onAction("done", row)}>{BUTTON.done}</Button>;
      case "bring_back":
        return <Button variant={variant} className={cls} onClick={() => onAction("bring_back", row)}>{BUTTON.bringBack}</Button>;
      default:
        return null;
    }
  };

  const said = story.said;
  const did = story.did;
  const saidBubble = said ? (
    <div className="min-w-0 rounded-2xl rounded-tl-md border border-border px-3 py-2">
      <p className="text-[13px] font-medium leading-[18px] text-muted-foreground">
        {SAID.them}{said.ago ? ` · ${said.ago}` : ""}
      </p>
      <p className="mt-0.5 line-clamp-3 text-[15px] leading-[22px] text-foreground [overflow-wrap:anywhere]">“{said.text}”</p>
    </div>
  ) : null;
  const didBubble = did ? (
    <div className="min-w-0 rounded-2xl rounded-tr-md bg-muted/60 px-3 py-2">
      <p className="text-[13px] font-medium leading-[18px] text-muted-foreground">
        <span className={cn(did.text === null && did.tone === "hot" && TONE_CLASS.hot.text)}>{did.label}</span>
        {did.ago ? ` · ${did.ago}` : ""}
        {did.note ? <> · <span className={TONE_CLASS[did.tone].text}>{did.note}</span></> : null}
      </p>
      {did.text ? <p className="mt-0.5 line-clamp-2 text-[15px] leading-[22px] text-muted-foreground [overflow-wrap:anywhere]">“{did.text}”</p> : null}
    </div>
  ) : null;

  return (
    <article
      aria-label={`${name}: ${story.pill.text}`}
      data-external-id={row.external_id}
      data-status={story.pill.key}
      className={cn(
        "apex-lift rounded-xl border bg-card p-4 sm:p-5",
        featured ? TONE_CLASS[tone].border : "border-border",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <ToneBubble tone={tone} size={featured ? "lg" : "md"} className="mt-0.5">
          <span className={cn("font-bold leading-none", featured ? "text-lg" : "text-base")}>{story.initial}</span>
        </ToneBubble>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {thread ? (
                <button
                  type="button"
                  onClick={() => onAction("history", row)}
                  title={name}
                  className={cn(
                    "block max-w-full truncate rounded-sm text-left font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--apex-focus-ring)]",
                    featured ? "text-lg leading-7" : "text-base leading-6",
                  )}
                >
                  {name}
                </button>
              ) : (
                <p title={name} className={cn("truncate font-semibold text-foreground", featured ? "text-lg leading-7" : "text-base leading-6")}>{name}</p>
              )}
              {story.alias ? <p title={story.alias} className="truncate text-sm leading-5 text-muted-foreground">{story.alias}</p> : null}
            </div>
            <TonePill tone={tone} dot className="mt-0.5 shrink-0 whitespace-nowrap">{story.pill.text}</TonePill>
          </div>
          {story.facts.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="About them">
              {story.facts.map((f) => (
                <li key={f.key}><TonePill tone={f.tone}>{f.text}</TonePill></li>
              ))}
            </ul>
          ) : null}
          {story.origin ? <p className="mt-2 text-[13px] leading-[18px] text-muted-foreground">{story.origin}</p> : null}
        </div>
      </div>

      {said || did ? (
        // Two lines of the conversation, older first like a chat: their words in an outlined bubble,
        // ours (or the bot's) in a filled one, each with who, when and, for ours, whether it landed.
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {oursFirst(story) ? <>{didBubble}{saidBubble}</> : <>{saidBubble}{didBubble}</>}
        </div>
      ) : null}

      <div className={cn("mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5", NEXT_TINT[tone])}>
        <ArrowRight className={cn("mt-[3px] h-4 w-4 shrink-0", TONE_CLASS[tone].text)} aria-hidden />
        <p className="text-[15px] font-medium leading-[22px] text-foreground">
          <span className="sr-only">Next: </span>
          {story.next.text}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {renderButton(pair.gold, featured ? "default" : "outline", featured)}
        {renderButton(pair.outline, "outline", false)}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={cn(sizing, "px-3 text-muted-foreground")} aria-label={`more for ${name}`}>
              {BUTTON.more}
              <ChevronDown className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem]">
            <DropdownMenuItem asChild>
              <a href={igUrl} target="_blank" rel="noopener noreferrer">{MENU.openIg}</a>
            </DropdownMenuItem>
            {vis.history && (
              <DropdownMenuItem onSelect={() => onAction("history", row)}>
                <MessagesSquare className="h-4 w-4" aria-hidden />
                {MENU.history}
              </DropdownMenuItem>
            )}
            {vis.done && <DropdownMenuItem onSelect={() => onAction("done", row)}>{MENU.done}</DropdownMenuItem>}
            {vis.later && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{MENU.later}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => onAction("later", row, { until: new Date(now + 4 * 3_600_000).toISOString(), label: MENU.in4h })}>
                    {MENU.in4h}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction("later", row, { until: tomorrowNinePhoenix(now), label: MENU.tomorrow9 })}>
                    {MENU.tomorrow9}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {vis.notALead && <DropdownMenuItem onSelect={() => onAction("not_lead", row)}>{MENU.notALead}</DropdownMenuItem>}
            {vis.mine && <DropdownMenuItem onSelect={() => onAction("mine", row)}>{MENU.itsMine}</DropdownMenuItem>}
            {vis.emailLink && <DropdownMenuItem onSelect={() => onAction("email_link", row)}>{MENU.emailTheLink}</DropdownMenuItem>}
            {vis.thatsALead && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{MENU.thatsALead}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => onAction("thats_lead", row, { intent: "opportunity" })}>{MENU.wantsIn}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction("thats_lead", row, { intent: "licensed" })}>{MENU.licensed}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
