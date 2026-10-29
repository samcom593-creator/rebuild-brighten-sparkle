import {
  channelAvailability,
  effectiveDueMs,
  hasRecordedContact,
  isOpen,
  phoenixDayBounds,
  type ContactChannel,
  type WorklistRow,
} from "@/lib/recruitingQueues";
import { STATUS_TONE } from "@/components/recruiting/StatusPill";
import { isDialablePhone } from "@/lib/phone";
import type { Tone } from "@/lib/tones";
import { formatDueShort, formatSince, formatTimeWithZone } from "./worklistFormat";
import { rowStatus } from "./worklistStatus";

/**
 * The one thing to do next with a person, in words a VA reads once (OVERHAUL-calllist,
 * 2026-10-29). Sam: "needs a complete makeover. Use logic and make it easier for the agent."
 *
 * Measured on Sam's live worklist that day: no outcome had ever been recorded, and 86 of the 97
 * applications from the last 90 days carried the automation stamp MANAGER_CALL_72H_ESCALATION,
 * which the list printed as "Next: Suggested: manager call 72h escalation". That is an internal
 * timer, not something a caller can do. This module reads the record and says what to do
 * instead, first match wins:
 *
 *   1. Closed people: do not contact, already joined, said no, or closed. Nothing to do.
 *   2. No usable phone: email them for a working number, or say there is no way to reach them.
 *   3. A step a PERSON set (next_action_set_at is written only by record_recruiting_outcome and
 *      set_recruiting_plan): their own words, with when it is due. A date nobody can read says so.
 *   4. Never reached: the first call, with how long ago they applied.
 *   5. Reached before with nothing planned: follow up.
 *
 * Nothing here decides who is in a list or in what order: queue membership and order stay in
 * src/lib/recruitingQueues.ts. The tone is the person's status tone (the pill and the bubble
 * beside it), so one person is never red in one place and blue in another; a booked interview
 * reads as scheduled, and a closed person as quiet.
 */
export type NextStepKey =
  | "do_not_contact"
  | "joined"
  | "said_no"
  | "closed"
  | "get_working_number"
  | "no_way_to_reach"
  | "fix_date"
  | "check_in"
  | "waiting"
  | "planned_late"
  | "planned_today"
  | "planned_later"
  | "booked"
  | "first_call"
  | "follow_up";

export interface NextStep {
  key: NextStepKey;
  /** The action in a few plain words: "First call", "Call back", "Email for a working number". */
  title: string;
  /** Why, in one short sentence: "Applied 9 days ago. Nobody has reached them yet." */
  detail: string;
  tone: Tone;
  /** The contact control the step uses, or null when it needs none (waiting, closed, nothing usable). */
  channel: Extract<ContactChannel, "call" | "sms" | "email"> | null;
  /** A person set this step. A suggestion worked out from the record is false. */
  planned: boolean;
}

const CONVERTED = new Set(["contracting", "onboarding", "paid", "approved", "producing", "hired"]);

/** "Tomorrow 10:00 AM" mid-sentence reads "tomorrow 10:00 AM"; "Thu" and "Nov 12" are names and keep their capital. */
function midSentence(words: string): string {
  return words.startsWith("Tomorrow") ? `t${words.slice(1)}` : words;
}

/** A person-set plan: the RPCs stamp next_action_set_at; automation never does. */
export function hasPersonPlan(row: WorklistRow): boolean {
  return Boolean(row.next_action_set_at) && Boolean(row.next_action?.trim() || row.waiting_reason?.trim());
}

function closedStep(row: WorklistRow): NextStep {
  if (row.do_not_contact_at) {
    return { key: "do_not_contact", title: "Do not contact", detail: "They asked us to stop calling, texting and emailing.", tone: "hot", channel: null, planned: false };
  }
  if (row.has_agent || CONVERTED.has((row.status ?? "").toLowerCase())) {
    return { key: "joined", title: "Already joined", detail: "They are past recruiting, so there is no call to make.", tone: "good", channel: null, planned: false };
  }
  if (row.last_contact_outcome === "not_interested") {
    return { key: "said_no", title: "Said no", detail: "They told us they are not interested.", tone: "slate", channel: null, planned: false };
  }
  return { key: "closed", title: "Closed", detail: "No more calls are planned for this person.", tone: "slate", channel: null, planned: false };
}

export function nextStepFor(row: WorklistRow, now: number): NextStep {
  if (!isOpen(row)) return closedStep(row);

  const status = rowStatus(row, now);
  const statusTone = STATUS_TONE[status.tone];
  const planned = hasPersonPlan(row);
  const reach = channelAvailability(row);

  // 2. The phone cannot be used: none on file, marked bad, or too short or garbled to dial (the
  //    Call link cannot be built for it). Asking by email is the useful move, if email is allowed.
  if (!reach.call.allowed || !isDialablePhone(row.phone)) {
    const why = !row.phone?.trim()
      ? "There is no phone number on file."
      : row.phone_bad_at
        ? "Their phone number is marked bad."
        : "The phone number on file can't be dialed.";
    return reach.email.allowed
      ? { key: "get_working_number", title: "Email for a working number", detail: why, tone: statusTone, channel: "email", planned }
      : { key: "no_way_to_reach", title: "No way to reach them", detail: `${why} Email can't be used either.`, tone: statusTone, channel: null, planned };
  }

  // 3. A step someone set by hand, in their own words.
  if (planned) {
    const due = effectiveDueMs(row);
    if (due !== null && Number.isNaN(due)) {
      return { key: "fix_date", title: "Set a new date", detail: "The follow-up date on file can't be read.", tone: statusTone, channel: null, planned };
    }
    const waitingOnly = Boolean(row.waiting_reason?.trim()) && !row.next_action_due_at;
    if (waitingOnly) {
      const reason = row.waiting_reason?.trim() ?? "";
      if (due !== null && due < now) {
        return { key: "check_in", title: "Check in with them", detail: `Waiting for: ${reason}. The check-back date was ${formatSince(row.next_review_at, now)}.`, tone: statusTone, channel: "call", planned };
      }
      const when = row.next_review_at ? ` Check back ${midSentence(formatDueShort(row.next_review_at, now))}.` : "";
      return { key: "waiting", title: "Wait for them", detail: `Waiting for: ${reason}.${when}`, tone: statusTone, channel: null, planned };
    }
    const title = row.next_action?.trim() || "Follow up";
    if (due === null) {
      return { key: "follow_up", title, detail: "No due time is set.", tone: statusTone, channel: "call", planned };
    }
    if (due < now) {
      return { key: "planned_late", title, detail: `Was due ${formatSince(row.next_action_due_at ?? row.next_review_at, now)}.`, tone: statusTone, channel: "call", planned };
    }
    if (row.last_contact_outcome === "appointment_booked") {
      return { key: "booked", title, detail: `Booked for ${midSentence(formatDueShort(row.next_action_due_at, now))}.`, tone: "cool", channel: "call", planned };
    }
    const { end } = phoenixDayBounds(new Date(now));
    if (due < end) {
      return { key: "planned_today", title, detail: `Due today at ${formatTimeWithZone(row.next_action_due_at)}.`, tone: statusTone, channel: "call", planned };
    }
    return { key: "planned_later", title, detail: `Not due until ${midSentence(formatDueShort(row.next_action_due_at, now))}.`, tone: statusTone, channel: "call", planned };
  }

  // 4. Nobody has reached them: the first call. How long they have waited is the reason.
  if (!hasRecordedContact(row)) {
    return { key: "first_call", title: "First call", detail: `Applied ${formatSince(row.created_at, now)}. Nobody has reached them yet.`, tone: statusTone, channel: "call", planned };
  }

  // 5. Reached before, nothing planned since.
  const last = row.last_contact_outcome_at ?? row.last_contacted_at;
  return { key: "follow_up", title: "Follow up", detail: `Last contact ${formatSince(last, now)}. No next step is set.`, tone: statusTone, channel: "call", planned };
}

/**
 * The step as the list row says it, one short line. A step a person set keeps its own words
 * after "Next:" (or "Waiting for:"), exactly as before; a suggestion is said as the action alone,
 * so a row never claims "Next:" for a plan nobody made. The first call carries how long the
 * person has waited, the one fact about them the row has no other place for.
 */
export function nextStepLine(row: WorklistRow, step: NextStep, now: number): string | null {
  if (!isOpen(row)) return null;
  if (step.planned) {
    if (row.next_action?.trim()) return `Next: ${row.next_action.trim()}`;
    if (row.waiting_reason?.trim()) return `Waiting for: ${row.waiting_reason.trim()}`;
  }
  if (step.key === "first_call") return `First call · applied ${formatSince(row.created_at, now)}`;
  return step.title;
}

/** "Call Mariah", "Email Mariah", "Open Mariah": the gold button's words for the step's channel. */
export function nextStepActionLabel(row: Pick<WorklistRow, "first_name" | "last_name">, step: NextStep): string {
  const first = (row.first_name ?? "").trim() || (row.last_name ?? "").trim();
  const verb = step.channel === "call" ? "Call" : step.channel === "email" ? "Email" : step.channel === "sms" ? "Text" : "Open";
  return first ? `${verb} ${first}` : verb;
}
