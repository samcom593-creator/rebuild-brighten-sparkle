// Launch Board content workflow — the one vocabulary for content_cards.status.
//
//   Idea -> Record -> Edit -> Review -> Ready -> Scheduled -> Published
//
// The database (migration 20261006150000_launch_board_workflow.sql) holds the
// same rules server-side; this module is what the page renders from and what
// the tests pin. Two legacy values stay readable forever and are never written
// again by the page:
//   recorded -> Edit       (footage exists, nothing has cut it yet)
//   posted   -> Published only when a live URL + evidence is on the row,
//               otherwise "Published (unconfirmed)", shown as such.
//
// Copying a caption or downloading a clip changes nothing here. Scheduled needs
// a real job reference, or it is a "Manual plan". Published needs provider
// evidence or an explicit confirmation carrying an https URL on a known
// platform domain.

import { parsePack } from "@/lib/contentFilmingPack";

export type WorkflowStatus = "idea" | "record" | "edit" | "review" | "ready" | "scheduled" | "published";
export type LegacyStatus = "recorded" | "posted";
export type StoredStatus = WorkflowStatus | LegacyStatus;
/** What the board shows. `published_unconfirmed` is a display stage, never stored. */
export type Stage = WorkflowStatus | "published_unconfirmed";

export const WORKFLOW: WorkflowStatus[] = ["idea", "record", "edit", "review", "ready", "scheduled", "published"];
export const STORED_STATUSES: StoredStatus[] = [...WORKFLOW, "recorded", "posted"];

export const STAGE_LABEL: Record<Stage, string> = {
  idea: "Idea",
  record: "Record",
  edit: "Edit",
  review: "Review",
  ready: "Ready",
  scheduled: "Scheduled",
  published: "Published",
  published_unconfirmed: "Published (unconfirmed)",
};

export type PublishEvidence = "provider" | "manual_confirmation";
export type ScheduleKind = "manual" | "job";

/** The execution fields a card carries. Every field is optional so legacy rows read cleanly. */
export interface WorkflowCard {
  id: string;
  title: string;
  status: string;
  hook?: string | null;
  record_script?: string | null;
  clip?: string | null;
  edit_prompt?: string | null;
  caption?: string | null;
  brand?: string | null;
  cta?: string | null;
  owner?: string | null;
  due_date?: string | null;
  day?: number | null;
  approved_at?: string | null;
  scheduled_for?: string | null;
  schedule_kind?: string | null;
  schedule_job_ref?: string | null;
  published_url?: string | null;
  publish_evidence?: string | null;
}

// ── Publish evidence ────────────────────────────────────────────────────────

/** Known platform hosts (and their subdomains). Mirrors public.content_publish_url_ok(). */
export const PLATFORM_DOMAINS: Record<string, string> = {
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "tiktok.com": "TikTok",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "fb.watch": "Facebook",
  "x.com": "X",
  "twitter.com": "X",
  "linkedin.com": "LinkedIn",
  "snapchat.com": "Snapchat",
  "threads.net": "Threads",
};

/** The platform a URL lives on, or null when it is not an https URL on a known platform domain. */
export function platformOf(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password || u.port) return null;
  // The raw string must have "/" right after the host, as the SQL rule does (no "?x" straight after the domain).
  if (!/^https:\/\/[^/?#@:]+\//i.test(s)) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  for (const [domain, name] of Object.entries(PLATFORM_DOMAINS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return null;
}

/** A link to a profile or home page is not a post. Require a path beyond "/". */
export function isLivePostUrl(raw: string | null | undefined): boolean {
  if (!platformOf(raw)) return false;
  const u = new URL((raw ?? "").trim());
  // Same shape public.content_publish_url_ok() requires: a path segment after the host.
  return u.pathname.replace(/\/+/g, "").length > 0;
}

/** Destination channels a card targets. SH/YT are YouTube; SFD/IMS are retired Instagram handles. */
export function expectedPlatform(brand: string | null | undefined): string | null {
  if (brand === "SH" || brand === "YT") return "YouTube";
  if (brand === "SFD" || brand === "IMS") return "Instagram";
  return null;
}

/** ok=true carries platform (+ optional warning); ok=false carries reason. Flat shape so it narrows without strict mode. */
export interface PublishCheck { ok: boolean; platform: string | null; warning: string | null; reason: string | null }
const fail = (reason: string): PublishCheck => ({ ok: false, platform: null, warning: null, reason });

/**
 * The rule for "Published": an https URL on a known platform that points at a
 * post (not a bare domain). A URL on a different platform than the card's
 * destination is allowed (Repurpose mirrors Shorts to TikTok) but warned.
 */
export function checkPublishUrl(raw: string | null | undefined, brand?: string | null): PublishCheck {
  const s = (raw ?? "").trim();
  if (!s) return fail("Paste the live post URL.");
  if (!/^https:\/\//i.test(s)) return fail("The URL must start with https://.");
  const platform = platformOf(s);
  if (!platform && !/[\s/]$/.test(s) && !/^https:\/\/[^/]+[?#]/i.test(s) && platformOf(`${s}/x`)) {
    return fail("That is the platform's home page, not a post. Paste the post's own link.");
  }
  if (!platform) return fail(`That is not a known platform link (${Object.values(PLATFORM_DOMAINS).filter((v, i, a) => a.indexOf(v) === i).join(", ")}).`);
  if (!isLivePostUrl(s)) return fail("That is the platform's home page, not a post. Paste the post's own link.");
  const want = expectedPlatform(brand);
  const warning = want && want !== platform ? `This card's destination is ${want}; the link is on ${platform}.` : null;
  return { ok: true, platform, warning, reason: null };
}

/** True only when the row carries real evidence of publication. */
export function hasPublishEvidence(c: Pick<WorkflowCard, "published_url" | "publish_evidence">): boolean {
  return (c.publish_evidence === "provider" || c.publish_evidence === "manual_confirmation") && isLivePostUrl(c.published_url);
}

// ── Stage mapping ───────────────────────────────────────────────────────────

/** Map any stored status (incl. legacy) to the stage the board shows. Unknown values fall back to Idea, never to Published. */
export function stageOf(c: Pick<WorkflowCard, "status" | "published_url" | "publish_evidence">): Stage {
  switch (c.status) {
    case "idea":
    case "record":
    case "edit":
    case "review":
    case "ready":
    case "scheduled":
      return c.status;
    case "recorded":
      return "edit";
    case "published":
    case "posted":
      return hasPublishEvidence(c) ? "published" : "published_unconfirmed";
    default:
      return "idea";
  }
}

export const STAGE_ORDER: Record<Stage, number> = {
  idea: 0, record: 1, edit: 2, review: 3, ready: 4, scheduled: 5, published_unconfirmed: 6, published: 7,
};

/** The forward step from a stage, or null at the end. Ready -> Scheduled is optional (Ready can publish directly). */
export function nextStatus(stage: Stage): WorkflowStatus | null {
  switch (stage) {
    case "idea": return "record";
    case "record": return "edit";
    case "edit": return "review";
    case "review": return "ready";
    case "ready": return "scheduled";
    case "scheduled": return "published";
    case "published_unconfirmed": return "published";
    default: return null;
  }
}

/** The backward step (send back). */
export function previousStatus(stage: Stage): WorkflowStatus | null {
  switch (stage) {
    case "record": return "idea";
    case "edit": return "record";
    case "review": return "edit";
    case "ready": return "edit";      // send back for another cut, approval is cleared by the caller
    case "scheduled": return "ready";
    case "published":
    case "published_unconfirmed": return "ready";
    default: return null;
  }
}

/**
 * Statuses the page may write directly with a plain status change. Published and
 * Scheduled need their dialogs (URL / time); Ready needs an approval; legacy
 * values are never written.
 */
export function canWriteStatus(status: string): status is WorkflowStatus {
  return status === "idea" || status === "record" || status === "edit" || status === "review";
}

export type ScheduleInfo = { label: string; isJob: boolean };
/** Scheduled is only "scheduled" when a job record backs it; otherwise it is a manual plan. */
export function scheduleLabel(c: Pick<WorkflowCard, "scheduled_for" | "schedule_kind" | "schedule_job_ref">): ScheduleInfo | null {
  if (!c.scheduled_for) return null;
  const isJob = c.schedule_kind === "job" && Boolean((c.schedule_job_ref ?? "").trim());
  return { label: isJob ? "Scheduled job" : "Manual plan", isJob };
}

// ── Next action ─────────────────────────────────────────────────────────────

const blank = (v: string | null | undefined) => !(v ?? "").trim();

/** The single next thing to do on a card, derived from its stage and what is missing. */
export function nextAction(c: WorkflowCard): string {
  const stage = stageOf(c);
  switch (stage) {
    case "idea":
      if (blank(c.hook)) return "Write the hook";
      if (blank(c.record_script)) return "Write the shot list";
      return "Plan the recording";
    case "record":
      if (blank(c.record_script)) return "Write the shot list";
      return blank(c.clip) ? "Record it, then attach the footage" : "Footage attached: move to Edit";
    case "edit":
      if (blank(c.clip)) return "Attach the source footage";
      if (blank(c.edit_prompt)) return "Write the edit instructions";
      if (blank(c.caption)) return "Write the caption";
      return "Cut it, then send to Review";
    case "review":
      if (blank(c.caption)) return "Write the caption before approval";
      return "Approve or send back";
    case "ready":
      return "Publish it, then confirm with the live URL";
    case "scheduled":
      return scheduleLabel(c)?.isJob ? "Confirm the live URL once it posts" : "Post it by hand at the planned time, then confirm the URL";
    case "published_unconfirmed":
      return "Add the live URL to confirm it was published";
    case "published":
      return "Done";
  }
}

// ── Today: a short prioritized queue ────────────────────────────────────────

/** YYYY-MM-DD in America/Phoenix for a given instant. */
export function phoenixDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** 1 = Monday … 7 = Sunday, in America/Phoenix (matches content_cards.day). */
export function phoenixWeekday(now: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", weekday: "short" }).format(now);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[wd] ?? 0;
}

export interface TodayItem<T extends WorkflowCard> { card: T; stage: Stage; reason: string; score: number }

/**
 * At most `limit` cards, most urgent first:
 *   overdue deadline > scheduled for today or earlier > ready > review > due today
 *   > edit with footage > record > today's weekly slot.
 * Published cards never appear; unconfirmed ones do (they need a URL).
 */
export function todayQueue<T extends WorkflowCard>(cards: T[], now: Date, limit = 7): TodayItem<T>[] {
  const today = phoenixDate(now);
  const weekday = phoenixWeekday(now);
  const out: TodayItem<T>[] = [];
  for (const card of cards) {
    const stage = stageOf(card);
    if (stage === "published") continue;
    let score = 0; let reason = "";
    const due = (card.due_date ?? "").slice(0, 10);
    const overdue = due && due < today;
    const dueToday = due === today;
    const schedDay = card.scheduled_for ? phoenixDate(new Date(card.scheduled_for)) : "";
    if (stage === "scheduled" && schedDay && schedDay <= today) { score = 90; reason = schedDay < today ? "Planned post time has passed" : "Planned to post today"; }
    else if (stage === "published_unconfirmed") { score = 55; reason = "Marked posted without a live URL"; }
    else if (stage === "ready") { score = 80; reason = "Approved and ready to publish"; }
    else if (stage === "review") { score = 70; reason = "Waiting on approval"; }
    else if (stage === "edit") { score = blank(card.clip) ? 40 : 60; reason = blank(card.clip) ? "Needs its footage" : "Footage in, needs the cut"; }
    else if (stage === "record") { score = 50; reason = "Next to record"; }
    else if (stage === "idea") { score = card.day === weekday ? 45 : 10; reason = card.day === weekday ? "Today's slot on the week plan" : "Idea"; }
    else if (stage === "scheduled") { score = 30; reason = "Planned for later"; }
    if (overdue) { score += 100; reason = `Overdue (due ${due})`; }
    else if (dueToday) { score += 50; reason = "Due today"; }
    if (score >= 40) out.push({ card, stage, reason, score });
  }
  out.sort((a, b) => b.score - a.score || STAGE_ORDER[b.stage] - STAGE_ORDER[a.stage] || (a.card.due_date ?? "9999").localeCompare(b.card.due_date ?? "9999") || a.card.title.localeCompare(b.card.title));
  return out.slice(0, limit);
}

// ── The four questions ──────────────────────────────────────────────────────

export interface FourQuestions<T extends WorkflowCard> {
  recordNext: T[];      // Idea + Record
  needsEditing: T[];    // Edit (+ Review awaiting approval reported separately)
  awaitingApproval: T[];
  readyToPublish: T[];  // Ready + Scheduled
  published: T[];       // confirmed only
  unconfirmed: T[];     // legacy posted / published without evidence
}

export function fourQuestions<T extends WorkflowCard>(cards: T[]): FourQuestions<T> {
  const by = (s: Stage[]) => cards.filter((c) => s.includes(stageOf(c)));
  const byDue = (a: T, b: T) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || (a.day || 9) - (b.day || 9) || a.title.localeCompare(b.title);
  return {
    recordNext: by(["record", "idea"]).sort((a, b) => STAGE_ORDER[stageOf(b)] - STAGE_ORDER[stageOf(a)] || byDue(a, b)),
    needsEditing: by(["edit"]).sort(byDue),
    awaitingApproval: by(["review"]).sort(byDue),
    readyToPublish: by(["ready", "scheduled"]).sort(byDue),
    published: by(["published"]),
    unconfirmed: by(["published_unconfirmed"]),
  };
}

// ── The simple lifecycle shown to the person ────────────────────────────────────────────────────────────────

/**
 * Idea -> Selected -> Filming -> Editing -> Ready -> Published. These are labels over the stored statuses above, not
 * new statuses: nothing in the database changes. Record is "Selected" until some filming has actually happened (a
 * ticked item in the pack, or footage attached), then "Filming". Review (waiting on approval) counts as Editing;
 * Scheduled counts as Ready. Published needs the same evidence the stage already requires.
 */
export type Lifecycle = "idea" | "selected" | "filming" | "editing" | "ready" | "published";
export const LIFECYCLE: Lifecycle[] = ["idea", "selected", "filming", "editing", "ready", "published"];
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { idea: "Idea", selected: "Selected", filming: "Filming", editing: "Editing", ready: "Ready", published: "Published" };

export function lifecycleOf(c: Pick<WorkflowCard, "status" | "published_url" | "publish_evidence" | "clip" | "record_script">): Lifecycle {
  const stage = stageOf(c);
  switch (stage) {
    case "idea": return "idea";
    case "record": return !blank(c.clip) || parsePack(c.record_script).done > 0 ? "filming" : "selected";
    case "edit":
    case "review": return "editing";
    case "ready":
    case "scheduled": return "ready";
    case "published":
    case "published_unconfirmed": return "published";
  }
}

/** The lifecycle label for the screen. A post marked published without a live link says so instead of reading as confirmed. */
export function lifecycleText(c: Pick<WorkflowCard, "status" | "published_url" | "publish_evidence" | "clip" | "record_script">): string {
  return stageOf(c) === "published_unconfirmed" ? "Published (unconfirmed)" : LIFECYCLE_LABEL[lifecycleOf(c)];
}
