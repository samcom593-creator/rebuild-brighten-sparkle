/**
 * The team leaderboard (OVERHAUL-leaderboards, 2026-10-29): every number the Leaderboard and
 * /board show, as pure functions over one read, leaderboard_team_board().
 *
 * Sam's rules for the board (master prompt 311, item 5):
 *   - No lead spend. Leads are company-funded, so the category only ever printed $0.
 *   - Nobody under $5,000 for the month is ranked or counted, and the board says so.
 *   - Cheers on a teammate's row, visible to the team.
 *
 * The bar is enforced in the database (supabase/migrations/20261029140000_*): a producer under
 * $5,000 for the board's month never leaves the server, except the viewer's own numbers (`me`),
 * so an agent under the bar can see how far they have to go. BOARD_MONTHLY_MINIMUM is the same
 * number, for the words on the page and the "to make the board" tile; a test holds the two
 * together. The board's month is the calendar month of the window's last day: Today, This week
 * and This month are this month's board, Last month is last month's.
 *
 * Truth rules kept here: a number counts exactly the rows on the board below it; an unknown
 * number is null (a dash on screen), never zero; a payload this page does not understand is an
 * error, not an empty board.
 */
import { getBusinessDayBounds, getBusinessDayKey, getBusinessLastMonthBounds, getBusinessMonthBounds, getBusinessWeekBounds } from "@/lib/dateUtils";
import type { Tone } from "@/lib/tones";

/** $5,000 of annual premium in the board's month. Must equal v_minimum in leaderboard_team_board. */
export const BOARD_MONTHLY_MINIMUM = 5000;

export type BoardWindow = "today" | "week" | "month" | "last_month";

export const BOARD_WINDOWS: ReadonlyArray<{ key: BoardWindow; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
];

export const DEFAULT_BOARD_WINDOW: BoardWindow = "month";

export function isBoardWindow(value: string | null | undefined): value is BoardWindow {
  return value === "today" || value === "week" || value === "month" || value === "last_month";
}

export interface TeamBoardRow {
  rank: number;
  /** The canonical agent id, or `name:<lower name>` for a producer with no agent record. */
  agentKey: string;
  agentId: string | null;
  /** null when no name is on file (the page shows a dash). */
  name: string | null;
  avatarUrl: string | null;
  deals: number;
  /** Annual premium posted in the window. */
  ap: number;
  /** Annual premium posted in the board's month: at least BOARD_MONTHLY_MINIMUM for every row. */
  monthAp: number;
  /** Only where the viewer may already read this agent's production; otherwise null. */
  estEarnings: number | null;
  readable: boolean;
  firstPolicyDate: string | null;
  agency: string | null;
  /** Terminated or deactivated: shown for the record, labelled, never cheered. */
  departed: boolean;
  isViewer: boolean;
  cheers: number;
  cheeredByMe: boolean;
  /** Up to three people who cheered, newest first, never the viewer. */
  cheerNames: string[];
}

export interface TeamBoardMe {
  monthAp: number;
  monthDeals: number;
  ap: number;
  deals: number;
  estEarnings: number;
}

export interface AgencyGap {
  agency: string;
  deals: number;
  ap: number;
}

export interface TeamBoard {
  /** "team": the viewer sees the team board; "none": only their own numbers. */
  access: "team" | "none";
  fullReader: boolean;
  asOf: string | null;
  windowStart: string;
  windowEnd: string;
  monthStart: string;
  monthEnd: string;
  minimum: number;
  rows: TeamBoardRow[];
  /** The viewer's own numbers; null when the login has no agent record. */
  me: TeamBoardMe | null;
  /** Full readers only: window premium from producers under the bar. null for everyone else. */
  belowBarAp: number | null;
  /** Full readers only: agency production not yet matched to a seller. Never ranked. */
  agencyGap: AgencyGap[];
}

export class BoardShapeError extends Error {
  constructor(what: string) {
    super(`The leaderboard came back in a shape this page does not understand (${what}).`);
    this.name = "BoardShapeError";
  }
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function requiredNumber(o: Json, key: string, where: string): number {
  const raw = o[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) throw new BoardShapeError(`${where}.${key}`);
  return n;
}

function optionalNumber(o: Json, key: string): number | null {
  const raw = o[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function text(o: Json, key: string): string | null {
  const raw = o[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function dateKey(o: Json, key: string, where: string): string {
  const raw = o[key];
  if (typeof raw !== "string" || !DATE_KEY.test(raw)) throw new BoardShapeError(`${where}.${key}`);
  return raw;
}

function parseRow(raw: unknown, index: number): TeamBoardRow {
  const where = `rows[${index}]`;
  if (!isObject(raw)) throw new BoardShapeError(where);
  const agentKey = text(raw, "agent_key");
  if (!agentKey) throw new BoardShapeError(`${where}.agent_key`);
  const names = Array.isArray(raw.cheer_names)
    ? raw.cheer_names.filter((n): n is string => typeof n === "string" && n.trim() !== "").map((n) => n.trim())
    : [];
  const first = text(raw, "first_policy_date");
  return {
    rank: requiredNumber(raw, "rank", where),
    agentKey,
    agentId: text(raw, "agent_id"),
    name: text(raw, "name"),
    avatarUrl: text(raw, "avatar_url"),
    deals: requiredNumber(raw, "deals", where),
    ap: requiredNumber(raw, "ap", where),
    monthAp: requiredNumber(raw, "month_ap", where),
    estEarnings: optionalNumber(raw, "est_earnings"),
    readable: raw.readable === true,
    firstPolicyDate: first && DATE_KEY.test(first) ? first : null,
    agency: text(raw, "agency"),
    departed: raw.departed === true,
    isViewer: raw.is_viewer === true,
    cheers: Math.max(0, optionalNumber(raw, "cheers") ?? 0),
    cheeredByMe: raw.cheered_by_me === true,
    cheerNames: names,
  };
}

/** Read the RPC's payload. Throws BoardShapeError rather than guessing, so a bad read is an error, not an empty board. */
export function parseTeamBoard(raw: unknown): TeamBoard {
  if (!isObject(raw)) throw new BoardShapeError("payload");
  const access = raw.access === "team" ? "team" : raw.access === "none" ? "none" : null;
  if (!access) throw new BoardShapeError("access");
  if (!Array.isArray(raw.rows)) throw new BoardShapeError("rows");
  const rows = raw.rows.map(parseRow).sort((a, b) => a.rank - b.rank);
  let me: TeamBoardMe | null = null;
  if (isObject(raw.me)) {
    me = {
      monthAp: requiredNumber(raw.me, "month_ap", "me"),
      monthDeals: requiredNumber(raw.me, "month_deals", "me"),
      ap: requiredNumber(raw.me, "ap", "me"),
      deals: requiredNumber(raw.me, "deals", "me"),
      estEarnings: optionalNumber(raw.me, "est_earnings") ?? 0,
    };
  } else if (raw.me !== null && raw.me !== undefined) {
    throw new BoardShapeError("me");
  }
  const gap = Array.isArray(raw.agency_gap)
    ? raw.agency_gap.filter(isObject).map((g, i) => ({
        agency: text(g, "agency") ?? "—",
        deals: requiredNumber(g, "deals", `agency_gap[${i}]`),
        ap: requiredNumber(g, "ap", `agency_gap[${i}]`),
      }))
    : [];
  return {
    access,
    fullReader: raw.full_reader === true,
    asOf: text(raw, "as_of"),
    windowStart: dateKey(raw, "window_start", "board"),
    windowEnd: dateKey(raw, "window_end", "board"),
    monthStart: dateKey(raw, "month_start", "board"),
    monthEnd: dateKey(raw, "month_end", "board"),
    minimum: requiredNumber(raw, "minimum", "board"),
    rows,
    me,
    belowBarAp: optionalNumber(raw, "below_bar_ap"),
    agencyGap: gap,
  };
}

export interface CheerResult {
  agentKey: string;
  monthStart: string;
  cheers: number;
  cheeredByMe: boolean;
}

export function parseCheerResult(raw: unknown): CheerResult {
  if (!isObject(raw)) throw new BoardShapeError("cheer");
  const agentKey = text(raw, "agent_key");
  if (!agentKey) throw new BoardShapeError("cheer.agent_key");
  return {
    agentKey,
    monthStart: dateKey(raw, "month_start", "cheer"),
    cheers: Math.max(0, requiredNumber(raw, "cheers", "cheer")),
    cheeredByMe: raw.cheered_by_me === true,
  };
}

/** The server's answer to a cheer, applied to a board of the same month. Other months are returned untouched. */
export function withCheer(board: TeamBoard, result: CheerResult): TeamBoard {
  if (board.monthStart !== result.monthStart) return board;
  let changed = false;
  const rows = board.rows.map((row) => {
    if (row.agentKey !== result.agentKey) return row;
    changed = true;
    return { ...row, cheers: result.cheers, cheeredByMe: result.cheeredByMe };
  });
  return changed ? { ...board, rows } : board;
}

/**
 * The window as Chicago business dates, end exclusive: the same day, Monday-start week and
 * month the rest of the production surfaces use (src/lib/dateUtils.ts).
 */
export function boardWindowRange(window: BoardWindow, now: Date = new Date()): { start: string; end: string } {
  const bounds =
    window === "today" ? getBusinessDayBounds(now)
    : window === "week" ? getBusinessWeekBounds(now)
    : window === "last_month" ? getBusinessLastMonthBounds(now)
    : getBusinessMonthBounds(now);
  return { start: getBusinessDayKey(bounds.start), end: getBusinessDayKey(bounds.end) };
}

/**
 * The board's month (yyyy-MM-01) for a window, from today's business date: last month for
 * Last month, this month for the rest. The same month leaderboard_team_board derives from the
 * window's last day, available before the read comes back.
 */
export function boardMonthStart(window: BoardWindow, todayKey: string = getBusinessDayKey()): string {
  const year = Number(todayKey.slice(0, 4));
  const month = Number(todayKey.slice(5, 7));
  if (window !== "last_month") return `${todayKey.slice(0, 7)}-01`;
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  return `${prev.y}-${String(prev.m).padStart(2, "0")}-01`;
}

/** "today", "this week", or "in October": how a window reads inside a sentence. */
export function windowPhrase(window: BoardWindow, monthStart: string, todayKey: string = getBusinessDayKey()): string {
  if (window === "today") return "today";
  if (window === "week") return "this week";
  return `in ${monthName(monthStart, todayKey)}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October", or "October 2025" when the board's month is not in the viewer's current year. */
export function monthName(monthStart: string, todayKey: string = getBusinessDayKey()): string {
  const [y, m] = monthStart.split("-").map(Number);
  const name = MONTHS[(m ?? 1) - 1] ?? monthStart;
  const thisYear = Number(todayKey.slice(0, 4));
  return y && y !== thisYear ? `${name} ${y}` : name;
}

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });

/** Whole dollars, "$41,307". */
export function formatMoney(value: number): string {
  return MONEY.format(Math.round(value));
}

/**
 * Money in a scoreboard tile: whole dollars up to $999,999, then millions to two places
 * ("$1.35M"), because a seven-digit dollar figure does not fit a phone tile at display size.
 */
export function formatTileMoney(value: number): string {
  if (Math.abs(value) >= 999_999.5) return `$${(Math.round(value / 10_000) / 100).toFixed(2)}M`;
  return formatMoney(value);
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Average premium a deal, whole dollars; null with no deals. */
export function averagePerDeal(ap: number, deals: number): number | null {
  return deals > 0 ? Math.round(ap / deals) : null;
}

function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.UTC(Number(fromKey.slice(0, 4)), Number(fromKey.slice(5, 7)) - 1, Number(fromKey.slice(8, 10)));
  const to = Date.UTC(Number(toKey.slice(0, 4)), Number(toKey.slice(5, 7)) - 1, Number(toKey.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}

/**
 * How long since this producer's first policy, the same steps leaderboard_board's tenure_label
 * used: days for the first week, then weeks to eight, months to a year, then years.
 */
export function tenureLabel(firstPolicyDate: string | null, todayKey: string = getBusinessDayKey()): string | null {
  if (!firstPolicyDate || !DATE_KEY.test(firstPolicyDate)) return null;
  const days = Math.max(0, daysBetween(firstPolicyDate, todayKey));
  if (days === 0) return "First day";
  if (days < 7) return `${plural(days, "day")} in`;
  if (days < 56) return `${plural(Math.floor(days / 7), "week")} in`;
  if (days < 365) return `${plural(Math.floor(days / 30), "month")} in`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years.toLocaleString("en-US")} ${years === 1 ? "year" : "years"} in`;
}

/** The facts under a name: deals, average a deal, tenure, and the income estimate where the viewer may see it. */
export function rowFacts(row: TeamBoardRow, todayKey: string = getBusinessDayKey()): string[] {
  const facts = [plural(row.deals, "deal")];
  const avg = averagePerDeal(row.ap, row.deals);
  if (avg !== null && row.deals > 1) facts.push(`avg ${formatMoney(avg)}`);
  if (row.estEarnings !== null) facts.push(`est. income ${formatMoney(row.estEarnings)}`);
  const tenure = tenureLabel(row.firstPolicyDate, todayKey);
  if (tenure) facts.push(tenure);
  return facts;
}

/**
 * Who cheered, in words: "You and Tyler Krejcha cheered", "Edwin Ac-lumor, Cari Mullen and 3
 * more cheered", "2 teammates cheered" when no names are on file. null with no cheers.
 */
export function cheerLine(row: Pick<TeamBoardRow, "cheers" | "cheeredByMe" | "cheerNames">): string | null {
  if (row.cheers <= 0) return null;
  const names = row.cheerNames.slice(0, row.cheeredByMe ? 1 : 2);
  const who = [...(row.cheeredByMe ? ["You"] : []), ...names];
  const rest = row.cheers - who.length;
  if (who.length === 0) return `${plural(row.cheers, "teammate")} cheered`;
  if (rest <= 0) {
    return who.length === 1 ? `${who[0]} cheered` : `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]} cheered`;
  }
  return `${who.join(", ")} and ${rest.toLocaleString("en-US")} more cheered`;
}

/** Whether the viewer can cheer this row: the team board, a teammate on it, not themselves, not departed. */
export function canCheer(board: Pick<TeamBoard, "access">, row: TeamBoardRow): boolean {
  return board.access === "team" && !row.isViewer && !row.departed;
}

/** The podium tones: first is the gold moment, second quiet silver (slate), third warm bronze. */
export function rankTone(rank: number): Tone | null {
  if (rank === 1) return "gold";
  if (rank === 2) return "slate";
  if (rank === 3) return "warm";
  return null;
}

export interface BoardTotals {
  sales: number;
  deals: number;
  agents: number;
}

/** The board's own totals: the sum of exactly the rows on it. */
export function boardTotals(rows: ReadonlyArray<Pick<TeamBoardRow, "ap" | "deals">>): BoardTotals {
  return {
    sales: rows.reduce((sum, r) => sum + r.ap, 0),
    deals: rows.reduce((sum, r) => sum + r.deals, 0),
    agents: rows.length,
  };
}

/** One scoreboard tile: a label, a number (null is a dash), what it counts, and its tone. */
export interface BoardTile {
  key: "rank" | "sales" | "next" | "team";
  label: string;
  value: number | null;
  kind: "rank" | "money";
  hint: string;
  tone: Tone;
  emphasis?: boolean;
}

const windowWords = (window: BoardWindow, month: string): { when: string; sold: string } => {
  switch (window) {
    case "today": return { when: "today", sold: "sold today" };
    case "week": return { when: "this week", sold: "sold this week" };
    default: return { when: `in ${month}`, sold: `in ${month}` };
  }
};

/**
 * The four numbers above the board, for the person looking at it.
 *
 *   rank  their place on this window's board, or a dash with the reason (under the bar, no
 *         sale in the window, not an agent)
 *   sales what they sold in the window (their own number, even under the bar)
 *   next  the gap to the person above them; their lead over #2 when they are #1; how much more
 *         they need for the month when they are under the bar; else the leader's number
 *   team  the board's total: the sum of exactly the rows shown, so it matches the list
 */
export function boardTiles(board: TeamBoard, window: BoardWindow, todayKey: string = getBusinessDayKey()): BoardTile[] {
  const month = monthName(board.monthStart, todayKey);
  const { when, sold } = windowWords(window, month);
  const totals = boardTotals(board.rows);
  const mine = board.rows.find((r) => r.isViewer) ?? null;
  const me = board.me;
  const underBar = me !== null && me.monthAp < board.minimum;
  const leader = board.rows[0] ?? null;

  const rank: BoardTile = mine
    ? { key: "rank", label: "Your rank", value: mine.rank, kind: "rank", hint: `of ${plural(totals.agents, "agent")} on the board`, tone: "gold", emphasis: true }
    : {
        key: "rank", label: "Your rank", value: null, kind: "rank", tone: "gold",
        hint: me === null
          ? "You are not set up as an agent"
          : underBar
            ? window === "last_month" ? "Not on the board" : "Not on the board yet"
            : window === "last_month" ? `No sale ${when}` : `No sale ${when} yet`,
      };

  const sales: BoardTile = me === null
    ? { key: "sales", label: "Your sales", value: null, kind: "money", hint: "You are not set up as an agent", tone: "good" }
    : { key: "sales", label: "Your sales", value: me.ap, kind: "money", hint: `${plural(me.deals, "deal")} ${sold}`, tone: "good" };

  let next: BoardTile;
  if (underBar && me) {
    const short = Math.max(0, board.minimum - me.monthAp);
    // A closed month cannot be caught up: last month's board says how far short it ended.
    next = window === "last_month"
      ? { key: "next", label: "Short of the board", value: short, kind: "money", hint: `in ${month}`, tone: "warm" }
      : { key: "next", label: "To make the board", value: short, kind: "money", hint: `more in ${month}`, tone: "warm" };
  } else if (mine && mine.rank > 1) {
    const above = board.rows.find((r) => r.rank === mine.rank - 1) ?? null;
    next = above
      ? { key: "next", label: `Gap to #${above.rank}`, value: Math.max(0, above.ap - mine.ap), kind: "money", hint: above.name ?? "—", tone: "warm" }
      : { key: "next", label: "Gap to the next spot", value: null, kind: "money", hint: "—", tone: "warm" };
  } else if (mine && mine.rank === 1) {
    const second = board.rows.find((r) => r.rank === 2) ?? null;
    next = second
      ? { key: "next", label: "Your lead", value: Math.max(0, mine.ap - second.ap), kind: "money", hint: `ahead of ${second.name ?? "#2"}`, tone: "good" }
      : { key: "next", label: "Your lead", value: null, kind: "money", hint: "Nobody else on the board yet", tone: "good" };
  } else {
    next = leader
      ? { key: "next", label: "Leader", value: leader.ap, kind: "money", hint: leader.name ?? "—", tone: "gold" }
      : { key: "next", label: "Leader", value: null, kind: "money", hint: "Nobody on the board yet", tone: "gold" };
  }

  const team: BoardTile = {
    key: "team", label: "Team sales", value: totals.sales, kind: "money", tone: "cool",
    hint: window === "today" || window === "week"
      ? `${plural(totals.agents, "agent")} on the board ${sold}`
      : `${plural(totals.agents, "agent")} on the board`,
  };

  return [rank, sales, next, team];
}

/** The rule, in the words the board shows. */
export function boardRule(board: Pick<TeamBoard, "monthStart" | "minimum">, todayKey: string = getBusinessDayKey()): string {
  const month = monthName(board.monthStart, todayKey);
  return `Only agents with ${formatMoney(board.minimum)} or more in sales in ${month} are ranked. Anyone under ${formatMoney(board.minimum)} for the month is not ranked or counted.`;
}

/** The leader's next round $5,000 mark on /board: always above where they are, a goal to chase, never shown as reached. */
export function nextMilestone(leaderAp: number): number {
  return Math.ceil((Math.max(0, Math.floor(leaderAp)) + 1) / 5000) * 5000;
}

/** The window as instants, for timestamp columns such as applications.created_at. */
export function boardWindowInstants(window: BoardWindow, now: Date = new Date()): { startIso: string; endIso: string } {
  const bounds =
    window === "today" ? getBusinessDayBounds(now)
    : window === "week" ? getBusinessWeekBounds(now)
    : window === "last_month" ? getBusinessLastMonthBounds(now)
    : getBusinessMonthBounds(now);
  return { startIso: bounds.start.toISOString(), endIso: bounds.end.toISOString() };
}

/**
 * The Recruiting and Referrals boards (leaders only). Same rules as before this overhaul, in
 * plain words:
 *   recruiting  an application counts for the first of referral_recruiter_id,
 *               referral_manager_id, recruiter_id, assigned_agent_id; "moving forward" is an
 *               application in review, interview, contracting or approved, or licensed;
 *               "contracted" has a contract date or a first deal
 *   referrals   an application counts for its referral_manager_id; "licensed" and "contracted"
 * They rank people by applications, so the $5,000 sales bar does not apply to them.
 */
export type RecruitingKind = "recruiting" | "referrals";

export interface RecruitingApp {
  referral_recruiter_id?: string | null;
  referral_manager_id?: string | null;
  recruiter_id?: string | null;
  assigned_agent_id?: string | null;
  status?: string | null;
  license_status?: string | null;
  contracted_at?: string | null;
  first_deal_at?: string | null;
}

export interface RecruitingTotal {
  ownerId: string;
  applications: number;
  moving: number;
  licensed: number;
  contracted: number;
}

const MOVING_STATUSES = new Set(["reviewing", "interview", "contracting", "approved"]);

export function recruitingOwner(app: RecruitingApp, kind: RecruitingKind): string | null {
  if (kind === "referrals") return app.referral_manager_id || null;
  return app.referral_recruiter_id || app.referral_manager_id || app.recruiter_id || app.assigned_agent_id || null;
}

/** Totals per person, most applications first (then contracted, then moving forward). */
export function groupRecruiting(apps: ReadonlyArray<RecruitingApp>, kind: RecruitingKind): RecruitingTotal[] {
  const byOwner = new Map<string, RecruitingTotal>();
  for (const app of apps) {
    const owner = recruitingOwner(app, kind);
    if (!owner) continue;
    const t = byOwner.get(owner) ?? { ownerId: owner, applications: 0, moving: 0, licensed: 0, contracted: 0 };
    t.applications += 1;
    if (app.license_status === "licensed") t.licensed += 1;
    if (MOVING_STATUSES.has(app.status ?? "") || app.license_status === "licensed") t.moving += 1;
    if (app.contracted_at || app.first_deal_at) t.contracted += 1;
    byOwner.set(owner, t);
  }
  return sortRecruiting([...byOwner.values()]);
}

function sortRecruiting(rows: RecruitingTotal[]): RecruitingTotal[] {
  return rows.sort((a, b) => b.applications - a.applications || b.contracted - a.contracted || b.moving - a.moving || a.ownerId.localeCompare(b.ownerId));
}

/** Fold duplicate agent records onto their canonical record (v_agent_canonical_map), so one person is one row. */
export function rollUpCanonical(
  rows: ReadonlyArray<RecruitingTotal>,
  canonical: ReadonlyArray<{ agent_id: string | null; canonical_agent_id: string | null }>,
): RecruitingTotal[] {
  const map = new Map(canonical.filter((c) => c.agent_id && c.canonical_agent_id).map((c) => [c.agent_id as string, c.canonical_agent_id as string]));
  const rolled = new Map<string, RecruitingTotal>();
  for (const row of rows) {
    const id = map.get(row.ownerId) ?? row.ownerId;
    const t = rolled.get(id) ?? { ownerId: id, applications: 0, moving: 0, licensed: 0, contracted: 0 };
    t.applications += row.applications;
    t.moving += row.moving;
    t.licensed += row.licensed;
    t.contracted += row.contracted;
    rolled.set(id, t);
  }
  return sortRecruiting([...rolled.values()]);
}

export function recruitingFacts(row: RecruitingTotal, kind: RecruitingKind): string[] {
  return kind === "referrals"
    ? [`${row.licensed.toLocaleString("en-US")} licensed`, `${row.contracted.toLocaleString("en-US")} contracted`]
    : [`${row.contracted.toLocaleString("en-US")} contracted`, `${row.moving.toLocaleString("en-US")} moving forward`];
}

/** PostgREST hands back at most 1,000 rows; a window that hits it may be missing applications. */
export const APPLICATION_READ_CAP = 1000;

/** Why the board is empty, in words that say it is not broken. */
export function emptyBoardText(board: Pick<TeamBoard, "monthStart" | "minimum">, window: BoardWindow, todayKey: string = getBusinessDayKey()): { title: string; body: string } {
  const month = monthName(board.monthStart, todayKey);
  const bar = formatMoney(board.minimum);
  if (window === "today" || window === "week") {
    return {
      title: window === "today" ? "No sales on the board today yet" : "No sales on the board this week yet",
      body: `The board shows sales from agents who have ${bar} or more in ${month}.`,
    };
  }
  return { title: `Nobody has reached ${bar} in ${month} yet`, body: `The board fills in as agents pass ${bar} for the month.` };
}
