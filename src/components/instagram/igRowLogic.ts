// Pure decisions for one IG desk row: the effective status, the main and second button, and the
// 'more' menu. Pure so the tests pin them without rendering. The words a row shows (who they are,
// what they said, what we did, what to do next) live in igStory.ts.
import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck, Check, Clock, FileCheck, Hourglass, Lock, MessageCircle, MessagesSquare, Phone, Send, Tag,
} from "lucide-react";
import { META } from "./igCopy";
import type { IgRow, IgRowContext, IgStatusWord } from "./igTypes";

export type IgButtonKind = "call" | "text" | "open_ig" | "send" | "nudge" | "showed" | "no_show" | "done" | "bring_back";

/** `gold` is the row's main action (filled gold only on the one featured row), `outline` the second. */
export interface IgButtonPair { gold: IgButtonKind; outline: IgButtonKind | null }

/** The icon beside each status word. Decorative: the word carries the meaning. */
export const STATUS_ICON: Record<IgStatusWord, LucideIcon> = {
  call: Phone,
  today: CalendarCheck,
  closing: Hourglass,
  reply: MessageCircle,
  tag_it: Tag,
  closed: Lock,
  casual: MessagesSquare,
  open: Send,
  snoozed: Clock,
  handled: Check,
  booked: CalendarCheck,
  applied: FileCheck,
};

/** The handle when it is a real one, else the name, else a plain fallback. Never "Unknown". */
export function who(row: Pick<IgRow, "handle" | "name">): string {
  const h = (row.handle ?? "").trim();
  if (h && !/^\d+$/.test(h.replace(/^@/, ""))) return h.startsWith("@") ? h : `@${h}`;
  const n = (row.name ?? "").trim();
  return n || META.someone;
}

/** A 'today' row whose slot has passed and carries no outcome. */
export function isPastUnmarked(row: IgRow, now: number = Date.now()): boolean {
  const ev = row.booked_event;
  return !!ev && new Date(ev.scheduled_at).getTime() < now && ev.outcome == null;
}

/**
 * The status the row renders: the server's word, except that a 'today' row whose slot has passed
 * WITH an outcome reads 'booked' (there is nothing left to tap), and a 'tag it' row reads 'closed'
 * until the sender supports HUMAN_AGENT (0 attempts ever; never assumed).
 */
export function effectiveStatus(row: IgRow, humanAgentSupported: boolean, now: number = Date.now()): IgStatusWord {
  if (row.status === "tag_it" && !humanAgentSupported) return "closed";
  if (row.status === "today") {
    const ev = row.booked_event;
    if (ev && new Date(ev.scheduled_at).getTime() < now && ev.outcome != null) return "booked";
  }
  return row.status;
}

export function buttonPair(row: IgRow, humanAgentSupported: boolean, now: number = Date.now()): IgButtonPair {
  const status = effectiveStatus(row, humanAgentSupported, now);
  const hasPhone = !!row.phone;
  switch (status) {
    case "call":
      return { gold: "call", outline: "text" };
    case "today":
      return isPastUnmarked(row, now) ? { gold: "showed", outline: "no_show" } : { gold: "call", outline: "text" };
    case "closing":
    case "reply":
    case "open":
      return { gold: "send", outline: "open_ig" };
    case "tag_it":
      return { gold: "nudge", outline: "open_ig" };
    case "closed":
      return { gold: "open_ig", outline: hasPhone ? "text" : "done" };
    case "casual":
      return { gold: "open_ig", outline: "done" };
    case "snoozed":
    case "handled":
      return { gold: "open_ig", outline: "bring_back" };
    case "booked":
    case "applied":
      return hasPhone ? { gold: "call", outline: "text" } : { gold: "open_ig", outline: "done" };
    default:
      return { gold: "open_ig", outline: null };
  }
}

/** Rows synthesized from applications / interview_events / partials have no DM thread to act on. */
export function isThreadRow(row: Pick<IgRow, "external_id">): boolean {
  return !/^(app|ie|partial|agent):/.test(row.external_id);
}

export interface IgMenuVisibility {
  history: boolean; done: boolean; later: boolean; notALead: boolean; mine: boolean; emailLink: boolean; thatsALead: boolean;
}

export function menuVisibility(row: IgRow, context: IgRowContext, humanAgentSupported: boolean): IgMenuVisibility {
  const thread = isThreadRow(row);
  const status = effectiveStatus(row, humanAgentSupported);
  const business = ["call", "today", "closing", "reply", "tag_it", "closed", "open", "booked"].includes(status);
  const onList = context === "list" || context === "sheet";
  return {
    history: thread,
    done: thread && status !== "handled",
    later: thread && status !== "snoozed",
    notALead: thread,
    mine: thread && !row.human_lane,
    emailLink: !!row.email,
    thatsALead: thread && (context === "everyone" || context === "later" || context === "people" || !business) && !(onList && business),
  };
}
