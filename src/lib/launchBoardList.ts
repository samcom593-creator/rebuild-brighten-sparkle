/**
 * The Launch Board's one list (Owner → Launch Board, /dashboard/launch-board), OVERHAUL-launchboard, 2026-10-31.
 *
 * Sam: "still pretty ugly." The brief: one clear list with stage colour, one next action per row, and no more than
 * four summary numbers. Everything the list shows comes from this module, so every number and every row can be
 * tested without the page:
 *
 *   videoStep()       where a video is, as the row shows it: the word, its tone, how far along the six-step bar
 *                     (Idea, Selected, Filming, Editing, Ready, Published) and one plain fact.
 *   videoNextStep()   the one thing to do with it, and the words on the button that does it.
 *   videoWhen()       when it is due, planned or posted, in the tone that says whether it is late.
 *   VIDEO_LISTS       every list the page can show, each with one predicate. videoListRows() draws a list and
 *                     videoListCounts() counts the same predicate, so a number always equals the list it opens.
 *   videoRank()       the order: late work first, then the closest to published (finish what you started), then
 *                     ideas, then what is already live.
 *
 * The four numbers are Ideas, To film, To edit and To post. With Published they cover every card on the board once,
 * so the four add up to everything not yet live. Measured on Sam's board that day: 34 videos, 31 ideas, 1 picked to
 * film with no shot list yet, 2 marked posted with no live link, nothing in editing, nothing ready, none published
 * with a link.
 *
 * The stages are the stored workflow statuses of src/lib/contentWorkflow.ts (the database enforces the same rules);
 * nothing here writes. "Selected" and "Filming" are the two halves of the Record stage: filming starts the moment a
 * shot is ticked in the filming pack or footage is attached (the same rule as lifecycleOf()).
 */
import { parsePack } from "@/lib/contentFilmingPack";
import { DAY_THEMES, phoenixWeekStart } from "@/lib/contentWeek";
import { phoenixDate, phoenixWeekday, platformOf, scheduleLabel, stageOf, type WorkflowCard } from "@/lib/contentWorkflow";
import { contentStepTone, type Tone } from "@/lib/tones";

/** A card as the board loads it: the workflow fields plus the few the list orders and labels by. */
export interface BoardVideo extends WorkflowCard {
  sort?: number | null;
  posted_at?: string | null;
  content_type?: string | null;
  planned_week?: string | null;
}

const blank = (v: string | null | undefined) => !(v ?? "").trim();
const PHOENIX = "America/Phoenix";

// ── Where a video is ───────────────────────────────────────────────────────

export type VideoStepKey = "idea" | "selected" | "filming" | "editing" | "ready" | "no_link" | "published";

/** The bar has six steps, Idea to Published. */
export const VIDEO_BAR_STEPS = 6;

export const VIDEO_STEPS: ReadonlyArray<{ key: VideoStepKey; label: string; means: string; index: number }> = [
  { key: "idea", label: "Idea", means: "Saved on the board. Nobody has picked it to film.", index: 1 },
  { key: "selected", label: "Selected", means: "Picked to film. Nothing filmed yet.", index: 2 },
  { key: "filming", label: "Filming", means: "A shot is ticked in the filming pack, or footage is attached.", index: 3 },
  { key: "editing", label: "Editing", means: "Footage in and being cut, or waiting on approval.", index: 4 },
  { key: "ready", label: "Ready", means: "Approved to post, or planned for a time.", index: 5 },
  { key: "published", label: "Published", means: "Live, with the post's link saved.", index: 6 },
  { key: "no_link", label: "Published, no link", means: "Marked as posted, but no live link proves it.", index: 6 },
];

const stepDef = (key: VideoStepKey) => VIDEO_STEPS.find((s) => s.key === key)!;

/** The step a card is on. Unknown statuses read as an idea, never as published (stageOf's rule). */
export function videoStepKey(v: Pick<BoardVideo, "status" | "published_url" | "publish_evidence" | "clip" | "record_script">): VideoStepKey {
  switch (stageOf(v)) {
    case "idea": return "idea";
    case "record": return !blank(v.clip) || parsePack(v.record_script).done > 0 ? "filming" : "selected";
    case "edit":
    case "review": return "editing";
    case "ready":
    case "scheduled": return "ready";
    case "published_unconfirmed": return "no_link";
    case "published": return "published";
  }
}

/** YYYY-MM-DD as "Oct 28". */
export function shortDate(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return key;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/** An instant as "Thu, Nov 6, 3:00 PM" in Phoenix (Sam's business day); "today, 3:00 PM" when it is today there. */
export function plannedTimeWords(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "an unreadable time";
  const time = at.toLocaleTimeString("en-US", { timeZone: PHOENIX, hour: "numeric", minute: "2-digit" });
  if (phoenixDate(at) === phoenixDate(now)) return `today, ${time}`;
  const day = at.toLocaleDateString("en-US", { timeZone: PHOENIX, weekday: "short", month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

/** On this week's plan: put on a weekday in the Week view during the Phoenix week that contains `now`. */
export function plannedThisWeek(v: Pick<BoardVideo, "day" | "planned_week">, now: Date): boolean {
  return Number(v.day ?? 0) > 0 && v.planned_week === phoenixWeekStart(now);
}

export interface VideoStep {
  key: VideoStepKey;
  /** The word on the row: "Filming", "Published, no link". */
  label: string;
  /** 1..6 along the bar. */
  index: number;
  tone: Tone;
  /** One plain fact beside the word, or null. */
  detail: string | null;
}

/** The step as the row shows it: the word, its tone, how far along the bar, and one fact. */
export function videoStep(v: BoardVideo, now: Date): VideoStep {
  const key = videoStepKey(v);
  const def = stepDef(key);
  const pack = parsePack(v.record_script);
  let detail: string | null = null;
  switch (key) {
    case "idea":
      detail = plannedThisWeek(v, now) ? `On the plan for ${DAY_THEMES[Number(v.day)]?.name ?? "this week"}`
        : !blank(v.record_script) ? "Filming pack ready" : null;
      break;
    case "selected":
      detail = blank(v.record_script) ? "No shot list yet" : pack.total > 0 ? `${pack.total} ${pack.total === 1 ? "shot" : "shots"} to film` : "Shot list ready";
      break;
    case "filming":
      detail = !blank(v.clip) ? "Footage attached" : `${pack.done} of ${pack.total} shots done`;
      break;
    case "editing":
      detail = stageOf(v) === "review" ? "Waiting on approval"
        : blank(v.clip) ? "Needs its footage"
        : blank(v.edit_prompt) ? "No edit instructions yet"
        : blank(v.caption) ? "No caption yet"
        : "Footage in";
      break;
    case "ready":
      detail = stageOf(v) === "scheduled" && v.scheduled_for ? (scheduleLabel(v)?.isJob ? "Scheduled to post" : "Planned, posts by hand") : "Approved";
      break;
    case "no_link":
      detail = "No live link saved";
      break;
    case "published": {
      const platform = platformOf(v.published_url);
      detail = platform ? `Live on ${platform}` : "Live";
      break;
    }
  }
  return { key, label: def.label, index: def.index, tone: contentStepTone(key), detail };
}

// ── When ───────────────────────────────────────────────────────────────────

export interface VideoWhen {
  text: string;
  tone: Tone;
  /** Late or due now: said in its tone, in bold. */
  emphasis: boolean;
}

/** When it is due, planned or posted. A late due date wins over a planned time; null when nothing is set. */
export function videoWhen(v: BoardVideo, now: Date): VideoWhen | null {
  const key = videoStepKey(v);
  if (key === "published") {
    const posted = v.posted_at ? phoenixDate(new Date(v.posted_at)) : "";
    return posted ? { text: `Posted ${shortDate(posted)}`, tone: "slate", emphasis: false } : null;
  }
  const today = phoenixDate(now);
  const due = (v.due_date ?? "").slice(0, 10);
  if (due && due < today) return { text: `Late: was due ${shortDate(due)}`, tone: "hot", emphasis: true };
  if (stageOf(v) === "scheduled" && v.scheduled_for) {
    const at = new Date(v.scheduled_for);
    if (!Number.isNaN(at.getTime())) {
      if (at.getTime() <= now.getTime()) return { text: `Planned time passed (${plannedTimeWords(v.scheduled_for, now)})`, tone: "hot", emphasis: true };
      const words = plannedTimeWords(v.scheduled_for, now);
      return words.startsWith("today") ? { text: `Planned for ${words}`, tone: "warm", emphasis: true } : { text: `Planned for ${words}`, tone: "cool", emphasis: false };
    }
  }
  if (due === today) return { text: "Due today", tone: "warm", emphasis: true };
  if (due) return { text: `Due ${shortDate(due)}`, tone: "slate", emphasis: false };
  return null;
}

// ── The next step ─────────────────────────────────────────────────────────

export type VideoActionKind = "film" | "pack" | "write" | "attach" | "advance" | "approve" | "post" | "link" | "view" | "wait";

export interface VideoNextStep {
  kind: VideoActionKind;
  /** The button's words; null when there is nothing to press here (it waits on someone else). */
  label: string | null;
  /** What to do, in a few words: Up next's heading. */
  title: string;
  /** Why, in one sentence. */
  detail: string;
  tone: Tone;
  /** For "advance": the status the button moves the card to. */
  to?: "record" | "edit" | "review";
}

/** A hook's first sentence without the planning tag some cards carry ("[YT-80/20] ..."). */
export function hookLine(hook: string | null | undefined): string {
  const clean = (hook ?? "").replace(/^\s*\[[^\]]*\]\s*/, "").trim();
  const sentence = /^(.*?[.!?])(\s|$)/.exec(clean);
  const first = (sentence ? sentence[1] : clean).trim();
  return first.length > 140 ? `${first.slice(0, 137).trimEnd()}…` : first;
}

/**
 * The one next thing to do with a video, derived from its stage and what is missing: the same checks as
 * contentWorkflow's nextAction(), each with the button that does it. Approving is an admin's step; anyone else sees
 * that the video waits on approval and gets no button for it.
 */
export function videoNextStep(v: BoardVideo, ctx: { isAdmin: boolean; now: Date }): VideoNextStep {
  const key = videoStepKey(v);
  const stage = stageOf(v);
  const tone = contentStepTone(key);
  const pack = parsePack(v.record_script);
  switch (key) {
    case "idea": {
      const opener = hookLine(v.hook);
      return {
        kind: "film", label: "Film this", title: "Film this next", tone,
        detail: opener ? `It opens with: “${opener}”` : "Pick it and it moves to Selected, ready to film.",
        to: "record",
      };
    }
    case "selected":
      if (blank(v.record_script)) return { kind: "write", label: "Write shot list", title: "Write the shot list", tone, detail: "Plan what to say and what to film. The card can fill it in from a template." };
      return {
        kind: "pack", label: "Open filming pack", title: "Film it", tone,
        detail: pack.total > 0 ? `The filming pack has ${pack.total} ${pack.total === 1 ? "shot" : "shots"}. Tick each one as you film it.` : "The filming pack has the script. Film it, then attach the footage.",
      };
    case "filming":
      if (!blank(v.clip)) return { kind: "advance", to: "edit", label: "Start editing", title: "Move it to editing", tone, detail: "The footage is attached, so it is ready to cut." };
      if (pack.total > 0 && !pack.complete) return { kind: "pack", label: "Open filming pack", title: "Finish filming", tone, detail: `${pack.done} of ${pack.total} shots done. Tick the rest as you film them.` };
      return { kind: "attach", label: "Attach footage", title: "Attach the footage", tone, detail: "Every shot is ticked. Pick the clip from the Library." };
    case "editing":
      if (stage === "review") {
        if (!ctx.isAdmin) return { kind: "wait", label: null, title: "Waiting on approval", tone, detail: "An admin approves it before it can post." };
        if (blank(v.caption)) return { kind: "write", label: "Write caption", title: "Write the caption", tone, detail: "It needs a caption before you can approve it." };
        return { kind: "approve", label: "Approve", title: "Approve it", tone, detail: "Watch the cut and read the caption. Approving makes it ready to post." };
      }
      if (blank(v.clip)) return { kind: "attach", label: "Attach footage", title: "Attach the footage", tone, detail: "Editing needs the clip. Pick it from the Library." };
      if (blank(v.edit_prompt)) return { kind: "write", label: "Write instructions", title: "Write the edit instructions", tone, detail: "Say how to cut it: the length, the captions, what to leave out. The card can fill it in from a template." };
      if (blank(v.caption)) return { kind: "write", label: "Write caption", title: "Write the caption", tone, detail: "The caption goes out with the post." };
      return { kind: "advance", to: "review", label: "Send to review", title: "Cut it, then send it for approval", tone, detail: "It needs an approval before it can post." };
    case "ready": {
      if (stage === "scheduled" && v.scheduled_for) {
        const words = plannedTimeWords(v.scheduled_for, ctx.now);
        const passed = new Date(v.scheduled_for).getTime() <= ctx.now.getTime();
        return {
          kind: "post", label: "Post it", tone,
          title: passed ? "Post it now" : `Post it ${words.startsWith("today") ? words.replace(/^today, /, "today at ") : `on ${words}`}`,
          detail: scheduleLabel(v)?.isJob ? "A scheduler posts it. Paste the live link once it is up." : "Nothing posts by itself. Post it, then paste the live link here.",
        };
      }
      return { kind: "post", label: "Post it", title: "Post it", tone, detail: "Copy the caption and the clip, post it, then paste the live link here." };
    }
    case "no_link":
      return { kind: "link", label: "Add link", title: "Add the live link", tone, detail: "It is marked as posted, but no link proves it. Paste the post's link." };
    case "published": {
      const platform = platformOf(v.published_url);
      return { kind: "view", label: "View post", title: "Done", tone, detail: platform ? `Live on ${platform}.` : "It is live." };
    }
  }
}

// ── Facts ──────────────────────────────────────────────────────────────────

/** Long-form or Short, from the card's destination; retired Instagram handles say so. */
export function videoFormat(v: Pick<BoardVideo, "brand" | "content_type">): string {
  if (v.brand === "SFD" || v.brand === "IMS") return "Instagram (retired)";
  return v.brand === "YT" || v.content_type === "long" ? "Long-form" : "Short";
}

// ── The lists ──────────────────────────────────────────────────────────────

export type VideoListKey = "working" | "ideas" | "film" | "edit" | "post" | "published" | "everyone";

export interface VideoListDef {
  key: VideoListKey;
  label: string;
  /** The rule in full, for the tooltip and How it works. */
  rule: string;
  /** How the list is ordered, after a comma: "closest to published first". */
  order: string;
}

export const VIDEO_LISTS: Record<VideoListKey, VideoListDef> = {
  working: { key: "working", label: "In progress", rule: "Every video picked to film and not published yet: To film, To edit and To post together.", order: "late first, then the closest to published" },
  ideas: { key: "ideas", label: "Ideas", rule: "Ideas saved on the board that nobody has picked to film yet.", order: "the ones on this week's plan first, then the ones with a filming pack, then the newest" },
  film: { key: "film", label: "To film", rule: "Picked to film: nothing filmed yet, or filming with shots still to tick or footage to attach.", order: "filming first, then selected" },
  edit: { key: "edit", label: "To edit", rule: "Footage in and being cut, or waiting on approval.", order: "waiting on approval first, then footage in" },
  post: { key: "post", label: "To post", rule: "Approved and ready to post, planned for a time, or marked posted with no live link yet.", order: "late first, then ready, then planned, then the ones missing a link" },
  published: { key: "published", label: "Published", rule: "Published, with the live link saved.", order: "the newest first" },
  everyone: { key: "everyone", label: "All videos", rule: "Every video on the board, cleared ideas aside.", order: "late first, then the closest to published" },
};

/** The four numbers, left to right in the order a video moves. With Published they cover every card once. */
export const VIDEO_TILE_LISTS: readonly VideoListKey[] = ["ideas", "film", "edit", "post"];
/** The lists offered as chips beside the numbers. */
export const VIDEO_CHIP_LISTS: readonly VideoListKey[] = ["working", "published", "everyone"];

const IN_LIST: Record<VideoListKey, (k: VideoStepKey) => boolean> = {
  working: (k) => k === "selected" || k === "filming" || k === "editing" || k === "ready" || k === "no_link",
  ideas: (k) => k === "idea",
  film: (k) => k === "selected" || k === "filming",
  edit: (k) => k === "editing",
  post: (k) => k === "ready" || k === "no_link",
  published: (k) => k === "published",
  everyone: () => true,
};

export function inVideoList(v: BoardVideo, list: VideoListKey): boolean {
  return IN_LIST[list](videoStepKey(v));
}

/** A list key from the URL; anything else is null (the page then picks its default). */
export function parseVideoList(raw: string | null | undefined): VideoListKey | null {
  return raw && Object.prototype.hasOwnProperty.call(VIDEO_LISTS, raw) ? (raw as VideoListKey) : null;
}

/** The list the page opens on: what is in progress, or the ideas when nothing is. */
export function defaultVideoList(counts: Record<VideoListKey, number>): VideoListKey {
  return counts.working > 0 || counts.ideas === 0 ? "working" : "ideas";
}

/**
 * The order of work. Lower comes first:
 *   0 late (a due date before today)             7 filming
 *   1 due today, or a planned post time reached  8 selected
 *   2 ready to post                              9 published with no link
 *   3 planned for a later time                  10 an idea on today's slot of this week's plan
 *   4 waiting on approval                       11 an idea with a filming pack
 *   5 editing with footage                      12 any other idea
 *   6 editing without footage                   13 published
 */
export function videoRank(v: BoardVideo, now: Date): number {
  const key = videoStepKey(v);
  if (key === "published") return 13;
  const stage = stageOf(v);
  const today = phoenixDate(now);
  const due = (v.due_date ?? "").slice(0, 10);
  if (due && due < today) return 0;
  const plannedReached = stage === "scheduled" && v.scheduled_for && new Date(v.scheduled_for).getTime() <= now.getTime();
  const plannedToday = stage === "scheduled" && v.scheduled_for && phoenixDate(new Date(v.scheduled_for)) === today;
  if (due === today || plannedReached || plannedToday) return 1;
  switch (key) {
    case "ready": return stage === "scheduled" ? 3 : 2;
    case "editing": return stage === "review" ? 4 : blank(v.clip) ? 6 : 5;
    case "filming": return 7;
    case "selected": return 8;
    case "no_link": return 9;
    case "idea":
      if (plannedThisWeek(v, now) && Number(v.day) === phoenixWeekday(now)) return 10;
      return blank(v.record_script) ? 12 : 11;
  }
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Same rank: published newest first, then the earliest due date, the earliest planned time, the newest card, the title. */
export function compareVideos(a: BoardVideo, b: BoardVideo, now: Date): number {
  const ra = videoRank(a, now);
  const rb = videoRank(b, now);
  if (ra !== rb) return ra - rb;
  if (ra === 13) {
    const byPosted = time(b.posted_at) - time(a.posted_at);
    if (byPosted !== 0) return byPosted;
  }
  const byDue = (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  if (byDue !== 0) return byDue;
  const byPlanned = (a.scheduled_for ?? "9999").localeCompare(b.scheduled_for ?? "9999");
  if (byPlanned !== 0) return byPlanned;
  const bySort = Number(b.sort ?? 0) - Number(a.sort ?? 0);
  if (bySort !== 0) return bySort;
  return (a.title ?? "").localeCompare(b.title ?? "");
}

/** The rows of a list, in the order to work them. */
export function videoListRows<T extends BoardVideo>(videos: readonly T[], list: VideoListKey, now: Date): T[] {
  return videos.filter((v) => inVideoList(v, list)).sort((a, b) => compareVideos(a, b, now));
}

/** How many rows each list holds. The same predicate as videoListRows, so a number always equals its list. */
export function videoListCounts(videos: readonly BoardVideo[]): Record<VideoListKey, number> {
  const counts = Object.fromEntries((Object.keys(VIDEO_LISTS) as VideoListKey[]).map((k) => [k, 0])) as Record<VideoListKey, number>;
  for (const v of videos) {
    const key = videoStepKey(v);
    for (const list of Object.keys(VIDEO_LISTS) as VideoListKey[]) if (IN_LIST[list](key)) counts[list] += 1;
  }
  return counts;
}

/** Up next: the first row, unless it is already live (the Published list has nothing to do). */
export function videoUpNext<T extends BoardVideo>(rows: readonly T[]): T | null {
  const first = rows[0];
  return first && videoStepKey(first) !== "published" ? first : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Search by title, opening line, caption or owner; accents and case do not matter. An empty search matches all. */
export function matchesVideoSearch(v: Pick<BoardVideo, "title" | "hook" | "caption" | "owner">, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold(`${v.title ?? ""} ${v.hook ?? ""} ${v.caption ?? ""} ${v.owner ?? ""}`);
  return words.every((w) => hay.includes(w));
}
