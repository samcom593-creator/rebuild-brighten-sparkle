/**
 * Winners and remakes, from real recorded results only.
 *
 * A winner is a post that already has measured views and clearly beat what that account normally gets for that
 * format. Nothing unposted, unmeasured or too new is ever called a winner, and every winner carries the numbers
 * behind the call: the platform, the format, how many days of views it has, and how many posts the baseline came from.
 *
 * Like is compared with like. A Short is only measured against Shorts on the same platform and account, long-form only
 * against long-form. A baseline needs enough posts, or the group is reported as "not enough to judge" instead of
 * producing a verdict from two data points.
 */
export interface ResultPost {
  id: number;
  platform: string;
  account: string | null;
  format: string;
  title: string | null;
  url: string | null;
  posted_at: string;
  views: number | null;
  external_id?: string | null;
}

export const WINNER_RULE = {
  /** A winner has at least this many times the baseline (the group's median views). */
  minRatio: 2,
  /** A baseline needs at least this many measured posts. */
  minBaselinePosts: 5,
  /** Only posts from this many days back count toward a baseline. */
  lookbackDays: 30,
  /** A post needs this many days of views before it can be judged. Shorts earn quickly; long-form takes longer. */
  minAgeDays: { short: 3, long: 7 } as Record<string, number>,
} as const;

const DAY = 86_400_000;
const PLATFORM_NAME: Record<string, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", snapchat: "Snapchat" };
export const platformLabel = (p: string): string => PLATFORM_NAME[p.toLowerCase()] ?? p;
const minAge = (format: string): number => WINNER_RULE.minAgeDays[format] ?? 7;
const groupKey = (p: Pick<ResultPost, "platform" | "account" | "format">) => `${p.platform}|${(p.account ?? "").trim()}|${p.format}`;
const ageDays = (p: ResultPost, now: Date) => Math.floor((now.getTime() - new Date(p.posted_at).getTime()) / DAY);

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Winner {
  post: ResultPost;
  /** Views divided by the baseline. */
  ratio: number;
  baseline: number;
  /** Measured posts the baseline came from. */
  sample: number;
  ageDays: number;
  group: string;
  /** What the number means, in words, for the screen. */
  basis: string;
}
export interface GroupGap { group: string; platform: string; format: string; have: number; need: number }
export interface WinnerReport {
  winners: Winner[];
  /** Groups with posts but too few measured ones to judge. */
  unmeasured: GroupGap[];
  /** Posts with views but too new to judge yet. */
  tooNew: number;
  /** Posts in the window with no views recorded. */
  missingViews: number;
}

export function measureWinners(posts: readonly ResultPost[], now: Date = new Date(), limit = 5): WinnerReport {
  const since = now.getTime() - WINNER_RULE.lookbackDays * DAY;
  const inWindow = posts.filter((p) => new Date(p.posted_at).getTime() >= since && new Date(p.posted_at).getTime() <= now.getTime());
  const missingViews = inWindow.filter((p) => p.views == null).length;
  const measured = inWindow.filter((p) => p.views != null);
  const tooNew = measured.filter((p) => ageDays(p, now) < minAge(p.format)).length;
  const mature = measured.filter((p) => ageDays(p, now) >= minAge(p.format));

  const groups = new Map<string, ResultPost[]>();
  for (const p of mature) groups.set(groupKey(p), [...(groups.get(groupKey(p)) ?? []), p]);

  const winners: Winner[] = [];
  const unmeasured: GroupGap[] = [];
  for (const [group, list] of groups) {
    const [platform, , format] = group.split("|");
    if (list.length < WINNER_RULE.minBaselinePosts) { unmeasured.push({ group, platform, format, have: list.length, need: WINNER_RULE.minBaselinePosts }); continue; }
    const base = median(list.map((p) => p.views as number));
    if (base < 1) continue;
    for (const p of list) {
      const ratio = (p.views as number) / base;
      if (ratio >= WINNER_RULE.minRatio) {
        winners.push({
          post: p, ratio: Math.round(ratio * 10) / 10, baseline: Math.round(base), sample: list.length, ageDays: ageDays(p, now), group,
          basis: `${(p.views as number).toLocaleString("en-US")} views after ${ageDays(p, now)} days, against a median of ${Math.round(base).toLocaleString("en-US")} across ${list.length} ${format === "long" ? "long-form videos" : "Shorts"} on ${platformLabel(platform)} in the last ${WINNER_RULE.lookbackDays} days`,
        });
      }
    }
  }
  winners.sort((a, b) => b.ratio - a.ratio || (b.post.views ?? 0) - (a.post.views ?? 0) || a.post.id - b.post.id);
  unmeasured.sort((a, b) => a.group.localeCompare(b.group));
  return { winners: winners.slice(0, limit), unmeasured, tooNew, missingViews };
}

// ── Matching a project to its post ──────────────────────────────────────────────────────────────────────────────

/** The video id in a YouTube link of any common shape, or null. */
export function youtubeId(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/))([A-Za-z0-9_-]{6,})/.exec(s);
  return m ? m[1] : null;
}
const normUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.|m\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** The recorded post for a published project, by link. A project with no matching post has no results yet. */
export function matchPost(publishedUrl: string | null | undefined, posts: readonly ResultPost[]): ResultPost | null {
  const url = (publishedUrl ?? "").trim();
  if (!url) return null;
  const yt = youtubeId(url);
  if (yt) return posts.find((p) => p.external_id === yt || youtubeId(p.url) === yt) ?? null;
  const n = normUrl(url);
  return posts.find((p) => p.url && normUrl(p.url) === n) ?? null;
}

export type ResultsState =
  | { state: "none"; message: string }
  | { state: "unmeasured"; message: string; post: ResultPost }
  | { state: "measured"; message: string; post: ResultPost; winner: Winner | null };

/** What to say about a published project's results: nothing recorded, recorded but not judgeable, or measured. */
export function resultsFor(publishedUrl: string | null | undefined, posts: readonly ResultPost[], report: WinnerReport, now: Date = new Date()): ResultsState {
  const post = matchPost(publishedUrl, posts);
  if (!post) return { state: "none", message: "No results recorded for this post yet. Log the numbers by hand, or wait for the next sync." };
  if (post.views == null) return { state: "unmeasured", post, message: "The post is recorded but has no view count yet." };
  const winner = report.winners.find((w) => w.post.id === post.id) ?? null;
  if (winner) return { state: "measured", post, winner, message: winner.basis };
  if (ageDays(post, now) < minAge(post.format)) return { state: "unmeasured", post, message: `Too new to judge: ${minAge(post.format)} days of views are needed for a ${post.format === "long" ? "long-form video" : "Short"}.` };
  const gap = report.unmeasured.find((g) => g.group === groupKey(post));
  if (gap) return { state: "unmeasured", post, message: `Not enough posts to compare: ${gap.have} measured ${post.format === "long" ? "long-form videos" : "Shorts"} on ${platformLabel(post.platform)}, ${gap.need} needed.` };
  return { state: "measured", post, winner: null, message: `${post.views.toLocaleString("en-US")} views. Within the normal range for this format, so not a winner.` };
}

// ── Remake ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type RemakeVariation = "sequel" | "fresh_application" | "experiment";
export type RemakeChange = "hook" | "example" | "perspective" | "format";

export const VARIATION_LABEL: Record<RemakeVariation, string> = { sequel: "A sequel", fresh_application: "A fresh application", experiment: "A new experiment" };
export const VARIATION_HELP: Record<RemakeVariation, string> = {
  sequel: "Continue it: the next part for people who liked this one.",
  fresh_application: "Same idea, applied to a different situation or audience.",
  experiment: "Change exactly one thing and see whether it still works.",
};
export const CHANGE_LABEL: Record<RemakeChange, string> = { hook: "The opening line", example: "The example", perspective: "The perspective", format: "The format" };

const stripPrefix = (t: string) => t.replace(/^(part \d+[:.\-]\s*)/i, "").replace(/\s*\((remake|sequel|experiment)[^)]*\)\s*$/i, "").trim();

export interface RemakeDraft {
  title: string;
  /** Left blank when the hook is what is being changed, so the project's first action is to write it. */
  hook: string;
  idea_key: string;
  hypothesis: string;
  format: "short" | "long";
  brief: Record<string, unknown>;
}

/**
 * A new draft that keeps the proven premise and deliberately changes one thing, with the reason in one sentence. The
 * original post and its numbers are never touched. The idea key is unique per post, variation and change, so asking
 * for the same remake twice opens the first one instead of creating a second.
 */
export function remakeDraft(winner: Winner, variation: RemakeVariation, change: RemakeChange, nowIso: string): RemakeDraft {
  const p = winner.post;
  const original = (p.title ?? "").trim() || "Untitled post";
  const base = stripPrefix(original);
  const fromFormat = p.format === "long" ? "long" : "short";
  const toFormat: "short" | "long" = change === "format" ? (fromFormat === "long" ? "short" : "long") : fromFormat;
  const title = variation === "sequel" ? `Part 2: ${base}`
    : variation === "fresh_application" ? `${base} (new situation)`
    : `${base} (${CHANGE_LABEL[change].toLowerCase()} test)`;
  const earned = `The original earned ${winner.ratio} times the usual views for ${fromFormat === "long" ? "long-form" : "Shorts"} on ${platformLabel(p.platform)}.`;
  const why: Record<RemakeChange, string> = {
    hook: "A new opening line tests whether the idea holds people longer when it starts differently.",
    example: "A different real example tests whether the idea reaches people the first example did not.",
    perspective: "Telling it from the other side tests whether the lesson lands for a different viewer.",
    format: `Making it a ${toFormat === "long" ? "long-form video" : "Short"} tests whether the idea holds at a different length.`,
  };
  const lead = variation === "sequel" ? "Hypothesis: viewers who liked the first one want the next part." : variation === "fresh_application" ? "Hypothesis: the same premise works in a new situation." : "Hypothesis: one change is enough to move the result.";
  const hypothesis = `${lead} ${earned} Changing ${CHANGE_LABEL[change].toLowerCase()}: ${why[change]}`;
  return {
    title, hook: "", idea_key: `remake:${p.id}:${variation}:${change}`, hypothesis, format: toFormat,
    brief: {
      idea_key: `remake:${p.id}:${variation}:${change}`, source: "remake", premise: base, reason: hypothesis, variation, change, hypothesis, kind: "talking_head",
      remake_of: { post_id: p.id, platform: p.platform, title: p.title, url: p.url, views: p.views, ratio: winner.ratio, measured_at: nowIso },
    },
  };
}
