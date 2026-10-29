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
 *   - Every number on the page is a list: the "Worked today" and "Booked" tiles open
 *     queues whose predicates ARE the scoreboard's, so a tile can never disagree with
 *     the rows behind it. "Worked today" is the one queue that is not a subset of the
 *     open items: a "Not interested" saved today is still a call made today.
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
  ai_score_tier?: string | null;
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
  /** Already has an agent row (computed column has_agent); absent on the legacy select. */
  has_agent?: boolean | null;
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
  "likely",
  "today",
  "all_open",
  "new",
  "uncontacted",
  "due_today",
  "overdue",
  "awaiting_reply",
  "unassigned",
  "mine",
  "needs_plan",
  "old",
  "worked_today",
  "booked",
] as const;
export type QueueKey = (typeof QUEUE_KEYS)[number];

export interface QueueDefinition {
  key: QueueKey;
  label: string;
  /** The full rule: the list button's title and "List rule" under Data status. */
  description: string;
  /**
   * The rule in one short plain sentence, shown on the page beside the open list so nobody has to
   * hover to learn what a list means (OVERHAUL-calllist, 2026-10-29). Same rule as the predicate.
   */
  hint: string;
  /** "personal" queues depend on who is looking; the rest are organisation-wide. */
  scope: "organization" | "personal";
}

// Conversion history (2026-10-06, 854 applications, 71 joined): median 5 days to join, 80% within 47,
// 95% within 97. Licensed 37% vs unlicensed 2%; ai_score_tier hot/warm ~50% vs cool/none ~4%.
export const LIKELY_WINDOW_DAYS = 47;
export const FRESH_WINDOW_DAYS = 14;
export const OLD_AFTER_DAYS = 90;

// Labels are plain English for people who do not live in software (Grow redesign,
// 2026-10-28); keys, URL params and predicates are unchanged, so old links still work.
// "Likely to join" became "Best leads" (OVERHAUL-calllist, 2026-10-29): Sam asked for words a
// VA understands. ?queue=likely still opens it.
export const QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  { key: "likely", label: "Best leads", description: "Licensed or rated hot/warm and applied in the last 47 days, or anyone who applied in the last 14 days. From the conversion history: licensed applicants join 37% of the time vs 2% unlicensed, and 80% of joins happen within 47 days", hint: `Licensed or high-scoring people from the last ${LIKELY_WINDOW_DAYS} days, and everyone from the last ${FRESH_WINDOW_DAYS}. They join most often.`, scope: "organization" },
  { key: "today", label: "Call today", description: "Next step due today or already late (Phoenix day): Due today plus Overdue", hint: "Their next step is due today or already late.", scope: "organization" },
  { key: "all_open", label: "Everyone", description: "Every open recruit you can see", hint: "Every open recruit you can see.", scope: "organization" },
  { key: "new", label: "New", description: "Applied in the last 7 days and not yet worked", hint: "Applied in the last 7 days, and nobody has worked them yet.", scope: "organization" },
  { key: "uncontacted", label: "Never contacted", description: "No recorded contact, ever (bulk-stamped contacted_at ignored)", hint: "Nobody has reached them yet.", scope: "organization" },
  { key: "due_today", label: "Due today", description: "Next action or review due later today (Phoenix)", hint: "Their next step is due later today.", scope: "organization" },
  { key: "overdue", label: "Overdue", description: "Next action or review time has passed", hint: "Their next step is late.", scope: "organization" },
  { key: "awaiting_reply", label: "Waiting on them", description: "Parked on a documented waiting reason", hint: "We are waiting for them to get back to us.", scope: "organization" },
  { key: "unassigned", label: "No owner", description: "No accountable owner yet", hint: "Nobody owns them yet.", scope: "organization" },
  { key: "mine", label: "Mine", description: "Open recruits where you are the accountable owner", hint: "People you own.", scope: "personal" },
  // The label names both halves of the rule: this list also holds people who have a next
  // step but no owner, so "No next step" alone read as wrong beside "Next: Call back".
  { key: "needs_plan", label: "No owner or next step", description: "Open and missing an owner, or missing a next step: no next action with a due time and no waiting reason with a review date", hint: "Missing an owner, a next step, or both.", scope: "organization" },
  { key: "old", label: "Older than 90 days", description: "Applied 90+ days ago with no follow-up set by a person. Only ~5% of joins ever come this late, so they stay out of the other queues", hint: `Applied ${OLD_AFTER_DAYS} or more days ago, and no person planned a follow-up.`, scope: "organization" },
  { key: "worked_today", label: "Worked today", description: "An outcome was saved today (Phoenix day), including no answers and people who said no", hint: "Someone saved what happened today, even a no answer or a no.", scope: "organization" },
  { key: "booked", label: "Booked", description: "Open recruits whose latest outcome is Appointment booked", hint: "Their last call booked an interview.", scope: "organization" },
] as const;

/** The two queues shown as big buttons; the rest sit behind "More lists" or on a tile. */
export const PRIMARY_QUEUE_KEYS: readonly QueueKey[] = ["likely", "mine"];

/**
 * The queues opened from the "Today's numbers" tiles. Each list has one entry point:
 * these are not repeated as buttons in the queue row or behind "More lists".
 */
export const TILE_QUEUE_KEYS: readonly QueueKey[] = ["today", "new", "worked_today", "booked"];

export function isQueueKey(value: string | null | undefined): value is QueueKey {
  return !!value && (QUEUE_KEYS as readonly string[]).includes(value);
}

/**
 * Deep links into /dashboard/recruiting (and the /dashboard/applicants redirect)
 * were written for the classic applicants table, which reads ?id= or ?lead=; other
 * senders use ?focus=. All of them carry an application id, which is also the
 * worklist row id. `person` is the worklist's own param and wins.
 */
export const PERSON_PARAM_ALIASES = ["id", "lead", "focus"] as const;

export function personFromParams(params: URLSearchParams): string | null {
  const own = params.get("person");
  if (own) return own;
  for (const key of PERSON_PARAM_ALIASES) {
    const value = params.get(key);
    if (value) return value;
  }
  return null;
}

/**
 * The classic table's filter params, mapped onto the saved queue that answers the
 * same question. Used only when the link carries no explicit ?queue=.
 */
export function queueFromLegacyParams(params: URLSearchParams): QueueKey | null {
  const filter = params.get("filter");
  if (filter === "follow_up_due") return "overdue";
  if (filter === "unclaimed" || params.get("assignment") === "unclaimed") return "unassigned";
  if (params.get("contacted") === "untouched") return "uncontacted";
  if (params.get("bucket") === "new") return "new";
  return null;
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
// Statuses that mean the person already said yes and moved on to contracting/onboarding.
const CONVERTED_STATUSES = new Set(["contracting", "onboarding", "paid", "approved", "producing", "hired"]);

export function isClosed(row: WorklistRow): boolean {
  if (row.do_not_contact_at) return true;
  // Already joined: an agent row exists, or the application moved past recruiting.
  // "Best leads" (then called "Likely to join") used to rank people who had already joined first.
  if (row.has_agent) return true;
  if (CONVERTED_STATUSES.has((row.status ?? "").toLowerCase())) return true;
  if (row.last_contact_outcome === "not_interested") return true;
  const status = (row.status ?? "").toLowerCase();
  // "lapsed" is what Recruit Stages writes when someone is moved to Closed/Lost
  // (set_recruit_stage), and the stage derivation already reads it as closed_lost.
  if (status === "rejected" || status === "disqualified" || status === "lapsed") return true;
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

const ageDays = (row: WorklistRow, nowMs: number): number | null => {
  const created = parseTs(row.created_at);
  return created === null || Number.isNaN(created) ? null : (nowMs - created) / DAY_MS;
};
const strongSignal = (row: WorklistRow): boolean =>
  row.license_status === "licensed" || row.ai_score_tier === "hot" || row.ai_score_tier === "warm";
/** 90+ days old and nobody set a follow-up by hand: kept out of every queue except "old" (and "mine"). */
export function isStale(row: WorklistRow, nowMs: number): boolean {
  const age = ageDays(row, nowMs);
  // A follow-up only keeps an old lead in the main lists when a PERSON set it
  // (next_action_set_at is written only by record_recruiting_outcome / set_recruiting_plan).
  // Automation stamps next_action_due_at on everyone, so it can't count.
  const personFollowUp = !!row.next_action_set_at && !!(row.next_action_due_at || row.next_review_at);
  return age !== null && age >= OLD_AFTER_DAYS && !personFollowUp;
}

/** An outcome was saved inside the Phoenix business day containing `now`. An unreadable timestamp is never "today". */
export function workedToday(row: WorklistRow, now: Date): boolean {
  const at = parseTs(row.last_contact_outcome_at);
  if (at === null || Number.isNaN(at)) return false;
  const { start, end } = phoenixDayBounds(now);
  return at >= start && at < end;
}

/** Queue membership. Every queue but "Worked today" is a subset of the open items. */
export function inQueue(row: WorklistRow, queue: QueueKey, ctx: QueueContext): boolean {
  // Work done today, open or closed, old or not: the same rule as the scoreboard tile.
  if (queue === "worked_today") return workedToday(row, ctx.now);
  if (!isOpen(row)) return false;
  const nowMs = ctx.now.getTime();
  if (queue === "old") return isStale(row, nowMs);
  // An open booking counts however old the application is: the same rule as the tile.
  if (queue === "booked") return row.last_contact_outcome === "appointment_booked";
  if (queue !== "mine" && isStale(row, nowMs)) return false;
  switch (queue) {
    case "likely": {
      const age = ageDays(row, nowMs);
      if (age === null) return false;
      return (strongSignal(row) && age <= LIKELY_WINDOW_DAYS) || age <= FRESH_WINDOW_DAYS;
    }
    case "today":
      return inQueue(row, "due_today", ctx) || inQueue(row, "overdue", ctx);
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

/**
 * The list the Call list opens on when the link names none (OVERHAUL-calllist, 2026-10-29): your
 * own people when one of them is due today or late, otherwise Best leads. It used to be Mine
 * whenever the viewer owned anyone, so on 2026-10-29 Sam, who owns one person with nothing due,
 * opened on a one-person list while 19 best leads waited. The page decides once per visit, so a
 * save that makes the viewer an owner never moves the list under them.
 */
export function defaultQueueFor(rows: readonly WorklistRow[], ctx: QueueContext): QueueKey {
  return rows.some((r) => inQueue(r, "mine", ctx) && inQueue(r, "today", ctx)) ? "mine" : "likely";
}

/**
 * The four numbers on top of the worklist. Each one IS a queue count over the same full
 * row set as the queue buttons, so a number can never disagree with the list its tile opens:
 *   callToday   = the "today" queue (Due today + Overdue, which are disjoint)
 *   newThisWeek = the "new" queue
 *   workedToday = the "worked_today" queue: an outcome recorded inside the Phoenix business
 *                 day, open or closed (a "Not interested" today is still work done today)
 *   booked      = the "booked" queue: open recruits whose latest outcome is Appointment booked
 * An unparseable outcome timestamp is not counted as today.
 */
export interface Scoreboard {
  callToday: number;
  newThisWeek: number;
  workedToday: number;
  booked: number;
}

export function computeScoreboard(counts: QueueCounts): Scoreboard {
  return { callToday: counts.today, newThisWeek: counts.new, workedToday: counts.worked_today, booked: counts.booked };
}

/** A follow-up a person set: next_action_set_at (written only by record_recruiting_outcome and
 *  set_recruiting_plan, the same signal isStale reads) with a due or review time on the row. */
function hasPromisedTime(row: WorklistRow): boolean {
  return Boolean(row.next_action_set_at) && effectiveDueMs(row) !== null;
}

const createdKey = (row: WorklistRow): number => {
  const t = parseTs(row.created_at);
  return t === null || Number.isNaN(t) ? 0 : t;
};
const dueKey = (row: WorklistRow): number => {
  const d = effectiveDueMs(row);
  return d === null || Number.isNaN(d) ? Number.POSITIVE_INFINITY : d;
};

/**
 * Order inside a queue (OVERHAUL-calllist, 2026-10-29): follow-ups a PERSON set come first, most
 * urgent first, with an unreadable date at the end of them; then everyone else, newest applicant
 * first. The automation stamp (MANAGER_CALL_72H_ESCALATION, due 72 hours after applying) is a
 * timer, not a promise. Ranking by it put the oldest applicants on top: on Sam's live list that
 * day "Call today" opened on an 88-day-old lead while the people who applied that week waited at
 * the bottom, and 80% of joins happen within 47 days. Membership and counts do not change.
 *  "Best leads" ranks by who converts: licensed / hot / warm first, then newest.
 *  "Worked today" reads like today's log: the latest outcome first.
 */
export function sortForQueue(rows: readonly WorklistRow[], queue?: QueueKey): WorklistRow[] {
  if (queue === "likely") {
    return [...rows].sort((a, b) => Number(strongSignal(b)) - Number(strongSignal(a))
      || createdKey(b) - createdKey(a) || a.id.localeCompare(b.id));
  }
  if (queue === "worked_today") {
    return [...rows].sort((a, b) => (parseTs(b.last_contact_outcome_at) ?? 0) - (parseTs(a.last_contact_outcome_at) ?? 0)
      || a.id.localeCompare(b.id));
  }
  return [...rows].sort((a, b) => {
    const pa = hasPromisedTime(a);
    const pb = hasPromisedTime(b);
    if (pa !== pb) return pa ? -1 : 1;
    const ka = dueKey(a);
    const kb = dueKey(b);
    const ca = createdKey(a);
    const cb = createdKey(b);
    if (pa) {
      if (ka !== kb) return ka - kb;
      if (ca !== cb) return cb - ca;
    } else {
      if (ca !== cb) return cb - ca;
      if (ka !== kb) return ka - kb;
    }
    return a.id.localeCompare(b.id);
  });
}

/** The order rule in one plain sentence, for Data status: the same rule as sortForQueue. */
export function queueOrderText(queue: QueueKey): string {
  if (queue === "likely") return "Licensed and high-scoring people first, then the newest.";
  if (queue === "worked_today") return "The latest saved outcome first.";
  return "Follow-ups someone set come first, the most urgent on top; then everyone else, the newest first.";
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
