/**
 * My Pipeline (Sell → My Pipeline, /dashboard/agent-pipeline), OVERHAUL-agentpipeline, 2026-10-31.
 *
 * Sam: "ridiculously ugly head to toe... I can't imagine that for my agents wanting to use this. Make
 * this 10 times better." The brief: one clear list with stage colour, one next action per row, and no
 * more than four summary numbers. Everything the page shows comes from this module, so every number
 * and every row can be tested without the page:
 *
 *   clientStage()      where a client is: New → Callback → Almost there → Sold (the four steps the call
 *                      sheet's stage bar uses), or closed.
 *   clientQueue()      the one bucket a client is in. The buckets are disjoint, so the numbers add up.
 *   clientNextStep()   the one thing to do with a client, in a few plain words, with when and why.
 *   pipelineListRows() the rows of a list in the order to work them; pipelineListCounts() counts the
 *                      same predicate, so a count always equals the list it opens.
 *
 * Measured on Sam's book that day (agency-wide): 2,028 clients, 1,094 sold, 808 imported from
 * AgentLink with no stage, 118 new, 6 waiting on a callback, 2 almost there; an agent's own book was
 * 25 clients, all new. "Today" is the viewer's calendar day, the rule src/lib/clientPipelinePriority.ts
 * already applies to callback dates (they are typed as dates, so a UTC midnight never moves a day).
 */
import {
  compareClientPriority,
  earliestSchedule,
  getClientPriority,
  localDateKey,
  pipelineDateKey,
  type ClientPriorityInput,
} from "@/lib/clientPipelinePriority";
import { isDialablePhone } from "@/lib/phone";
import { clientStepTone, type Tone } from "@/lib/tones";

/** A client row as My Pipeline reads it: agentlink_clients with this app's saved call results laid over it. */
export interface PipelineClient extends ClientPriorityInput {
  id: string;
  agent_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  city: string | null;
  updated_at: string | null;
  stage_changed_at: string | null;
  do_not_call: boolean | null;
  do_not_email: boolean | null;
  do_not_text: boolean | null;
  hostile_language_detected?: boolean | null;
  policy_number: string | null;
  /** The "Exact next step" typed on the call sheet (client_pipeline_overrides.reminder_notes). */
  reminder_notes?: string | null;
  /** The stage was set in this app (an override with a date), so stage_changed_at is the day it was marked. */
  stage_marked_here?: boolean;
}

/** One saved call result (client_pipeline_overrides): what the call sheet wrote, which an AgentLink sync cannot overwrite. */
export interface PipelineOverride {
  client_id: string;
  stage_override: string | null;
  stage_changed_at: string | null;
  last_contact_date: string | null;
  next_action_date: string | null;
  callback_date: string | null;
  callback_time: string | null;
  schedule_overridden: boolean | null;
  reminder_notes?: string | null;
}

/**
 * Lay the saved call results over the imported rows, exactly as the call sheet reads them: a saved
 * stage and last contact win; the saved schedule replaces the imported one only once the call sheet
 * has written a schedule (schedule_overridden), so clearing a callback there clears it here too.
 */
export function mergeClientOverrides<T extends PipelineClient>(rows: T[], overrides: PipelineOverride[]): T[] {
  const byClient = new Map(overrides.map((row) => [row.client_id, row]));
  return rows.map((client) => {
    const o = byClient.get(client.id);
    if (!o) return client;
    return {
      ...client,
      pipeline_stage: o.stage_override ?? client.pipeline_stage,
      stage_changed_at: o.stage_changed_at ?? client.stage_changed_at,
      last_contact_date: o.last_contact_date ?? client.last_contact_date,
      next_action_date: o.schedule_overridden ? o.next_action_date : client.next_action_date,
      callback_date: o.schedule_overridden ? o.callback_date : client.callback_date,
      callback_time: o.schedule_overridden ? o.callback_time : client.callback_time,
      reminder_notes: o.reminder_notes ?? client.reminder_notes ?? null,
      stage_marked_here: Boolean(o.stage_override && o.stage_changed_at),
    };
  });
}

// ── Stage ────────────────────────────────────────────────────────────────

export type ClientStepKey = "new" | "callback" | "almost" | "sold";

/** The four steps, the same four the call sheet's stage bar shows (src/pages/ClientDetail.tsx). */
export const CLIENT_STEPS: ReadonlyArray<{ key: ClientStepKey; label: string; means: string }> = [
  { key: "new", label: "New", means: "Nobody has worked them yet, or the first call is still to come." },
  { key: "callback", label: "Callback", means: "You talked or tried, and a callback or a quote follow-up comes next." },
  { key: "almost", label: "Almost there", means: "An appointment is set to finish the sale." },
  { key: "sold", label: "Sold", means: "The policy is sold." },
];

export interface ClientStage {
  /** A step, closed (not interested, inactive), or other (a stage word this app does not know). */
  key: ClientStepKey | "closed" | "other";
  /** The stage in words: "New", "Callback", "Almost there", "Sold", "Not interested", "Inactive". */
  label: string;
  /** 1..4 along CLIENT_STEPS, or null for a closed client (an empty bar). */
  index: number | null;
  tone: Tone;
  /** A finer word the call sheet recorded inside a step ("Quote given"), or null. */
  detail: string | null;
}

/** Title Case for a stage word the app does not know, so an unexpected value still reads as words. */
function humanize(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Where a client is. No stage (808 rows imported from AgentLink) is New, as the call sheet shows it;
 * Working, Pitched and Follow-up are the Callback step (the call sheet's bar groups them the same
 * way), with "Quote given" said for Pitched.
 */
export function clientStage(stage: string | null | undefined): ClientStage {
  const raw = (stage ?? "").trim().toUpperCase();
  const step = (key: ClientStepKey, detail: string | null = null): ClientStage => {
    const index = CLIENT_STEPS.findIndex((s) => s.key === key);
    return { key, label: CLIENT_STEPS[index].label, index: index + 1, tone: clientStepTone(key), detail };
  };
  switch (raw) {
    case "":
    case "NEW_INITIAL":
    case "UNSORTED":
      return step("new");
    case "WORKING":
    case "FOLLOW_UP":
      return step("callback");
    case "PITCHED":
      return step("callback", "Quote given");
    case "ALMOST_THERE":
      return step("almost");
    case "SOLD":
      return step("sold");
    case "LOST":
      return { key: "closed", label: "Not interested", index: null, tone: "slate", detail: null };
    case "INACTIVE":
      return { key: "closed", label: "Inactive", index: null, tone: "slate", detail: null };
    default:
      return { key: "other", label: humanize(raw), index: null, tone: "slate", detail: null };
  }
}

// ── Queue: the one bucket a client is in ────────────────────────────────

export type ClientQueue = "late" | "today" | "new" | "follow_up" | "scheduled" | "do_not_call" | "sold" | "closed";

/** The buckets in the order the Everyone list works them. Every client is in exactly one. */
export const QUEUE_ORDER: readonly ClientQueue[] = ["late", "today", "new", "follow_up", "scheduled", "do_not_call", "sold", "closed"];

/**
 * Sold first (a sold client is sold whatever else is on file), then closed (not interested,
 * inactive), then do not call: a client nobody may call is never counted in a list of people to
 * call. Everyone else takes the bucket of src/lib/clientPipelinePriority.ts: a late promise, one due
 * today, never contacted, contacted with nothing planned, or a promise set for a later day.
 */
export function clientQueue(client: PipelineClient, now: Date): ClientQueue {
  const stage = (client.pipeline_stage ?? "").trim().toUpperCase();
  if (stage === "SOLD") return "sold";
  const priority = getClientPriority(client, now);
  if (!priority) return "closed";
  if (client.do_not_call) return "do_not_call";
  switch (priority.code) {
    case "overdue": return "late";
    case "today": return "today";
    case "new": return "new";
    case "unplanned": return "follow_up";
    case "upcoming": return "scheduled";
  }
}

/** The buckets that are someone to contact now: the Up next card only ever offers one of these. */
export const WORK_NOW: ReadonlySet<ClientQueue> = new Set<ClientQueue>(["late", "today", "new", "follow_up"]);

// ── Lists ────────────────────────────────────────────────────────────────

export type PipelineListKey = "todo" | "today" | "new" | "follow_up" | "almost" | "scheduled" | "sold" | "all";

export interface PipelineListDef {
  key: PipelineListKey;
  label: string;
  /** How the list is ordered, in words for the line above it. */
  order: string;
  /** The full rule, for the tooltip and the explainer. */
  rule: string;
}

export const PIPELINE_LISTS: Record<PipelineListKey, PipelineListDef> = {
  todo: {
    key: "todo", label: "To do", order: "in the order to call them",
    rule: "Everyone to contact now: late callbacks, callbacks due today, clients nobody has called, and clients you talked to with no next step. Not sold, not closed, not do not call.",
  },
  today: {
    key: "today", label: "Call today", order: "latest promise first",
    rule: "A callback or next action that was due before today or is due today. Not sold, not closed, not do not call.",
  },
  new: {
    key: "new", label: "Never called", order: "newest first",
    rule: "No call has been logged and no callback is set. Not sold, not closed, not do not call.",
  },
  follow_up: {
    key: "follow_up", label: "No next step", order: "longest wait first",
    rule: "A call was logged, but no callback or next action is set.",
  },
  almost: {
    key: "almost", label: "Almost there", order: "in the order to call them",
    rule: "The stage is Almost there: an appointment is set to finish the sale. Not do not call.",
  },
  scheduled: {
    key: "scheduled", label: "Scheduled", order: "soonest first",
    rule: "A callback or next action is set for a later day. Nothing to do before then.",
  },
  sold: {
    key: "sold", label: "Sold", order: "most recently marked first",
    rule: "The stage is Sold.",
  },
  all: {
    key: "all", label: "Everyone", order: "people to call first, then scheduled, then sold and closed",
    rule: "Every client you can see.",
  },
};

export const PIPELINE_LIST_KEYS = Object.keys(PIPELINE_LISTS) as PipelineListKey[];

/** A list key from a URL, or To do when it is missing or unknown. */
export function parsePipelineList(value: string | null | undefined): PipelineListKey {
  return value && (PIPELINE_LIST_KEYS as string[]).includes(value) ? (value as PipelineListKey) : "todo";
}

function stageKey(client: Pick<PipelineClient, "pipeline_stage">): string {
  return (client.pipeline_stage ?? "").trim().toUpperCase();
}

/** Whether a client belongs to a list. The single predicate both the count and the list use. */
export function inPipelineList(client: PipelineClient, list: PipelineListKey, queue: ClientQueue): boolean {
  switch (list) {
    case "todo": return WORK_NOW.has(queue);
    case "today": return queue === "late" || queue === "today";
    case "new": return queue === "new";
    case "follow_up": return queue === "follow_up";
    case "almost": return stageKey(client) === "ALMOST_THERE" && queue !== "do_not_call" && queue !== "closed";
    case "scheduled": return queue === "scheduled";
    case "sold": return queue === "sold";
    case "all": return true;
  }
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** A stable last resort so equal rows never swap places between renders. */
function byNameThenId(a: PipelineClient, b: PipelineClient): number {
  return clientName(a).localeCompare(clientName(b)) || a.id.localeCompare(b.id);
}

function compareSold(a: PipelineClient, b: PipelineClient): number {
  // Marked here first, newest mark first; imported sales (no date) after, newest added first.
  const am = a.stage_marked_here ? timestamp(a.stage_changed_at) : null;
  const bm = b.stage_marked_here ? timestamp(b.stage_changed_at) : null;
  if (am !== null || bm !== null) {
    if (am === null) return 1;
    if (bm === null) return -1;
    if (am !== bm) return bm - am;
  }
  const ac = timestamp(a.created_at) ?? 0;
  const bc = timestamp(b.created_at) ?? 0;
  return bc - ac || byNameThenId(a, b);
}

/**
 * The rows of a list, in the order to work them. Within the people to contact, the order is the one
 * the old work queue used and its tests pin: late promises (oldest first), today's (by time), never
 * contacted (newest first), contacted with no plan (longest wait first), then later promises.
 */
export function pipelineListRows<T extends PipelineClient>(rows: T[], list: PipelineListKey, now: Date): T[] {
  const queued = rows.map((client) => ({ client, queue: clientQueue(client, now) }));
  const picked = queued.filter(({ client, queue }) => inPipelineList(client, list, queue));
  const rank = (q: ClientQueue) => QUEUE_ORDER.indexOf(q);
  picked.sort((a, b) => {
    if (a.queue !== b.queue && (list === "all" || list === "almost")) return rank(a.queue) - rank(b.queue);
    if (a.queue === "sold" && b.queue === "sold") return compareSold(a.client, b.client);
    if (a.queue === "closed" || a.queue === "do_not_call") {
      if (a.queue === b.queue) return byNameThenId(a.client, b.client);
    }
    return compareClientPriority(a.client, b.client, now) || byNameThenId(a.client, b.client);
  });
  return picked.map(({ client }) => client);
}

/** How many clients each list holds: the same predicate as pipelineListRows, so a count equals its list. */
export function pipelineListCounts(rows: PipelineClient[], now: Date): Record<PipelineListKey, number> {
  const counts = Object.fromEntries(PIPELINE_LIST_KEYS.map((k) => [k, 0])) as Record<PipelineListKey, number>;
  for (const client of rows) {
    const queue = clientQueue(client, now);
    for (const list of PIPELINE_LIST_KEYS) if (inPipelineList(client, list, queue)) counts[list] += 1;
  }
  return counts;
}

// ── Words ────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 28" for a YYYY-MM-DD key, with the year when it is not this year. */
export function dayLabel(key: string, now: Date): string {
  const [y, m, d] = key.split("-").map(Number);
  const label = `${MONTHS[(m - 1) % 12] ?? "?"} ${d}`;
  return String(y) === String(now.getFullYear()) ? label : `${label}, ${y}`;
}

/** The viewer's calendar day of a timestamp, or null when it cannot be read. */
export function timestampDayKey(value: string | null | undefined): string | null {
  const t = timestamp(value);
  return t === null ? null : localDateKey(new Date(t));
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Whole days from one calendar day to another, never below zero. */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.max(0, dayNumber(toKey) - dayNumber(fromKey));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "15:00" (a time input) reads "3:00 PM"; anything else typed on the call sheet is shown as typed, short. */
export function formatCallbackTime(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return text.slice(0, 20);
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return text.slice(0, 20);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export function clientName(client: Pick<PipelineClient, "first_name" | "last_name">): string {
  return [client.first_name, client.last_name].map((v) => (v ?? "").trim()).filter(Boolean).join(" ") || "No name on file";
}

// ── The one next step ────────────────────────────────────────────────────

export type ClientNextStepKey =
  | "late" | "today" | "first_call" | "follow_up" | "scheduled"
  | "email_for_phone" | "no_phone" | "do_not_call" | "sold" | "closed";

export interface ClientNextStep {
  key: ClientNextStepKey;
  /** The button's words: "Call back", "First call", "Follow up", "Email", "Open". */
  action: string;
  /** What to do, for the Up next card: "Call back", "Make the first call". */
  title: string;
  /** One short line on the row: "3 days late", "Due today at 3:00 PM", "Added Oct 21". */
  when: string;
  /** One or two plain sentences for the Up next card: when it was due and the note left for it. */
  detail: string;
  tone: Tone;
  /** What the button does: dial, write an email, or open the call sheet. */
  channel: "call" | "email" | "open";
  /** The row's short line carries the tone (late, due today, no next step, do not call). */
  emphasis: boolean;
}

function note(client: PipelineClient): string {
  const text = (client.reminder_notes ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return ` Your note: “${text.length > 160 ? `${text.slice(0, 157)}…` : text}”`;
}

function canEmail(client: PipelineClient): boolean {
  return Boolean(client.email?.trim()) && !client.do_not_email;
}

/**
 * The one thing to do with a client next. First match wins:
 *   1. Sold or closed: nothing to call about; the row opens their file.
 *   2. Do not call: email when that is allowed, otherwise open.
 *   3. No phone that can be dialled: email for one, or open the file to add one.
 *   4. A late promise, one due today, the first call, a follow-up with nothing planned.
 *   5. A promise set for a later day: nothing to do yet.
 */
export function clientNextStep(client: PipelineClient, now: Date): ClientNextStep {
  const queue = clientQueue(client, now);
  const today = localDateKey(now);
  const stage = clientStage(client.pipeline_stage);

  if (queue === "sold") {
    const marked = client.stage_marked_here ? timestampDayKey(client.stage_changed_at) : null;
    const when = marked ? `Marked sold ${dayLabel(marked, now)}` : "Policy sold";
    return { key: "sold", action: "Open", title: "Sold", when, detail: `${when}.`, tone: "good", channel: "open", emphasis: false };
  }
  if (queue === "closed") {
    return { key: "closed", action: "Open", title: stage.label, when: stage.label, detail: `Marked ${stage.label.toLowerCase()}.`, tone: "slate", channel: "open", emphasis: false };
  }
  if (queue === "do_not_call") {
    return canEmail(client)
      ? { key: "do_not_call", action: "Email", title: "Email them", when: "Do not call", detail: "Marked do not call. Email them instead.", tone: "hot", channel: "email", emphasis: true }
      : { key: "do_not_call", action: "Open", title: "Do not call", when: "Do not call", detail: "Marked do not call, and there is no email to use.", tone: "hot", channel: "open", emphasis: true };
  }
  if (!isDialablePhone(client.phone)) {
    return canEmail(client)
      ? { key: "email_for_phone", action: "Email", title: "Email for a phone number", when: "No phone on file", detail: "There is no phone number to call. Email them and ask for one.", tone: "warm", channel: "email", emphasis: true }
      : { key: "no_phone", action: "Open", title: "Add a phone number", when: "No phone or email", detail: "There is no phone number or email on file. Open their file to add one.", tone: "slate", channel: "open", emphasis: false };
  }

  const schedule = earliestSchedule(client);
  const kind = schedule?.kind === "Callback" ? "callback" : "follow-up";
  const time = schedule?.kind === "Callback" ? formatCallbackTime(client.callback_time) : null;

  if (queue === "late" && schedule) {
    const late = Math.max(1, daysBetween(schedule.date, today));
    const action = schedule.kind === "Callback" ? "Call back" : "Follow up";
    return {
      key: "late", action, title: action, when: `${plural(late, "day")} late`,
      detail: `The ${kind} was due ${dayLabel(schedule.date, now)}.${note(client)}`,
      tone: "hot", channel: "call", emphasis: true,
    };
  }
  if (queue === "today" && schedule) {
    const action = schedule.kind === "Callback" ? "Call back" : "Follow up";
    const at = time ? ` at ${time}` : "";
    return {
      key: "today", action, title: `${action} today`, when: `Due today${at}`,
      detail: `The ${kind} is due today${at}.${note(client)}`,
      tone: "warm", channel: "call", emphasis: true,
    };
  }
  if (queue === "new") {
    const added = timestampDayKey(client.created_at);
    return {
      key: "first_call", action: "First call", title: "Make the first call", when: added ? `Added ${dayLabel(added, now)}` : "Never called",
      detail: `${added ? `Added ${dayLabel(added, now)}. ` : ""}Nobody has logged a call yet.${note(client)}`,
      tone: "cool", channel: "call", emphasis: false,
    };
  }
  if (queue === "follow_up") {
    const talked = timestampDayKey(client.last_contact_date);
    return {
      key: "follow_up", action: "Follow up", title: "Follow up", when: talked ? `Talked ${dayLabel(talked, now)} · no next step` : "No next step",
      detail: `${talked ? `You last talked ${dayLabel(talked, now)}, and n` : "N"}othing is planned. Call and set the next step.${note(client)}`,
      tone: "warm", channel: "call", emphasis: true,
    };
  }
  // Scheduled for a later day (or, defensively, anything left): nothing to do yet.
  const word = schedule?.kind === "Callback" ? "Callback" : "Follow-up";
  const set = schedule ? `${word} ${dayLabel(schedule.date, now)}${time ? ` at ${time}` : ""}` : "Nothing planned";
  return {
    key: "scheduled", action: "Open", title: `${word} set`, when: set,
    detail: `${set}. Nothing to do before then.${note(client)}`,
    tone: "cool", channel: "open", emphasis: false,
  };
}

// ── Search ───────────────────────────────────────────────────────────────

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function phoneDigits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/**
 * Name, email, city, state, policy number and (for a manager or the owner) the agent's name, without
 * minding accents or case; three or more digits also match the phone number, however it is written.
 */
export function matchesClientSearch(client: PipelineClient, query: string, agentName?: string | null): boolean {
  const q = query.trim();
  if (!q) return true;
  const folded = fold(q);
  const haystack = fold([
    client.first_name, client.last_name, clientName(client), client.email, client.city, client.state, client.policy_number, agentName,
  ].filter(Boolean).join(" "));
  if (haystack.includes(folded)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 && phoneDigits(client.phone).includes(digits);
}

// ── Back from the call sheet ─────────────────────────────────────────────

/** The router state My Pipeline hands the call sheet, so Back returns to the same list and search. */
export interface PipelineBackState {
  from: string;
}

/**
 * Where the call sheet's "Back to pipeline" goes: the exact My Pipeline list it was opened from (with
 * its list and search), or My Pipeline itself. Only a pipeline address is accepted, so router state
 * can never send Back anywhere else.
 */
export function pipelineBackTo(state: unknown): string {
  const from = state && typeof state === "object" ? (state as { from?: unknown }).from : null;
  return typeof from === "string" && /^\/dashboard\/(agent-pipeline|clients)(\?[^#]*)?$/.test(from) ? from : "/dashboard/agent-pipeline";
}
