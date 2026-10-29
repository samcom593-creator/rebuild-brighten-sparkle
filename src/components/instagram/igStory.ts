// The story of one IG desk row, in words (OVERHAUL-instagram, 2026-10-28). Sam's ask: every row says
// who they are, what they last said, what we last did, and what to do next. Pure, so the tests pin
// every branch without rendering.
//
// Truth rules this keeps:
//  - "Delivered" only on a Meta mid (last_out.state 'delivered'); a bot send through ManyChat has no
//    receipt and says so. Refused sends say "not delivered" with Meta's reason.
//  - Unknown is not "nobody": a row built from a booking or an application with no DM thread has no
//    last_out key at all, and then the "what we did" line is left out instead of claiming silence.
//  - Ages are from the instants the server measured; only display is Phoenix time.
import { firstGrapheme } from "@/lib/personInitials";
import { formatPhoneDisplay } from "@/lib/phone";
import { igDeskTone, type Tone } from "@/lib/tones";
import { CAME_FROM, DID, FACT, INTENT_WORD, NEXT, PILL, REFUSAL_WORD, SAID } from "./igCopy";
import { agoWords, phoenixDayTime, phoenixTime, shortAge } from "./igFormat";
import { effectiveStatus, isPastUnmarked, who } from "./igRowLogic";
import type { IgRow } from "./igTypes";

export type IgPillKey =
  | "call" | "booked" | "did_they_show" | "closing" | "reply" | "tag_it" | "closed" | "casual" | "open"
  | "snoozed" | "handled" | "showed" | "no_show" | "applied" | "hired";

export interface IgChip { key: string; text: string; tone: Tone }

export interface IgStory {
  /** @handle when there is a real one, else the name. */
  name: string;
  /** The display name when it adds something beside the handle. */
  alias: string | null;
  /** One grapheme for the avatar bubble. */
  initial: string;
  pill: IgChip;
  facts: IgChip[];
  /** "Commented on “…” · first wrote 12d ago · 3 messages", or null when nothing is known. */
  origin: string | null;
  /** Their newest words. `at` orders the two lines like a chat: the older one first. */
  said: { text: string; ago: string; at: number | null } | null;
  /** Our newest move: a send (with its delivery truth) or a desk action. null = unknown. */
  did: { label: string; text: string | null; ago: string; note: string | null; tone: Tone; at: number | null } | null;
  next: { text: string; tone: Tone };
}

const SHOWED_OUTCOMES = new Set(["completed", "hired", "contracted", "passed"]);
const BUSINESS_INTENTS = new Set(["opportunity", "licensed", "licensed_team", "mentorship", "fitness", "rentals", "partnership", "followup", "winback"]);

function ms(at: string | null | undefined): number | null {
  if (!at) return null;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : null;
}

/** The pill: the row's state in words, from the effective status and the booking outcome. */
export function pillFor(row: IgRow, humanAgentSupported: boolean, now: number = Date.now()): IgChip {
  const status = effectiveStatus(row, humanAgentSupported, now);
  const outcome = row.booked_event?.outcome ?? null;
  let key: IgPillKey;
  switch (status) {
    case "call": key = "call"; break;
    case "today": key = isPastUnmarked(row, now) ? "did_they_show" : "booked"; break;
    case "closing": key = "closing"; break;
    case "reply": key = "reply"; break;
    case "tag_it": key = "tag_it"; break;
    case "closed": key = "closed"; break;
    case "casual": key = "casual"; break;
    case "open": key = "open"; break;
    case "snoozed": key = "snoozed"; break;
    case "handled": key = "handled"; break;
    case "booked": key = outcome === "no_show" ? "no_show" : outcome && SHOWED_OUTCOMES.has(outcome) ? "showed" : "booked"; break;
    case "applied": key = row.agent_status || row.hired_at ? "hired" : "applied"; break;
    default: key = "open";
  }
  const text: Record<IgPillKey, string> = {
    call: PILL.call, booked: PILL.booked, did_they_show: PILL.didTheyShow, closing: PILL.closing, reply: PILL.reply,
    tag_it: PILL.tagIt, closed: PILL.closed, casual: PILL.casual, open: PILL.open, snoozed: PILL.snoozed,
    handled: PILL.handled, showed: PILL.showed, no_show: PILL.noShow, applied: PILL.applied, hired: PILL.hired,
  };
  return { key, text: text[key], tone: igDeskTone(key) };
}

/** Who they are, as short facts: what they want, what they gave us, where they are in the process. */
export function factsFor(row: IgRow): IgChip[] {
  const facts: IgChip[] = [];
  const intent = (row.intent ?? "").trim().toLowerCase();
  if (row.licensed || intent === "licensed" || intent === "licensed_team") {
    facts.push({ key: "licensed", text: intent === "licensed_team" ? INTENT_WORD.licensed_team : INTENT_WORD.licensed, tone: igDeskTone("licensed") });
  } else if (intent === "opportunity" || intent === "winback") {
    facts.push({ key: "wants_in", text: INTENT_WORD[intent], tone: igDeskTone("wants_in") });
  } else if (intent === "followup") {
    facts.push({ key: "following_up", text: INTENT_WORD.followup, tone: igDeskTone("following_up") });
  } else if (INTENT_WORD[intent]) {
    facts.push({ key: intent, text: INTENT_WORD[intent], tone: igDeskTone(intent) });
  }
  if (row.phone) facts.push({ key: "gave_number", text: FACT.gaveNumber, tone: igDeskTone("gave_number") });
  else if (row.email) facts.push({ key: "gave_email", text: FACT.gaveEmail, tone: igDeskTone("gave_email") });
  if (row.applied) {
    const status = (row.application_status ?? "").replace(/_/g, " ").trim();
    facts.push({ key: "applied", text: status ? FACT.appliedStatus(status) : FACT.applied, tone: igDeskTone("applied") });
  }
  if (row.told_locked_in && !row.has_booking) facts.push({ key: "locked_in_gap", text: FACT.lockedInGap, tone: igDeskTone("locked_in_gap") });
  else if (row.has_booking && !row.booked_event) facts.push({ key: "booked_before", text: FACT.bookedBefore, tone: igDeskTone("booked_before") });
  if (row.human_lane) facts.push({ key: "your_thread", text: FACT.yourThread, tone: igDeskTone("your_thread") });
  return facts;
}

/** How they came in and how long they have been writing. */
export function originFor(row: IgRow, now: number = Date.now()): string | null {
  const parts: string[] = [];
  const from = row.came_from;
  const channel = (from?.channel ?? "").toLowerCase();
  if (channel === "comment") parts.push(from?.reel_title?.trim() ? CAME_FROM.comment(truncate(from.reel_title.trim(), 48)) : CAME_FROM.commentNoTitle);
  else if (channel === "story") parts.push(CAME_FROM.story);
  else if (channel === "dm") parts.push(CAME_FROM.dm);
  const first = ms(row.first_in_at ?? null);
  if (first != null) parts.push(CAME_FROM.firstWrote(shortAge(first, now)));
  if (row.in_count != null && row.in_count > 1) parts.push(CAME_FROM.messages(row.in_count));
  return parts.length ? parts.join(" · ") : null;
}

/** Their newest words. Falls back to last_body only when the server says it is theirs. */
export function saidFor(row: IgRow, now: number = Date.now()): IgStory["said"] {
  const text = (row.last_in_body ?? (row.last_direction === "inbound" ? row.last_body : null) ?? "").trim();
  if (!text) return null;
  const at = row.last_inbound_at ?? row.last_at;
  return { text, ago: agoWords(at, now), at: ms(at) };
}

function deskWords(action: string, until: string | null): string | null {
  const w = DID.desk[action];
  if (!w) return null;
  return typeof w === "function" ? w(phoenixTime(until)) : w;
}

/** Our newest move: a desk action newer than our last send wins; otherwise the send and its truth. */
export function didFor(row: IgRow, business: boolean, now: number = Date.now()): IgStory["did"] {
  const out = row.last_out;
  const act = row.last_action ?? null;
  const outAt = ms(out?.at ?? null);
  const actAt = ms(act?.at ?? null);
  if (act && actAt != null && (outAt == null || actAt >= outAt)) {
    const words = deskWords(act.action, act.until);
    if (words) return { label: words, text: null, ago: agoWords(actAt, now), note: null, tone: act.action === "handled" ? "good" : "slate", at: actAt };
  }
  if (out === undefined) {
    // A server older than 20261029070000 sends one side only: when ours is newest, last_body is the
    // last send that carried no error. Who sent it and whether Meta took it are unknown, so say neither.
    const ours = row.last_direction === "outbound" ? (row.last_body ?? "").trim() : "";
    return ours ? { label: DID.weReplied, text: ours, ago: agoWords(row.last_at, now), note: null, tone: "slate", at: ms(row.last_at) } : null;
  }
  // "Nobody has answered" is a statement about now, so it always reads after their words.
  if (out === null) return { label: DID.nobody, text: null, ago: "", note: null, tone: business ? "hot" : "slate", at: null };
  const refused = out.state === "refused";
  const label = out.by === "bot" ? (refused ? DID.botTried : DID.botReplied) : refused ? DID.youTried : DID.youReplied;
  let note: string;
  switch (out.state) {
    case "delivered": note = DID.delivered; break;
    case "handed": note = DID.handed; break;
    case "queued": note = DID.queued; break;
    case "refused": {
      const why = out.kind ? REFUSAL_WORD[out.kind] ?? out.kind.replace(/_/g, " ") : null;
      note = why ? DID.refused(why) : DID.refusedNoWhy;
      break;
    }
    default: note = DID.noReceipt;
  }
  const tone: Tone = refused ? "hot" : out.state === "queued" ? "warm" : out.state === "delivered" ? "good" : "slate";
  return { label, text: (out.body ?? "").trim() || null, ago: agoWords(outAt, now), note, tone, at: outAt };
}

/** True when our last move came before their last words, so ours reads first, like a chat. */
export function oursFirst(story: Pick<IgStory, "said" | "did">): boolean {
  const s = story.said?.at ?? null;
  const d = story.did?.at ?? null;
  return s != null && d != null && d < s;
}

/** What to do next, as one plain sentence in the row's tone. */
export function nextFor(row: IgRow, humanAgentSupported: boolean, now: number = Date.now()): IgStory["next"] {
  const pill = pillFor(row, humanAgentSupported, now);
  const phone = row.phone ? formatPhoneDisplay(row.phone) : "";
  let text: string;
  switch (pill.key) {
    case "call": {
      const why = row.told_locked_in && !row.has_booking ? NEXT.whyLockedIn
        : row.has_booking ? NEXT.whyPassed
          : row.licensed ? NEXT.whyLicensed
            : NEXT.whyNumber;
      text = `${phone ? NEXT.call(phone) : NEXT.callNoPhone} ${why}`;
      break;
    }
    case "booked":
      text = row.booked_event ? NEXT.booked(phoenixDayTime(row.booked_event.scheduled_at)) : NEXT.bookedNoOutcome;
      break;
    case "did_they_show": text = NEXT.didTheyShow; break;
    case "closing": text = NEXT.closing(phoenixTime(row.window_closes_at ?? null)); break;
    case "reply": text = NEXT.reply; break;
    case "tag_it": text = NEXT.tagIt; break;
    case "closed": text = row.phone ? NEXT.closedPhone : NEXT.closed; break;
    case "casual": text = NEXT.casual; break;
    case "open": text = NEXT.open; break;
    case "snoozed": text = NEXT.snoozed(phoenixTime(row.snoozed_until ?? null)); break;
    case "handled": text = NEXT.handled; break;
    case "showed": text = NEXT.showed; break;
    case "no_show": text = NEXT.noShow; break;
    case "applied":
    case "hired":
      text = row.phone ? NEXT.appliedPhone : NEXT.applied;
      break;
    default: text = NEXT.open;
  }
  return { text, tone: pill.tone };
}

export function rowStory(row: IgRow, humanAgentSupported: boolean, now: number = Date.now()): IgStory {
  const name = who(row);
  const alias = (row.name ?? "").trim();
  const pill = pillFor(row, humanAgentSupported, now);
  const intent = (row.intent ?? "").trim().toLowerCase();
  const business = BUSINESS_INTENTS.has(intent) || row.has_booking || row.applied;
  return {
    name,
    alias: alias && alias !== name && `@${alias}` !== name ? alias : null,
    initial: (firstGrapheme(name.replace(/^@/, "")) || "?").toUpperCase(),
    pill,
    facts: factsFor(row),
    origin: originFor(row, now),
    said: saidFor(row, now),
    did: didFor(row, business, now),
    next: nextFor(row, humanAgentSupported, now),
  };
}

function truncate(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n - 1).join("").trimEnd()}…` : s;
}
