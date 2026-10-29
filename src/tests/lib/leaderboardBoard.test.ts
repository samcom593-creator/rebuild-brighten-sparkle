/**
 * The team leaderboard's numbers and rules (src/lib/leaderboardBoard.ts, OVERHAUL-leaderboards).
 *
 * Pinned here: the $5,000 bar is the database's bar; a payload the page does not understand is
 * an error, never an empty board; the windows are Chicago business days with a Monday week;
 * every scoreboard number is computed from exactly the rows on the board; an unknown number is
 * null (a dash), never zero; cheers are worded from the server's names, never the viewer's own.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOARD_MONTHLY_MINIMUM,
  BoardShapeError,
  boardMonthStart,
  boardRule,
  boardTiles,
  boardTotals,
  boardWindowInstants,
  boardWindowRange,
  canCheer,
  cheerLine,
  emptyBoardText,
  formatMoney,
  formatTileMoney,
  groupRecruiting,
  isBoardWindow,
  monthName,
  nextMilestone,
  parseCheerResult,
  parseTeamBoard,
  rankTone,
  recruitingFacts,
  rollUpCanonical,
  rowFacts,
  tenureLabel,
  windowPhrase,
  withCheer,
  type TeamBoard,
  type TeamBoardRow,
} from "@/lib/leaderboardBoard";

const MIGRATION = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261029140000_leaderboard_team_board_cheers.sql"), "utf8");

function row(over: Partial<TeamBoardRow> & { rank: number; agentKey: string; ap: number }): TeamBoardRow {
  return {
    agentId: over.agentKey,
    name: `Agent ${over.rank}`,
    avatarUrl: null,
    deals: 2,
    monthAp: Math.max(over.ap, BOARD_MONTHLY_MINIMUM),
    estEarnings: null,
    readable: false,
    firstPolicyDate: null,
    agency: "APEX Financial",
    departed: false,
    isViewer: false,
    cheers: 0,
    cheeredByMe: false,
    cheerNames: [],
    ...over,
  };
}

function board(over: Partial<TeamBoard> = {}): TeamBoard {
  return {
    access: "team",
    fullReader: false,
    asOf: "2026-10-29T18:00:00Z",
    windowStart: "2026-10-01",
    windowEnd: "2026-10-30",
    monthStart: "2026-10-01",
    monthEnd: "2026-11-01",
    minimum: 5000,
    rows: [],
    me: null,
    belowBarAp: null,
    agencyGap: [],
    ...over,
  };
}

// October 2026 as Sam saw it on 2026-10-29 (names changed): ten agents at $5,000 or more.
const OCTOBER = [
  row({ rank: 1, agentKey: "a1", ap: 41307.32, deals: 24 }),
  row({ rank: 2, agentKey: "a2", ap: 38302, deals: 23 }),
  row({ rank: 3, agentKey: "a3", ap: 14346, deals: 7 }),
  row({ rank: 4, agentKey: "a4", ap: 11913, deals: 7 }),
  row({ rank: 5, agentKey: "a5", ap: 10332, deals: 9 }),
  row({ rank: 6, agentKey: "a6", ap: 10205.04, deals: 7, name: "Six Person" }),
  row({ rank: 7, agentKey: "a7", ap: 9456, deals: 3 }),
  row({ rank: 8, agentKey: "a8", ap: 8048, deals: 6 }),
  row({ rank: 9, agentKey: "a9", ap: 7074, deals: 4 }),
  row({ rank: 10, agentKey: "a10", ap: 5686.56, deals: 4 }),
];
const TODAY = "2026-10-29";

describe("the $5,000 bar", () => {
  it("is the same number the database ranks by, in both functions", () => {
    expect(BOARD_MONTHLY_MINIMUM).toBe(5000);
    const declared = MIGRATION.match(/v_minimum constant numeric := (\d+);/g) ?? [];
    expect(declared).toHaveLength(2);
    for (const line of declared) expect(line).toContain(String(BOARD_MONTHLY_MINIMUM));
    expect(MIGRATION).toContain("where mt.month_ap >= v_minimum");
  });

  it("is stated on the board in plain words, with the month", () => {
    const rule = boardRule(board(), TODAY);
    expect(rule).toBe("Only agents with $5,000 or more in sales in October are ranked. Anyone under $5,000 for the month is not ranked or counted.");
    expect(boardRule(board({ monthStart: "2026-09-01" }), TODAY)).toContain("in September");
  });

  it("keeps lead spend out of the board entirely", () => {
    expect(MIGRATION).not.toMatch(/lead_cost|lead_spend/);
  });
});

describe("parseTeamBoard", () => {
  const payload = {
    access: "team",
    full_reader: true,
    as_of: "2026-10-29T18:00:00Z",
    window_start: "2026-10-01",
    window_end: "2026-10-30",
    month_start: "2026-10-01",
    month_end: "2026-11-01",
    minimum: 5000,
    rows: [
      { rank: 2, agent_key: "k2", agent_id: "k2", name: "Two", avatar_url: null, deals: "23", ap: "38302.00", month_ap: 38302, est_earnings: null, readable: false, first_policy_date: "2026-09-08", agency: "APEX Financial", departed: false, is_viewer: false, cheers: 2, cheered_by_me: true, cheer_names: ["Tyler", "", 7] },
      { rank: 1, agent_key: "k1", agent_id: "k1", name: "  One  ", avatar_url: "", deals: 24, ap: 41307.32, month_ap: 41307.32, est_earnings: 24784.39, readable: true, first_policy_date: "bad", agency: null, departed: false, is_viewer: true, cheers: 0, cheered_by_me: false, cheer_names: [] },
    ],
    me: { month_ap: 41307.32, month_deals: 24, ap: 41307.32, deals: 24, est_earnings: 24784.39 },
    below_bar_ap: 1411,
    agency_gap: [{ agency: "Vantage Financial", deals: 6, ap: 7571.28 }],
  };

  it("reads every field, sorts by rank, and keeps an unreadable estimate null", () => {
    const parsed = parseTeamBoard(payload);
    expect(parsed.rows.map((r) => r.agentKey)).toEqual(["k1", "k2"]);
    expect(parsed.rows[0]).toMatchObject({ name: "One", avatarUrl: null, estEarnings: 24784.39, readable: true, isViewer: true, firstPolicyDate: null });
    expect(parsed.rows[1]).toMatchObject({ deals: 23, ap: 38302, estEarnings: null, cheers: 2, cheeredByMe: true, cheerNames: ["Tyler"] });
    expect(parsed.me).toEqual({ monthAp: 41307.32, monthDeals: 24, ap: 41307.32, deals: 24, estEarnings: 24784.39 });
    expect(parsed.belowBarAp).toBe(1411);
    expect(parsed.agencyGap).toEqual([{ agency: "Vantage Financial", deals: 6, ap: 7571.28 }]);
    expect(parsed.fullReader).toBe(true);
  });

  it("reads a viewer with no agent record as me null and an agent's board as no below-bar total", () => {
    const parsed = parseTeamBoard({ ...payload, full_reader: false, me: null, below_bar_ap: null, agency_gap: [] });
    expect(parsed.me).toBeNull();
    expect(parsed.belowBarAp).toBeNull();
    expect(parsed.agencyGap).toEqual([]);
  });

  it("refuses a payload it does not understand instead of drawing an empty board", () => {
    expect(() => parseTeamBoard(null)).toThrow(BoardShapeError);
    expect(() => parseTeamBoard([])).toThrow(BoardShapeError);
    expect(() => parseTeamBoard({ ...payload, access: "everyone" })).toThrow(/access/);
    expect(() => parseTeamBoard({ ...payload, rows: null })).toThrow(/rows/);
    expect(() => parseTeamBoard({ ...payload, month_start: "October" })).toThrow(/month_start/);
    expect(() => parseTeamBoard({ ...payload, rows: [{ ...payload.rows[0], ap: "lots" }] })).toThrow(/rows\[0\]\.ap/);
    expect(() => parseTeamBoard({ ...payload, rows: [{ ...payload.rows[0], agent_key: "" }] })).toThrow(/agent_key/);
    expect(() => parseTeamBoard({ ...payload, me: "me" })).toThrow(/me/);
  });

  it("reads the cheer answer", () => {
    expect(parseCheerResult({ agent_key: "k1", month_start: "2026-10-01", cheers: 3, cheered_by_me: true })).toEqual({ agentKey: "k1", monthStart: "2026-10-01", cheers: 3, cheeredByMe: true });
    expect(() => parseCheerResult({ agent_key: "k1", month_start: "2026-10-01", cheers: "many" })).toThrow(BoardShapeError);
  });
});

describe("windows", () => {
  // 1 pm in Chicago on Thursday 2026-10-29.
  const now = new Date("2026-10-29T18:00:00Z");

  it("are Chicago business days, end exclusive, with a Monday week", () => {
    expect(boardWindowRange("today", now)).toEqual({ start: "2026-10-29", end: "2026-10-30" });
    expect(boardWindowRange("week", now)).toEqual({ start: "2026-10-26", end: "2026-10-30" });
    expect(boardWindowRange("month", now)).toEqual({ start: "2026-10-01", end: "2026-10-30" });
    expect(boardWindowRange("last_month", now)).toEqual({ start: "2026-09-01", end: "2026-10-01" });
  });

  it("roll over at Chicago midnight, so the 1st is a new month's board", () => {
    // 00:30 in Chicago on Sunday 2026-11-01 is still Saturday evening in Phoenix.
    const justAfter = new Date("2026-11-01T05:30:00Z");
    expect(boardWindowRange("month", justAfter)).toEqual({ start: "2026-11-01", end: "2026-11-02" });
    expect(boardWindowRange("week", justAfter)).toEqual({ start: "2026-10-26", end: "2026-11-02" });
    expect(boardWindowRange("last_month", justAfter)).toEqual({ start: "2026-10-01", end: "2026-11-01" });
  });

  it("give the same instants for timestamp columns", () => {
    const today = boardWindowInstants("today", now);
    expect(today).toEqual({ startIso: "2026-10-29T05:00:00.000Z", endIso: "2026-10-30T05:00:00.000Z" });
  });

  it("name the board's month the way the server picks it, across a new year too", () => {
    expect(boardMonthStart("today", TODAY)).toBe("2026-10-01");
    expect(boardMonthStart("week", TODAY)).toBe("2026-10-01");
    expect(boardMonthStart("month", TODAY)).toBe("2026-10-01");
    expect(boardMonthStart("last_month", TODAY)).toBe("2026-09-01");
    expect(boardMonthStart("last_month", "2027-01-04")).toBe("2026-12-01");
    expect(monthName("2026-12-01", "2027-01-04")).toBe("December 2026");
    expect(monthName("2026-10-01", TODAY)).toBe("October");
    expect(windowPhrase("today", "2026-10-01", TODAY)).toBe("today");
    expect(windowPhrase("week", "2026-10-01", TODAY)).toBe("this week");
    expect(windowPhrase("last_month", "2026-09-01", TODAY)).toBe("in September");
  });

  it("accept only the four windows from the URL", () => {
    expect(["today", "week", "month", "last_month"].every(isBoardWindow)).toBe(true);
    expect(isBoardWindow("custom")).toBe(false);
    expect(isBoardWindow(null)).toBe(false);
  });
});

describe("the four numbers above the board", () => {
  it("count exactly the rows on the board", () => {
    const totals = boardTotals(OCTOBER);
    expect(totals.agents).toBe(10);
    expect(totals.deals).toBe(94);
    expect(totals.sales).toBeCloseTo(156669.92, 2);
    const team = boardTiles(board({ rows: OCTOBER }), "month", TODAY)[3];
    expect(team).toMatchObject({ label: "Team sales", value: totals.sales, hint: "10 agents on the board" });
  });

  it("show the viewer's rank, sales and the gap to the person above", () => {
    const rows = OCTOBER.map((r) => (r.rank === 7 ? { ...r, isViewer: true } : r));
    const [rank, sales, next] = boardTiles(board({ rows, me: { monthAp: 9456, monthDeals: 3, ap: 9456, deals: 3, estEarnings: 11820 } }), "month", TODAY);
    expect(rank).toMatchObject({ label: "Your rank", value: 7, hint: "of 10 agents on the board", tone: "gold" });
    expect(sales).toMatchObject({ label: "Your sales", value: 9456, hint: "3 deals in October" });
    expect(next).toMatchObject({ label: "Gap to #6", hint: "Six Person", tone: "warm" });
    expect(next.value).toBeCloseTo(749.04, 2);
  });

  it("show the leader their lead, or say nobody else is on the board", () => {
    const rows = OCTOBER.map((r) => (r.rank === 1 ? { ...r, isViewer: true } : r));
    const lead = boardTiles(board({ rows, me: { monthAp: 41307.32, monthDeals: 24, ap: 41307.32, deals: 24, estEarnings: 0 } }), "month", TODAY)[2];
    expect(lead).toMatchObject({ label: "Your lead", hint: "ahead of Agent 2", tone: "good" });
    expect(lead.value).toBeCloseTo(3005.32, 2);
    const alone = boardTiles(board({ rows: [rows[0]], me: { monthAp: 41307.32, monthDeals: 24, ap: 41307.32, deals: 24, estEarnings: 0 } }), "month", TODAY)[2];
    expect(alone).toMatchObject({ label: "Your lead", value: null, hint: "Nobody else on the board yet" });
  });

  it("tell an agent under the bar how far they have to go, from their own month", () => {
    const tiles = boardTiles(board({ rows: OCTOBER, me: { monthAp: 1411, monthDeals: 1, ap: 1411, deals: 1, estEarnings: 846.6 } }), "month", TODAY);
    expect(tiles[0]).toMatchObject({ value: null, hint: "Not on the board yet" });
    expect(tiles[1]).toMatchObject({ value: 1411, hint: "1 deal in October" });
    expect(tiles[2]).toMatchObject({ label: "To make the board", value: 3589, hint: "more in October" });
    // The same agent on today's board still counts against the whole month.
    const today = boardTiles(board({ rows: OCTOBER.slice(0, 2), me: { monthAp: 1411, monthDeals: 1, ap: 0, deals: 0, estEarnings: 0 } }), "today", TODAY);
    expect(today[1]).toMatchObject({ value: 0, hint: "0 deals sold today" });
    expect(today[2]).toMatchObject({ label: "To make the board", value: 3589 });
  });

  it("say how far short a closed month ended, never 'more' for last month", () => {
    const last = boardTiles(board({ monthStart: "2026-09-01", rows: OCTOBER, me: { monthAp: 3216, monthDeals: 2, ap: 3216, deals: 2, estEarnings: 0 } }), "last_month", TODAY);
    expect(last[0]).toMatchObject({ value: null, hint: "Not on the board" });
    expect(last[2]).toMatchObject({ label: "Short of the board", value: 1784, hint: "in September" });
  });

  it("show the leader to someone on the bar with no sale in the window, or with no agent record", () => {
    const noSale = boardTiles(board({ rows: OCTOBER.slice(0, 3), me: { monthAp: 9456, monthDeals: 3, ap: 0, deals: 0, estEarnings: 0 } }), "today", TODAY);
    expect(noSale[0]).toMatchObject({ value: null, hint: "No sale today yet" });
    expect(noSale[2]).toMatchObject({ label: "Leader", value: 41307.32, hint: "Agent 1" });
    expect(noSale[3]).toMatchObject({ hint: "3 agents on the board sold today" });
    const staff = boardTiles(board({ rows: OCTOBER }), "month", TODAY);
    expect(staff[0]).toMatchObject({ value: null, hint: "You are not set up as an agent" });
    expect(staff[1]).toMatchObject({ value: null, hint: "You are not set up as an agent" });
    expect(staff[2]).toMatchObject({ label: "Leader", value: 41307.32 });
  });

  it("are a true zero for an empty board and a dash only where nothing is known", () => {
    const tiles = boardTiles(board({ rows: [], me: { monthAp: 0, monthDeals: 0, ap: 0, deals: 0, estEarnings: 0 } }), "month", TODAY);
    expect(tiles[3]).toMatchObject({ value: 0, hint: "0 agents on the board" });
    expect(tiles[2]).toMatchObject({ label: "To make the board", value: 5000 });
    const leaderless = boardTiles(board({ rows: [] }), "week", TODAY)[2];
    expect(leaderless).toMatchObject({ label: "Leader", value: null, hint: "Nobody on the board yet" });
  });
});

describe("rows", () => {
  it("say deals, average a deal, the income estimate only when the viewer may see it, and tenure", () => {
    expect(rowFacts(row({ rank: 1, agentKey: "x", ap: 41307.32, deals: 24, estEarnings: 24784.39, firstPolicyDate: "2026-08-23" }), TODAY))
      .toEqual(["24 deals", "avg $1,721", "est. income $24,784", "2 months in"]);
    expect(rowFacts(row({ rank: 1, agentKey: "x", ap: 1411, deals: 1 }), TODAY)).toEqual(["1 deal"]);
  });

  it("count tenure the way the old board's tenure label did", () => {
    expect(tenureLabel(null, TODAY)).toBeNull();
    expect(tenureLabel("2026-10-29", TODAY)).toBe("First day");
    expect(tenureLabel("2026-10-30", TODAY)).toBe("First day");
    expect(tenureLabel("2026-10-28", TODAY)).toBe("1 day in");
    expect(tenureLabel("2026-10-23", TODAY)).toBe("6 days in");
    expect(tenureLabel("2026-10-22", TODAY)).toBe("1 week in");
    expect(tenureLabel("2026-09-04", TODAY)).toBe("7 weeks in");
    expect(tenureLabel("2026-09-03", TODAY)).toBe("1 month in");
    expect(tenureLabel("2025-10-30", TODAY)).toBe("12 months in");
    expect(tenureLabel("2025-10-29", TODAY)).toBe("1 year in");
    expect(tenureLabel("2025-04-29", TODAY)).toBe("1.5 years in");
  });

  it("print whole dollars, and millions to two places only where a tile has no room", () => {
    expect(formatMoney(41307.32)).toBe("$41,307");
    expect(formatMoney(5686.56)).toBe("$5,687");
    expect(formatMoney(0)).toBe("$0");
    expect(formatTileMoney(156669.92)).toBe("$156,670");
    expect(formatTileMoney(999999.4)).toBe("$999,999");
    expect(formatTileMoney(999999.6)).toBe("$1.00M");
    expect(formatTileMoney(1349931)).toBe("$1.35M");
  });

  it("give the podium its tones and nobody else one", () => {
    expect([1, 2, 3, 4].map(rankTone)).toEqual(["gold", "slate", "warm", null]);
  });

  it("give /board a next milestone that is always ahead of the leader", () => {
    expect(nextMilestone(41307.32)).toBe(45000);
    expect(nextMilestone(45000)).toBe(50000);
    expect(nextMilestone(0)).toBe(5000);
    expect(nextMilestone(4999.99)).toBe(5000);
  });
});

describe("cheers", () => {
  it("say who cheered, the viewer first as You, and how many more", () => {
    expect(cheerLine({ cheers: 0, cheeredByMe: false, cheerNames: [] })).toBeNull();
    expect(cheerLine({ cheers: 1, cheeredByMe: true, cheerNames: [] })).toBe("You cheered");
    expect(cheerLine({ cheers: 2, cheeredByMe: true, cheerNames: ["Tyler Krejcha"] })).toBe("You and Tyler Krejcha cheered");
    expect(cheerLine({ cheers: 5, cheeredByMe: true, cheerNames: ["A", "B", "C"] })).toBe("You, A and 3 more cheered");
    expect(cheerLine({ cheers: 1, cheeredByMe: false, cheerNames: ["A"] })).toBe("A cheered");
    expect(cheerLine({ cheers: 2, cheeredByMe: false, cheerNames: ["A", "B"] })).toBe("A and B cheered");
    expect(cheerLine({ cheers: 3, cheeredByMe: false, cheerNames: ["A", "B", "C"] })).toBe("A, B and 1 more cheered");
    expect(cheerLine({ cheers: 2, cheeredByMe: false, cheerNames: ["A"] })).toBe("A and 1 more cheered");
    expect(cheerLine({ cheers: 2, cheeredByMe: false, cheerNames: [] })).toBe("2 teammates cheered");
  });

  it("can go on a teammate's row, never your own, a departed agent's, or without the team board", () => {
    const mate = row({ rank: 1, agentKey: "x", ap: 6000 });
    expect(canCheer(board(), mate)).toBe(true);
    expect(canCheer(board(), { ...mate, isViewer: true })).toBe(false);
    expect(canCheer(board(), { ...mate, departed: true })).toBe(false);
    expect(canCheer(board({ access: "none" }), mate)).toBe(false);
  });

  it("apply the server's count to the same month's board and leave other months alone", () => {
    const b = board({ rows: OCTOBER.slice(0, 2) });
    const after = withCheer(b, { agentKey: "a2", monthStart: "2026-10-01", cheers: 4, cheeredByMe: true });
    expect(after.rows[1]).toMatchObject({ cheers: 4, cheeredByMe: true });
    expect(after.rows[0]).toBe(b.rows[0]);
    expect(withCheer(b, { agentKey: "a2", monthStart: "2026-09-01", cheers: 9, cheeredByMe: true })).toBe(b);
    expect(withCheer(b, { agentKey: "nobody", monthStart: "2026-10-01", cheers: 9, cheeredByMe: true })).toBe(b);
  });
});

describe("empty boards", () => {
  it("say the board is filling, not broken", () => {
    expect(emptyBoardText(board(), "month", TODAY)).toEqual({ title: "Nobody has reached $5,000 in October yet", body: "The board fills in as agents pass $5,000 for the month." });
    expect(emptyBoardText(board(), "today", TODAY).title).toBe("No sales on the board today yet");
    expect(emptyBoardText(board(), "week", TODAY).body).toBe("The board shows sales from agents who have $5,000 or more in October.");
  });
});

describe("recruiting and referrals boards", () => {
  const apps = [
    { referral_recruiter_id: "sam", referral_manager_id: "sam", status: "interview", license_status: "unlicensed", contracted_at: null },
    { referral_recruiter_id: "sam", status: "new", license_status: "licensed", contracted_at: "2026-10-10" },
    { referral_recruiter_id: null, referral_manager_id: "jo", status: "hired", license_status: "licensed", first_deal_at: "2026-10-20" },
    { recruiter_id: "kim", status: "new" },
    { assigned_agent_id: "lee", status: "reviewing" },
    { status: "new" },
  ];

  it("credit an application to the first owner on it and count what moved", () => {
    expect(groupRecruiting(apps, "recruiting")).toEqual([
      { ownerId: "sam", applications: 2, moving: 2, licensed: 1, contracted: 1 },
      { ownerId: "jo", applications: 1, moving: 1, licensed: 1, contracted: 1 },
      { ownerId: "lee", applications: 1, moving: 1, licensed: 0, contracted: 0 },
      { ownerId: "kim", applications: 1, moving: 0, licensed: 0, contracted: 0 },
    ]);
  });

  it("credit referrals to the referring manager only", () => {
    expect(groupRecruiting(apps, "referrals")).toEqual([
      { ownerId: "jo", applications: 1, moving: 1, licensed: 1, contracted: 1 },
      { ownerId: "sam", applications: 1, moving: 1, licensed: 0, contracted: 0 },
    ]);
  });

  it("fold a duplicate agent record onto its canonical record", () => {
    const rolled = rollUpCanonical(
      [
        { ownerId: "dup", applications: 3, moving: 1, licensed: 1, contracted: 0 },
        { ownerId: "sam", applications: 2, moving: 0, licensed: 0, contracted: 1 },
        { ownerId: "jo", applications: 4, moving: 0, licensed: 0, contracted: 0 },
      ],
      [{ agent_id: "dup", canonical_agent_id: "sam" }, { agent_id: "sam", canonical_agent_id: "sam" }],
    );
    expect(rolled).toEqual([
      { ownerId: "sam", applications: 5, moving: 1, licensed: 1, contracted: 1 },
      { ownerId: "jo", applications: 4, moving: 0, licensed: 0, contracted: 0 },
    ]);
  });

  it("say what each count is", () => {
    const t = { ownerId: "sam", applications: 26, moving: 3, licensed: 4, contracted: 13 };
    expect(recruitingFacts(t, "recruiting")).toEqual(["13 contracted", "3 moving forward"]);
    expect(recruitingFacts(t, "referrals")).toEqual(["4 licensed", "13 contracted"]);
  });
});
