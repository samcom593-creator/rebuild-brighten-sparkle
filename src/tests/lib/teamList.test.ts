/**
 * My Team's list logic (src/lib/teamList.ts), OVERHAUL-myteam 2026-10-31.
 *
 * Pins the truth the page draws: four steps that are disjoint and cover everyone on the team, every count from
 * the same predicate as its list, unknown never shown as zero, the order to work the list in (drop-off risk
 * first: how long since anyone talked to them, weighted by step), one next action per person, and merged
 * duplicates folded into their canonical person instead of listed twice.
 */
import { describe, expect, it } from "vitest";
import {
  TEAM_LISTS, TEAM_MORE_LISTS, TEAM_STEPS, TEAM_TILE_LISTS, compareTeamMembers, daysAgoWords, daysBetween, dropOffRisk,
  dropOffTone, foldMergedTwins, hasTeamFilters, lastTalkedWords, licenseProgressRank, licenseProgressWords, listAlp30, matchesTeamFilters,
  matchesTeamSearch, onTeam, parseTeamFilters, parseTeamList, teamFilterWords, teamListCounts, teamListDef, teamListRows, teamNextStep,
  teamStage, teamStateOptions, teamStep, tenureWords, trainingStageWords, type TeamFilters, type TeamMember,
} from "@/lib/teamList";
import type { TeamProfile } from "@/lib/teamProfile";
import { teamStepTone } from "@/lib/tones";
import { FIELD_COURSE_URL, buildFirstStepsText, firstNameOf, firstStepLinksFromSettings, firstStepsLinkLines } from "@/lib/firstStepsLinks";
import { rosterRow } from "../helpers/teamRosterFixtures";
import { teamProfile } from "../helpers/teamProfileFixtures";
import { personFacts } from "../helpers/teamStageFixtures";

const TODAY = "2026-10-31";
/** A check-in stamp `days` days before TODAY, as applications.last_contacted_at stores it (an ISO instant). */
const talkedDaysAgo = (days: number) => new Date(Date.UTC(2026, 9, 31 - days, 15, 0, 0)).toISOString();
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

  it("the four step lists are disjoint and together are exactly Everyone, so their numbers add up", () => {
    const counts = teamListCounts(team, { factsReady: true, todayKey: TODAY });
    const stepKeys = TEAM_STEPS.map((s) => s.key);
    const stepLists = stepKeys.map((key) => teamListRows(team, key, TODAY).map((m) => m.row.agent_id));
    const all = stepLists.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(teamListRows(team, "everyone", TODAY).map((m) => m.row.agent_id).sort());
    expect(stepKeys.reduce((sum, key) => sum + (counts[key] ?? 0), 0)).toBe(counts.everyone);
  });

  it("everyone on the team is active and a person: placeholder seats and inactive people are not", () => {
    expect(onTeam(seller.row)).toBe(true);
    expect(onTeam(inactive.row)).toBe(false);
    expect(onTeam(ghost.row)).toBe(false);
    expect(teamListRows(team, "everyone", TODAY).map((m) => m.row.agent_id)).not.toContain("g1");
    expect(teamListRows(team, "everyone", TODAY).map((m) => m.row.agent_id)).not.toContain("i1");
  });
});

describe("dropOffRisk: how long since anyone talked to them, weighted by step", () => {
  it("never talked to is the worst, and a new agent outranks a seller talked to yesterday", () => {
    const neverLicensing = member({ license_status: "unlicensed", last_contacted_at: null });
    const sellerYesterday = member({ l30_deals: 2, lifetime_deals: 2, last_posted_date: "2026-10-16", last_contacted_at: talkedDaysAgo(1) });
    expect(dropOffRisk(neverLicensing, TODAY)).toMatchObject({ level: "high", days: null, why: "Never talked to, not licensed yet" });
    expect(dropOffRisk(neverLicensing, TODAY).score).toBeGreaterThan(dropOffRisk(sellerYesterday, TODAY).score);
    // Never beats any length of silence on the same step, even past the 30-day cap.
    expect(dropOffRisk(neverLicensing, TODAY).score).toBeGreaterThan(dropOffRisk(member({ license_status: "unlicensed", last_contacted_at: talkedDaysAgo(400) }), TODAY).score);
  });

  it("getting licensed and no sale yet: a week of silence is medium, two weeks is high, less is low", () => {
    const noSale = (days: number) => dropOffRisk(member({ license_status: "licensed", last_contacted_at: talkedDaysAgo(days) }), TODAY);
    expect(noSale(6).level).toBe("low");
    expect(noSale(7)).toMatchObject({ level: "medium", days: 7, why: "Last talked 7 days ago, no sale yet" });
    expect(noSale(13).level).toBe("medium");
    expect(noSale(14)).toMatchObject({ level: "high", days: 14, why: "Last talked 14 days ago, no sale yet" });
    const licensing = (days: number) => dropOffRisk(member({ license_status: "unlicensed", last_contacted_at: talkedDaysAgo(days) }), TODAY);
    expect(licensing(1)).toMatchObject({ level: "low", why: "Last talked yesterday, not licensed yet" });
    expect(licensing(7).level).toBe("medium");
    expect(licensing(14).level).toBe("high");
  });

  it("gone quiet weighs high but not most: ten days is medium, three weeks is high", () => {
    const quietFor = (days: number) => dropOffRisk(member({ l30_deals: 0, lifetime_deals: 3, last_posted_date: "2026-09-01", last_contacted_at: talkedDaysAgo(days) }), TODAY);
    expect(quietFor(9).level).toBe("low");
    expect(quietFor(10)).toMatchObject({ level: "medium", why: "Last talked 10 days ago, no sale in 30 days" });
    expect(quietFor(20).level).toBe("medium");
    expect(quietFor(21).level).toBe("high");
    expect(dropOffRisk(member({ l30_deals: 0, lifetime_deals: 3, last_contacted_at: null }), TODAY)).toMatchObject({ level: "high", why: "Never talked to, no sale in 30 days" });
    // The same silence weighs more on a new agent than on someone who has sold before.
    expect(quietFor(14).score).toBeLessThan(dropOffRisk(member({ license_status: "licensed", last_contacted_at: talkedDaysAgo(14) }), TODAY).score);
  });

  it("selling weighs least: a sale in the last 14 days is none, an older sale is at most low", () => {
    const recent = member({ l30_deals: 1, lifetime_deals: 1, last_posted_date: "2026-10-28", last_contacted_at: null });
    expect(dropOffRisk(recent, TODAY)).toEqual({ score: 0, level: "none", days: null, why: "Selling" });
    const fading = member({ l30_deals: 1, lifetime_deals: 1, last_posted_date: "2026-10-10", last_contacted_at: null });
    expect(dropOffRisk(fading, TODAY)).toMatchObject({ level: "low", why: "Never talked to, last sale 21 days ago" });
    expect(dropOffRisk(fading, TODAY).score).toBeLessThan(dropOffRisk(member({ license_status: "licensed", last_contacted_at: talkedDaysAgo(7) }), TODAY).score);
    expect(dropOffRisk(member({ l30_deals: 1, lifetime_deals: 1, last_posted_date: null, last_contacted_at: talkedDaysAgo(20) }), TODAY).why).toBe("Last talked 20 days ago, selling");
  });

  it("talked to today is no risk; a stamp dated after today reads as today, never a negative count", () => {
    expect(dropOffRisk(member({ license_status: "unlicensed", last_contacted_at: talkedDaysAgo(0) }), TODAY)).toMatchObject({ score: 0, level: "none", days: 0, why: "Last talked today, not licensed yet" });
    expect(dropOffRisk(member({ license_status: "licensed", last_contacted_at: "2026-11-03T02:00:00Z" }), TODAY)).toMatchObject({ score: 0, days: 0 });
  });

  it("nobody off the team is at risk here, and the words say what they are", () => {
    expect(dropOffRisk(inactive, TODAY)).toEqual({ score: 0, level: "none", days: null, why: "Not on the team" });
    expect(dropOffRisk(ghost, TODAY)).toEqual({ score: 0, level: "none", days: null, why: "Not a person" });
    expect(lastTalkedWords(inactive, TODAY)).toBeNull();
  });

  it("the row's fact says when, or that nobody ever has; high is the act-now red and medium the nudge amber", () => {
    expect(lastTalkedWords(member({ last_contacted_at: null }), TODAY)).toBe("Never talked to");
    expect(lastTalkedWords(member({ last_contacted_at: talkedDaysAgo(14) }), TODAY)).toBe("Last talked 14 days ago");
    expect(lastTalkedWords(member({ last_contacted_at: talkedDaysAgo(1) }), TODAY)).toBe("Last talked yesterday");
    expect(dropOffTone("high")).toBe("hot");
    expect(dropOffTone("medium")).toBe("warm");
    expect(dropOffTone("low")).toBe("slate");
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
    const counts = teamListCounts(withFacts, { factsReady: true, profileReady: true, todayKey: TODAY });
    for (const def of TEAM_LISTS) expect(counts[def.key]).toBe(teamListRows(withFacts, def.key, TODAY).length);
    expect(counts.no_login).toBe(1); // Nia; Quinn has no facts, so he is not counted as having no login
    expect(counts.free_leads).toBe(1);
    expect(counts.free_leads_close).toBe(1);
    expect(counts.not_active).toBe(1);
    expect(counts.sync_only).toBe(1);
  });

  it("a list built on the team facts is unknown, not zero, until the facts have loaded", () => {
    const counts = teamListCounts(team, { factsReady: false, todayKey: TODAY });
    expect(counts.no_login).toBeNull();
    expect(counts.stage_unset).toBeNull();
    expect(counts.no_schedule).toBeNull();
    expect(counts.everyone).toBe(4);
  });

  it("Talk to first is everyone on the team at high or medium risk, highest first, and its count is its list", () => {
    const rows = [
      member({ agent_id: "fine", license_status: "licensed", last_contacted_at: talkedDaysAgo(2) }),
      member({ agent_id: "week", license_status: "licensed", last_contacted_at: talkedDaysAgo(8) }),
      member({ agent_id: "never", license_status: "unlicensed", last_contacted_at: null }),
      member({ agent_id: "quiet-3w", l30_deals: 0, lifetime_deals: 2, last_posted_date: "2026-08-01", last_contacted_at: talkedDaysAgo(22) }),
      member({ agent_id: "sells", l30_deals: 2, lifetime_deals: 2, last_posted_date: "2026-10-29", last_contacted_at: null }),
      member({ agent_id: "gone", status: "inactive", last_contacted_at: null }),
      member({ agent_id: "seat", is_sync_only: true, last_contacted_at: null }),
    ];
    expect(teamListRows(rows, "drop_off", TODAY).map((m) => m.row.agent_id)).toEqual(["never", "quiet-3w", "week"]);
    expect(teamListCounts(rows, { factsReady: false, todayKey: TODAY }).drop_off).toBe(3);
    expect(teamListDef("drop_off").match(ghost, TODAY)).toBe(false);
    expect(teamListDef("drop_off").admitsSyncOnly).toBe(false);
    expect(TEAM_TILE_LISTS[0]).toBe("drop_off");
    expect(TEAM_TILE_LISTS).toHaveLength(4);
  });

  it("joined in the last 30 days is 30 days or less, a start date ahead of today included", () => {
    const rows = [member({ agent_id: "a", tenure_days: 30 }), member({ agent_id: "b", tenure_days: 31 }), member({ agent_id: "c", tenure_days: -2 }), member({ agent_id: "d", tenure_days: null })];
    expect(teamListRows(rows, "new_hires", TODAY).map((m) => m.row.agent_id)).toEqual(["c", "a"]);
  });

  it("declares, for every list, whether a placeholder seat may be in it, and honours it", () => {
    for (const def of TEAM_LISTS) expect(typeof def.admitsSyncOnly).toBe("boolean");
    expect(teamListDef("sync_only").match(ghost, TODAY)).toBe(true);
    expect(teamListDef("everyone").match(ghost, TODAY)).toBe(false);
    expect(teamListDef("licensing").match(ghost, TODAY)).toBe(false);
  });

  it("an unknown list in the URL falls back to Everyone; More lists holds every list that is not a tile", () => {
    expect(parseTeamList("selling")).toBe("selling");
    expect(parseTeamList("drop_off")).toBe("drop_off");
    expect(parseTeamList("licensing")).toBe("licensing");
    expect(parseTeamList("nonsense")).toBe("everyone");
    expect(parseTeamList(null)).toBe("everyone");
    const shown = new Set<string>(["everyone", ...TEAM_TILE_LISTS, ...TEAM_MORE_LISTS]);
    expect(TEAM_LISTS.every((def) => shown.has(def.key))).toBe(true);
    expect(TEAM_MORE_LISTS).toContain("licensing");
  });

  it("adds the 30-day ALP of a list", () => {
    expect(listAlp30([seller, member({ l30_alp: "544.5" })])).toBe(10000.5);
  });
});

describe("order: who needs you first", () => {
  it("Everyone puts the highest drop-off risk first: nobody has talked to these four, so the new agents outrank the quiet seller and the active seller is last", () => {
    expect(teamListRows(team, "everyone", TODAY).map((m) => m.row.agent_id)).toEqual(["n1", "l1", "q1", "s1"]);
  });

  it("with everyone talked to today, Everyone falls back to no sale yet, gone quiet, getting licensed, then selling", () => {
    const today = team.map((m) => ({ ...m, row: { ...m.row, last_contacted_at: talkedDaysAgo(0) } }));
    expect(teamListRows(today, "everyone", TODAY).map((m) => m.row.agent_id)).toEqual(["n1", "q1", "l1", "s1"]);
  });

  it("risk outranks the step order: a seller nobody has talked to in three weeks sits above a new hire talked to yesterday, and the off-team rows stay after, A to Z", () => {
    const rows = [
      member({ agent_id: "n-fresh", full_name: "Nia", license_status: "licensed", last_contacted_at: talkedDaysAgo(1) }),
      member({ agent_id: "s-silent", full_name: "Sal", l30_deals: 1, lifetime_deals: 1, last_posted_date: "2026-10-10", last_contacted_at: talkedDaysAgo(21) }),
      member({ agent_id: "l-week", full_name: "Lee", license_status: "unlicensed", last_contacted_at: talkedDaysAgo(7) }),
      member({ agent_id: "z-off", full_name: "Zed", status: "inactive", last_contacted_at: null }),
      member({ agent_id: "a-off", full_name: "Amy", status: "terminated", last_contacted_at: null }),
    ];
    expect([...rows].sort(compareTeamMembers(TODAY)).map((m) => m.row.agent_id)).toEqual(["l-week", "s-silent", "n-fresh", "a-off", "z-off"]);
  });

  it("within a step: newest first, most recent sale first, furthest along first, most ALP first", () => {
    // Everyone talked to today, so risk ties at zero and the order inside each step is what decides.
    const now = talkedDaysAgo(0);
    const rows = [
      member({ agent_id: "n-old", license_status: "licensed", tenure_days: 90, last_contacted_at: now }),
      member({ agent_id: "n-new", license_status: "licensed", tenure_days: 3, last_contacted_at: now }),
      member({ agent_id: "q-long", lifetime_deals: 1, last_posted_date: "2026-03-01", last_contacted_at: now }),
      member({ agent_id: "q-recent", lifetime_deals: 1, last_posted_date: "2026-09-25", last_contacted_at: now }),
      member({ agent_id: "l-start", license_status: "unlicensed", license_progress: "unlicensed", last_contacted_at: now }),
      member({ agent_id: "l-far", license_status: "unlicensed", license_progress: "waiting_on_license", last_contacted_at: now }),
      member({ agent_id: "l-none", license_status: "unlicensed", license_progress: null, last_contacted_at: now }),
      member({ agent_id: "s-small", l30_deals: 1, lifetime_deals: 1, l30_alp: 800, last_contacted_at: now }),
      member({ agent_id: "s-big", l30_deals: 2, lifetime_deals: 2, l30_alp: 12000, last_contacted_at: now }),
    ];
    expect([...rows].sort(compareTeamMembers(TODAY)).map((m) => m.row.agent_id)).toEqual([
      "n-new", "n-old", "q-recent", "q-long", "l-far", "l-start", "l-none", "s-big", "s-small",
    ]);
  });

  it("close to free leads lists the closest first; the off-team lists are A to Z", () => {
    const rows = [
      member({ agent_id: "far", full_name: "B", free_leads_needed_for_qual: 4800 }),
      member({ agent_id: "near", full_name: "A", free_leads_needed_for_qual: 300 }),
    ];
    expect(teamListRows(rows, "free_leads_close", TODAY).map((m) => m.row.agent_id)).toEqual(["near", "far"]);
    const off = [member({ agent_id: "z", full_name: "Zed", status: "inactive" }), member({ agent_id: "a", full_name: "Amy", status: "terminated" })];
    expect(teamListRows(off, "not_active", TODAY).map((m) => m.row.agent_id)).toEqual(["a", "z"]);
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

describe("first-steps links: the text a manager sends a new hire", () => {
  const all = { slack: "https://join.slack.com/t/galaxy/shared_invite/abc", discord: "https://discord.gg/galaxy", call: "https://calendly.com/sam/first-call" };

  it("greets by first name and lists the training videos, Slack, Discord and the call, one plain line each", () => {
    expect(buildFirstStepsText("Ann", all)).toBe([
      "Hey Ann, your first steps at Galaxy:",
      `Training videos: ${FIELD_COURSE_URL}`,
      "Slack: https://join.slack.com/t/galaxy/shared_invite/abc",
      "Discord: https://discord.gg/galaxy",
      "Book your call with Sam: https://calendly.com/sam/first-call",
      "Reply here if anything is stuck. Sam",
    ].join("\n"));
  });

  it("leaves out any link that is not set, never printing undefined, null or a blank line", () => {
    const text = buildFirstStepsText("Ann", { discord: all.discord });
    expect(text).toContain("Discord: https://discord.gg/galaxy");
    expect(text).toContain(`Training videos: ${FIELD_COURSE_URL}`);
    expect(text).not.toMatch(/Slack|Book your call|undefined|null/);
    expect(text.split("\n").every((line) => line.trim().length > 0)).toBe(true);
    expect(buildFirstStepsText("Ann", { slack: "  ", discord: "", call: undefined })).not.toMatch(/Slack|Discord|Book your call/);
    expect(firstStepsLinkLines(null).map((l) => l.key)).toEqual(["training"]);
    expect(firstStepsLinkLines(all).map((l) => l.key)).toEqual(["training", "slack", "discord", "call"]);
  });

  it("is plain text: no markdown, no em-dashes, and a greeting that still reads with no name on file", () => {
    const text = buildFirstStepsText("Ann", all);
    // The words are graded, not the links: a real URL may carry an underscore (shared_invite), and that is not markdown.
    expect(text.replace(/https?:\/\/\S+/g, "")).not.toMatch(/[*_#[\]`—]/);
    expect(text).not.toMatch(/—/);
    expect(buildFirstStepsText(null, all).startsWith("Hey there, your first steps at Galaxy:")).toBe(true);
    expect(buildFirstStepsText("", all).startsWith("Hey there,")).toBe(true);
    expect(firstNameOf("  Ann  Lee ")).toBe("Ann");
    expect(firstNameOf(null)).toBe("");
  });

  it("reads the three links from their system_settings keys, trimmed, and a key that is not set is blank", () => {
    const links = firstStepLinksFromSettings([
      { key: "discord_invite_url", value: " https://discord.gg/galaxy " },
      { key: "onboarding_call_scheduling_url", value: "https://calendly.com/sam/first-call" },
      { key: "unrelated_setting", value: "nope" },
    ]);
    expect(links).toEqual({ slack: "", discord: "https://discord.gg/galaxy", call: "https://calendly.com/sam/first-call" });
    expect(firstStepLinksFromSettings([])).toEqual({ slack: "", discord: "", call: "" });
    expect(firstStepLinksFromSettings([{ key: "slack_community_invite_url", value: null }]).slack).toBe("");
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

// MP-TEAM-PROFILE-FACTS (2026-11-27). Sam: "see what contracts they have back ... if they have Ethos back already ...
// a filter to see which one of those guys I can filter by state, see who's in Wisconsin."
describe("profile facts: the Ethos, carrier and sign-in lists, and the state and Ethos filters", () => {
  const withProfile = (m: TeamMember, p: Partial<TeamProfile>): TeamMember => ({ ...m, profile: teamProfile({ agent_id: m.row.agent_id, ...p }) });
  const ethosSeller = withProfile(seller, { ethos_back: true, ethos_source: "ethos_hierarchy", home_state: "AZ", carriers_active: 2 });
  const wiNoSale = withProfile(noSale, { home_state: "WI", carriers_active: 0, last_sign_in_at: null });
  const txQuiet = withProfile(quiet, { home_state: "TX", license_states: ["TX", "WI"], carriers_active: 1 });
  const learner = withProfile(licensing, { home_state: "WI", has_login: false, last_sign_in_at: null });
  const roster: TeamMember[] = [ethosSeller, wiNoSale, txQuiet, learner, inactive, ghost];

  it("the lists built on the facts read — until they load, then count exactly the people the facts describe", () => {
    const waiting = teamListCounts(roster, { factsReady: true, profileReady: false, todayKey: TODAY });
    expect([waiting.ethos, waiting.no_ethos, waiting.no_carriers, waiting.never_signed_in]).toEqual([null, null, null, null]);
    expect(waiting.everyone).toBe(4);
    const counts = teamListCounts(roster, { factsReady: true, profileReady: true, todayKey: TODAY });
    expect(counts).toMatchObject({ ethos: 1, no_ethos: 2, no_carriers: 1, never_signed_in: 2 });
    expect(teamListRows(roster, "ethos", TODAY).map((m) => m.row.agent_id)).toEqual(["s1"]);
    expect(teamListRows(roster, "no_ethos", TODAY).map((m) => m.row.agent_id).sort()).toEqual(["n1", "q1"]);
    expect(teamListRows(roster, "no_carriers", TODAY).map((m) => m.row.agent_id)).toEqual(["n1"]);
    expect(teamListRows(roster, "never_signed_in", TODAY).map((m) => m.row.agent_id).sort()).toEqual(["l1", "n1"]);
    // A person whose facts have not loaded is in none of them: unknown is never "has nothing".
    expect(teamListRows([noSale], "no_ethos", TODAY)).toEqual([]);
    expect(teamListRows([noSale], "no_carriers", TODAY)).toEqual([]);
    expect(teamListRows([noSale], "never_signed_in", TODAY)).toEqual([]);
  });

  it("the state filter matches a home state or a licensed state; the Ethos chips match back or nothing on file; unloaded facts match nothing", () => {
    const ids = (f: TeamFilters) => roster.filter((m) => onTeam(m.row) && matchesTeamFilters(m, f)).map((m) => m.row.agent_id).sort();
    expect(ids({ state: "WI", ethos: null })).toEqual(["l1", "n1", "q1"]);
    expect(ids({ state: "AZ", ethos: null })).toEqual(["s1"]);
    expect(ids({ state: null, ethos: "back" })).toEqual(["s1"]);
    // "None on file" is the people to call about Ethos: licensed only. Lee is still getting licensed, so he is not in it.
    expect(ids({ state: null, ethos: "none" })).toEqual(["n1", "q1"]);
    expect(ids({ state: "WI", ethos: "none" })).toEqual(["n1", "q1"]);
    expect(ids({ state: "WI", ethos: "back" })).toEqual([]);
    expect(matchesTeamFilters(noSale, { state: "WI", ethos: null })).toBe(false);
    expect(matchesTeamFilters(noSale, { state: null, ethos: "none" })).toBe(false);
    expect(matchesTeamFilters(noSale, { state: null, ethos: null })).toBe(true);
  });

  it("the state options count each person once per state, most people first, and only from people on the team", () => {
    expect(teamStateOptions(roster)).toEqual([
      { code: "WI", name: "Wisconsin", count: 3 },
      { code: "AZ", name: "Arizona", count: 1 },
      { code: "TX", name: "Texas", count: 1 },
    ]);
    expect(teamStateOptions([withProfile(inactive, { home_state: "WI" }), withProfile(ghost, { home_state: "WI" })])).toEqual([]);
  });

  it("filters are read from the URL in any case and written back in words", () => {
    const get = (o: Record<string, string>) => (k: string) => o[k] ?? null;
    expect(parseTeamFilters(get({ state: "wi", ethos: "back" }))).toEqual({ state: "WI", ethos: "back" });
    expect(parseTeamFilters(get({ state: "Wisconsin", ethos: "maybe" }))).toEqual({ state: null, ethos: null });
    expect(hasTeamFilters({ state: null, ethos: null })).toBe(false);
    expect(hasTeamFilters({ state: "WI", ethos: null })).toBe(true);
    expect(teamFilterWords({ state: "WI", ethos: "none" })).toBe("in Wisconsin with no Ethos on file");
    expect(teamFilterWords({ state: null, ethos: "back" })).toBe("with Ethos back");
    expect(teamFilterWords({ state: null, ethos: null })).toBeNull();
  });

  it("the four lists live under More lists, need the profile facts, and admit no placeholder seat", () => {
    for (const key of ["ethos", "no_ethos", "no_carriers", "never_signed_in"] as const) {
      expect(TEAM_MORE_LISTS).toContain(key);
      expect(teamListDef(key)).toMatchObject({ needsProfile: true, admitsSyncOnly: false });
      expect(teamListDef(key).match(withProfile(ghost, { ethos_back: true, last_sign_in_at: null, carriers_active: 0 }), TODAY)).toBe(false);
    }
  });
});
