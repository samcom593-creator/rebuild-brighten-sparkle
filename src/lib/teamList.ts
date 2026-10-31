/**
 * My Team (Team → My Team, /dashboard/team), OVERHAUL-myteam, 2026-10-31.
 *
 * Sam: "I literally just look at it and it gave me a full headache." The brief: one clear list with
 * stage colour, one next action per row, and no more than four summary numbers. Everything the list
 * shows comes from this module, so every number and every row can be tested without the page:
 *
 *   teamStep()        where a person is: Getting licensed → No sale yet → Selling, or Gone quiet. The
 *                     four are disjoint and cover everyone on the team, so the four numbers add up to
 *                     Everyone.
 *   teamStage()       the step as the row shows it: the word, its tone, how far along the bar, and one
 *                     plain fact beside it ("Passed the test", "On the team 23 days", "Last sale 45 days ago").
 *   teamNextStep()    the one thing to do with a person: Call, or Open their card.
 *   TEAM_LISTS        every list the page can show, each with one predicate; teamListRows() draws a list
 *                     and teamListCounts() counts the same predicate, so a number always equals its list.
 *   foldMergedTwins() a merged duplicate's production joins its canonical person, and the duplicate row
 *                     goes, so nobody is listed twice or shown with no sales while their twin holds them.
 *
 * Measured on Sam's team that day (admin scope, after folding): 65 people on the team: 28 licensed with no
 * sale yet, 9 gone quiet, 18 getting licensed, 10 selling ($147.0K ALP in the last 30 days). The roster read
 * returned 96 rows: 27 inactive, 1 placeholder seat and 3 merged duplicates, one of which held $14,346 of
 * this month's production while its canonical row read "no sale".
 *
 * The production facts come from crm_agent_roster() (mat_production_unified, the America/Phoenix business
 * day): l30_deals counts sales posted in the last 30 days, lifetime_deals every sale. The license is the
 * agents row's own license_status; license_progress is the furthest step on their application.
 */
import { isDialablePhone } from "@/lib/phone";
import { isSyncOnly, num, usdOrNull, type RosterRow } from "@/lib/teamRoster";
import { stageLabel as trainingStageLabel, type PersonFacts } from "@/lib/teamStage";
import { teamStepTone, type Tone } from "@/lib/tones";

/** A person as My Team lists them: their roster row, and the team facts when this viewer may read them. */
export interface TeamMember {
  row: RosterRow;
  /**
   * Training stage, work days and login (team_people_facts). null when this viewer cannot read the facts
   * (agents and agency owners), while they load, or when the person is not on the tracker.
   */
  facts: PersonFacts | null;
}

// ── Where a person is ─────────────────────────────────────────────────────

export type TeamStepKey = "licensing" | "no_sale" | "selling" | "quiet";

/** The three steps the bar draws, in the order a new agent climbs them. Gone quiet fell off the last one. */
export const TEAM_BAR_STEPS = 3;

export const TEAM_STEPS: ReadonlyArray<{ key: TeamStepKey; label: string; means: string; index: number }> = [
  { key: "licensing", label: "Getting licensed", means: "Not licensed yet.", index: 1 },
  { key: "no_sale", label: "No sale yet", means: "Licensed, with no sale on record yet.", index: 2 },
  { key: "selling", label: "Selling", means: "Made a sale in the last 30 days.", index: 3 },
  { key: "quiet", label: "Gone quiet", means: "Sold before, but nothing in the last 30 days.", index: 3 },
];

const stepDef = (key: TeamStepKey) => TEAM_STEPS.find((s) => s.key === key)!;

/**
 * The one step a person is on. A sale is the strongest evidence, so it is read first: a sale in the last
 * 30 days is Selling and any earlier sale is Gone quiet, whatever the license field says (two people on
 * Sam's team have sales and still read "unlicensed"). With no sale on record, the license decides.
 */
export function teamStep(row: Pick<RosterRow, "l30_deals" | "lifetime_deals" | "license_status">): TeamStepKey {
  if (num(row.l30_deals) > 0) return "selling";
  if (num(row.lifetime_deals) > 0) return "quiet";
  return row.license_status === "licensed" ? "no_sale" : "licensing";
}

/** On the team: an active person. Placeholder seats are not people; inactive, pending and terminated are off the team. */
export function onTeam(row: Pick<RosterRow, "status" | "is_sync_only">): boolean {
  return row.status === "active" && !isSyncOnly(row as RosterRow);
}

/** The steps of a license, in order, as an application records them, with the words a person reads. */
const LICENSE_PROGRESS: ReadonlyArray<{ key: string; words: string }> = [
  { key: "unlicensed", words: "Not started" },
  { key: "course_purchased", words: "Bought the course" },
  { key: "finished_course", words: "Finished the course" },
  { key: "test_scheduled", words: "Test scheduled" },
  { key: "passed_test", words: "Passed the test" },
  { key: "fingerprints_done", words: "Fingerprints done" },
  { key: "waiting_fingerprints", words: "Waiting on fingerprints" },
  { key: "waiting_on_license", words: "Waiting on the license" },
  // Their application says licensed while their agent record does not: worth a look, never a certainty.
  { key: "licensed", words: "Application says licensed" },
];

/** How far along their license is, in words. Nothing on file says so; it never reads as "Not started". */
export function licenseProgressWords(progress: string | null | undefined): string {
  const key = (progress ?? "").trim().toLowerCase();
  return LICENSE_PROGRESS.find((p) => p.key === key)?.words ?? "No license progress on file";
}

/** 0 for not started up to 8; -1 when nothing is on file, so a known step always sorts ahead of an unknown one. */
export function licenseProgressRank(progress: string | null | undefined): number {
  const key = (progress ?? "").trim().toLowerCase();
  return LICENSE_PROGRESS.findIndex((p) => p.key === key);
}

/** Whole days from one YYYY-MM-DD date to another (later minus earlier); null when either is unreadable. */
export function daysBetween(fromKey: string | null | undefined, toKey: string): number | null {
  const parse = (k: string | null | undefined) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(k ?? "");
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = parse(fromKey);
  const b = parse(toKey);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

/** "Today", "Yesterday", "45 days ago". A date after today reads as today rather than a negative count. */
export function daysAgoWords(days: number): string {
  const d = Math.max(0, days);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

/** "On the team 23 days", "Joined today", "Starts in 3 days" (a start date ahead of today); null when unknown. */
export function tenureWords(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null;
  if (days < 0) return `Starts in ${-days} ${days === -1 ? "day" : "days"}`;
  if (days === 0) return "Joined today";
  return `On the team ${days} ${days === 1 ? "day" : "days"}`;
}

export interface TeamStage {
  /** A step, or why the person is off the team. */
  key: TeamStepKey | "placeholder" | "inactive" | "pending" | "terminated" | "other";
  /** The words on the row: "No sale yet", "Gone quiet", "Inactive". */
  label: string;
  /** 1..3 along the bar, or null for someone off the team (an empty bar). */
  index: number | null;
  tone: Tone;
  /** One plain fact beside the word, or null. */
  detail: string | null;
}

const STATUS_LABEL: Record<string, string> = { inactive: "Inactive", pending: "Pending", terminated: "Terminated" };

/**
 * Where a person is, as the row shows it. `todayKey` is the America/Phoenix business day (YYYY-MM-DD), the
 * same day the roster's 30-day window is counted in.
 */
export function teamStage(member: TeamMember, todayKey: string): TeamStage {
  const { row } = member;
  if (isSyncOnly(row)) {
    return { key: "placeholder", label: "Placeholder seat", index: null, tone: "slate", detail: "Not a person" };
  }
  if (row.status !== "active") {
    const status = (row.status ?? "").toLowerCase();
    const label = STATUS_LABEL[status] ?? (status ? status[0].toUpperCase() + status.slice(1) : "Status not set");
    const key = status === "inactive" || status === "pending" || status === "terminated" ? status : "other";
    return { key, label, index: null, tone: "slate", detail: null };
  }
  const key = teamStep(row);
  const def = stepDef(key);
  const base = { key, label: def.label, index: def.index, tone: teamStepTone(key) };
  switch (key) {
    case "licensing":
      return { ...base, detail: licenseProgressWords(row.license_progress) };
    case "no_sale":
      return { ...base, detail: tenureWords(row.tenure_days) };
    case "selling": {
      const parts: string[] = [];
      if (num(row.today_deals) > 0) parts.push("Sold today");
      const l30 = usdOrNull(row.l30_alp);
      if (l30) parts.push(`${l30} in 30 days`);
      return { ...base, detail: parts.length ? parts.join(" · ") : null };
    }
    case "quiet": {
      const days = daysBetween(row.last_posted_date, todayKey);
      return { ...base, detail: days === null ? "Last sale date unknown" : `Last sale ${daysAgoWords(days)}` };
    }
  }
}

// ── The one next action ───────────────────────────────────────────────────

export interface TeamNextStep {
  /** Call dials (and opens their card); Open opens their card. */
  kind: "call" | "open";
  label: "Call" | "Open";
  /** Why, in a few words, for the button's accessible name and tooltip. */
  why: string;
}

/**
 * The one thing to do with a person. Selling people need nothing from you today, so their row opens their
 * card; everyone else on the team gets a call, for the reason their step names. Your own row and anyone with
 * no phone that can be dialled open the card instead. Dialling records nothing.
 */
export function teamNextStep(member: TeamMember, opts: { isMe?: boolean } = {}): TeamNextStep {
  const { row } = member;
  const open = (why: string): TeamNextStep => ({ kind: "open", label: "Open", why });
  if (!onTeam(row)) return open("See their record");
  if (opts.isMe) return open("This is you");
  const step = teamStep(row);
  if (step === "selling") return open("Selling: see their numbers");
  if (!isDialablePhone(row.phone)) return open("No phone on file");
  if (step === "licensing") return { kind: "call", label: "Call", why: "ask how their license is going" };
  if (step === "no_sale") return { kind: "call", label: "Call", why: "help them get a first sale" };
  return { kind: "call", label: "Call", why: "check in, no sale in 30 days" };
}

// ── Lists ─────────────────────────────────────────────────────────────────

export type TeamListKey =
  | "everyone"
  | "no_sale" | "quiet" | "licensing" | "selling"
  | "new_hires" | "free_leads" | "free_leads_close"
  | "no_login" | "stage_unset" | "no_schedule"
  | "not_active" | "sync_only";

export interface TeamListDef {
  key: TeamListKey;
  label: string;
  /** What the list holds, in one sentence: the tile's tooltip and the explainer. */
  rule: string;
  /** The order of the list, in words, for its caption. */
  order: string;
  /**
   * Declared, never inferred (scripts/check-roster-segment-placeholders.mjs runs these predicates): may a
   * sync-only placeholder seat be in this list? A list that implies doing something with a person (call,
   * coach, route leads to) is false; a list that sorts the roster by status alone is true.
   */
  admitsSyncOnly: boolean;
  /** Needs the team facts (training stage, work days, login), which only admins, managers and the support team read. */
  needsFacts?: boolean;
  match: (m: TeamMember) => boolean;
}

const stepIs = (key: TeamStepKey) => (m: TeamMember) => onTeam(m.row) && teamStep(m.row) === key;

export const TEAM_LISTS: readonly TeamListDef[] = [
  { key: "everyone", label: "Everyone", rule: "Everyone active on the team.", order: "who needs you first", admitsSyncOnly: false,
    match: (m) => onTeam(m.row) },
  { key: "no_sale", label: "No sale yet", rule: "Licensed and on the team, with no sale on record yet.", order: "newest first", admitsSyncOnly: false,
    match: stepIs("no_sale") },
  { key: "quiet", label: "Gone quiet", rule: "Sold before, but no sale in the last 30 days.", order: "most recent sale first", admitsSyncOnly: false,
    match: stepIs("quiet") },
  { key: "licensing", label: "Getting licensed", rule: "On the team and not licensed yet.", order: "furthest along first", admitsSyncOnly: false,
    match: stepIs("licensing") },
  { key: "selling", label: "Selling", rule: "Made a sale in the last 30 days.", order: "most ALP in the last 30 days first", admitsSyncOnly: false,
    match: stepIs("selling") },
  { key: "new_hires", label: "Joined in the last 30 days", rule: "On the team 30 days or less.", order: "newest first", admitsSyncOnly: false,
    match: (m) => onTeam(m.row) && m.row.tenure_days !== null && m.row.tenure_days !== undefined && m.row.tenure_days <= 30 },
  { key: "free_leads", label: "Free leads now", rule: "Qualify for free leads right now. Route leads to them first.", order: "most ALP in the last 30 days first", admitsSyncOnly: false,
    match: (m) => onTeam(m.row) && m.row.free_leads_qualified === true },
  { key: "free_leads_close", label: "Close to free leads", rule: "Within $5,000 of the free-leads bar.", order: "closest first", admitsSyncOnly: false,
    match: (m) => onTeam(m.row) && m.row.free_leads_qualified !== true && num(m.row.free_leads_needed_for_qual) > 0 && num(m.row.free_leads_needed_for_qual) <= 5000 },
  { key: "no_login", label: "No login yet", rule: "Has never had a login to the app.", order: "who needs you first", admitsSyncOnly: false, needsFacts: true,
    match: (m) => onTeam(m.row) && m.facts !== null && !m.facts.access.has_login },
  { key: "stage_unset", label: "Training stage not set", rule: "Nobody has set their training stage yet.", order: "who needs you first", admitsSyncOnly: false, needsFacts: true,
    match: (m) => onTeam(m.row) && m.facts !== null && m.facts.stage === null },
  { key: "no_schedule", label: "No work days set", rule: "Nobody has set the weekdays they work.", order: "who needs you first", admitsSyncOnly: false, needsFacts: true,
    match: (m) => onTeam(m.row) && m.facts !== null && !m.facts.schedule_set },
  // A status bucket, not a worklist: it sorts the roster by status alone, so a placeholder seat with that status is in it.
  { key: "not_active", label: "Not active", rule: "Inactive, pending or terminated. Kept so a wrong change can be caught and reversed.", order: "A to Z", admitsSyncOnly: true,
    match: (m) => m.row.status !== "active" },
  { key: "sync_only", label: "Placeholder seats", rule: "Not people: seats the sales import made for posts it could not match to an agent. Nothing to call or coach.", order: "A to Z", admitsSyncOnly: true,
    match: (m) => isSyncOnly(m.row) },
];

/** The four numbers on top, in the order of the list under them: who needs you first. */
export const TEAM_TILE_LISTS: readonly TeamListKey[] = ["no_sale", "quiet", "licensing", "selling"];

/** The lists in the More lists menu. */
export const TEAM_MORE_LISTS: readonly TeamListKey[] = [
  "new_hires", "free_leads", "free_leads_close", "no_login", "stage_unset", "no_schedule", "not_active", "sync_only",
];

export function teamListDef(key: TeamListKey): TeamListDef {
  return TEAM_LISTS.find((l) => l.key === key)!;
}

export function parseTeamList(value: string | null | undefined): TeamListKey {
  return TEAM_LISTS.some((l) => l.key === value) ? (value as TeamListKey) : "everyone";
}

// ── Order ─────────────────────────────────────────────────────────────────

/** Who needs you first: no sale yet, then gone quiet, then getting licensed, then the people selling. */
const STEP_ORDER: Record<TeamStepKey, number> = { no_sale: 0, quiet: 1, licensing: 2, selling: 3 };

const nameOf = (m: TeamMember) => (m.row.full_name ?? "").trim();
const byName = (a: TeamMember, b: TeamMember) => nameOf(a).localeCompare(nameOf(b)) || a.row.agent_id.localeCompare(b.row.agent_id);
const tenure = (m: TeamMember) => (m.row.tenure_days === null || m.row.tenure_days === undefined ? Number.POSITIVE_INFINITY : m.row.tenure_days);

/** Within a step: the newest first, the most recent sale first, the furthest along first, the most ALP first. */
function compareWithinStep(step: TeamStepKey, a: TeamMember, b: TeamMember): number {
  switch (step) {
    case "no_sale":
      return tenure(a) - tenure(b) || byName(a, b);
    case "quiet":
      return (b.row.last_posted_date ?? "").localeCompare(a.row.last_posted_date ?? "") || byName(a, b);
    case "licensing":
      return licenseProgressRank(b.row.license_progress) - licenseProgressRank(a.row.license_progress) || tenure(a) - tenure(b) || byName(a, b);
    case "selling":
      return num(b.row.l30_alp) - num(a.row.l30_alp) || byName(a, b);
  }
}

/** Everyone in the order to work them. Off-team rows (placeholder, not active) come after, A to Z. */
export function compareTeamMembers(a: TeamMember, b: TeamMember): number {
  const aOn = onTeam(a.row);
  const bOn = onTeam(b.row);
  if (aOn !== bOn) return aOn ? -1 : 1;
  if (!aOn) return byName(a, b);
  const sa = teamStep(a.row);
  const sb = teamStep(b.row);
  return STEP_ORDER[sa] - STEP_ORDER[sb] || compareWithinStep(sa, a, b);
}

function compareForList(key: TeamListKey): (a: TeamMember, b: TeamMember) => number {
  switch (key) {
    case "new_hires":
      return (a, b) => tenure(a) - tenure(b) || byName(a, b);
    case "free_leads":
      return (a, b) => num(b.row.l30_alp) - num(a.row.l30_alp) || byName(a, b);
    case "free_leads_close":
      return (a, b) => num(a.row.free_leads_needed_for_qual) - num(b.row.free_leads_needed_for_qual) || byName(a, b);
    case "not_active":
    case "sync_only":
      return byName;
    default:
      return compareTeamMembers;
  }
}

/** The rows of one list, in its order. */
export function teamListRows(members: readonly TeamMember[], key: TeamListKey): TeamMember[] {
  const def = teamListDef(key);
  return members.filter(def.match).sort(compareForList(key));
}

/**
 * Every list's count, from the same predicate that draws it. A list that needs the team facts is null (shown
 * as "—") until the facts have loaded, because a list nobody could check is unknown, never zero.
 */
export function teamListCounts(members: readonly TeamMember[], opts: { factsReady: boolean }): Record<TeamListKey, number | null> {
  const out = {} as Record<TeamListKey, number | null>;
  for (const def of TEAM_LISTS) {
    out[def.key] = def.needsFacts && !opts.factsReady ? null : members.filter(def.match).length;
  }
  return out;
}

/** The ALP the people in a list sold in the last 30 days. */
export function listAlp30(members: readonly TeamMember[]): number {
  return members.reduce((sum, m) => sum + num(m.row.l30_alp), 0);
}

// ── Search ────────────────────────────────────────────────────────────────

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Name, email, agent code or upline, ignoring accents and case; a phone number by its digits once three
 * digits are typed. Blank matches everyone.
 */
export function matchesTeamSearch(member: TeamMember, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const { row } = member;
  const text = fold([row.full_name, row.email, row.agent_code, row.manager_name].filter(Boolean).join(" "));
  if (text.includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length >= 3 && (row.phone ?? "").replace(/\D/g, "").includes(digits);
}

// ── Merged duplicates ─────────────────────────────────────────────────────

/** Fields that add up when a merged duplicate joins its canonical person. */
const ADDED = ["mtd_alp", "mtd_deals", "l30_alp", "l30_deals", "lifetime_alp", "lifetime_deals", "today_alp", "today_deals", "contracts_total", "contracts_active"] as const;

const minDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
const maxDate = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * crm_agent_roster() returns a merged-away duplicate (agents.canonical_agent_id names another row) as a
 * person of its own, carrying whatever production was posted under its id. Measured 2026-10-31: three such
 * rows on Sam's roster, one holding $14,346 of the month while its canonical person read "no sale".
 *
 * Each duplicate whose canonical person is on the same roster is folded into them: money and counts add,
 * the first sale is the earlier and the last sale the later, and the duplicate row goes. The selling streak
 * keeps the longer of the two, the most the two rows can prove (one row's sale days cannot be joined to
 * the other's without the dates). A duplicate whose canonical person this viewer cannot see stays as it is,
 * because it is the only row they have for that person.
 */
export function foldMergedTwins(rows: readonly RosterRow[], canonicalOf: ReadonlyMap<string, string>): RosterRow[] {
  const byId = new Map(rows.map((r) => [r.agent_id, r] as const));
  // Follow the map to the end (a duplicate of a duplicate lands on the last canonical row this roster holds). A
  // loop in the map has no end, so one fixed member of the loop stands for all of it; nobody is dropped.
  const rootOf = (id: string): string => {
    const path: string[] = [id];
    let at = id;
    for (;;) {
      const next = canonicalOf.get(at);
      if (!next || next === at || !byId.has(next)) return at;
      const loopAt = path.indexOf(next);
      if (loopAt !== -1) return [...path.slice(loopAt)].sort()[0];
      path.push(next);
      at = next;
    }
  };
  const twinsOf = new Map<string, RosterRow[]>();
  for (const r of rows) {
    const root = rootOf(r.agent_id);
    if (root !== r.agent_id) twinsOf.set(root, [...(twinsOf.get(root) ?? []), r]);
  }
  const out: RosterRow[] = [];
  for (const r of rows) {
    if (rootOf(r.agent_id) !== r.agent_id) continue; // folded into its canonical row
    const twins = twinsOf.get(r.agent_id);
    if (!twins) { out.push(r); continue; }
    const merged: RosterRow = { ...r };
    for (const t of twins) {
      for (const field of ADDED) {
        (merged as unknown as Record<string, number>)[field] = num(merged[field]) + num(t[field]);
      }
      merged.first_posted_date = minDate(merged.first_posted_date, t.first_posted_date);
      merged.last_posted_date = maxDate(merged.last_posted_date, t.last_posted_date);
      merged.selling_streak_days = Math.max(num(merged.selling_streak_days), num(t.selling_streak_days));
    }
    out.push(merged);
  }
  return out;
}

/** Training stage words for a person's facts line, or null when it is not set or not readable. */
export function trainingStageWords(facts: PersonFacts | null): string | null {
  return facts?.stage ? trainingStageLabel(facts.stage) : null;
}
