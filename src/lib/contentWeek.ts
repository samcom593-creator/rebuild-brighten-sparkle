// Sam's weekly content system (2026-10-06). One source of truth for the Launch Board week,
// the Today view and the My Day schedule, so the three can never disagree.
//
// Rubric (Sam, repositioned 2026-10-07): content he actually enjoys making — self-improvement,
// the come-up, day-in-the-life of building young — not insurance-sales talking-head. Mon the build,
// Tue money, Wed get-better, Thu mindset/faith, Fri fitness, Sat story, Sun reset. The business is
// the backdrop; recruiting, the mentorship and the fitness course are where it quietly points.
// Volume: 4–5 long-form a week, 30–60 Shorts a week (Repurpose pushes each Short to every platform).
// Built as: one long-form each weekday (5/week) + 7 Shorts a day Mon–Sat (42/week). Each long-form
// is cut into 5+ Shorts, so only ~2 fresh Shorts need filming a day.

export type DayThemeKey = "sales" | "mindset" | "reset";

export interface DayTheme {
  /** ISO weekday: 1 = Monday … 7 = Sunday (matches content_cards.day). */
  day: number;
  short: string;            // "Mon"
  name: string;             // "Monday"
  theme: DayThemeKey;
  themeLabel: string;       // "Sales"
  angle: string;            // "Sales skills"
  longForm: string;         // what the day's long-form is about ("" when none)
  shorts: string;           // what the day's Shorts are about
  longTarget: number;       // long-form videos planned that day
  shortsTarget: number;     // Shorts to post that day
}

export const DAY_THEMES: Record<number, DayTheme> = {
  1: { day: 1, short: "Mon", name: "Monday", theme: "sales", themeLabel: "The Build", angle: "Day in the life",
       longForm: "A real day building the agency at 20: the calls, the team, the grind, the wins. No script, no set.", shorts: "POV day-in-the-life moments, the office, team wins, the reality of building young.", longTarget: 1, shortsTarget: 7 },
  2: { day: 2, short: "Tue", name: "Tuesday", theme: "sales", themeLabel: "Money", angle: "Money moves",
       longForm: "Getting money moving young: the first $10k, money after the 9–5, the truths nobody tells you.", shorts: "Real numbers, what a day actually pays, money one-liners.", longTarget: 1, shortsTarget: 7 },
  3: { day: 3, short: "Wed", name: "Wednesday", theme: "mindset", themeLabel: "Get better", angle: "Self-improvement",
       longForm: "The self-improvement essay you'd watch yourself: discipline, the boring routine, killing limiting beliefs.", shorts: "One reframe, one habit, 'do this instead' one-liners.", longTarget: 1, shortsTarget: 7 },
  4: { day: 4, short: "Thu", name: "Thursday", theme: "mindset", themeLabel: "Mindset & faith", angle: "Identity & faith",
       longForm: "Who you had to become: identity, the standard, God gave you the vision, what you cut off to protect it.", shorts: "Conviction lines, faith moments, 'I cut off everyone' beats.", longTarget: 1, shortsTarget: 7 },
  5: { day: 5, short: "Fri", name: "Friday", theme: "mindset", themeLabel: "Fitness", angle: "Body & discipline",
       longForm: "How getting in shape fixed the rest of your life. Gym discipline bleeding into the business.", shorts: "Gym clips, what you train and eat, discipline one-liners.", longTarget: 1, shortsTarget: 7 },
  6: { day: 6, short: "Sat", name: "Saturday", theme: "mindset", themeLabel: "Story", angle: "The come-up",
       longForm: "Your story, every detail: homeless at 18 to a 7-figure agency, the rock bottom that changed it.", shorts: "Story beats, 'if you're broke and ambitious watch this', rock-bottom hooks.", longTarget: 0, shortsTarget: 7 },
  7: { day: 7, short: "Sun", name: "Sunday", theme: "reset", themeLabel: "Reset", angle: "Plan & batch",
       longForm: "", shorts: "Optional: schedule a few in Repurpose. Plan next week's 5 long-forms.", longTarget: 0, shortsTarget: 0 },
};

export const WEEKLY_TARGETS = { long: 5, shortsMin: 30, shortsMax: 60, shortsPlanned: 42 } as const;

/** Tailwind classes per theme, readable in both themes. */
export const THEME_TONE: Record<DayThemeKey, { chip: string; bar: string; ring: string }> = {
  sales:   { chip: "bg-primary/15 text-primary border-primary/40", bar: "bg-primary", ring: "border-primary/50" },
  mindset: { chip: "bg-sky-500/15 text-sky-300 border-sky-400/40 dark:text-sky-300", bar: "bg-sky-400", ring: "border-sky-400/50" },
  reset:   { chip: "bg-muted text-muted-foreground border-border", bar: "bg-muted-foreground/50", ring: "border-border" },
};

/** Today's ISO weekday (1–7) in Sam's time zone (Phoenix, no DST). */
export function phoenixWeekday(now: Date = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Phoenix", weekday: "short" }).format(now);
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[wd] ?? 1;
}

/** YYYY-MM-DD for "today" in Phoenix. */
export function phoenixDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

type PostLike = { posted_at: string | null; platform: string | null; format: string | null };

/** Repurpose posts each piece to every platform, so a day's count is its busiest platform that day,
 *  not the sum across platforms. Keyed by Phoenix date (YYYY-MM-DD). */
export function piecesByDay(posts: PostLike[], format: string): Record<string, number> {
  const per: Record<string, Record<string, number>> = {};
  for (const p of posts) {
    if (p.format !== format || !p.posted_at) continue;
    const day = (per[phoenixDateKey(new Date(p.posted_at))] ??= {});
    const pl = p.platform ?? "other";
    day[pl] = (day[pl] ?? 0) + 1;
  }
  const out: Record<string, number> = {};
  for (const [d, v] of Object.entries(per)) out[d] = Math.max(...Object.values(v));
  return out;
}

/** Pieces of one format in `posts`, each counted once rather than once per platform. */
export function countPieces(posts: PostLike[], format: string): number {
  return Object.values(piecesByDay(posts, format)).reduce((sum, n) => sum + n, 0);
}

/** YYYY-MM-DD of this week's Monday in Phoenix (matches content_cards.planned_week). */
export function phoenixWeekStart(now: Date = new Date()): string {
  const [y, m, d] = phoenixDateKey(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - (phoenixWeekday(now) - 1) * 86400_000).toISOString().slice(0, 10);
}
