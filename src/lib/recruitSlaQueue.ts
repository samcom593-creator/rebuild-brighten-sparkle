import type { Tone } from "@/lib/tones";

/**
 * The recruit SLA queue (WP3, 2026-11-10): one row per open recruit who needs a human,
 * read from public.v_recruit_sla_queue (staff-only view). The states, in the view's
 * own precedence order:
 *
 *   CALL_NO_OUTCOME   a recruiting call ended over 2h ago and nobody recorded how it went
 *   NEW_UNTOUCHED     applied 15+ business minutes ago (08:00-19:00 Phoenix), no logged
 *                     human contact, nothing on the calendar
 *   CALLBACK          the last outcome was a callback and it is due
 *   FOLLOWUP_DUE      a planned next action or review date has come due
 *   LICENSED_UNBOOKED licensed, contacted, never booked a call
 *
 * "Human contact" means an application_contact_log row a person wrote. The automated
 * contacted_at stamp is never read here.
 */

export const SLA_STATES = [
  "CALL_NO_OUTCOME",
  "NEW_UNTOUCHED",
  "CALLBACK",
  "FOLLOWUP_DUE",
  "LICENSED_UNBOOKED",
] as const;

export type SlaState = (typeof SLA_STATES)[number];

export interface SlaQueueRow {
  application_id: string;
  first_name: string | null;
  state: string | null;
  license_status: string | null;
  created_at: string;
  age_business_minutes: number | null;
  sla_state: SlaState;
  owner_user_id: string | null;
  owner_first_name: string | null;
  human_last_contact_at: string | null;
  last_automated_touch_at: string | null;
  call_no_outcome_at: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  owner_alerted_at: string | null;
  post_deploy: boolean | null;
  email_bounced_at: string | null;
  sort_rank: number | null;
}

export const SLA_QUEUE_COLUMNS =
  "application_id, first_name, state, license_status, created_at, age_business_minutes, sla_state, " +
  "owner_user_id, owner_first_name, human_last_contact_at, last_automated_touch_at, call_no_outcome_at, " +
  "next_action, next_action_due_at, owner_alerted_at, post_deploy, email_bounced_at, sort_rank";

export const SLA_STATE_META: Record<SlaState, { label: string; action: string; tone: Tone }> = {
  CALL_NO_OUTCOME: { label: "Call ended, no outcome", action: "Record how the call went", tone: "warm" },
  NEW_UNTOUCHED: { label: "New, nobody has called", action: "Call them now", tone: "hot" },
  CALLBACK: { label: "Callback due", action: "Call back", tone: "gold" },
  FOLLOWUP_DUE: { label: "Follow-up due", action: "Do the planned next step", tone: "cool" },
  LICENSED_UNBOOKED: { label: "Licensed, never booked", action: "Get a call on the calendar", tone: "royal" },
};

export function isSlaState(value: unknown): value is SlaState {
  return typeof value === "string" && (SLA_STATES as readonly string[]).includes(value);
}

/** Counts per state, every state present (0 when empty) so a quiet day reads as 0, not blank. */
export function countByState(rows: readonly Pick<SlaQueueRow, "sla_state">[]): Record<SlaState, number> {
  const out = Object.fromEntries(SLA_STATES.map((s) => [s, 0])) as Record<SlaState, number>;
  for (const r of rows) if (isSlaState(r.sla_state)) out[r.sla_state] += 1;
  return out;
}

/** The view orders licensed first, then oldest; keep that order client-side too. */
export function sortQueue<T extends Pick<SlaQueueRow, "sort_rank" | "created_at">>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = a.sort_rank ?? 9;
    const rb = b.sort_rank ?? 9;
    if (ra !== rb) return ra - rb;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });
}

/** "12m", "3h", "2d" since applying, wall clock. Unreadable dates say so. */
export function waitingFor(createdAt: string | null | undefined, now = Date.now()): string {
  if (!createdAt) return "unknown";
  const ms = Date.parse(createdAt);
  if (Number.isNaN(ms)) return "unknown";
  const mins = Math.max(0, Math.floor((now - ms) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function licenseLabel(status: string | null | undefined): string {
  if (status === "licensed") return "Licensed";
  if (status === "pending") return "Pending";
  if (status === "unlicensed") return "Unlicensed";
  return "Unknown";
}

/** The worklist opens a person from ?person=<application id>. */
export function personHref(applicationId: string): string {
  return `/dashboard/recruiting?person=${encodeURIComponent(applicationId)}`;
}
