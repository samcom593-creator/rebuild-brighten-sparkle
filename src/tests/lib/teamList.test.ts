/**
 * My Team's list logic (src/lib/teamList.ts), OVERHAUL-myteam 2026-10-31.
 *
 * Pins the truth the page draws: four steps that are disjoint and cover everyone on the team (so the four
 * numbers add up to Everyone), every count from the same predicate as its list, unknown never shown as zero,
 * the order to work the list in, one next action per person, and merged duplicates folded into their
 * canonical person instead of listed twice.
 */
import { describe, expect, it } from "vitest";
import {
  TEAM_LISTS, TEAM_MORE_LISTS, TEAM_TILE_LISTS, compareTeamMembers, daysAgoWords, daysBetween, foldMergedTwins,
  licenseProgressRank, licenseProgressWords, listAlp30, matchesTeamSearch, onTeam, parseTeamList, teamListCounts,
  teamListDef, teamListRows, teamNextStep, teamStage, teamStep, tenureWords, trainingStageWords, type TeamMember,
} from "@/lib/teamList";
import { teamStepTone } from "@/lib/tones";
import { rosterRow } from "../helpers/teamRosterFixtures";
import { personFacts } from "../helpers/teamStageFixtures";

const TODAY = "2026-10-31";
const member = (o: Parameters<typeof rosterRow>[0] = {}, facts: TeamMember["facts"] = null): TeamMember => ({ row: rosterRow(o), facts });

// One person per step, plus the rows that are not on the team.
const seller = member({ agent_id: "s1", full_name: "Sal Seller", l30_deals: 3, l30_alp: 9456, lifetime_deals: 60, mtd_alp: 9456, last_posted_date: "2026-10-16" });
const quiet = member({ agent_id: "q1", full_name: "Quinn Quiet", l30_deals: 0, lifetime_deals: 4, last_posted_date: "2026-09-16" });
const noSale = member({ agent_id: "n1", full_name: "Nia New", license_status: "licensed", lifetime_deals: 0, tenure_days: 12 });
const licensing = member({ agent_id: "l1", full_name: "Lee Learner", license_status: "unlicensed", license_progress: "passed_test", tenure_days: 20 });
const inactive = member({ agent_id: "i1", full_name: "Ira Inactive", status: "inactive" });
const ghost = member({ agent_id: "g1", full_name: "GHOST seat", is_sync_only: true, license_status: "unlicensed", phone: null, email: null });
const team = [seller, quiet, noSale, licensing, inactive, ghost];

describe("teamStep: where a person is", () => {
  it("reads a sale first: in the last 30 days is Selling, any earlier sale is Gone quiet, whatever the license field says", () => {
    expect(teamStep({ l30_deals: 1, lifetime_deals: 1, license_status: "unlicensed" })).toBe("selling");
    expect(teamStep({ l30_deals: 0, lifetime_deals: 2, license_status: "unlicensed" })).toBe("quiet");
  });

  it("with no sale on record, the license decides: licensed is No sale yet, anything else is Getting licensed", () => {
    expect(teamStep({ l30_deals: 0, lifetime_deals: 0, license_status: "licensed" })).toBe("no_sale");
    expect(teamStep({ l30_deals: 0, lifetime_deals: 0, license_status: "unlicensed" })).toBe("licensing");
    expect(teamStep({ l30_deals: 0, lifetime_deals: 0, license_status: "pending" })).toBe("licensing");
    expect(teamStep({ l30_deals: null, lifetime_deals: null, license_status: null })).toBe("licensing");
  });

  it("the four step lists are disjoint and together are exactly Everyone, so the four numbers add up", () => {
    const counts = teamListCounts(team, { factsReady: true });
    const stepLists = TEAM_TILE_LISTS.map((key) => teamListRows(team, key).map((m) => m.row.agent_id));
    const all = stepLists.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(teamListRows(team, "everyone").map((m) => m.row.agent_id).sort());
    expect(TEAM_TILE_LISTS.reduce((sum, key) => sum + (counts[key] ?? 0), 0)).toBe(counts.everyone);
  });

  it("everyone on the team is active and a person: placeholder seats and inactive people are not", () => {
    expect(onTeam(seller.row)).toBe(true);
    expect(onTeam(inactive.row)).toBe(false);
    expect(onTeam(ghost.row)).toBe(false);
    expect(teamListRows(team, "everyone").map((m) => m.row.agent_id)).not.toContain("g1");
    expect(teamListRows(team, "everyone").map((m) => m.row.agent_id)).not.toContain("i1");
  });
});

describe("teamStage: the word, the colour and one fact", () => {
  it("each step has its own tone and the bar fills one, two or three segments", () => {
    expect(teamStage(licensing, TODAY)).toMatchObject({ label: "Getting licensed", index: 1, tone: "royal", detail: "Passed the test" });
    expect(teamStage(noSale, TODAY)).toMatchObject({ label: "No sale yet", index: 2, tone: "warm", detail: "On the team 12 days" });
    expect(teamStage(seller, TODAY)).toMatchObject({ label: "Selling", index: 3, tone: "good", detail: "$9.5K in 30 days" });
    expect(teamStage(quiet, TODAY)).toMatchObject({ label: "Gone quiet", index: 3, tone: "hot", detail: "Last sale 45 days ago" });
    expect(new Set(["licensing", "no_sale", "selling", "quiet"].map(teamStepTone)).size).toBe(4);
  });

  it("says Sold today beside the 30-day total when a sale posted today", () => {
    const today = member({ l30_deals: 2, l30_alp: 3200, today_deals: 1, today_alp: 1200, lifetime_deals: 2 });
    expect(teamStage(today, TODAY).detail).toBe("Sold today · $3.2K in 30 days");
  });

  it("a placeholder seat says so, and an off-team person shows their status with an empty bar", () => {
    expect(teamStage(ghost, TODAY)).toMatchObject({ key: "placeholder", label: "Placeholder seat", index: null, tone: "slate", detail: "Not a person" });
    expect(teamStage(inactive, TODAY)).toMatchObject({ key: "inactive", label: "Inactive", index: null, tone: "slate" });
    expect(teamStage(member({ status: "terminated" }), TODAY).label).toBe("Terminated");
    expect(teamStage(member({ status: "pending" }), TODAY).label).toBe("Pending");
  });

  it("license progress reads in words, and nothing on file never reads as Not started", () => {
    expect(licenseProgressWords("unlicensed")).toBe("Not started");
    expect(licenseProgressWords("waiting_on_license")).toBe("Waiting on the license");
    expect(licenseProgressWords("licensed")).toBe("Application says licensed");
    expect(licenseProgressWords(null)).toBe("No license progress on file");
    expect(licenseProgressWords("something_new")).toBe("No license progress on file");
    expect(licenseProgressRank("waiting_on_license")).toBeGreaterThan(licenseProgressRank("passed_test"));
    expect(licenseProgressRank(null)).toBe(-1);
  });

  it("tenure and days read as plain words; a future date never prints a negative count", () => {
    expect(tenureWords(0)).toBe("Joined today");
    expect(tenureWords(1)).toBe("On the team 1 day");
    expect(tenureWords(-3)).toBe("Starts in 3 days");
    expect(tenureWords(null)).toBeNull();
    expect(daysBetween("2026-10-16", TODAY)).toBe(15);
    expect(daysBetween("nonsense", TODAY)).toBeNull();
    expect(daysAgoWords(-2)).toBe("today");
    expect(daysAgoWords(1)).toBe("yesterday");
    expect(teamStage(member({ l30_deals: 0, lifetime_deals: 1, last_posted_date: null }), TODAY).detail).toBe("Last sale date unknown");
  });

  it("the training stage is a fact beside the step only when it is set", () => {
    expect(trainingStageWords(personFacts({ stage: "online_training" }))).toBe("Online training");
    expect(trainingStageWords(personFacts({ stage: null }))).toBeNull();
    expect(trainingStageWords(null)).toBeNull();
  });
});

describe("teamNextStep: one action per row", () => {
  it("calls the people who need you, for the reason their step names", () => {
    expect(teamNextStep(noSale)).toEqual({ kind: "call", label: "Call", why: "help them get a first sale" });
    expect(teamNextStep(quiet)).toEqual({ kind: "call", label: "Call", why: "check in, no sale in 30 days" });
    expect(teamNextStep(licensing)).toEqual({ kind: "call", label: "Call", why: "ask how their license is going" });
  });

  it("opens the card for a seller, for you, for someone with no dialable phone, and for anyone off the team", () => {
    expect(teamNextStep(seller).kind).toBe("open");
    expect(teamNextStep(noSale, { isMe: true })).toMatchObject({ kind: "open", why: "This is you" });
    expect(teamNextStep(member({ license_status: "licensed", phone: null }))).toMatchObject({ kind: "open", why: "No phone on file" });
    expect(teamNextStep(member({ license_status: "licensed", phone: "12" }))).toMatchObject({ kind: "open", why: "No phone on file" });
    expect(teamNextStep(inactive).kind).toBe("open");
    expect(teamNextStep(ghost).kind).toBe("open");
  });
});

describe("lists: a number always equals the list it opens", () => {
  it("every count is the length of the list drawn with the same predicate", () => {
    const facts = (id: string, o: Parameters<typeof personFacts>[0] = {}) => personFacts({ id, ...o });
    const withFacts: TeamMember[] = [
      { ...seller, facts: facts("s1", { access: { has_login: true, invitation: "accepted" }, schedule_set: true, weekdays: [1], stage: "released_in_field" }) },
      { ...noSale, facts: facts("n1") },
      { ...quiet, facts: null },
      licensing, inactive, ghost,
      member({ agent_id: "f1", free_leads_qualified: true, l30_deals: 1, lifetime_deals: 1, l30_alp: 5000 }),
      member({ agent_id: "f2", free_leads_qualified: false, free_leads_needed_for_qual: 2500 }),
      member({ agent_id: "f3", free_leads_qualified: false, free_leads_needed_for_qual: 9000 }),
    ];
    const counts = teamListCounts(withFacts, { factsReady: true });
    for (const def of TEAM_LISTS) expect(counts[def.key]).toBe(teamListRows(withFacts, def.key).length);
    expect(counts.no_login).toBe(1); // Nia; Quinn has no facts, so he is not counted as having no login
    expect(counts.free_leads).toBe(1);
    expect(counts.free_leads_close).toBe(1);
    expect(counts.not_active).toBe(1);
    expect(counts.sync_only).toBe(1);
  });

  it("a list built on the team facts is unknown, not zero, until the facts have loaded", () => {
    const counts = teamListCounts(team, { factsReady: false });
    expect(counts.no_login).toBeNull();
    expect(counts.stage_unset).toBeNull();
    expect(counts.no_schedule).toBeNull();
    expect(counts.everyone).toBe(4);
  });

  it("joined in the last 30 days is 30 days or less, a start date ahead of today included", () => {
    const rows = [member({ agent_id: "a", tenure_days: 30 }), member({ agent_id: "b", tenure_days: 31 }), member({ agent_id: "c", tenure_days: -2 }), member({ agent_id: "d", tenure_days: null })];
    expect(teamListRows(rows, "new_hires").map((m) => m.row.agent_id)).toEqual(["c", "a"]);
  });

  it("declares, for every list, whether a placeholder seat may be in it, and honours it", () => {
    for (const def of TEAM_LISTS) expect(typeof def.admitsSyncOnly).toBe("boolean");
    expect(teamListDef("sync_only").match(ghost)).toBe(true);
    expect(teamListDef("everyone").match(ghost)).toBe(false);
    expect(teamListDef("licensing").match(ghost)).toBe(false);
  });

  it("an unknown list in the URL falls back to Everyone; More lists holds every list that is not a tile", () => {
    expect(parseTeamList("selling")).toBe("selling");
    expect(parseTeamList("nonsense")).toBe("everyone");
    expect(parseTeamList(null)).toBe("everyone");
    const shown = new Set<string>(["everyone", ...TEAM_TILE_LISTS, ...TEAM_MORE_LISTS]);
    expect(TEAM_LISTS.every((def) => shown.has(def.key))).toBe(true);
  });

  it("adds the 30-day ALP of a list", () => {
    expect(listAlp30([seller, member({ l30_alp: "544.5" })])).toBe(10000.5);
  });
});

describe("order: who needs you first", () => {
  it("Everyone runs no sale yet, gone quiet, getting licensed, then selling", () => {
    expect(teamListRows(team, "everyone").map((m) => m.row.agent_id)).toEqual(["n1", "q1", "l1", "s1"]);
  });

  it("within a step: newest first, most recent sale first, furthest along first, most ALP first", () => {
    const rows = [
      member({ agent_id: "n-old", license_status: "licensed", tenure_days: 90 }),
      member({ agent_id: "n-new", license_status: "licensed", tenure_days: 3 }),
      member({ agent_id: "q-long", lifetime_deals: 1, last_posted_date: "2026-03-01" }),
      member({ agent_id: "q-recent", lifetime_deals: 1, last_posted_date: "2026-09-25" }),
      member({ agent_id: "l-start", license_status: "unlicensed", license_progress: "unlicensed" }),
      member({ agent_id: "l-far", license_status: "unlicensed", license_progress: "waiting_on_license" }),
      member({ agent_id: "l-none", license_status: "unlicensed", license_progress: null }),
      member({ agent_id: "s-small", l30_deals: 1, lifetime_deals: 1, l30_alp: 800 }),
      member({ agent_id: "s-big", l30_deals: 2, lifetime_deals: 2, l30_alp: 12000 }),
    ];
    expect([...rows].sort(compareTeamMembers).map((m) => m.row.agent_id)).toEqual([
      "n-new", "n-old", "q-recent", "q-long", "l-far", "l-start", "l-none", "s-big", "s-small",
    ]);
  });

  it("close to free leads lists the closest first; the off-team lists are A to Z", () => {
    const rows = [
      member({ agent_id: "far", full_name: "B", free_leads_needed_for_qual: 4800 }),
      member({ agent_id: "near", full_name: "A", free_leads_needed_for_qual: 300 }),
    ];
    expect(teamListRows(rows, "free_leads_close").map((m) => m.row.agent_id)).toEqual(["near", "far"]);
    const off = [member({ agent_id: "z", full_name: "Zed", status: "inactive" }), member({ agent_id: "a", full_name: "Amy", status: "terminated" })];
    expect(teamListRows(off, "not_active").map((m) => m.row.agent_id)).toEqual(["a", "z"]);
  });
});

describe("search", () => {
  it("matches name, email, code or upline, ignoring accents and case, and a phone by its digits", () => {
    const m = member({ full_name: "José Núñez", email: "jose@example.test", agent_code: "JN7", manager_name: "Mia Manager", phone: "+1 (602) 555-0101" });
    expect(matchesTeamSearch(m, "jose nunez")).toBe(true);
    expect(matchesTeamSearch(m, "MIA")).toBe(true);
    expect(matchesTeamSearch(m, "jn7")).toBe(true);
    expect(matchesTeamSearch(m, "555-01")).toBe(true);
    expect(matchesTeamSearch(m, "60")).toBe(false); // two digits are not enough to search a phone
    expect(matchesTeamSearch(m, "   ")).toBe(true);
    expect(matchesTeamSearch(m, "kim")).toBe(false);
  });
});

describe("foldMergedTwins: one person, one row", () => {
  // Shaped like the case measured on Sam's roster: the canonical row reads "no sale" while its merged
  // duplicate holds $14,346 of the month and six sales in 30 days.
  const canonical = rosterRow({ agent_id: "canon", full_name: "Cara Canon", mtd_alp: 0, l30_alp: 0, l30_deals: 0, lifetime_alp: 0, lifetime_deals: 0, last_posted_date: null, first_posted_date: null, onboarding_stage: "training_online" });
  const twin = rosterRow({ agent_id: "twin", full_name: "Cara Canon", mtd_alp: "14346.12", mtd_deals: 6, l30_alp: "14346.12", l30_deals: 6, lifetime_alp: 22000, lifetime_deals: 11, today_deals: 1, today_alp: 900, selling_streak_days: 2, first_posted_date: "2026-08-01", last_posted_date: "2026-10-30" });
  const other = rosterRow({ agent_id: "other", full_name: "Otto Other" });
  const map = new Map([["canon", "canon"], ["twin", "canon"], ["other", "other"]]);

  it("adds the duplicate's production to its canonical person and drops the duplicate row", () => {
    const out = foldMergedTwins([twin, canonical, other], map);
    expect(out.map((r) => r.agent_id)).toEqual(["canon", "other"]);
    const cara = out[0];
    expect(cara).toMatchObject({ full_name: "Cara Canon", mtd_alp: 14346.12, mtd_deals: 6, l30_deals: 6, lifetime_deals: 11, lifetime_alp: 22000, today_deals: 1, selling_streak_days: 2, first_posted_date: "2026-08-01", last_posted_date: "2026-10-30", onboarding_stage: "training_online" });
    expect(teamStep(cara)).toBe("selling");
  });

  it("keeps a duplicate whose canonical person is not on this roster: it is the only row for them", () => {
    const out = foldMergedTwins([twin, other], map);
    expect(out.map((r) => r.agent_id)).toEqual(["twin", "other"]);
  });

  it("follows a duplicate of a duplicate to the last canonical row, and survives a loop in the map", () => {
    const b = rosterRow({ agent_id: "b", lifetime_deals: 1, l30_deals: 1 });
    const c = rosterRow({ agent_id: "c", lifetime_deals: 2, l30_deals: 0 });
    const a = rosterRow({ agent_id: "a", lifetime_deals: 4, l30_deals: 0 });
    const chain = new Map([["a", "b"], ["b", "c"], ["c", "c"]]);
    expect(foldMergedTwins([a, b, c], chain).map((r) => [r.agent_id, r.lifetime_deals])).toEqual([["c", 7]]);
    // A loop in the map keeps one person with both rows' sales: nobody vanishes.
    const loop = new Map([["a", "b"], ["b", "a"]]);
    expect(foldMergedTwins([a, b], loop).map((r) => [r.agent_id, r.lifetime_deals])).toEqual([["a", 5]]);
  });

  it("leaves a roster with no duplicates exactly as it was", () => {
    const rows = [canonical, other];
    expect(foldMergedTwins(rows, new Map())).toEqual(rows);
  });
});
