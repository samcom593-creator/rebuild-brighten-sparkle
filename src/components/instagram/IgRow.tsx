// The one row shape on every IG desk surface (list, everyone else, later, people tab, every sheet).
// Line 1: who + status word. Line 2: their words. Line 3: meta + ONE gold button + ONE outline
// button + a 'more' word. A fourth line never exists.
import { useCallback } from "react";
import { ChevronDown, ExternalLink, MessageCircle, Phone, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { contactLinkProps, formatPhoneDisplay, phoneHref, smsHref } from "@/lib/phone";
import { igThreadUrl } from "@/lib/instagram";
import { cn } from "@/lib/utils";
import { BUTTON, MENU, META, SMS, TOAST } from "./igCopy";
import { phoenixDayTime, tomorrowNinePhoenix } from "./igFormat";
import {
  STATUS_ICON, buttonPair, effectiveStatus, menuVisibility, metaText, statusWordText, who, type IgButtonKind,
} from "./igRowLogic";
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
  className?: string;
}

function defaultSmsBody(row: IgRowData, humanAgentSupported: boolean, now: number): string {
  const status = effectiveStatus(row, humanAgentSupported, now);
  if (status === "today" && row.booked_event) return SMS.today(phoenixDayTime(row.booked_event.scheduled_at));
  if (status === "call" || status === "booked" || status === "applied") return SMS.call;
  return SMS.numberNotBooked;
}

export function IgRow({ row, context, humanAgentSupported, onAction, smsBody, now = Date.now(), className }: IgRowProps) {
  const status = effectiveStatus(row, humanAgentSupported, now);
  const Icon = STATUS_ICON[status];
  const pair = buttonPair(row, humanAgentSupported, now);
  const name = who(row);
  const meta = metaText(row, humanAgentSupported, now);
  const vis = menuVisibility(row, context, humanAgentSupported);
  const body = smsBody ?? defaultSmsBody(row, humanAgentSupported, now);
  const tel = phoneHref(row.phone);
  const sms = smsHref(row.phone, body);
  const igUrl = igThreadUrl(row.handle);

  const onTextClick = useCallback(() => {
    // Google Voice's composer has no prefill, so on desktop the body is shown as copyable text.
    if (sms && sms.startsWith("https://")) {
      toast(TOAST.smsBodyCopied, { description: body, duration: 10_000 });
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(body).catch((e) => console.warn("[ig-desk] clipboard refused", e));
      }
    }
  }, [sms, body]);

  const sizing = "h-11 sm:h-9";

  const renderButton = (kind: IgButtonKind | null, variant: "default" | "outline", alone: boolean) => {
    if (!kind) return null;
    const cls = cn(sizing, alone && variant === "default" && "w-full sm:w-auto");
    switch (kind) {
      case "call":
        if (!tel || !row.phone) return renderButton("open_ig", variant, alone);
        return (
          <Button asChild variant={variant} className={cls}>
            <a href={tel} {...contactLinkProps(tel)} aria-label={`call ${name}`}>
              <Phone className="h-4 w-4" />
              {BUTTON.call(formatPhoneDisplay(row.phone))}
            </a>
          </Button>
        );
      case "text":
        if (!sms) return null;
        return (
          <Button asChild variant={variant} className={cls}>
            <a href={sms} {...contactLinkProps(sms)} onClick={onTextClick} aria-label={`text ${name}`}>
              <MessageCircle className="h-4 w-4" />
              {BUTTON.text}
            </a>
          </Button>
        );
      case "open_ig":
        return (
          <Button asChild variant={variant} className={cls}>
            <a href={igUrl} target="_blank" rel="noopener noreferrer" aria-label={`open ${name} on instagram`}>
              <ExternalLink className="h-4 w-4" />
              {BUTTON.openIg}
            </a>
          </Button>
        );
      case "send":
        return (
          <Button variant={variant} className={cls} onClick={() => onAction("send", row)}>
            <Send className="h-4 w-4" />
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

  const quote = row.last_body?.trim();
  const ours = row.last_direction === "outbound";

  return (
    <div className={cn("min-h-[44px] border-b border-border py-3", className)} data-external-id={row.external_id} data-status={status}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 truncate text-base font-semibold">{name}</div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground",
            (status === "call" || status === "closing") && "text-primary",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span>{statusWordText(status)}</span>
        </div>
      </div>
      {quote ? (
        <p className={cn("mt-1 text-sm text-muted-foreground", ours ? "line-clamp-1" : "line-clamp-2")}>
          {ours ? <span className="italic">{META.youPrefix}</span> : null}
          {ours ? quote : `“${quote}”`}
        </p>
      ) : null}
      {row.note ? <p className="mt-1 text-xs text-muted-foreground">{row.note}</p> : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{meta}</span>
        <div className="flex flex-wrap items-center gap-2">
          {renderButton(pair.gold, "default", !pair.outline)}
          {renderButton(pair.outline, "outline", false)}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={cn(sizing, "px-2 text-muted-foreground")} aria-label={`more for ${name}`}>
                {BUTTON.more}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[10rem]">
              <DropdownMenuItem asChild>
                <a href={igUrl} target="_blank" rel="noopener noreferrer">{MENU.openIg}</a>
              </DropdownMenuItem>
              {vis.history && <DropdownMenuItem onSelect={() => onAction("history", row)}>{MENU.history}</DropdownMenuItem>}
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
      </div>
    </div>
  );
}
