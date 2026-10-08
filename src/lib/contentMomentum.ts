// Launch Board momentum / gamification logic (Sam 2026-10-08).
//
// The objective: make posting addictive and obvious. The old 80/20 "insurance
// mix" grading is gone — the only numbers here are the ones that make Sam want
// to post again: the streak he doesn't want to break, the climb to the next
// subscriber milestone, a creator level that ticks up with every upload, and
// honest week-over-week on uploads and views.
//
// Everything is a pure function of the posts already loaded by usePosts() plus
// the live youtube_channel_stats, so there is nothing new to fetch and no fake
// number: a value we can't compute honestly returns null and the UI hides it.
import { countPieces, phoenixDateKey } from "./contentWeek";

export type MomentumPost = { posted_at: string | null; format: string | null; platform: string | null; views?: number | null };

const DAY = 86400_000; // Phoenix has no DST, so subtracting whole days keeps the same wall-clock day.

/** Consecutive Phoenix days ending today (or yesterday) with at least one post.
 *  alive  = today already has a post.
 *  atRisk = the run is still live but today is empty — the chain is on the line.
 *  missed = when the chain is broken (days === 0), the number of days in a row with NO post
 *           ending today — shown as a negative streak so a slip is loud, not silent.
 *  Pass a pre-filtered array (e.g. YouTube-only) to get a per-platform streak. */
export function streak(posts: MomentumPost[], now: Date = new Date()): { days: number; alive: boolean; atRisk: boolean; missed: number } {
  const daySet = new Set<string>();
  for (const p of posts) if (p.posted_at) daySet.add(phoenixDateKey(new Date(p.posted_at)));
  const hasToday = daySet.has(phoenixDateKey(now));
  const hasYesterday = daySet.has(phoenixDateKey(new Date(now.getTime() - DAY)));
  // Start the walk from today if it has a post, else yesterday if it does; otherwise the chain is broken.
  const start = hasToday ? now : hasYesterday ? new Date(now.getTime() - DAY) : null;
  if (!start) {
    if (daySet.size === 0) return { days: 0, alive: false, atRisk: false, missed: 0 };
    // Count the empty days from today back to the most recent post (capped so a dead channel can't loop forever).
    let missed = 0;
    for (let c = now; !daySet.has(phoenixDateKey(c)) && missed < 3650; c = new Date(c.getTime() - DAY)) missed++;
    return { days: 0, alive: false, atRisk: false, missed };
  }
  let days = 0;
  for (let c = start; daySet.has(phoenixDateKey(c)); c = new Date(c.getTime() - DAY)) days++;
  return { days, alive: hasToday, atRisk: !hasToday, missed: 0 };
}

// A creator level that ticks up satisfyingly: fast early wins, then wider gaps.
const LEVEL_LADDER = [0, 10, 25, 50, 100, 150, 250, 400, 600, 900, 1300, 1800, 2500, 3500, 5000, 7500, 10000];

/** Creator level from total pieces ever posted. pct is progress toward the next level (0 when maxed). */
export function level(totalPieces: number): { level: number; into: number; span: number; next: number | null; pct: number } {
  const n = Math.max(0, Math.floor(totalPieces));
  let i = 0;
  while (i + 1 < LEVEL_LADDER.length && LEVEL_LADDER[i + 1] <= n) i++;
  const floor = LEVEL_LADDER[i];
  const next = i + 1 < LEVEL_LADDER.length ? LEVEL_LADDER[i + 1] : null;
  const span = next == null ? 0 : next - floor;
  const into = n - floor;
  return { level: i + 1, into, span, next, pct: next == null ? 100 : Math.round((into / span) * 100) };
}

const SUB_LADDER = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** The next subscriber milestone and how close Sam is to it — the climb, with a target to chase.
 *  pct is progress from the previous milestone to the next. Returns null once past the top of the ladder. */
export function nextMilestone(subs: number | null | undefined): { next: number; remaining: number; from: number; pct: number } | null {
  if (subs == null || !Number.isFinite(subs)) return null;
  const s = Math.max(0, Math.floor(subs));
  const idx = SUB_LADDER.findIndex((m) => m > s);
  if (idx === -1) return null;
  const next = SUB_LADDER[idx];
  const from = idx === 0 ? 0 : SUB_LADDER[idx - 1];
  const span = next - from;
  return { next, remaining: next - s, from, pct: span > 0 ? Math.round(((s - from) / span) * 100) : 0 };
}

const inWindow = (p: MomentumPost, now: Date, fromDaysAgo: number, toDaysAgo: number) => {
  if (!p.posted_at) return false;
  const age = now.getTime() - new Date(p.posted_at).getTime();
  return age >= toDaysAgo * DAY && age < fromDaysAgo * DAY;
};

type WoW = { now: number; prev: number; deltaPct: number | null };

/** This 7 days vs the previous 7 days, split into long-form, Shorts, all uploads, and total views
 *  (pieces de-duped per platform per day). deltaPct is null when the prior window is empty
 *  (no honest percentage against zero). */
export function weekOverWeek(posts: MomentumPost[], now: Date = new Date()): {
  uploads: WoW; long: WoW; short: WoW; views: WoW;
} {
  const thisWk = posts.filter((p) => inWindow(p, now, 7, 0));
  const prevWk = posts.filter((p) => inWindow(p, now, 14, 7));
  const sumViews = (xs: MomentumPost[]) => xs.reduce((n, p) => n + (p.views ?? 0), 0);
  const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const pair = (a: number, b: number): WoW => ({ now: a, prev: b, deltaPct: delta(a, b) });
  const ln = countPieces(thisWk, "long"), lp = countPieces(prevWk, "long");
  const sn = countPieces(thisWk, "short"), sp = countPieces(prevWk, "short");
  return {
    uploads: pair(ln + sn, lp + sp),
    long: pair(ln, lp),
    short: pair(sn, sp),
    views: pair(sumViews(thisWk), sumViews(prevWk)),
  };
}

/** Total pieces ever (short + long), de-duped per platform per day — the creator-level input. */
export function totalPieces(posts: MomentumPost[]): number {
  return countPieces(posts, "short") + countPieces(posts, "long");
}
