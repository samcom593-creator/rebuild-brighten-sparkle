/**
 * Recruit tracking (OVERHAUL-recruits, 2026-10-29). Sam: "a progress bar with each applicant,
 * adding color, seeing what stages they're on." And: a clear badge when someone bought the Xcel
 * pre-licensing course, a "has not bought Xcel yet" nudge when they should have, matched by email
 * first, then phone, and a name-only match shown as a possible match, never a certainty.
 *
 * Seven steps, in the order a recruit lives them. A person's step comes from the Next Step Engine
 * stage on their row (next_step_progress, derived from evidence and the one stage the New hires
 * page edits), with two facts the engine does not use:
 *
 *   - An interview booking. A Licensed Call or Leader Call on Calendly that was not cancelled
 *     (recruit_pipeline_list.interview_at, from interview_events, the booking truth). The engine
 *     leaves a booked applicant at "Applied" because nobody logged a contact; measured 2026-10-29,
 *     41 licensed applicants with a past Licensed Call still sat at "Applied". A booking moves an
 *     applicant who is not yet further along to Interview.
 *   - Their license. An applicant who says on the form that they are licensed and whose interview
 *     time has passed has nothing left to do before contracting, so they are at Licensed. The
 *     page says the interview date beside the step, so nobody reads it as a hire.
 *
 * Everything here is a pure function of the row and a clock, so the bar, the chips, the tiles and
 * the sections all count with one definition (src/tests/lib/recruitJourney.test.ts).
 */

export type RecruitStepKey = "applied" | "contacted" | "interview" | "licensing" | "licensed" | "contracted" | "first_deal";

export interface RecruitStepDef {
  key: RecruitStepKey;
  label: string;
  /** One plain sentence, shown in "What the steps mean". */
  means: string;
}

export const RECRUIT_STEPS: readonly RecruitStepDef[] = [
  { key: "applied", label: "Applied", means: "Sent an application. Nobody has talked to them yet." },
  { key: "contacted", label: "Contacted", means: "Someone on the team reached them." },
  { key: "interview", label: "Interview", means: "Booked a Licensed Call or Leader Call on Calendly." },
  { key: "licensing", label: "Licensing", means: "Getting licensed: the course, the exam, or hired and still needs the license." },
  { key: "licensed", label: "Licensed", means: "Licensed and past the interview. Contracting is next." },
  { key: "contracted", label: "Contracted", means: "Hired as an agent and working through onboarding." },
  { key: "first_deal", label: "First deal", means: "Closed a first deal." },
];

export const STEP_COUNT = RECRUIT_STEPS.length;

/**
 * The engine's stages placed on the seven steps. The order is next_step_stages.order_index: the
 * licensing stages, then contracting (licensed, signing contracts), then the hired-agent stages.
 * hired_unlicensed is a hire who still needs the license, so it is Licensing. A stage missing
 * from this map is not invented a step; the row says its own stage name and sits under "Other".
 */
const STAGE_STEP: Record<string, number> = {
  applied: 1,
  watched_vsl: 1,
  completed_application: 1,
  contacted: 2,
  booked_seminar: 3,
  attended_seminar: 3,
  started_prelicense: 4,
  finished_prelicense: 4,
  exam_scheduled: 4,
  passed_exam: 4,
  hired_unlicensed: 4,
  contracting: 5,
  hired: 6,
  course_started: 6,
  course_completed: 6,
  infield_training: 6,
  first_appointment: 6,
  first_deal: 7,
  first_10k_week: 7,
};

/** The facts on a recruit_pipeline_list row this file reads. Columns added by OVERHAUL-recruits are optional. */
export interface JourneyRow {
  person_type: "applicant" | "agent";
  stage_key: string;
  stage_name: string;
  status: string;
  entered_at: string | null;
  days_in_stage: number;
  license_status: string | null;
  license_progress?: string | null;
  applied_at?: string | null;
  interview_at?: string | null;
  interview_booked_at?: string | null;
  xcel_match?: string | null;
  xcel_enrolled_on?: string | null;
  xcel_pct?: number | string | null;
  xcel_completed_on?: string | null;
  xcel_last_login_on?: string | null;
  xcel_course?: string | null;
  xcel_report_on?: string | null;
}

export interface RecruitStep {
  /** 1..7 on the journey; null for a closed person or a stage this page has no step for. */
  index: number | null;
  key: RecruitStepKey | null;
  /** The step in words: "Licensing", or "Closed", or the stage's own name when it has no step. */
  label: string;
  /** The finer stage beside it ("In Pre-License", "Interview was Oct 12"); null when it would repeat the label. */
  detail: string | null;
  /** When they reached this step. */
  since: string | null;
  /** What placed them here: the engine's stage, or an interview booking the engine does not read. */
  reason: "stage" | "interview" | "licensed_interview";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECRUITING_ZONE = "America/Phoenix";

const toMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

const yearIn = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(new Date(ms));

/** A moment as a day in the recruiting zone: "Oct 2", or "Oct 2, 2025" outside the current year. Null if unreadable. */
export function formatRecruitDay(value: string | null | undefined, now = Date.now()): string | null {
  const ms = toMs(value);
  if (ms === null) return null;
  const sameYear = yearIn(ms, RECRUITING_ZONE) === yearIn(now, RECRUITING_ZONE);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: RECRUITING_ZONE,
  }).format(new Date(ms));
}

/** A calendar date ("2026-10-02", as Xcel reports it) in words, with no time-zone shift. Null if unreadable. */
export function formatCalendarDay(value: string | null | undefined, now = Date.now()): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(ms)) return null;
  const sameYear = m[1] === yearIn(now, RECRUITING_ZONE);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(new Date(ms));
}

const squash = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export const isLicensed = (row: Pick<JourneyRow, "license_status">) => squash(row.license_status) === "licensed";

/** Where this person is on the seven steps. */
export function recruitStep(row: JourneyRow, now = Date.now()): RecruitStep {
  if (row.status !== "active") {
    // "completed" is an applicant the engine closed because they were hired; anything else is a close.
    const label = row.status === "completed" ? "Completed" : "Closed";
    const detail = row.stage_key === "closed_lost" ? null : row.stage_name || null;
    return { index: null, key: null, label, detail, since: row.entered_at, reason: "stage" };
  }
  let index: number | null = STAGE_STEP[row.stage_key] ?? null;
  if (index === null) {
    return { index: null, key: null, label: row.stage_name || "No step on file", detail: null, since: row.entered_at, reason: "stage" };
  }
  let reason: RecruitStep["reason"] = "stage";
  let since = row.entered_at;
  const booked = !!(row.interview_at || row.interview_booked_at);
  const interviewMs = toMs(row.interview_at);
  const interviewPast = interviewMs !== null && interviewMs <= now;
  if (row.person_type === "applicant" && booked) {
    if (index < 3) {
      index = 3;
      reason = "interview";
      since = row.interview_booked_at ?? row.interview_at ?? row.entered_at;
    }
    if (isLicensed(row) && interviewPast && index < 5) {
      index = 5;
      reason = "licensed_interview";
      since = row.interview_at ?? since;
    }
  }
  const def = RECRUIT_STEPS[index - 1];
  let detail: string | null = null;
  if (reason === "stage") {
    detail = squash(row.stage_name) === squash(def.label) ? null : row.stage_name || null;
  } else {
    // Said after the step's own word, so it never repeats it: "Interview · booked for Oct 30",
    // "Interview · was on Oct 26", "Licensed · interview was on Oct 25".
    const day = formatRecruitDay(row.interview_at, now);
    if (reason === "licensed_interview") detail = day ? `interview was on ${day}` : "interview held";
    else if (!day) detail = "booked";
    else detail = interviewPast ? `was on ${day}` : `booked for ${day}`;
  }
  return { index, key: def.key, label: def.label, detail, since, reason };
}

/**
 * Days on the step they are on now. The engine's own days for its stage; for a step an interview
 * booking set, the days since that booking (or since the interview, once it is past). Never negative.
 */
export function stepDays(row: JourneyRow, step: RecruitStep, now = Date.now()): number {
  if (step.reason === "stage") return Math.max(0, Number.isFinite(row.days_in_stage) ? row.days_in_stage : 0);
  const ms = toMs(step.since);
  if (ms === null) return Math.max(0, Number.isFinite(row.days_in_stage) ? row.days_in_stage : 0);
  return Math.max(0, (now - ms) / DAY_MS);
}

/** "Applied Oct 2"; "No application on file" for a hire with none; null when the list did not send the column. */
export function appliedWords(row: JourneyRow, now = Date.now()): string | null {
  if (!("applied_at" in row)) return null;
  const day = formatRecruitDay(row.applied_at, now);
  if (day) return `Applied ${day}`;
  return row.applied_at ? "Application date unreadable" : "No application on file";
}

/** Licensed or not, in words, from the form for an applicant and the agent record for a hire. */
export function licenseWords(row: Pick<JourneyRow, "license_status">): { key: "licensed" | "pending" | "unlicensed"; label: string } | null {
  switch (squash(row.license_status)) {
    case "licensed": return { key: "licensed", label: "Licensed" };
    case "pending": return { key: "pending", label: "License pending" };
    case "unlicensed": return { key: "unlicensed", label: "Not licensed" };
    default: return null;
  }
}

// ── Xcel ──────────────────────────────────────────────────────────────────────

/** A daily Xcel report older than this is not trusted to say somebody has NOT bought. */
export const XCEL_FRESH_DAYS = 3;

export interface XcelFeed {
  /**
   * fresh: a report arrived recently. stale: the last one is old. none: no report ever.
   * unavailable: the list sent no Xcel columns. empty: there is nobody on the list, so nobody can
   * be owed a nudge and the true count is zero.
   */
  state: "fresh" | "stale" | "none" | "unavailable" | "empty";
  reportOn: string | null;
}

/** How far the Xcel facts on these rows can be trusted. Every row carries the same report date. */
export function xcelFeed(rows: readonly JourneyRow[], now = Date.now()): XcelFeed {
  const first = rows[0];
  if (!first) return { state: "empty", reportOn: null };
  if (!("xcel_report_on" in first)) return { state: "unavailable", reportOn: null };
  const reportOn = first.xcel_report_on ?? null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(reportOn ?? "");
  if (!m) return { state: "none", reportOn: null };
  // Whole calendar days between the report's date and today in the recruiting zone. The report
  // lands every morning, so a normal one is 0 or 1 day behind.
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: RECRUITING_ZONE }).format(new Date(now));
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  const behind = t
    ? Math.round((Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3])) - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / DAY_MS)
    : Number.POSITIVE_INFINITY;
  return { state: behind > XCEL_FRESH_DAYS ? "stale" : "fresh", reportOn };
}

export type XcelKind = "bought" | "possible" | "missing" | "none" | "unknown";

export interface XcelStatus {
  kind: XcelKind;
  /** The badge's words; null draws no badge. */
  label: string | null;
  /** The quiet words after the badge: the enrollment and the progress, or why it is only possible. */
  detail: string | null;
  matchedBy: "email" | "phone" | "name" | null;
}

/** Engine stages at which the course is already behind them: no nudge to buy it. */
const COURSE_DONE_STAGES = new Set(["finished_prelicense", "exam_scheduled", "passed_exam"]);

const pctOf = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};

/**
 * Should this person have bought Xcel by now? Unlicensed by their own record, no further on the
 * licensing ladder than starting it, and someone has talked to them: Contacted, Interview, or
 * Licensing short of a finished course (which covers a hire who still needs the license).
 */
export function shouldHaveXcel(row: JourneyRow, step: RecruitStep): boolean {
  if (row.status !== "active" || step.index === null) return false;
  if (squash(row.license_status) !== "unlicensed") return false;
  const progress = squash(row.license_progress);
  if (progress && progress !== "unlicensed") return false;
  if (step.index < 2 || step.index > 4) return false;
  return !COURSE_DONE_STAGES.has(row.stage_key);
}

/** The Xcel badge for one person. */
export function xcelStatus(row: JourneyRow, step: RecruitStep, feed: XcelFeed, now = Date.now()): XcelStatus {
  if (feed.state === "unavailable") return { kind: "unknown", label: null, detail: null, matchedBy: null };
  const match = squash(row.xcel_match);
  if (match === "email" || match === "phone") {
    const pct = pctOf(row.xcel_pct);
    const enrolled = formatCalendarDay(row.xcel_enrolled_on, now);
    const finished = formatCalendarDay(row.xcel_completed_on, now);
    // Read after the word "Xcel" on the row: "Xcel enrolled Oct 2, 45% done", "Xcel course finished Oct 20".
    const parts: string[] = [];
    if (finished || pct === 100) parts.push(finished ? `course finished ${finished}` : "course finished");
    else {
      if (enrolled) parts.push(`enrolled ${enrolled}`);
      if (pct !== null) parts.push(`${pct}% done`);
    }
    return { kind: "bought", label: "Bought Xcel", detail: parts.join(", ") || null, matchedBy: match };
  }
  if (match === "name") {
    return { kind: "possible", label: "Possible Xcel match", detail: "matched on the name only", matchedBy: "name" };
  }
  if (!shouldHaveXcel(row, step)) return { kind: "none", label: null, detail: null, matchedBy: null };
  // A "has not bought" is only as true as the report it is read from.
  if (feed.state !== "fresh") return { kind: "unknown", label: null, detail: null, matchedBy: null };
  return { kind: "missing", label: "Has not bought Xcel yet", detail: null, matchedBy: null };
}

export type XcelFilter = "all" | "bought" | "possible" | "missing";

export function xcelMatchesFilter(kind: XcelKind, filter: XcelFilter): boolean {
  return filter === "all" || kind === filter;
}
