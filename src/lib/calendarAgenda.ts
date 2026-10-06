/**
 * Calendar agenda model — one list from two server feeds, no duplicates.
 *
 *   v_calendar_agenda   (security_invoker view)  → every EDITABLE appointment:
 *                        interview_events (interviews + onboarding calls) and
 *                        calendar_events (appointments, draft dates, post-test
 *                        follow-ups), with zone, owner, meeting link, status
 *                        and reminder state.
 *   calendar_window()   (RPC)                    → the same two tables PLUS the
 *                        read-only date markers (milestones, policy effective
 *                        dates, callbacks, birthdays, applications.next_action_at).
 *
 * The agenda view is authoritative for any row it owns, keyed identically
 * ("interview:<uuid>" / "cal:<uuid>"), so a merged list never shows the same
 * meeting twice and the Calendar edits exactly the record Pipeline edits.
 * If the agenda view could not be read, the caller passes `null` and the
 * window rows are kept as they are — degraded, never silently emptied.
 */
import { BUSINESS_TZ, dateKeyInZone, formatClock } from "@/lib/calendarTime";

export type CalendarWindowRow = {
  event_id: string;
  event_date: string;
  event_at: string;
  kind: string;
  title: string;
  subtitle: string | null;
  person_name: string | null;
  status: string | null;
  ref_id: string | null;
  link: string | null;
};

export type AgendaStatus = "scheduled" | "canceled" | "completed" | "no_show" | "rescheduled";

export type AgendaViewRow = {
  event_key: string;
  source_table: "interview_events" | "calendar_events";
  ref_id: string;
  kind: string;
  title: string;
  person_name: string | null;
  person_email: string | null;
  application_id: string | null;
  agent_id: string | null;
  owner_user_id: string | null;
  starts_at: string;
  ends_at: string | null;
  event_tz: string | null;
  meeting_link: string | null;
  status: AgendaStatus;
  outcome: string | null;
  booking_source: string | null;
  call_track: string | null;
  reminder_state: string;
  reschedule_url: string | null;
  cancel_url: string | null;
  was_rescheduled: boolean;
  cancel_reason: string | null;
  notes: string | null;
  updated_at: string | null;
};

/** How (and whether) a merged item can be changed from the Calendar. */
export type EditMode =
  | "interview" // staff-booked interview_events row → book/reschedule/cancel RPCs
  | "calendly" // Calendly-owned interview_events row → Calendly links; outcome via cc_dispose_interview
  | "appointment" // calendar_events appointment owned by the caller → edit / soft-cancel
  | null; // read-only marker

export type CalendarItem = {
  key: string;
  /** Business-day bucket (America/Phoenix), "YYYY-MM-DD". */
  dateKey: string;
  startsAt: string;
  endsAt: string | null;
  kind: string;
  title: string;
  subtitle: string | null;
  personName: string | null;
  status: string | null;
  refId: string | null;
  link: string | null;
  eventTz: string | null;
  allDay: boolean;
  editMode: EditMode;
  agenda: AgendaViewRow | null;
};

export const AGENDA_OWNED_PREFIXES = ["interview:", "cal:"] as const;

export function isAgendaOwnedKey(key: string): boolean {
  return AGENDA_OWNED_PREFIXES.some((p) => key.startsWith(p));
}

/** calendar_window spells it "cancelled"; the agenda uses "canceled". */
export function normalizeStatus(status: string | null): string | null {
  if (status === "cancelled") return "canceled";
  return status;
}

function editModeFor(row: AgendaViewRow, viewerUserId: string | null): EditMode {
  if (row.source_table === "interview_events") {
    return row.booking_source === "calendly" ? "calendly" : "interview";
  }
  if (row.kind !== "appointment") return null;
  // calendar_events RLS lets a user change their own rows (and ownerless ones).
  return row.owner_user_id === null || row.owner_user_id === viewerUserId ? "appointment" : null;
}

export function itemFromAgenda(row: AgendaViewRow, viewerUserId: string | null, businessTz = BUSINESS_TZ): CalendarItem {
  return {
    key: row.event_key,
    dateKey: dateKeyInZone(row.starts_at, businessTz),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    kind: row.kind,
    title: row.title,
    subtitle: row.source_table === "interview_events"
      ? (row.call_track && row.call_track !== "other" ? row.call_track : null)
      : null,
    personName: row.person_name,
    status: row.status,
    refId: row.ref_id,
    link: row.meeting_link,
    eventTz: row.event_tz,
    allDay: false,
    editMode: editModeFor(row, viewerUserId),
    agenda: row,
  };
}

export function itemFromWindow(row: CalendarWindowRow, businessTz = BUSINESS_TZ): CalendarItem {
  return {
    key: row.event_id,
    dateKey: row.event_date,
    startsAt: row.event_at,
    endsAt: null,
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    personName: row.person_name,
    status: normalizeStatus(row.status),
    refId: row.ref_id,
    link: row.link,
    eventTz: null,
    // Date-only markers land on business-zone midnight; never print "12:00 AM".
    allDay: formatClock(row.event_at, businessTz) === "12:00 AM",
    editMode: null,
    agenda: null,
  };
}

export type MergeOptions = {
  /** Kinds to keep; null or empty = every kind. */
  kinds?: string[] | null;
  /** Keep canceled appointments/interviews in the list. Default false. */
  showCanceled?: boolean;
  viewerUserId?: string | null;
  businessTz?: string;
};

/**
 * Merge the read-only window feed with the authoritative agenda feed.
 * Pure: same inputs → same output; no I/O, no clock.
 */
export function mergeAgenda(
  windowRows: CalendarWindowRow[] | null | undefined,
  agendaRows: AgendaViewRow[] | null | undefined,
  options: MergeOptions = {},
): CalendarItem[] {
  const businessTz = options.businessTz ?? BUSINESS_TZ;
  const kinds = options.kinds && options.kinds.length ? new Set(options.kinds) : null;
  const agendaAvailable = Array.isArray(agendaRows);
  const byKey = new Map<string, CalendarItem>();

  for (const row of windowRows ?? []) {
    // The agenda owns these keys; keep the window copy only when the agenda feed is unavailable.
    if (agendaAvailable && isAgendaOwnedKey(row.event_id)) continue;
    byKey.set(row.event_id, itemFromWindow(row, businessTz));
  }
  for (const row of agendaRows ?? []) {
    byKey.set(row.event_key, itemFromAgenda(row, options.viewerUserId ?? null, businessTz));
  }

  const items: CalendarItem[] = [];
  for (const item of byKey.values()) {
    if (kinds && !kinds.has(item.kind)) continue;
    if (!options.showCanceled && item.status === "canceled") continue;
    items.push(item);
  }
  items.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    const ta = Date.parse(a.startsAt);
    const tb = Date.parse(b.startsAt);
    if (ta !== tb) return ta - tb;
    return a.title.localeCompare(b.title);
  });
  return items;
}

export function groupByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = map.get(item.dateKey);
    if (list) list.push(item);
    else map.set(item.dateKey, [item]);
  }
  return map;
}

/** Operator wording for v_calendar_agenda.reminder_state. Never claims a send that has no receipt. */
export function reminderStateLabel(state: string | null | undefined): { label: string; tone: "ok" | "warn" | "muted" | "bad" } {
  switch (state) {
    case "sent": return { label: "Reminder sent (inbox)", tone: "ok" };
    case "pending": return { label: "Reminder due 30 min before", tone: "muted" };
    case "off": return { label: "Reminders off", tone: "muted" };
    case "no_owner": return { label: "No owner — no reminder", tone: "warn" };
    case "calendly_managed": return { label: "Calendly sends its own reminder (not visible here)", tone: "muted" };
    case "invite_sent": return { label: "Team invite delivered to mail service", tone: "ok" };
    case "invite_queued": return { label: "Team invite queued — not sent yet", tone: "warn" };
    case "invite_failed": return { label: "Team invite FAILED", tone: "bad" };
    case "invite_none": return { label: "No team invite on file", tone: "warn" };
    case "closed": return { label: "No reminder (closed)", tone: "muted" };
    case "not_tracked": return { label: "Reminders not tracked", tone: "muted" };
    default: return { label: "Reminder state unknown", tone: "warn" };
  }
}
