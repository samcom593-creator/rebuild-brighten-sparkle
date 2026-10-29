// The desk's numbers and the lists they open (OVERHAUL-instagram, 2026-10-28). Pure, so a test pins
// that every number equals the rows its list shows.
//
// The People tab IS the funnel: each list is one funnel stage of the same 30 days.
//  - Everyone, Talked business, Said licensed and Gave a number are the people[] rows (everyone the
//    server counts as "in"), filtered by the stage flags the server put on each row, so the count on
//    the list is the server's own stage count.
//  - Booked, Applied and Hired are the server's stage lists, which can hold people with no DM thread
//    (a Calendly booking or an application matched by handle).
// When the server is older than migration 20261029070000 (people[] rows carry no stage flags, and
// people[] is only the newest 60 threads), every list falls back to the stage's own list and says
// how many of the total it holds instead of passing a partial list off as the whole.
import { STAGE_NAME, PEOPLE } from "./igCopy";
import { trendOf } from "./igFormat";
import type { IgDashboard, IgRow, IgStage, IgStageKey } from "./igTypes";

export type IgListKey = "everyone" | "business" | "licensed" | "number" | "booked" | "applied" | "hired";

export const LIST_KEYS: IgListKey[] = ["everyone", "business", "number", "booked", "applied", "hired", "licensed"];

export interface IgPeopleList {
  key: IgListKey;
  label: string;
  /** The rows this list shows. */
  rows: IgRow[];
  /** What the funnel says the stage holds. rows.length < total means the list is the newest slice. */
  total: number;
}

const STAGE_OF: Record<IgListKey, IgStageKey> = {
  everyone: "in", business: "business", licensed: "licensed", number: "number", booked: "booked", applied: "applied", hired: "hired",
};

const FLAG_OF: Partial<Record<IgListKey, "business" | "licensed" | "number">> = {
  business: "business", licensed: "licensed", number: "number",
};

export function stageOf(d: Pick<IgDashboard, "funnel">, key: IgStageKey): IgStage | undefined {
  return d.funnel?.stages?.find((s) => s.key === key);
}

/** True when people[] rows carry the per-person stage flags (migration 20261029070000 and later). */
export function hasStageFlags(people: IgRow[] | undefined): boolean {
  return !!people && people.length > 0 && people.every((p) => !!p.stages);
}

export function listLabel(key: IgListKey): string {
  return key === "everyone" ? PEOPLE.everyone : STAGE_NAME[STAGE_OF[key]] ?? key;
}

export function peopleList(d: Pick<IgDashboard, "funnel" | "people">, key: IgListKey): IgPeopleList {
  const stage = stageOf(d, STAGE_OF[key]);
  const total = stage?.count ?? 0;
  const label = listLabel(key);
  const people = d.people ?? [];
  const flagged = hasStageFlags(people);
  if (key === "everyone") return { key, label, rows: flagged ? people : stage?.people ?? [], total };
  const flag = FLAG_OF[key];
  if (flag && flagged) return { key, label, rows: people.filter((p) => p.stages?.[flag] === true), total };
  return { key, label, rows: stage?.people ?? [], total };
}

export function peopleLists(d: Pick<IgDashboard, "funnel" | "people">): IgPeopleList[] {
  return LIST_KEYS.map((k) => peopleList(d, k));
}

/** Search on what Sam remembers: the handle, the name, the number, the email or their words. */
export function filterPeople(rows: IgRow[], q: string): IgRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  const digits = needle.replace(/\D/g, "");
  return rows.filter((p) => {
    const text = [p.handle, p.name, p.last_body, p.last_in_body, p.email, p.last_out?.body, p.came_from?.reel_title]
      .some((v) => (v ?? "").toLowerCase().includes(needle));
    return text || (digits.length >= 3 && (p.phone ?? "").replace(/\D/g, "").includes(digits));
  });
}

export interface IgTileTrend { text: string; tone: "good" | "hot" | "slate" }

/** The trend under a 30-day number: words first, the tone only repeats them. */
export function tileTrend(stage: IgStage | undefined, words: { up: (n: string) => string; down: (n: string) => string; same: string }): IgTileTrend | null {
  if (!stage) return null;
  const t = trendOf(stage.count, stage.prior_count);
  // Nothing then and nothing now is not a trend worth a word.
  if (!t || (stage.count === 0 && t.prior === 0)) return null;
  const n = t.prior.toLocaleString("en-US");
  if (t.dir === "up") return { text: words.up(n), tone: "good" };
  if (t.dir === "down") return { text: words.down(n), tone: "hot" };
  return { text: words.same, tone: "slate" };
}
