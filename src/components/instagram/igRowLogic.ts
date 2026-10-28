// Pure decisions for one IG desk row: the status word's icon, the gold/outline button pair, the
// line-3 meta and the 'more' menu visibility. Pure so the test pins them without rendering.
import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck, Check, Clock, FileCheck, Hourglass, Lock, MessageCircle, MessagesSquare, Phone, Send, Tag,
} from "lucide-react";
import { formatPhoneDisplay } from "@/lib/phone";
import { META, STATUS_WORD } from "./igCopy";
import { phoenixDayTime, phoenixTime, shortAge } from "./igFormat";
import type { IgRow, IgRowContext, IgStatusWord } from "./igTypes";

export type IgButtonKind = "call" | "text" | "open_ig" | "send" | "nudge" | "showed" | "no_show" | "done" | "bring_back";

export interface IgButtonPair { gold: IgButtonKind; outline: IgButtonKind | null }

/** Business threads only get the converting buttons; everything else gets the app. */
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
 * The status word the row renders: the server's word, except that a 'today' row whose slot has
 * passed WITH an outcome reads 'booked' (there is nothing left to tap), and a 'tag it' row reads
 * 'closed' until the sender supports HUMAN_AGENT (0 attempts ever; never assumed).
 */
export function effectiveStatus(row: IgRow, humanAgentSupported: boolean, now: number = Date.now()): IgStatusWord {
  if (row.status === "tag_it" && !humanAgentSupported) return "closed";
  if (row.status === "today") {
    const ev = row.booked_event;
    if (ev && new Date(ev.scheduled_at).getTime() < now && ev.outcome != null) return "booked";
  }
  return row.status;
}

export function statusWordText(status: IgStatusWord): string {
  return STATUS_WORD[status];
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

/** Line 3, left side. The number is visible before the tap (feedback_no_hidden_working_data). */
export function metaText(row: IgRow, humanAgentSupported: boolean, now: number = Date.now()): string {
  const status = effectiveStatus(row, humanAgentSupported, now);
  const parts: string[] = [];
  const age = shortAge(row.last_inbound_at ?? row.last_at, now);
  switch (status) {
    case "call":
      if (row.phone) parts.push(formatPhoneDisplay(row.phone));
      if (age) parts.push(age);
      break;
    case "today": {
      const ev = row.booked_event;
      if (ev) {
        const t = new Date(ev.scheduled_at).getTime();
        if (t < now && ev.outcome == null) parts.push(META.wasAgo(shortAge(t, now)));
        else parts.push(META.az(phoenixDayTime(ev.scheduled_at)));
      }
      if (row.phone) parts.push(formatPhoneDisplay(row.phone));
      break;
    }
    case "closing":
      if (row.window_closes_at) parts.push(META.closes(phoenixTime(row.window_closes_at)));
      else if (age) parts.push(age);
      break;
    case "closed":
      if (age) parts.push(age);
      parts.push(META.windowClosed);
      break;
    case "snoozed":
      if (row.snoozed_until) parts.push(META.till(phoenixTime(row.snoozed_until)));
      break;
    case "handled":
      if (row.handled_at) parts.push(META.handledAgo(shortAge(row.handled_at, now)));
      break;
    case "booked": {
      const ev = row.booked_event;
      if (ev?.outcome) parts.push(ev.outcome.replace(/_/g, "-"));
      else if (age) parts.push(age);
      if (row.phone) parts.push(formatPhoneDisplay(row.phone));
      break;
    }
    default:
      if (age) parts.push(age);
  }
  if (row.human_lane) parts.push(META.yourThread);
  return parts.join(" · ");
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
