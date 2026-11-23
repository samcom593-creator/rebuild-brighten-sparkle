/**
 * Monday roll call (MP-MONDAY-ROLLCALL, 2026-11-22): the rules behind the owner Home card.
 *
 * Source: owner_monday_rollcall(). One row per hire of the last 45 days. This file decides the
 * order to call in, what each person still needs before the meeting, and what the header counts.
 * It is pure so the order and the wording are testable without a browser.
 */

import { formatTimeAgo } from "@/lib/dateUtils";
import { isRealUsNumber } from "@/lib/phone";

export type RollCallMark = "confirmed" | "no_answer" | "texted" | "cant_make_it" | "showed" | "no_show";
/** hired_direct: a hire link, Add Agent or an import. The other four are a self-enrolled applicant. */
export type InterviewState = "hired_direct" | "interviewed" | "upcoming" | "missed" | "never";

export interface RollCallRow {
  agent_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  hired_at: string;
  days_since_hire: number;
  this_week: boolean;
  how_hired: "hire_link" | "added" | "self_enrolled";
  interview_state: InterviewState | null;
  interview_at: string | null;
  licensed: boolean;
  license_step: string | null;
  npn_on_file: boolean;
  npn_note: string | null;
  license_states: string[] | null;
  phone_state_hint: string | null;
  leads_state: string;
  live_leads: number;
  last_sign_in_at: string | null;
  manager_name: string | null;
  stage: string | null;
  mark: RollCallMark | null;
  mark_note: string | null;
  marked_at: string | null;
  marked_by: string | null;
}

export interface RollCallPayload {
  monday: string;
  is_today: boolean;
  rows: RollCallRow[];
}

export const MARK_LABEL: Record<RollCallMark, string> = {
  confirmed: "Confirmed",
  no_answer: "No answer",
  texted: "Texted",
  cant_make_it: "Can't make it",
  showed: "Showed",
  no_show: "No show",
};

/** Before the meeting you confirm people; on the day you take attendance. */
export const BEFORE_MARKS: readonly RollCallMark[] = ["confirmed", "no_answer", "texted", "cant_make_it"];
export const DAY_OF_MARKS: readonly RollCallMark[] = ["showed", "no_show"];

const LICENSE_STEP_LABEL: Record<string, string> = {
  unlicensed: "Not licensed yet",
  course_purchased: "Bought the course",
  course_started: "In the course",
  finished_course: "Finished the course",
  test_scheduled: "Exam booked",
  failed_test: "Failed the exam",
  passed_test: "Passed the exam",
  exam_passed: "Passed the exam",
  fingerprints_done: "Fingerprints done",
  waiting_fingerprints: "Waiting on fingerprints",
  waiting_on_license: "Waiting on the license",
};

const PHOENIX = "America/Phoenix";

/** "Sat, Nov 21, 5:00 PM" in Arizona time: the clock Sam's calendar runs on. */
export function phoenixWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHOENIX, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(d);
}

/** "Monday, Nov 23" from the yyyy-mm-dd the server sends. */
export function mondayLabel(monday: string): string {
  const d = new Date(`${monday}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Monday";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(d);
}

export function hiredLabel(row: Pick<RollCallRow, "hired_at" | "how_hired">): string {
  // The shared formatter: "2h ago", "Yesterday", "3d ago", then a date. Mid-sentence, so no capital.
  const ago = formatTimeAgo(row.hired_at);
  const when = ago === "Yesterday" ? "yesterday" : ago;
  // A self-enrolled person was not hired by anyone: they applied as licensed and opened the course.
  return row.how_hired === "self_enrolled" ? `Joined ${when} from an application` : `Hired ${when}`;
}

/** True when nobody has interviewed this person, whatever the reason. */
export function notInterviewed(row: Pick<RollCallRow, "interview_state">): boolean {
  return row.interview_state === "missed" || row.interview_state === "upcoming" || row.interview_state === "never";
}

/** The single line that says where the interview stands; null for a person someone hired directly. */
export function interviewLine(row: Pick<RollCallRow, "interview_state" | "interview_at">): string | null {
  const when = phoenixWhen(row.interview_at);
  switch (row.interview_state) {
    case "missed":
      return when ? `Interview was ${when} and no result was recorded` : "Interview time passed and no result was recorded";
    case "upcoming":
      return when ? `Interview ${when}` : "Interview booked";
    case "never":
      return "Never interviewed and no call booked";
    default:
      return null;
  }
}

/** Ten digits a US carrier could route. "1480555010" (a country code kept, the last digit lost) is not one. */
export function phoneUsable(phone: string | null | undefined): boolean {
  return isRealUsNumber(phone);
}

/** What this person still needs before they can sit in the meeting and work. Short, one fact each. */
export function needsList(row: RollCallRow): string[] {
  const out: string[] = [];
  if (!row.phone) out.push("No phone on file");
  else if (!phoneUsable(row.phone)) out.push("Phone on file is missing a digit: get the right number");
  if (!row.last_sign_in_at) out.push("Has not signed in");
  if (!row.licensed) out.push(LICENSE_STEP_LABEL[row.license_step ?? "unlicensed"] ?? "Not licensed yet");
  if (row.licensed && !row.npn_on_file) out.push(row.npn_note ? `No NPN: "${row.npn_note}"` : "No NPN on file");
  if (row.licensed && !(row.license_states && row.license_states.length)) out.push("License state not on file");
  return out;
}

/** Where this person's leads stand, in the words of the next action. */
export function leadsLine(row: RollCallRow): string {
  if (row.live_leads > 0) return `${row.live_leads} leads in My Leads`;
  switch (row.leads_state) {
    case "ready":
      return "Gets a 25-lead starter pack at the next hourly run";
    case "license_state_unknown":
      return "No leads until a license state is on file";
    case "not_interviewed_yet":
      return "No leads until interviewed";
    case "not_signed_in_since_hire":
      return "No leads until they sign in";
    case "starter_pack_already_given":
      return "Starter pack already used: drop a new batch from Lead Manager";
    case "has_live_lead_bundle":
      return "Has a lead pack";
    case "not_licensed":
      return "No leads until licensed";
    case "suspended":
    case "login_banned":
      return "No leads: access is off";
    default:
      return "No leads yet";
  }
}

/**
 * Call order. An interview that was not held comes first because that person is owed a call.
 * Then people nobody has reached, this week's hires before older ones. People already
 * confirmed sink; "can't make it" sits last because the call was made and answered.
 */
export function rollCallRank(row: RollCallRow): number {
  if (row.mark === "showed") return 8;
  if (row.mark === "no_show") return 3;
  if (row.mark === "cant_make_it") return 7;
  if (row.mark === "confirmed") return 6;
  if (row.interview_state === "missed") return 0;
  if (row.mark === "no_answer" || row.mark === "texted") return 4;
  if (row.interview_state === "upcoming" || row.interview_state === "never") return 1;
  return row.this_week ? 2 : 5;
}

export function sortRollCall(rows: readonly RollCallRow[]): RollCallRow[] {
  return [...rows].sort((a, b) => {
    const rank = rollCallRank(a) - rollCallRank(b);
    if (rank !== 0) return rank;
    const hired = new Date(b.hired_at).getTime() - new Date(a.hired_at).getTime();
    if (hired !== 0) return hired;
    return a.name.localeCompare(b.name);
  });
}

export interface RollCallSummary {
  total: number;
  confirmed: number;
  toCall: number;
  cantMake: number;
  showed: number;
  noShow: number;
  notInterviewed: number;
  noLeadsYet: number;
}

export function summarize(rows: readonly RollCallRow[]): RollCallSummary {
  const s: RollCallSummary = { total: rows.length, confirmed: 0, toCall: 0, cantMake: 0, showed: 0, noShow: 0, notInterviewed: 0, noLeadsYet: 0 };
  for (const r of rows) {
    if (r.mark === "confirmed") s.confirmed += 1;
    else if (r.mark === "cant_make_it") s.cantMake += 1;
    else if (r.mark === "showed") s.showed += 1;
    else if (r.mark === "no_show") s.noShow += 1;
    else s.toCall += 1;
    if (notInterviewed(r)) s.notInterviewed += 1;
    if (r.licensed && r.live_leads === 0) s.noLeadsYet += 1;
  }
  return s;
}

/** Two-letter codes out of whatever was typed: "wi, mn" and "WI MN" both give ["WI","MN"]. */
export function parseStates(input: string): string[] {
  const seen = new Set<string>();
  for (const part of input.toUpperCase().split(/[^A-Z]+/)) {
    if (part.length === 2) seen.add(part);
  }
  return [...seen];
}
