/**
 * Training stage, weekday work commitments and workday attendance: the facts My Team shows beside each person.
 *
 * These are separate facts. The stage does not change onboarding, commission, licensing or contracting; a carrier mark
 * does not change the stage; a work commitment is a plan, never attendance evidence; attendance never changes employment
 * status. The database enforces that; this file only names things and parses the two reads so a failed or short read
 * can never be mistaken for "nobody is scheduled" or "nobody was present".
 */
import { supabase } from "@/integrations/supabase/client";

export const STAGES = [
  { key: "online_training", label: "Online training" },
  { key: "training", label: "Training" },
  { key: "released_in_field", label: "Released in field" },
] as const;
export type StageKey = typeof STAGES[number]["key"];
export const STAGE_UNSET_LABEL = "Stage not set";
export const stageLabel = (key: string | null | undefined): string => STAGES.find((s) => s.key === key)?.label ?? STAGE_UNSET_LABEL;

/** ISO weekdays Monday (1) to Friday (5). Stored as numbers; named only on screen. */
export const WEEKDAYS = [
  { n: 1, short: "Mon", long: "Monday" }, { n: 2, short: "Tue", long: "Tuesday" }, { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" }, { n: 5, short: "Fri", long: "Friday" },
] as const;
export const SCHEDULE_UNSET_LABEL = "Schedule not set";

/** "Mon, Wed, Fri · 3 days/week". null = never set ("Schedule not set"), [] = no scheduled days. */
export function workdaysSummary(days: readonly number[] | null | undefined): string {
  if (days == null) return SCHEDULE_UNSET_LABEL;
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 5).sort((a, b) => a - b);
  if (sorted.length === 0) return "No scheduled days";
  const names = sorted.map((d) => WEEKDAYS.find((w) => w.n === d)!.short).join(", ");
  return `${names} · ${sorted.length} ${sorted.length === 1 ? "day" : "days"}/week`;
}

export type InvitationState = "none" | "pending" | "accepted" | "expired" | "revoked" | "superseded";
export interface PersonFacts {
  agent_id: string;
  stage: StageKey | null; stage_label: string | null; stage_source: "staff" | "default" | "mapped" | null;
  schedule_set: boolean; weekdays: number[] | null;
  next_schedule: { effective_from: string; weekdays: number[] } | null;
  access: { has_login: boolean; invitation: InvitationState };
}
export interface TeamFacts { as_of: string; people: PersonFacts[]; counts: { people: number; stage_unset: number; schedule_unset: number } }

export function parseTeamFacts(raw: unknown): TeamFacts {
  const r = raw as Partial<TeamFacts> & { ok?: boolean } | null;
  if (!r || typeof r !== "object" || r.ok !== true || !Array.isArray(r.people) || !r.counts) throw new Error("The team facts did not load completely.");
  if (r.counts.people !== r.people.length) throw new Error("The team facts were cut short.");
  return { as_of: String(r.as_of ?? ""), counts: r.counts, people: r.people.map((p) => ({
    ...p, stage: (STAGES.some((s) => s.key === p.stage) ? p.stage : null) as StageKey | null,
    weekdays: Array.isArray(p.weekdays) ? p.weekdays : null, schedule_set: p.schedule_set === true,
    access: { has_login: p.access?.has_login === true, invitation: (p.access?.invitation ?? "none") as InvitationState },
  })) };
}

/** What the roster says about a person's access, in one short honest line. */
export function accessSummary(a: PersonFacts["access"]): { text: string; tone: "ok" | "wait" | "off" } {
  if (a.has_login) return { text: "Signed in before", tone: "ok" };
  switch (a.invitation) {
    case "pending": return { text: "Invitation pending", tone: "wait" };
    case "accepted": return { text: "Invitation accepted, no sign-in yet", tone: "wait" };
    case "expired": return { text: "Invitation expired", tone: "off" };
    case "revoked": return { text: "Invitation revoked", tone: "off" };
    case "superseded": return { text: "Invitation replaced", tone: "wait" };
    default: return { text: "No login yet", tone: "off" };
  }
}

// ── attendance ───────────────────────────────────────────────────────────────────────────────────────────────

export type MarkStatus = "unmarked" | "present" | "absent" | "excused";
export type Expected = "yes" | "no" | "unknown";
export const MARKS: ReadonlyArray<{ key: Exclude<MarkStatus, "unmarked">; label: string }> = [
  { key: "present", label: "Present" }, { key: "absent", label: "Absent" }, { key: "excused", label: "Excused" },
];
export interface AttendancePerson {
  agent_id: string; display_name: string; email: string | null; stage: StageKey | null; stage_label: string | null;
  expected: Expected; weekdays: number[] | null; status: MarkStatus; marked_by_name: string | null; marked_at: string | null; note: string | null;
}
export interface AttendanceDay {
  date: string; is_today: boolean; weekday: number; people: AttendancePerson[];
  summary: { total: number; expected: number; present: number; absent: number; excused: number; unmarked: number; not_scheduled: number; schedule_not_set: number };
}

export function parseAttendanceDay(raw: unknown): AttendanceDay {
  const r = raw as Partial<AttendanceDay> & { ok?: boolean } | null;
  if (!r || typeof r !== "object" || r.ok !== true || !Array.isArray(r.people) || !r.summary || typeof r.date !== "string") throw new Error("Attendance did not load completely.");
  if (r.summary.total !== r.people.length) throw new Error("Attendance was cut short.");
  return { date: r.date, is_today: r.is_today === true, weekday: Number(r.weekday ?? 0), summary: r.summary, people: r.people.map((p) => ({
    ...p, status: (["present", "absent", "excused"].includes(p.status as string) ? p.status : "unmarked") as MarkStatus,
    expected: (["yes", "no"].includes(p.expected as string) ? p.expected : "unknown") as Expected,
    weekdays: Array.isArray(p.weekdays) ? p.weekdays : null,
  })) };
}

export const expectedLabel = (e: Expected): string => (e === "yes" ? "Expected" : e === "no" ? "Not scheduled" : SCHEDULE_UNSET_LABEL);
export const statusLabel = (s: MarkStatus): string => (s === "unmarked" ? "Unmarked" : s[0].toUpperCase() + s.slice(1));

/** Today's date key in America/Phoenix (no daylight saving). */
export function phoenixToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
export function dateKeyLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export type AttendanceStageFilter = "all" | StageKey | "unset";
export function filterAttendance(people: readonly AttendancePerson[], stage: AttendanceStageFilter, search: string, onlyExpected: boolean): AttendancePerson[] {
  const q = search.trim().toLowerCase();
  return people.filter((p) => {
    if (stage === "unset" ? p.stage !== null : stage !== "all" && p.stage !== stage) return false;
    if (onlyExpected && p.expected !== "yes") return false;
    if (q && !`${p.display_name} ${p.email ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** A bulk preview: who would change, who would be left alone (already marked), who is not expected. Nothing is written. */
export function bulkPreview(people: readonly AttendancePerson[], selected: ReadonlySet<string>) {
  const chosen = people.filter((p) => selected.has(p.agent_id));
  return {
    willChange: chosen.filter((p) => p.status === "unmarked"),
    alreadyMarked: chosen.filter((p) => p.status !== "unmarked"),
    notExpected: chosen.filter((p) => p.status === "unmarked" && p.expected !== "yes"),
  };
}

// ── writers (flat result shapes; this repo does not narrow unions on `ok`) ───────────────────────────────────

type Json = Record<string, unknown> | null;
const msg = (e: unknown): string => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "save failed").slice(0, 160);
export interface StageResult { ok: boolean; conflict: boolean; stage: StageKey | null; changed: boolean; error: string | null }
export interface WorkdaysResult { ok: boolean; conflict: boolean; weekdays: number[] | null; changed: boolean; error: string | null }
export interface MarkResult { ok: boolean; conflict: boolean; status: MarkStatus; changed: boolean; error: string | null }
export interface BulkResult { ok: boolean; applied: number; skipped: number; denied: number; error: string | null }

export async function saveStage(agentId: string, stage: StageKey, expected: StageKey | null): Promise<StageResult> {
  const { data, error } = await supabase.rpc("set_agent_stage", { p_agent_id: agentId, p_stage: stage, ...(expected === null ? { p_expect_unset: true } : { p_expected: expected }) });
  const r = data as unknown as Json;
  if (error) return { ok: false, conflict: false, stage: expected, changed: false, error: msg(error) };
  if (!r) return { ok: false, conflict: false, stage: expected, changed: false, error: "The save did not come back." };
  return { ok: r.ok === true, conflict: r.conflict === true, stage: (r.stage as StageKey | null) ?? null, changed: r.changed === true, error: r.ok === true || r.conflict === true ? null : "The save was not accepted." };
}

export async function saveWorkdays(agentId: string, weekdays: number[], expected: number[] | null, effectiveFrom?: string): Promise<WorkdaysResult> {
  const { data, error } = await supabase.rpc("set_work_commitment", {
    p_agent_id: agentId, p_weekdays: weekdays, ...(effectiveFrom ? { p_effective_from: effectiveFrom } : {}), ...(expected === null ? { p_expect_unset: true } : { p_expected: expected }),
  });
  const r = data as unknown as Json;
  if (error) return { ok: false, conflict: false, weekdays: expected, changed: false, error: msg(error) };
  if (!r) return { ok: false, conflict: false, weekdays: expected, changed: false, error: "The save did not come back." };
  return { ok: r.ok === true, conflict: r.conflict === true, weekdays: Array.isArray(r.weekdays) ? (r.weekdays as number[]) : null, changed: r.changed === true, error: r.ok === true || r.conflict === true ? null : "The save was not accepted." };
}

export async function saveMark(agentId: string, date: string, status: MarkStatus, expected: MarkStatus, note?: string): Promise<MarkResult> {
  const { data, error } = await supabase.rpc("set_workday_attendance", { p_agent_id: agentId, p_date: date, p_status: status, p_expected: expected, ...(note ? { p_note: note } : {}) });
  const r = data as unknown as Json;
  if (error) return { ok: false, conflict: false, status: expected, changed: false, error: msg(error) };
  if (!r) return { ok: false, conflict: false, status: expected, changed: false, error: "The save did not come back." };
  return { ok: r.ok === true, conflict: r.conflict === true, status: (r.status as MarkStatus) ?? expected, changed: r.changed === true, error: r.ok === true || r.conflict === true ? null : "The save was not accepted." };
}

export async function saveBulk(date: string, agentIds: string[], status: Exclude<MarkStatus, "unmarked">): Promise<BulkResult> {
  const { data, error } = await supabase.rpc("set_workday_attendance_bulk", { p_date: date, p_agent_ids: agentIds, p_status: status });
  const r = data as unknown as Json;
  if (error) return { ok: false, applied: 0, skipped: 0, denied: 0, error: msg(error) };
  if (!r || r.ok !== true) return { ok: false, applied: 0, skipped: 0, denied: 0, error: "The save was not accepted." };
  return { ok: true, applied: Number(r.applied ?? 0), skipped: Number(r.skipped_already_marked ?? 0), denied: Number(r.denied ?? 0), error: null };
}
