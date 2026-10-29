/**
 * Home conversions (OVERHAUL-home, 2026-10-29): the pure rules behind the owner Home's
 * conversion strip and its roster number.
 *
 * Sam: "the roster being 68 is just not accurate. Give me better stats and make it easier for
 * me to convert." Every number here is the length of one slice of the people the server
 * returned (home_conversion_people, supabase/migrations/20261029083000_home_conversion_people.sql),
 * so a number and the list it opens are the same rows by construction, never two queries that
 * can drift apart. Nothing in this file touches the network.
 *
 * Truth rules:
 *   - A failed or missing read is unknown ("—"), never zero. An empty slice of a read that
 *     arrived is a true zero.
 *   - "Today" is the America/Phoenix business day the server answered for; windows are
 *     inclusive day keys and are never rebuilt from the viewer's clock.
 *   - Bought Xcel depends on Xcel's daily report. When the newest report is more than two days
 *     old the count is unknown, because a purchase since then cannot be in it.
 *   - A row whose kind or period the page does not know is dropped, never guessed into a tile.
 */
import { formatClock, formatDay } from "@/lib/calendarTime";
import type { Tone } from "@/lib/tones";

export const CONVERSION_KINDS = [
  "applied",
  "interview_booked",
  "xcel_bought",
  "passed_test",
  "licensed",
  "first_deal",
  "selling",
] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

export type ConversionPeriod = "current" | "prior";

/** The zone every Home window and every time on these lists is read in. */
export const CONVERSION_TZ = "America/Phoenix";

/** One person behind one number. Extra fields depend on the kind. */
export interface ConversionPerson {
  kind: ConversionKind;
  period: ConversionPeriod;
  name: string | null;
  /** When it happened, when the source has a time. */
  at: string | null;
  /** The Phoenix business day it happened on ("YYYY-MM-DD"). */
  on: string | null;
  application_id: string | null;
  agent_id: string | null;
  /** Applied and passed: the license status on the record. */
  license?: string | null;
  /** Interview booked: "licensed" or "leader". */
  track?: string | null;
  /** Interview booked: when the call is. */
  starts_at?: string | null;
  /** Bought Xcel: the course name Xcel reported. */
  course?: string | null;
  /** Newly licensed: "booking" when booking the licensed call marked them licensed. */
  how?: string | null;
  /** First deal: ALP on the first day. Selling: ALP in the last 30 days. */
  ap?: number | null;
  /** Selling: posted deals in the last 30 days. */
  deals?: number | null;
}

export interface ConversionPayload {
  as_of: string;
  /** The Phoenix business day the server answered for. */
  today: string;
  week_start: string;
  prior_week_start: string;
  month_start: string;
  /** The newest Xcel daily report on file, or null when none ever arrived. */
  xcel_report_on: string | null;
  people: ConversionPerson[];
}

export type ConversionWindow = "day" | "week" | "month";

export interface ConversionStep {
  kind: ConversionKind;
  /** What the number counts, in plain words: the list's title and the tile's spoken name. */
  label: string;
  /** The tile label under its group's header ("Today", "Last 7 days"), which already says when. */
  short: string;
  window: ConversionWindow;
  /** The full rule, for the tooltip and the list's header. */
  definition: string;
  /** The list's sentence when nobody is on it. */
  emptyText: string;
  /** What to do when nobody is on the list yet. */
  emptyAction: { label: string; to: string };
}

/** The strip, in funnel order: from a new application to a first deal. */
export const CONVERSION_STEPS: readonly ConversionStep[] = [
  {
    kind: "applied",
    label: "Applied today",
    short: "Applied",
    window: "day",
    definition: "Applications received today, Phoenix time. A second application from the same person and interview-only bookings are not counted.",
    emptyText: "No applications yet today.",
    emptyAction: { label: "Share a recruiting link", to: "/admin/invite-links" },
  },
  {
    kind: "interview_booked",
    label: "Interviews booked today",
    short: "Interviews booked",
    window: "day",
    definition: "Licensed calls and leader calls booked today, Phoenix time, that are still on. Onboarding calls are not interviews. One per person.",
    emptyText: "No interviews booked yet today.",
    emptyAction: { label: "Open the Call list", to: "/dashboard/recruiting" },
  },
  {
    kind: "xcel_bought",
    label: "Bought Xcel",
    short: "Bought Xcel",
    window: "week",
    definition: "People who bought the Xcel pre-licensing course in the last 7 days: their first enrollment in Xcel's reports. Someone enrolling again is not a new purchase.",
    emptyText: "Nobody bought Xcel in the last 7 days.",
    emptyAction: { label: "See who still needs Xcel", to: "/dashboard/recruits" },
  },
  {
    kind: "passed_test",
    label: "Passed the test",
    short: "Passed the test",
    window: "week",
    definition: "People first marked as having passed the state licensing exam in the last 7 days.",
    emptyText: "Nobody passed the test in the last 7 days.",
    emptyAction: { label: "Open New hires", to: "/dashboard/recruits" },
  },
  {
    kind: "licensed",
    label: "Newly licensed",
    short: "Newly licensed",
    window: "week",
    definition: "People who got licensed in the last 7 days after they applied or were hired without a license. Someone who applied already licensed is not counted.",
    emptyText: "Nobody got licensed in the last 7 days.",
    emptyAction: { label: "Open New hires", to: "/dashboard/recruits" },
  },
  {
    kind: "first_deal",
    label: "First deals",
    short: "First deals",
    window: "week",
    definition: "Agents whose first posted deal ever was in the last 7 days, from the same book as the production numbers.",
    emptyText: "No first deals in the last 7 days.",
    emptyAction: { label: "Open New hires", to: "/dashboard/recruits" },
  },
];

/** The strip's two groups: what happened today, and what moved in the last 7 days. */
export const CONVERSION_GROUPS: ReadonlyArray<{ window: ConversionWindow; title: string; compared: string; steps: readonly ConversionStep[] }> = [
  { window: "day", title: "Today", compared: "compared with yesterday", steps: CONVERSION_STEPS.filter((s) => s.window === "day") },
  { window: "week", title: "Last 7 days", compared: "compared with the 7 days before", steps: CONVERSION_STEPS.filter((s) => s.window === "week") },
];

/** The roster number: who is actually selling. */
export const SELLING_STEP: ConversionStep = {
  kind: "selling",
  label: "Selling agents",
  short: "Selling agents",
  window: "month",
  definition: "Licensed agents on the roster with at least one posted deal in the last 30 days, from the same book as the production numbers. The list is every one of them.",
  emptyText: "Nobody on the roster sold in the last 30 days.",
  emptyAction: { label: "Open the leaderboard", to: "/dashboard/leaderboard" },
};

/**
 * One tone per step (src/lib/tones.ts meanings): a new application is a new lead and a booked
 * interview is Booked (cool, as on the Call list and the Instagram desk); buying Xcel is "Bought
 * Xcel" (good, as on New hires); passing the test is a licensing step (royal, the journey bar's
 * licensing); newly licensed, a first deal and a selling agent are going well (good, as the
 * journey bar's licensed and first deal, and Producing).
 */
export function conversionTone(kind: ConversionKind): Tone {
  switch (kind) {
    case "applied":
    case "interview_booked":
      return "cool";
    case "passed_test":
      return "royal";
    case "xcel_bought":
    case "licensed":
    case "first_deal":
    case "selling":
      return "good";
    default:
      return "slate";
  }
}

const KEY_RX = /^\d{4}-\d{2}-\d{2}$/;

const isKind = (v: unknown): v is ConversionKind => typeof v === "string" && (CONVERSION_KINDS as readonly string[]).includes(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const dayKey = (v: unknown): string | null => {
  const s = str(v);
  return s && KEY_RX.test(s.slice(0, 10)) ? s.slice(0, 10) : null;
};

/**
 * The server's answer, checked. Anything that is not the shape returns null (unknown), and a
 * person row with an unknown kind or period is dropped rather than counted somewhere.
 */
export function parseConversionPayload(raw: unknown): ConversionPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const today = dayKey(o.today);
  if (!today || !Array.isArray(o.people)) return null;
  const people: ConversionPerson[] = [];
  for (const row of o.people) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (!isKind(r.kind) || (r.period !== "current" && r.period !== "prior")) continue;
    people.push({
      kind: r.kind,
      period: r.period,
      name: str(r.name)?.trim() ?? null,
      at: str(r.at),
      on: dayKey(r.on),
      application_id: str(r.application_id),
      agent_id: str(r.agent_id),
      license: str(r.license),
      track: str(r.track),
      starts_at: str(r.starts_at),
      course: str(r.course),
      how: str(r.how),
      ap: num(r.ap),
      deals: num(r.deals),
    });
  }
  return {
    as_of: str(o.as_of) ?? "",
    today,
    week_start: dayKey(o.week_start) ?? today,
    prior_week_start: dayKey(o.prior_week_start) ?? today,
    month_start: dayKey(o.month_start) ?? today,
    xcel_report_on: dayKey(o.xcel_report_on),
    people,
  };
}

/**
 * The people behind one number. Newest first, as the server sent them, except Selling agents,
 * which reads like a leaderboard: most ALP in the last 30 days first, then by name.
 */
export function peopleFor(payload: ConversionPayload | null, kind: ConversionKind, period: ConversionPeriod = "current"): ConversionPerson[] {
  if (!payload) return [];
  const list = payload.people.filter((p) => p.kind === kind && p.period === period);
  if (kind !== "selling") return list;
  return [...list].sort((a, b) => (b.ap ?? -1) - (a.ap ?? -1) || (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Whole days from key a to key b (b - a). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The Xcel numbers can be trusted when the newest daily report is at most two days old. */
export const XCEL_REPORT_MAX_AGE_DAYS = 2;

export function xcelFeedFresh(payload: ConversionPayload | null): boolean {
  if (!payload?.xcel_report_on) return false;
  return daysBetween(payload.xcel_report_on, payload.today) <= XCEL_REPORT_MAX_AGE_DAYS;
}

/**
 * The number on a tile: the count of its people, or null (a dash) when it cannot be known —
 * no answer from the server, or Bought Xcel while Xcel's report has gone quiet.
 */
export function conversionCount(payload: ConversionPayload | null, kind: ConversionKind, period: ConversionPeriod = "current"): number | null {
  if (!payload) return null;
  if (kind === "xcel_bought" && !xcelFeedFresh(payload)) return null;
  return peopleFor(payload, kind, period).length;
}

/** What the comparison period is called on a tile and in a list. */
export function priorLabel(window: ConversionWindow): string {
  return window === "day" ? "yesterday" : window === "week" ? "the week before" : "the 30 days before";
}

/** What the current period is called, when the label does not already say it. */
export function currentLabel(window: ConversionWindow): string {
  return window === "day" ? "Today" : window === "week" ? "Last 7 days" : "Last 30 days";
}

/**
 * The comparison under a number, in words. `text` sits under a group header that already says
 * what it is compared with ("Up from 1", "Down from 3", "No change"); `spoken` says it in full
 * for a screen reader ("Up from 1 yesterday"). The tone only repeats the words. Unknown on either
 * side gives no comparison at all.
 */
export function conversionTrend(current: number | null, prior: number | null, window: ConversionWindow): { text: string; spoken: string; tone: Tone } | null {
  if (current === null || prior === null) return null;
  const when = priorLabel(window);
  if (current > prior) return { text: `Up from ${prior.toLocaleString()}`, spoken: `Up from ${prior.toLocaleString()} ${when}`, tone: "good" };
  if (current < prior) return { text: `Down from ${prior.toLocaleString()}`, spoken: `Down from ${prior.toLocaleString()} ${when}`, tone: "warm" };
  return { text: "No change", spoken: `Same as ${when}`, tone: "slate" };
}

/** "today", "yesterday", or "Tue, Oct 20": the day inside a sentence. */
export function dayWords(key: string | null, todayKey: string): string {
  const label = dayLabel(key, todayKey);
  return label === "Today" || label === "Yesterday" || label === "Date unknown" ? label.toLowerCase() : label;
}

/** "Today", "Yesterday", or "Tue, Oct 20" for a business-day key. */
export function dayLabel(key: string | null, todayKey: string): string {
  if (!key) return "Date unknown";
  const diff = daysBetween(key, todayKey);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function licenseWords(license: string | null | undefined): string | null {
  switch ((license ?? "").toLowerCase()) {
    case "licensed": return "Licensed";
    case "unlicensed": return "Not licensed yet";
    case "pending": return "License pending";
    default: return null;
  }
}

function validInstant(iso: string | null | undefined): iso is string {
  return Boolean(iso) && Number.isFinite(Date.parse(iso as string));
}

/**
 * The one line under a person's name: what happened and when, in Phoenix time. The day-window
 * lists sit under "Today" and "Yesterday", so their lines carry the time and not the day again.
 */
export function personDetail(p: ConversionPerson, todayKey: string): string {
  const day = dayWords(p.on, todayKey);
  const clock = validInstant(p.at) ? formatClock(p.at, CONVERSION_TZ) : null;
  const when = clock ? `${day}, ${clock}` : day;
  switch (p.kind) {
    case "applied":
      return [`Applied ${clock ?? day}`, licenseWords(p.license)].filter(Boolean).join(" · ");
    case "interview_booked": {
      const call = p.track === "leader" ? "Leader call" : "Licensed call";
      const slot = validInstant(p.starts_at)
        ? `${formatDay(p.starts_at, CONVERSION_TZ)}, ${formatClock(p.starts_at, CONVERSION_TZ)}`
        : "time not set";
      return `${call} ${slot} · booked ${clock ?? day}`;
    }
    case "xcel_bought":
      return [`Enrolled ${day}`, p.course].filter(Boolean).join(" · ");
    case "passed_test":
      return `Passed ${when}`;
    case "licensed":
      return p.how === "booking" ? `Licensed ${when} · booked the licensed call` : `Licensed ${when}`;
    case "first_deal":
      return `First deal ${day}`;
    case "selling": {
      const deals = p.deals ?? 0;
      return `${deals.toLocaleString()} ${deals === 1 ? "deal" : "deals"} · last sale ${day}`;
    }
    default:
      return day;
  }
}

/** The amount on the right of a producer's row: 30-day ALP for a seller, first-day ALP for a first deal. */
export function personValue(p: ConversionPerson): { amount: string; label: string } | null {
  if (p.ap === null || p.ap === undefined) return null;
  if (p.kind === "selling") return { amount: money(p.ap), label: "ALP, 30 days" };
  if (p.kind === "first_deal") return { amount: money(p.ap), label: "first-day ALP" };
  return null;
}

/**
 * Where a person opens: a hire or a producer opens their agent page; anyone still in the
 * funnel opens on the Call list (applied, booked) or on New hires (Xcel, test, license), where
 * their progress bar is. Null when there is nothing to open them by.
 */
export function personHref(p: ConversionPerson): string | null {
  if ((p.kind === "first_deal" || p.kind === "selling") && p.agent_id) return `/dashboard/agents/${encodeURIComponent(p.agent_id)}`;
  if ((p.kind === "applied" || p.kind === "interview_booked") && p.application_id) {
    return `/dashboard/recruiting?person=${encodeURIComponent(p.application_id)}`;
  }
  if (p.kind === "interview_booked" && p.agent_id) return `/dashboard/agents/${encodeURIComponent(p.agent_id)}`;
  if ((p.kind === "xcel_bought" || p.kind === "passed_test" || p.kind === "licensed") && p.name) {
    return `/dashboard/recruits?q=${encodeURIComponent(p.name)}`;
  }
  if (p.agent_id) return `/dashboard/agents/${encodeURIComponent(p.agent_id)}`;
  return null;
}

/** Why a number is a dash, in words, or null when it is known. */
export function unknownReason(payload: ConversionPayload | null, kind: ConversionKind): string | null {
  if (!payload) return null;
  if (kind === "xcel_bought" && !xcelFeedFresh(payload)) {
    return payload.xcel_report_on
      ? `Xcel's daily report has not arrived since ${dayLabel(payload.xcel_report_on, payload.today)}, so recent purchases may be missing.`
      : "No Xcel daily report has arrived yet, so purchases cannot be counted.";
  }
  return null;
}
