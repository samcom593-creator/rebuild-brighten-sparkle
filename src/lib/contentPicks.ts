/**
 * Launch Board "what to film next": the types and the pure rules behind three strong, distinct picks.
 *
 * Nothing here calls a model or the network. Browsing, filtering, ranking and choosing are plain functions over a
 * saved idea bank (src/data/contentIdeaBank.ts) plus whatever ideas the vidIQ snapshot already holds, so the same
 * filters always give the same three picks and the page costs nothing to use.
 */

export type Lane = "gym" | "mindset" | "faith" | "business" | "education";
export type Place = "gym" | "home" | "car" | "office" | "outside" | "anywhere";
export type Platform = "YouTube" | "Instagram" | "TikTok";
export type PickFormat = "short" | "long";
export type PickKind = "talking_head" | "vlog";
export type PickSource = "bank" | "insights" | "own";

export const LANE_LABEL: Record<Lane, string> = {
  gym: "Gym",
  mindset: "Mindset and lifestyle",
  faith: "Faith",
  business: "Building a business",
  education: "Educational",
};
export const PLACE_LABEL: Record<Place, string> = { gym: "At the gym", home: "At home", car: "In the car", office: "At the office", outside: "Outside", anywhere: "Anywhere" };
export const FORMAT_LABEL: Record<PickFormat, string> = { short: "Short", long: "Long-form" };

export interface PickIdea {
  /** Stable identity. One live project per key, in the database as well as on screen. */
  key: string;
  title: string;
  lane: Lane;
  format: PickFormat;
  kind: PickKind;
  platforms: Platform[];
  /** Estimated time to FILM it, in minutes. Editing time is not included. */
  minutes: number;
  locations: Place[];
  premise: string;
  payoff: string;
  hook: string;
  /** One short reason this idea fits. */
  why: string;
  beats: string[];
  /** Shots to capture. Vlogs only; talking-head ideas leave it empty. */
  shots: string[];
  ending: string;
  /** Editorial priority 0 to 100. A ranking aid, not a prediction of views. */
  score: number;
  source: PickSource;
  /** Where an imported idea came from, when it has a source video. */
  inspiredBy?: { channel?: string; title?: string; views?: number; url?: string } | null;
}

export interface PickFilters {
  platform: "any" | Platform;
  format: "any" | PickFormat;
  lane: "any" | Lane;
  /** The most minutes available to film. "any" means no limit. */
  minutes: "any" | number;
  place: "any" | Place;
}

export const DEFAULT_FILTERS: PickFilters = { platform: "any", format: "any", lane: "any", minutes: "any", place: "any" };
export const TIME_OPTIONS: { value: number; label: string }[] = [
  { value: 20, label: "20 minutes" }, { value: 45, label: "45 minutes" }, { value: 90, label: "90 minutes" }, { value: 180, label: "3 hours" },
];

export const activeFilterCount = (f: PickFilters): number =>
  [f.platform !== "any", f.format !== "any", f.lane !== "any", f.minutes !== "any", f.place !== "any"].filter(Boolean).length;

/** Does an idea fit the filters? A place filter also admits ideas that can be filmed anywhere. */
export function matchesFilters(idea: PickIdea, f: PickFilters): boolean {
  if (f.platform !== "any" && !idea.platforms.includes(f.platform)) return false;
  if (f.format !== "any" && idea.format !== f.format) return false;
  if (f.lane !== "any" && idea.lane !== f.lane) return false;
  if (f.minutes !== "any" && idea.minutes > f.minutes) return false;
  if (f.place !== "any" && !idea.locations.includes(f.place) && !idea.locations.includes("anywhere")) return false;
  return true;
}

export interface PickContext {
  /** Idea keys the viewer dismissed. Never offered again until brought back. */
  dismissed: ReadonlySet<string>;
  /** Idea keys and lower-cased titles that already have a live project. Never offered twice. */
  used: ReadonlySet<string>;
  count?: number;
}

export interface PickResult {
  picks: PickIdea[];
  /** How many ideas fit the filters before the three were chosen. */
  matched: number;
  /** Why the list is shorter than asked for, in words. Null when it is full. */
  note: string | null;
}

const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
export const usedMarkers = (cards: { title: string; brief?: Record<string, unknown> | null }[]): Set<string> => {
  const out = new Set<string>();
  for (const c of cards) {
    out.add(`title:${normTitle(c.title)}`);
    const k = c.brief?.idea_key;
    if (typeof k === "string" && k) out.add(k);
  }
  return out;
};
const isUsed = (idea: PickIdea, used: ReadonlySet<string>) => used.has(idea.key) || used.has(`title:${normTitle(idea.title)}`);

/**
 * Three strong, distinct picks. The first is the best-ranked idea that fits. Each next one prefers a lane not yet
 * chosen, so three gym ideas are never the whole screen unless the filters leave nothing else. Long-form ranks ahead
 * of Shorts when no format is chosen, because long-form is the lane being fed. Ties break on title so the same
 * inputs always return the same picks in the same order.
 */
export function selectPicks(ideas: readonly PickIdea[], filters: PickFilters, ctx: PickContext): PickResult {
  const want = ctx.count ?? 3;
  const eligible = ideas.filter((i) => !ctx.dismissed.has(i.key) && !isUsed(i, ctx.used) && matchesFilters(i, filters));
  const rank = (i: PickIdea) => i.score + (filters.format === "any" && i.format === "long" ? 6 : 0);
  const sorted = [...eligible].sort((a, b) => rank(b) - rank(a) || a.title.localeCompare(b.title));
  const picks: PickIdea[] = [];
  for (const c of sorted) {
    if (picks.length >= want) break;
    if (!picks.some((p) => p.lane === c.lane)) picks.push(c);
  }
  for (const c of sorted) {
    if (picks.length >= want) break;
    if (!picks.includes(c)) picks.push(c);
  }
  const note = picks.length >= want ? null
    : eligible.length === 0 ? "No saved idea fits these filters. Loosen one, or write your own."
    : `Only ${picks.length} idea${picks.length === 1 ? "" : "s"} fit${picks.length === 1 ? "s" : ""} these filters.`;
  return { picks, matched: eligible.length, note };
}

// ── Choosing: the card that gets saved ──────────────────────────────────────────────────────────────────────────

export interface IdeaEdits { title?: string; hook?: string; premise?: string }

/** The saved brief on a project. Everything here is optional so older projects read cleanly. */
export interface ProjectBrief {
  idea_key?: string;
  source?: PickSource | "remake";
  lane?: Lane;
  premise?: string;
  payoff?: string;
  reason?: string;
  effort_minutes?: number;
  locations?: Place[];
  platforms?: Platform[];
  kind?: PickKind;
  edited?: boolean;
  remake_of?: { post_id: number; platform: string; title: string | null; url: string | null; views: number | null; ratio: number; measured_at: string };
  variation?: string;
  change?: string;
  hypothesis?: string;
}

/** Apply the viewer's edits to a suggestion without changing its identity. */
export function applyEdits(idea: PickIdea, edits: IdeaEdits | undefined): PickIdea {
  if (!edits) return idea;
  const clean = (v: string | undefined, fallback: string) => (v !== undefined && v.trim() ? v.trim() : fallback);
  return { ...idea, title: clean(edits.title, idea.title), hook: clean(edits.hook, idea.hook), premise: clean(edits.premise, idea.premise) };
}
export const wasEdited = (original: PickIdea, edited: PickIdea): boolean =>
  original.title !== edited.title || original.hook !== edited.hook || original.premise !== edited.premise;

export const briefFromIdea = (idea: PickIdea, edited = false): ProjectBrief => ({
  idea_key: idea.key, source: idea.source, lane: idea.lane, premise: idea.premise, payoff: idea.payoff, reason: idea.why,
  effort_minutes: idea.minutes, locations: idea.locations, platforms: idea.platforms, kind: idea.kind, ...(edited ? { edited: true } : {}),
});

/** Existing project for an idea, matched by key first and by exact title for cards made before keys existed. */
export function findProject<T extends { id: string; title: string; brief?: Record<string, unknown> | null }>(idea: PickIdea, live: readonly T[], archived: readonly T[]): { card: T; archived: boolean } | null {
  const byKey = (c: T) => c.brief?.idea_key === idea.key;
  const byTitle = (c: T) => normTitle(c.title) === normTitle(idea.title);
  const l = live.find(byKey) ?? live.find(byTitle);
  if (l) return { card: l, archived: false };
  const a = archived.find(byKey) ?? archived.find(byTitle);
  return a ? { card: a, archived: true } : null;
}

/** A short stable key for an imported idea, from its title. */
export function keyFromTitle(prefix: string, title: string): string {
  let h = 5381;
  const t = normTitle(title);
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return `${prefix}:${h.toString(36)}`;
}

/** Idea from the saved vidIQ snapshot, shaped like a bank idea. It has no beats or shots of its own. */
export interface InsightIdea { day?: number; theme?: string; format?: string; score: number; title: string; why: string; source?: { title?: string; channel?: string; views?: number; url?: string } | null }
const LANE_HINTS: [Lane, RegExp][] = [
  ["faith", /\b(faith|god|pray|prayer|church|scripture|bible)\b/i],
  ["gym", /\b(gym|lift|lifting|workout|training|squat|bench|physique|cut|bulk|cardio)\b/i],
  ["education", /\b(insurance|policy|premium|coverage|license|licen[cs]ing|term life|whole life)\b/i],
  ["business", /\b(business|agency|hire|hiring|team|revenue|clients?|sales?|recruit|scale|entrepreneur)\b/i],
];
export function ideaFromInsight(i: InsightIdea): PickIdea {
  const hay = `${i.title} ${i.why} ${i.theme ?? ""}`;
  const lane = LANE_HINTS.find(([, re]) => re.test(hay))?.[0] ?? "mindset";
  const format: PickFormat = (i.format ?? "").toLowerCase() === "long" ? "long" : "short";
  return {
    key: keyFromTitle("insight", i.title), title: i.title, lane, format, kind: "talking_head",
    platforms: format === "long" ? ["YouTube"] : ["YouTube", "Instagram", "TikTok"], minutes: format === "long" ? 90 : 30, locations: ["anywhere"],
    premise: i.why, payoff: "", hook: i.title, beats: [], shots: [], ending: "", score: i.score, source: "insights",
    why: i.source?.channel ? `Based on a top video from ${i.source.channel}.` : "From your saved ideas.",
    inspiredBy: i.source ?? null,
  };
}

/** The idea a person wrote themselves. */
export function ownIdea(input: { title: string; hook?: string; premise?: string; format: PickFormat; minutes?: number }, id: string): PickIdea {
  const title = input.title.trim();
  return {
    key: `own:${id}`, title, lane: "mindset", format: input.format, kind: "talking_head",
    platforms: input.format === "long" ? ["YouTube"] : ["YouTube", "Instagram", "TikTok"], minutes: input.minutes ?? (input.format === "long" ? 90 : 30), locations: ["anywhere"],
    premise: (input.premise ?? "").trim(), payoff: "", hook: (input.hook ?? "").trim() || title, why: "Your own idea.", beats: [], shots: [], ending: "", score: 50, source: "own",
  };
}
