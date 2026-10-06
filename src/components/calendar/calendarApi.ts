/**
 * Calendar data access. Every write to an interview goes through one of three
 * SECURITY DEFINER RPCs (migration 20261006130000_calendar_agenda.sql):
 *
 *   book_interview_event       → INSERT interview_events (source 'manual')
 *   reschedule_interview_event → UPDATE the SAME row (scheduled_at, event_tz),
 *                                supersede stale reminders, history row
 *   cancel_interview_event     → stamp canceled_at + reason (+ outcome via
 *                                cc_dispose_interview), never DELETE
 *
 * Calendly-owned rows are refused by the server (the 15-minute Calendly
 * reconcile would overwrite an in-app change); the UI offers the invitee's
 * Calendly reschedule/cancel link for those instead.
 *
 * New relations/RPCs are cast (`as never`) until the generated types are
 * regenerated after merge.
 */
import { supabase } from "@/integrations/supabase/client";
import { BUSINESS_TZ, zonedWallTimeToUtc } from "@/lib/calendarTime";
import type { AgendaViewRow, CalendarWindowRow } from "@/lib/calendarAgenda";

const PAGE = 1000;
/** Hard stop so a runaway window cannot loop forever; surfaced as truncation. */
const MAX_PAGES = 25;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/** Reads every page of a PostgREST result instead of trusting the 1000-row cap. */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Inclusive business-day window [fromKey, toKey] as a UTC half-open range. */
export function businessWindowUtc(fromKey: string, toKey: string): { startIso: string; endIso: string } {
  const startIso = zonedWallTimeToUtc(fromKey, "00:00", BUSINESS_TZ);
  const end = new Date(zonedWallTimeToUtc(toKey, "00:00", BUSINESS_TZ));
  end.setUTCDate(end.getUTCDate() + 1); // Phoenix has no DST: +24h is the next midnight
  return { startIso, endIso: end.toISOString() };
}

export async function fetchAgendaRows(fromKey: string, toKey: string) {
  const { startIso, endIso } = businessWindowUtc(fromKey, toKey);
  return fetchAllPages<AgendaViewRow>((from, to) =>
    supabase
      .from("v_calendar_agenda" as never)
      .select("*")
      .gte("starts_at", startIso)
      .lt("starts_at", endIso)
      .order("starts_at", { ascending: true })
      .order("event_key", { ascending: true })
      .range(from, to) as unknown as PromiseLike<PageResult<AgendaViewRow>>,
  );
}

export async function fetchWindowRows(fromKey: string, toKey: string, kinds: string[] | null) {
  return fetchAllPages<CalendarWindowRow>((from, to) =>
    supabase
      .rpc("calendar_window" as never, { p_from: fromKey, p_to: toKey, p_kinds: kinds } as never)
      .range(from, to) as unknown as PromiseLike<PageResult<CalendarWindowRow>>,
  );
}

export type ProviderHealth = {
  measured_at: string;
  calendly_last_webhook_booking_at: string | null;
  calendly_last_reconcile_at: string | null;
  calendly_last_reconcile_status: string | null;
  calendly_reconcile_failures_24h: number | null;
  google_last_synced_at: string | null;
  google_sync_job_active: boolean | null;
  onboarding_invites_queued: number | null;
  onboarding_invites_sent: number | null;
  onboarding_invites_failed: number | null;
  onboarding_invite_last_error: string | null;
  interview_reminders_enabled: boolean | null;
  interview_reminders_sent: number | null;
  ics_feed_last_polled_at: string | null;
};

export type ProviderHealthResult =
  | { state: "ok"; health: ProviderHealth }
  | { state: "forbidden" }
  | { state: "error"; message: string };

export async function fetchProviderHealth(): Promise<ProviderHealthResult> {
  const { data, error } = await supabase.rpc("calendar_provider_health" as never);
  if (error) {
    if ((error as { code?: string }).code === "42501") return { state: "forbidden" };
    return { state: "error", message: error.message };
  }
  const payload = data as unknown;
  const row = Array.isArray(payload)
    ? (payload[0] as ProviderHealth | undefined)
    : (payload as ProviderHealth | null);
  if (!row) return { state: "error", message: "provider health returned no row" };
  return { state: "ok", health: row };
}

export type ConflictRow = {
  event_key: string;
  source_table: string;
  title: string;
  starts_at: string;
  ends_at: string;
  scope: "owner" | "unassigned";
};

export async function fetchOwnerConflicts(params: {
  ownerUserId: string;
  startsAt: string;
  endsAt: string;
  excludeKey?: string | null;
}): Promise<ConflictRow[]> {
  const { data, error } = await supabase.rpc("calendar_owner_conflicts" as never, {
    p_owner_user_id: params.ownerUserId,
    p_starts_at: params.startsAt,
    p_ends_at: params.endsAt,
    p_exclude_event_key: params.excludeKey ?? null,
  } as never);
  if (error) throw new Error(error.message);
  return (data ?? []) as ConflictRow[];
}

/** Turns a Postgres error into the sentence an operator should read. */
export function schedulingErrorMessage(error: unknown): string {
  const e = error as { message?: string; hint?: string; code?: string } | null;
  const msg = e?.message ?? String(error);
  if (msg.startsWith("calendly_owned")) {
    return "This booking belongs to Calendly. Use the Calendly link so the invitee is told and the change is not reverted by the Calendly sync.";
  }
  if (e?.code === "42501") return "You do not have permission to change interviews.";
  return msg;
}

export type InterviewEventRow = {
  id: string;
  scheduled_at: string;
  ended_at: string | null;
  event_tz: string | null;
  canceled_at: string | null;
  outcome: string | null;
};

export async function bookInterviewEvent(params: {
  scheduledAt: string;
  eventTz: string;
  applicationId?: string | null;
  agentId?: string | null;
  inviteeName?: string | null;
  inviteeEmail?: string | null;
  kind?: "interview" | "onboarding_call";
  durationMinutes?: number;
  meetingLink?: string | null;
  notes?: string | null;
  ownerUserId?: string | null;
}): Promise<InterviewEventRow> {
  const { data, error } = await supabase.rpc("book_interview_event" as never, {
    p_scheduled_at: params.scheduledAt,
    p_event_tz: params.eventTz,
    p_application_id: params.applicationId ?? null,
    p_agent_id: params.agentId ?? null,
    p_invitee_name: params.inviteeName ?? null,
    p_invitee_email: params.inviteeEmail ?? null,
    p_kind: params.kind ?? "interview",
    p_duration_minutes: params.durationMinutes ?? 30,
    p_meeting_link: params.meetingLink ?? null,
    p_notes: params.notes ?? null,
    p_owner_user_id: params.ownerUserId ?? null,
  } as never);
  if (error) throw new Error(schedulingErrorMessage(error));
  return data as unknown as InterviewEventRow;
}

export async function rescheduleInterviewEvent(params: {
  id: string;
  newAt: string;
  eventTz: string;
  reason?: string | null;
  durationMinutes?: number | null;
}): Promise<InterviewEventRow> {
  const { data, error } = await supabase.rpc("reschedule_interview_event" as never, {
    p_id: params.id,
    p_new_at: params.newAt,
    p_event_tz: params.eventTz,
    p_reason: params.reason ?? null,
    p_duration_minutes: params.durationMinutes ?? null,
  } as never);
  if (error) throw new Error(schedulingErrorMessage(error));
  return data as unknown as InterviewEventRow;
}

export async function cancelInterviewEvent(params: {
  id: string;
  reason: string;
  outcome?: string | null;
}): Promise<InterviewEventRow> {
  const { data, error } = await supabase.rpc("cancel_interview_event" as never, {
    p_id: params.id,
    p_reason: params.reason,
    p_outcome: params.outcome ?? null,
  } as never);
  if (error) throw new Error(schedulingErrorMessage(error));
  return data as unknown as InterviewEventRow;
}

/** Outcome writer shared with Follow-Ups (moves applications.status too). */
export async function disposeInterview(id: string, outcome: string, notes?: string | null) {
  const { error } = await supabase.rpc("cc_dispose_interview" as never, {
    p_id: id,
    p_outcome: outcome,
    p_notes: notes ?? null,
  } as never);
  if (error) throw new Error(schedulingErrorMessage(error));
}

/** Outcome vocabulary — the interview_events_outcome_check constraint, verbatim. */
export const INTERVIEW_OUTCOMES: { value: string; label: string }[] = [
  { value: "no_show", label: "No-show" },
  { value: "no_answer", label: "No answer" },
  { value: "rescheduled", label: "Asked to reschedule" },
  { value: "callback", label: "Callback" },
  { value: "not_interested", label: "Not interested" },
  { value: "not_a_fit", label: "Not a fit" },
  { value: "bad_number", label: "Bad number" },
  { value: "completed", label: "Completed" },
  { value: "hired", label: "Hired" },
  { value: "contracted", label: "Contracted" },
  { value: "passed", label: "Passed" },
];
