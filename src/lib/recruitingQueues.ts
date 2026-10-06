/**
 * Recruiting worklist — the pure rules behind the saved queues.
 *
 * One definition of every queue, every blocker and the outcome vocabulary, so the
 * chip count, the rows shown after a click, and the save validation can never
 * disagree. Nothing in here touches the network; the page feeds it the FULL set of
 * rows the viewer can see (paginated past PostgREST's 1000-row cap) and every count
 * is computed over that whole set.
 *
 * Truth rules this module enforces (docs/audits/apex-os-redesign-2026-10-05/04-pipeline-contact-workspace.md):
 *   - `contacted_at` is bulk-stamped and is NEVER read here. "Contacted" means a person
 *     recorded an outcome (last_contact_outcome_at) or last_contacted_at is set.
 *   - A dial-link click is not a contact. Only record_recruiting_outcome() moves a row
 *     out of Uncontacted.
 *   - Ownership is the explicit recruiting_owner_user_id. Attribution columns
 *     (assigned_agent_id etc.) are credit, not accountability, and never count as "owned".
 *   - "Today" is the America/Phoenix calendar day (the business clock), unless the
 *     record carries its own verified time zone — which only changes what is DISPLAYED
 *     as the person's local time, never which queue the item is in.
 *   - Unknown never becomes zero: a row whose due timestamp cannot be parsed is not
 *     silently "not due"; it lands in the Needs-a-plan exception filter.
 */

export const CONTACT_OUTCOMES = [
  "no_answer",
  "callback",
  "interested",
  "appointment_booked",
  "not_interested",
  "wrong_number",
  "do_not_contact",
] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export const CONTACT_CHANNELS = ["call", "sms", "email", "in_person", "manual"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export interface OutcomeDefinition {
  value: ContactOutcome;
  label: string;
  /** Ends the open item: no next action required afterwards. */
  closes: boolean;
  /** The plan must be a dated next action (a callback time, an appointment time). */
  requiresDatedAction: boolean;
  /** Suggested next action text, editable before save. */
  suggestedAction: string | null;
  hint: string;
}

export const OUTCOME_DEFINITIONS: readonly OutcomeDefinition[] = [
  { value: "no_answer", label: "No answer", closes: false, requiresDatedAction: false, suggestedAction: "Try again", hint: "Rang out, voicemail, or no reply" },
  { value: "callback", label: "Callback", closes: false, requiresDatedAction: true, suggestedAction: "Call back", hint: "They asked to be called at a set time" },
  { value: "interested", label: "Interested", closes: false, requiresDatedAction: false, suggestedAction: "Send next step", hint: "Wants to move forward" },
  { value: "appointment_booked", label: "Appointment booked", closes: false, requiresDatedAction: true, suggestedAction: "Interview", hint: "A meeting time is agreed" },
  { value: "not_interested", label: "Not interested", closes: true, requiresDatedAction: false, suggestedAction: null, hint: "Closes the item" },
  { value: "wrong_number", label: "Wrong number", closes: false, requiresDatedAction: false, suggestedAction: "Email for a working number", hint: "Marks the phone bad" },
  { value: "do_not_contact", label: "Do not contact", closes: true, requiresDatedAction: false, suggestedAction: null, hint: "Stops all outreach, including automated email" },
] as const;

export const CHANNEL_LABELS: Record<ContactChannel, string> = {
  call: "Call",
  sms: "Text",
  email: "Email",
  in_person: "In person",
  manual: "Other",
};

export function outcomeDefinition(value: string | null | undefined): OutcomeDefinition | null {
  return OUTCOME_DEFINITIONS.find((d) => d.value === value) ?? null;
}

export function outcomeLabel(value: string | null | undefined): string {
  return outcomeDefinition(value)?.label ?? "—";
}

/** The columns the worklist reads. Same shape record_recruiting_outcome() returns. */
export interface WorklistRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  time_zone: string | null;
  time_zone_source: string | null;
  license_status: string | null;
  license_progress: string | null;
  status: string | null;
  next_step_stage_key: string | null;
  created_at: string;
  assigned_agent_id: string | null;
  recruiting_owner_user_id: string | null;
  last_contacted_at: string | null;
  last_contact_outcome: string | null;
  /** Kept as the raw server string: it is echoed back for the conflict check. */
  last_contact_outcome_at: string | null;
  last_contact_channel: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  next_action_set_at: string | null;
  waiting_reason: string | null;
  next_review_at: string | null;
  next_step_due_at: string | null;
  phone_bad_at: string | null;
  email_bad_at: string | null;
  sms_consent_given: boolean | null;
  email_consent_given: boolean | null;
  do_not_contact_at: string | null;
  terminated_at?: string | null;
  is_duplicate?: boolean | null;
  record_type?: string | null;
}

export const QUEUE_KEYS = [
  "all_open",
  "new",
  "uncontacted",
  "due_today",
  "overdue",
  "awaiting_reply",
  "unassigned",
  "mine",
  "needs_plan",
] as const;
export type QueueKey = (typeof QUEUE_KEYS)[number];

export interface QueueDefinition {
  key: QueueKey;
  label: string;
  description: string;
  /** "personal" queues depend on who is looking; the rest are organisation-wide. */
  scope: "organization" | "personal";
}

export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  { key: "all_open", label: "All open", description: "Every open recruit you can see", scope: "organization" },
  { key: "new", label: "New", description: "Applied in the last 7 days and not yet worked", scope: "organization" },
  { key: "uncontacted", label: "Uncontacted", description: "No recorded contact, ever (bulk-stamped contacted_at ignored)", scope: "organization" },
  { key: "due_today", label: "Due today", description: "Next action or review due later today (Phoenix)", scope: "organization" },
  { key: "overdue", label: "Overdue", description: "Next action or review time has passed", scope: "organization" },
  { key: "awaiting_reply", label: "Awaiting reply", description: "Parked on a documented waiting reason", scope: "organization" },
  { key: "unassigned", label: "Unassigned", description: "No accountable owner yet", scope: "organization" },
  { key: "mine", label: "My queue", description: "Open recruits where you are the accountable owner", scope: "personal" },
  { key: "needs_plan", label: "Needs a plan", description: "Open but missing an owner, or a next action and due time, or a waiting reason and review date", scope: "organization" },
] as const;

export function isQueueKey(value: string | null | undefined): value is QueueKey {
  return !!value && (QUEUE_KEYS as readonly string[]).includes(value);
}

const PHOENIX_OFFSET_MS = 7 * 60 * 60 * 1000; // America/Phoenix is UTC-7 all year (no DST).
const DAY_MS = 24 * 60 * 60 * 1000;
export const NEW_WINDOW_DAYS = 7;

/** [start, end) of the America/Phoenix calendar day containing `now`, in epoch ms. */
export function phoenixDayBounds(now: Date): { start: number; end: number } {
  const local = now.getTime() - PHOENIX_OFFSET_MS;
  const start = Math.floor(local / DAY_MS) * DAY_MS + PHOENIX_OFFSET_MS;
  return { start, end: start + DAY_MS };
}

/** Parse a timestamp. Returns null for absent, NaN for present-but-unparseable. */
function parseTs(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  return new Date(value).getTime();
}

export function fullName(row: Pick<WorklistRow, "first_name" | "last_name">): string {
  const name = [row.first_name, row.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
  return name || "Name not provided";
}

/** Closed = no further outreach expected. Everything else is an open item. */
export function isClosed(row: WorklistRow): boolean {
  if (row.do_not_contact_at) return true;
  if (row.last_contact_outcome === "not_interested") return true;
  const status = (row.status ?? "").toLowerCase();
  if (status === "rejected" || status === "disqualified") return true;
  if (row.next_step_stage_key === "closed_lost") return true;
  return false;
}

export function isOpen(row: WorklistRow): boolean {
  return !isClosed(row);
}

/** A human contact is on record. `contacted_at` is deliberately absent. */
export function hasRecordedContact(row: WorklistRow): boolean {
  return Boolean(row.last_contact_outcome_at || row.last_contacted_at);
}

export type BlockerKey = "do_not_contact" | "phone_bad" | "no_phone" | "sms_opt_out" | "email_opt_out" | "email_bad" | "no_email";

export interface Blocker {
  key: BlockerKey;
  label: string;
  /** Severity drives the chip tone: hard blocks stop a channel, soft ones are context. */
  hard: boolean;
}

export function blockersOf(row: WorklistRow): Blocker[] {
  const out: Blocker[] = [];
  if (row.do_not_contact_at) out.push({ key: "do_not_contact", label: "Do not contact", hard: true });
  if (!row.phone || !row.phone.trim()) out.push({ key: "no_phone", label: "No phone", hard: false });
  else if (row.phone_bad_at) out.push({ key: "phone_bad", label: "Phone bad", hard: true });
  if (row.sms_consent_given === false) out.push({ key: "sms_opt_out", label: "No SMS consent", hard: false });
  if (!row.email || !row.email.trim()) out.push({ key: "no_email", label: "No email", hard: false });
  else if (row.email_bad_at) out.push({ key: "email_bad", label: "Email bad", hard: false });
  if (row.email_consent_given === false) out.push({ key: "email_opt_out", label: "No email consent", hard: false });
  return out;
}

/** Which channels a person may be contacted on right now. Mirrors the RPC's suppression. */
export function channelAvailability(row: WorklistRow): Record<ContactChannel, { allowed: boolean; reason: string | null }> {
  const dnc = row.do_not_contact_at ? "Asked not to be contacted" : null;
  const phoneReason = dnc ?? (!row.phone?.trim() ? "No phone on file" : row.phone_bad_at ? "Phone marked bad" : null);
  const smsReason = phoneReason ?? (row.sms_consent_given === false ? "No SMS consent on file" : null);
  const emailReason = dnc ?? (!row.email?.trim()
    ? "No email on file"
    : row.email_bad_at
      ? "Email marked bad"
      : row.email_consent_given === false
        ? "No email consent on file"
        : null);
  return {
    call: { allowed: !phoneReason, reason: phoneReason },
    sms: { allowed: !smsReason, reason: smsReason },
    email: { allowed: !emailReason, reason: emailReason },
    in_person: { allowed: !dnc, reason: dnc },
    manual: { allowed: !dnc, reason: dnc },
  };
}

/**
 * The moment this item next needs attention: the next action's due time, else the
 * review date of a waiting item. `NaN` means a value is present but unreadable.
 */
export function effectiveDueMs(row: WorklistRow): number | null {
  const due = parseTs(row.next_action_due_at);
  if (due !== null) return due;
  return parseTs(row.next_review_at);
}

export interface PlanCheck {
  ok: boolean;
  missing: Array<"owner" | "plan" | "unreadable_date">;
}

/** Every open item needs an owner and either action+due or waiting reason+review date. */
export function planCheck(row: WorklistRow): PlanCheck {
  if (isClosed(row)) return { ok: true, missing: [] };
  const missing: PlanCheck["missing"] = [];
  if (!row.recruiting_owner_user_id) missing.push("owner");
  const due = parseTs(row.next_action_due_at);
  const review = parseTs(row.next_review_at);
  if ((due !== null && Number.isNaN(due)) || (review !== null && Number.isNaN(review))) missing.push("unreadable_date");
  const hasAction = Boolean(row.next_action?.trim()) && due !== null && !Number.isNaN(due);
  const hasWait = Boolean(row.waiting_reason?.trim()) && review !== null && !Number.isNaN(review);
  if (!hasAction && !hasWait) missing.push("plan");
  return { ok: missing.length === 0, missing };
}

export interface QueueContext {
  now: Date;
  userId: string | null;
}

/** Queue membership. Every queue is a subset of the open items. */
export function inQueue(row: WorklistRow, queue: QueueKey, ctx: QueueContext): boolean {
  if (!isOpen(row)) return false;
  const nowMs = ctx.now.getTime();
  switch (queue) {
    case "all_open":
      return true;
    case "new": {
      const created = parseTs(row.created_at);
      if (created === null || Number.isNaN(created)) return false;
      return created >= nowMs - NEW_WINDOW_DAYS * DAY_MS && !row.last_contact_outcome_at;
    }
    case "uncontacted":
      return !hasRecordedContact(row);
    case "due_today": {
      const due = effectiveDueMs(row);
      if (due === null || Number.isNaN(due)) return false;
      const { end } = phoenixDayBounds(ctx.now);
      return due >= nowMs && due < end;
    }
    case "overdue": {
      const due = effectiveDueMs(row);
      if (due === null || Number.isNaN(due)) return false;
      return due < nowMs;
    }
    case "awaiting_reply": {
      if (!row.waiting_reason?.trim()) return false;
      // Waiting with an action also due is work, not waiting.
      const due = parseTs(row.next_action_due_at);
      return due === null;
    }
    case "unassigned":
      return !row.recruiting_owner_user_id;
    case "mine":
      return Boolean(ctx.userId) && row.recruiting_owner_user_id === ctx.userId;
    case "needs_plan":
      return !planCheck(row).ok;
    default:
      return false;
  }
}

export type QueueCounts = Record<QueueKey, number>;

export function computeQueueCounts(rows: readonly WorklistRow[], ctx: QueueContext): QueueCounts {
  const counts = Object.fromEntries(QUEUE_KEYS.map((k) => [k, 0])) as QueueCounts;
  for (const row of rows) {
    for (const key of QUEUE_KEYS) {
      if (inQueue(row, key, ctx)) counts[key] += 1;
    }
  }
  return counts;
}

/** Order inside a queue: most urgent first, unknown dates last, then oldest applicant. */
export function sortForQueue(rows: readonly WorklistRow[]): WorklistRow[] {
  return [...rows].sort((a, b) => {
    const da = effectiveDueMs(a);
    const db = effectiveDueMs(b);
    const ka = da === null || Number.isNaN(da) ? Number.POSITIVE_INFINITY : da;
    const kb = db === null || Number.isNaN(db) ? Number.POSITIVE_INFINITY : db;
    if (ka !== kb) return ka - kb;
    const ca = parseTs(a.created_at) ?? 0;
    const cb = parseTs(b.created_at) ?? 0;
    if (ca !== cb) return cb - ca;
    return a.id.localeCompare(b.id);
  });
}

export interface OutcomeDraft {
  outcome: ContactOutcome | null;
  channel: ContactChannel;
  notes: string;
  nextAction: string;
  /** datetime-local value ("YYYY-MM-DDTHH:mm") in the viewer's browser zone, or "". */
  nextActionDue: string;
  waitingReason: string;
  /** datetime-local value or "". */
  nextReview: string;
}

export const EMPTY_DRAFT: OutcomeDraft = {
  outcome: null,
  channel: "call",
  notes: "",
  nextAction: "",
  nextActionDue: "",
  waitingReason: "",
  nextReview: "",
};

/** Client-side mirror of record_recruiting_outcome()'s validation. Returns an error or null. */
export function validateOutcomeDraft(draft: OutcomeDraft, row: WorklistRow): string | null {
  if (!draft.outcome) return "Pick what happened.";
  const def = outcomeDefinition(draft.outcome);
  if (!def) return "Unknown outcome.";
  if (draft.outcome !== "do_not_contact") {
    const avail = channelAvailability(row)[draft.channel];
    if (!avail.allowed) return `${CHANNEL_LABELS[draft.channel]} is blocked: ${avail.reason}.`;
  }
  if (def.closes) return null;
  const hasAction = Boolean(draft.nextAction.trim()) && Boolean(draft.nextActionDue);
  const hasWait = Boolean(draft.waitingReason.trim()) && Boolean(draft.nextReview);
  if (def.requiresDatedAction && !hasAction) return `${def.label} needs the next action and its date and time.`;
  if (!hasAction && !hasWait) return "Set a next action with a due time, or a waiting reason with a review date.";
  return null;
}

/** "YYYY-MM-DDTHH:mm" (browser-local, from <input type="datetime-local">) -> ISO, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Map a server error message to a person-readable sentence. Unknown errors stay visible verbatim. */
export function describeSaveError(message: string | null | undefined): { kind: "conflict" | "suppressed" | "forbidden" | "invalid" | "missing_backend" | "unknown"; text: string } {
  const msg = (message ?? "").trim();
  if (/^conflict:/i.test(msg)) return { kind: "conflict", text: "Someone else updated this person while you were working. Your note is kept — reload the person and save again." };
  if (/^suppressed:/i.test(msg)) return { kind: "suppressed", text: msg.replace(/^suppressed:\s*/i, "Blocked: ") };
  if (/^not_authorized|^not_authenticated/i.test(msg)) return { kind: "forbidden", text: "You are not allowed to work this recruit." };
  if (/^invalid_[a-z_]+:/i.test(msg)) return { kind: "invalid", text: msg.replace(/^invalid_[a-z_]+:\s*/i, "") };
  if (/could not find the function|does not exist|PGRST202|42883/i.test(msg)) {
    return { kind: "missing_backend", text: "Outcome recording is not available yet: the database update for this workspace has not been applied." };
  }
  return { kind: "unknown", text: msg || "Save failed for an unknown reason." };
}
