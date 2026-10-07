// Sam's weekly content system (2026-10-06). One source of truth for the Launch Board week,
// the Today view and the My Day schedule, so the three can never disagree.
//
// Rubric from Sam: Mon–Wed sales-focused, Thu–Sat mindset/self-improvement, Sunday reset.
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
  1: { day: 1, short: "Mon", name: "Monday", theme: "sales", themeLabel: "Sales", angle: "Sales skills",
       longForm: "One sales lesson people can use today: a line, a script, an objection.", shorts: "Live call moments, one-liners, objection replies.", longTarget: 1, shortsTarget: 7 },
  2: { day: 2, short: "Tue", name: "Tuesday", theme: "sales", themeLabel: "Sales", angle: "Money & proof",
       longForm: "How you built it: the system, the numbers, what it pays.", shorts: "Proof: deals, paydays, the lifestyle it bought.", longTarget: 1, shortsTarget: 7 },
  3: { day: 3, short: "Wed", name: "Wednesday", theme: "sales", themeLabel: "Sales", angle: "Team & the 9–5 exit",
       longForm: "Leaving a 9–5 for sales, building a team at 20.", shorts: "Team wins, 'POV you joined a sales team', recruiting moments.", longTarget: 1, shortsTarget: 7 },
  4: { day: 4, short: "Thu", name: "Thursday", theme: "mindset", themeLabel: "Mindset", angle: "Habits & discipline",
       longForm: "Habits and rules that changed your life.", shorts: "One habit, one rule, discipline one-liners.", longTarget: 1, shortsTarget: 7 },
  5: { day: 5, short: "Fri", name: "Friday", theme: "mindset", themeLabel: "Mindset", angle: "Fitness & health",
       longForm: "How getting fit changed your life (and your money).", shorts: "Gym clips, what you train and eat.", longTarget: 1, shortsTarget: 7 },
  6: { day: 6, short: "Sat", name: "Saturday", theme: "mindset", themeLabel: "Mindset", angle: "Story & life",
       longForm: "Bonus only if a weekday was missed: your story, every detail.", shorts: "Day-in-the-life, story beats, 'if you're broke, watch this'.", longTarget: 0, shortsTarget: 7 },
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
