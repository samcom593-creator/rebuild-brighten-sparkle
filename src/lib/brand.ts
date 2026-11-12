// Brand engine vocabulary (MP-BRAND-ENGINE, 2026-11-12): the accounts, pillars, keywords and card
// formats shared by Brand Command, the Social Media Center, the Launch Board plan and My Day.
// One list each, so a pillar or account can never be spelled two ways on two pages.
import type { Tone } from "@/lib/tones";

export type AccountKey = "youtube" | "tiktok-main" | "tiktok-sales" | "tiktok-rant" | "snapchat" | "instagram";

export interface BrandAccount {
  key: AccountKey;
  label: string;
  handle: string;
  /** Public profile, or null when the handle has not been confirmed to resolve. */
  url: string | null;
  /** Shorts expected per day. The six add up to 5 a day, 35 a week. Instagram is 0 while it is paused. */
  dailyExpected: number;
  /** The platform value used by content_posts and social_bot_drafts for this account. */
  platform: "youtube" | "tiktok" | "snapchat" | "instagram";
}

export const ACCOUNTS: BrandAccount[] = [
  { key: "youtube", label: "YouTube", handle: "@Sell4daddy", url: "https://www.youtube.com/@Sell4daddy", dailyExpected: 1, platform: "youtube" },
  { key: "tiktok-main", label: "TikTok main", handle: "@sellfordaddy", url: "https://www.tiktok.com/@sellfordaddy", dailyExpected: 1, platform: "tiktok" },
  { key: "tiktok-sales", label: "TikTok sales", handle: "sales page", url: null, dailyExpected: 1, platform: "tiktok" },
  { key: "tiktok-rant", label: "TikTok rants", handle: "@rant4daddy", url: "https://www.tiktok.com/@rant4daddy", dailyExpected: 1, platform: "tiktok" },
  { key: "snapchat", label: "Snapchat", handle: "Snapchat", url: "https://snapchat.com/t/Cd9FF7Bv", dailyExpected: 1, platform: "snapchat" },
  { key: "instagram", label: "Instagram", handle: "@sell4daddy", url: "https://www.instagram.com/sell4daddy/", dailyExpected: 0, platform: "instagram" },
];

export const ACCOUNT_BY_KEY: Record<string, BrandAccount> = Object.fromEntries(ACCOUNTS.map((a) => [a.key, a]));
export const accountLabel = (key: string | null | undefined): string => (key && ACCOUNT_BY_KEY[key]?.label) || key || "No account";

/** Which account a draft belongs to: its own account when set, else the first account on its platform. */
export function accountOfDraft(d: { account?: string | null; platform?: string | null }): AccountKey | null {
  if (d.account && ACCOUNT_BY_KEY[d.account]) return d.account as AccountKey;
  const p = (d.platform ?? "").toLowerCase();
  if (p.startsWith("youtube") || p === "yt") return "youtube";
  if (p.startsWith("tiktok")) return "tiktok-main";
  if (p.startsWith("snap")) return "snapchat";
  if (p.startsWith("instagram") || p === "ig") return "instagram";
  return null;
}

export type PillarKey = "money-sales" | "rebuild" | "gym-looks" | "style-streetwear" | "cars-speed" | "story-faith" | "proof";

export const PILLARS: { key: PillarKey; label: string; mix: number; tone: Tone }[] = [
  { key: "money-sales", label: "Money and sales", mix: 25, tone: "gold" },
  { key: "rebuild", label: "The rebuild", mix: 20, tone: "royal" },
  { key: "gym-looks", label: "Gym and looks", mix: 20, tone: "good" },
  { key: "style-streetwear", label: "Style and streetwear", mix: 10, tone: "cool" },
  { key: "cars-speed", label: "Cars and speed", mix: 10, tone: "hot" },
  { key: "story-faith", label: "Story and faith", mix: 10, tone: "warm" },
  { key: "proof", label: "Proof", mix: 5, tone: "slate" },
];
export const PILLAR_BY_KEY: Record<string, (typeof PILLARS)[number]> = Object.fromEntries(PILLARS.map((p) => [p.key, p]));
export const pillarLabel = (key: string | null | undefined): string => (key && PILLAR_BY_KEY[key]?.label) || key || "No pillar";

export type Keyword = "TEAM" | "BODY" | "BUILD";
export const KEYWORDS: { key: Keyword; door: string; url: string; reply: string; tone: Tone }[] = [
  {
    key: "TEAM", door: "Join the Team", url: "https://sell4daddy.com/team", tone: "gold",
    reply: "Appreciate you reaching out. This is the team page, it takes two minutes: https://sell4daddy.com/team. Apply there and you are in the pipeline the same day.",
  },
  {
    key: "BODY", door: "The Standard Body", url: "https://sell4daddy.com/body", tone: "good",
    reply: "Here is the plan I used, built for you with a setup call: https://sell4daddy.com/body. Results depend on the work you put in.",
  },
  {
    key: "BUILD", door: "Build Your Agency", url: "https://sell4daddy.com/build", tone: "royal",
    reply: "For agency owners I start with four questions, then a call: https://sell4daddy.com/build. If the numbers fit, I call you.",
  },
];
export const KEYWORD_BY_KEY: Record<Keyword, (typeof KEYWORDS)[number]> = Object.fromEntries(KEYWORDS.map((k) => [k.key, k])) as Record<Keyword, (typeof KEYWORDS)[number]>;

/**
 * The keyword a message is asking for. The typed word wins; otherwise the bot's own tier/intent label
 * decides. Returns null when nothing points at a door, so an unrelated comment is never forced into one.
 */
export function keywordOf(row: { message?: string | null; tier?: string | null; intent?: string | null }): Keyword | null {
  const msg = (row.message ?? "").toUpperCase();
  const typed = msg.match(/\b(TEAM|BODY|BUILD)\b/);
  if (typed) return typed[1] as Keyword;
  const hint = `${row.tier ?? ""} ${row.intent ?? ""}`.toLowerCase();
  if (/fit|body|gym|weight/.test(hint)) return "BODY";
  if (/agency|build|owner|imo/.test(hint)) return "BUILD";
  if (/join|apex|team|career|recruit/.test(hint) || /\bAPEX\b/.test(msg)) return "TEAM";
  return null;
}

export const CARD_FORMATS: { key: string; label: string; long: boolean }[] = [
  { key: "long-numbers", label: "Long-form: numbers", long: true },
  { key: "long-lesson", label: "Long-form: lesson", long: true },
  { key: "long-story", label: "Long-form: story", long: true },
  { key: "long-case-study", label: "Long-form: case study", long: true },
  { key: "long-hot-seat", label: "Long-form: hot seat", long: true },
  { key: "long-teardown", label: "Long-form: teardown", long: true },
  { key: "short", label: "Short", long: false },
  { key: "rant", label: "Rant", long: false },
  { key: "fit-check", label: "Fit check", long: false },
  { key: "gym", label: "Gym", long: false },
  { key: "car", label: "Car", long: false },
];
export const FORMAT_BY_KEY: Record<string, (typeof CARD_FORMATS)[number]> = Object.fromEntries(CARD_FORMATS.map((f) => [f.key, f]));
export const formatLabel = (key: string | null | undefined): string => (key && FORMAT_BY_KEY[key]?.label) || key || "No format";

/** What a card still needs before it may be Scheduled. Mirrors public.content_cards_brand_gate(). */
export function scheduleGaps(card: { title?: string | null; brief?: Record<string, unknown> | null }): string[] {
  const b = card.brief ?? {};
  const has = (k: string) => String(b[k] ?? "").trim() !== "";
  const gaps: string[] = [];
  if (!String(card.title ?? "").trim()) gaps.push("title");
  if (!has("account")) gaps.push("account");
  if (!has("pillar")) gaps.push("pillar");
  if (!has("keyword")) gaps.push("CTA keyword");
  return gaps;
}

// ── Scorecard maths ─────────────────────────────────────────────────────────

export interface Lane { key: string; label: string; target: number; kind: "output" | "result"; value: number; prev: number }
export type LaneState = "green" | "amber" | "red";

/** Share of the Phoenix week that has passed, 1/7 at the end of Monday. A finished week is 1. */
export function weekPace(weekStart: string, now = new Date()): number {
  const start = new Date(`${weekStart}T00:00:00-07:00`).getTime();
  const days = (now.getTime() - start) / 86_400_000;
  return Math.min(1, Math.max(1 / 7, Math.ceil(days) / 7));
}

/**
 * Green: at or ahead of where the week should be by now (or the target is already hit).
 * Amber: within 70% of that pace. Red: further behind.
 */
export function laneState(value: number, target: number, pace: number): LaneState {
  if (target <= 0) return "green";
  if (value >= target) return "green";
  const due = target * pace;
  if (value >= due) return "green";
  if (value >= due * 0.7) return "amber";
  return "red";
}

export const LANE_TONE: Record<LaneState, Tone> = { green: "good", amber: "warm", red: "hot" };
export const LANE_WORD: Record<LaneState, string> = { green: "On target", amber: "Close", red: "Behind" };

/** Stage-to-stage conversion, or null when the earlier stage is 0 (no rate exists, so none is shown). */
export function conversion(from: number, to: number): number | null {
  if (!from || from <= 0) return null;
  return Math.round((to / from) * 1000) / 10;
}

export const fmtNum = (n: number | null | undefined): string => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));

/** YYYY-MM-DD for a date in Arizona, which never changes its clock. */
export function phoenixDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Monday of the Phoenix week containing `key`. */
export function weekStartOf(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDaysKey(key, -dow);
}

/** The two rules printed under the weekly review. */
export const REVIEW_RULES = [
  "Results missed twice while output is green: fix the hook, title or offer, not the volume.",
  "Output missed: fix the schedule.",
] as const;

/** The five numbers Sam reads first. */
export const FIVE_NUMBERS = ["long_forms", "shorts", "keyword_dms", "applications", "body_sales"] as const;
