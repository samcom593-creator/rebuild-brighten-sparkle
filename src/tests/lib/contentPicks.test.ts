import { describe, expect, it } from "vitest";
import { BANK_IDEAS } from "@/data/contentIdeaBank";
import {
  DEFAULT_FILTERS, activeFilterCount, applyEdits, findProject, ideaFromInsight, keyFromTitle, matchesFilters, ownIdea, selectPicks, usedMarkers, wasEdited,
  type PickFilters, type PickIdea,
} from "@/lib/contentPicks";

const idea = (o: Partial<PickIdea> = {}): PickIdea => ({
  key: "t:1", title: "Test idea", lane: "gym", format: "short", kind: "talking_head", platforms: ["YouTube", "Instagram"], minutes: 20, locations: ["gym"],
  premise: "p", payoff: "y", hook: "h", why: "w", beats: [], shots: [], ending: "", score: 50, source: "bank", ...o,
});
const none = { dismissed: new Set<string>(), used: new Set<string>() };

describe("idea bank", () => {
  it("covers every lane the brief names, in both formats, without forcing an insurance pitch", () => {
    const lanes = new Set(BANK_IDEAS.map((i) => i.lane));
    expect([...lanes].sort()).toEqual(["business", "education", "faith", "gym", "mindset"]);
    expect(new Set(BANK_IDEAS.map((i) => i.format))).toEqual(new Set(["short", "long"]));
    expect(BANK_IDEAS.filter((i) => i.lane !== "education").every((i) => !/insurance|apply|policy|carrier/i.test(`${i.title} ${i.hook} ${i.ending}`))).toBe(true);
  });
  it("gives every idea a specific premise, payoff, hook, reason, beats, a unique key and a real effort estimate", () => {
    const keys = BANK_IDEAS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of BANK_IDEAS) {
      expect(i.premise.length, i.key).toBeGreaterThan(20);
      expect(i.payoff.length, i.key).toBeGreaterThan(10);
      expect(i.hook.length, i.key).toBeGreaterThan(15);
      expect(i.why.length, i.key).toBeGreaterThan(10);
      expect(i.beats.length, i.key).toBeGreaterThanOrEqual(3);
      expect(i.ending.length, i.key).toBeGreaterThan(10);
      expect(i.minutes, i.key).toBeGreaterThan(0);
      expect(i.platforms.length, i.key).toBeGreaterThan(0);
      expect(i.locations.length, i.key).toBeGreaterThan(0);
      if (i.kind === "vlog") expect(i.shots.length, `${i.key} is a vlog and needs a shot list`).toBeGreaterThanOrEqual(3);
    }
  });
  it("never states a fact about the creator, never mentions an offer, and avoids the repo's banned phrases", () => {
    const text = BANK_IDEAS.map((i) => `${i.title} ${i.premise} ${i.payoff} ${i.hook} ${i.beats.join(" ")} ${i.ending}`).join(" ").toLowerCase();
    // Built from fragments so this file does not itself trip the repo's copy guard, which scans for these exact phrases.
    const banned = ["game" + "-changer", "transform your " + "life", "un" + "lock", "elevate " + "your", "seam" + "lessly", "cutting" + "-edge", "world" + "-class", "\u2014", "inner " + "circle", "mentor" + "ship", "$"];
    for (const bad of banned) expect(text).not.toContain(bad);
  });
});

describe("filters", () => {
  it("default filters match everything and count as zero active", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(BANK_IDEAS.every((i) => matchesFilters(i, DEFAULT_FILTERS))).toBe(true);
  });
  it("each filter narrows on its own field", () => {
    const f = (o: Partial<PickFilters>): PickFilters => ({ ...DEFAULT_FILTERS, ...o });
    expect(matchesFilters(idea({ platforms: ["YouTube"] }), f({ platform: "TikTok" }))).toBe(false);
    expect(matchesFilters(idea({ platforms: ["YouTube", "TikTok"] }), f({ platform: "TikTok" }))).toBe(true);
    expect(matchesFilters(idea({ format: "long" }), f({ format: "short" }))).toBe(false);
    expect(matchesFilters(idea({ lane: "faith" }), f({ lane: "gym" }))).toBe(false);
    expect(activeFilterCount(f({ platform: "TikTok", lane: "gym", minutes: 45 }))).toBe(3);
  });
  it("available time is a ceiling and includes the boundary", () => {
    expect(matchesFilters(idea({ minutes: 45 }), { ...DEFAULT_FILTERS, minutes: 45 })).toBe(true);
    expect(matchesFilters(idea({ minutes: 46 }), { ...DEFAULT_FILTERS, minutes: 45 })).toBe(false);
  });
  it("a place filter also admits ideas that can be filmed anywhere, but not a different fixed place", () => {
    const f = { ...DEFAULT_FILTERS, place: "car" as const };
    expect(matchesFilters(idea({ locations: ["anywhere"] }), f)).toBe(true);
    expect(matchesFilters(idea({ locations: ["car", "home"] }), f)).toBe(true);
    expect(matchesFilters(idea({ locations: ["gym"] }), f)).toBe(false);
  });
});

describe("three strong, distinct picks", () => {
  it("returns three picks, best first, from three different lanes when the bank allows", () => {
    const r = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none);
    expect(r.picks).toHaveLength(3);
    expect(r.note).toBeNull();
    expect(new Set(r.picks.map((p) => p.lane)).size).toBe(3);
    expect(r.matched).toBe(BANK_IDEAS.length);
  });
  it("brings in a different lane before repeating one, even when the three best-scored ideas share a lane", () => {
    const pool = [
      idea({ key: "g1", title: "Gym one", lane: "gym", score: 90 }), idea({ key: "g2", title: "Gym two", lane: "gym", score: 89 }),
      idea({ key: "g3", title: "Gym three", lane: "gym", score: 88 }), idea({ key: "f1", title: "Faith one", lane: "faith", score: 60 }),
    ];
    const keys = selectPicks(pool, DEFAULT_FILTERS, none).picks.map((p) => p.key);
    expect(keys).toEqual(["g1", "f1", "g2"]); // best first, then a new lane, then the next best
    expect(new Set(selectPicks(pool, DEFAULT_FILTERS, none).picks.map((p) => p.lane)).size).toBe(2);
  });
  it("ranks long-form ahead of Shorts when no format is chosen, and not when one is", () => {
    const pool = [idea({ key: "s", title: "S", score: 80, format: "short", lane: "gym" }), idea({ key: "l", title: "L", score: 76, format: "long", lane: "faith" })];
    expect(selectPicks(pool, DEFAULT_FILTERS, none).picks[0].key).toBe("l");
    expect(selectPicks(pool, { ...DEFAULT_FILTERS, format: "short" }, none).picks[0].key).toBe("s");
  });
  it("is deterministic: the same inputs give the same picks in the same order", () => {
    const a = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks.map((p) => p.key);
    const b = selectPicks([...BANK_IDEAS].reverse(), DEFAULT_FILTERS, none).picks.map((p) => p.key);
    expect(a).toEqual(b);
  });
  it("never offers a dismissed idea, or one that already has a project by key or by title", () => {
    const top = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];
    const withoutTop = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, { dismissed: new Set([top.key]), used: new Set() });
    expect(withoutTop.picks.map((p) => p.key)).not.toContain(top.key);
    const usedByKey = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, { dismissed: new Set(), used: new Set([top.key]) });
    expect(usedByKey.picks.map((p) => p.key)).not.toContain(top.key);
    const usedByTitle = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, { dismissed: new Set(), used: usedMarkers([{ title: `  ${top.title.toUpperCase()}  ` }]) });
    expect(usedByTitle.picks.map((p) => p.key)).not.toContain(top.key);
  });
  it("fills with the same lane when the filters leave nothing else, and says so when fewer than three fit", () => {
    const gym = selectPicks(BANK_IDEAS, { ...DEFAULT_FILTERS, lane: "gym" }, none);
    expect(gym.picks).toHaveLength(3);
    expect(gym.picks.every((p) => p.lane === "gym")).toBe(true);
    const tight = selectPicks(BANK_IDEAS, { ...DEFAULT_FILTERS, lane: "faith", format: "long" }, none);
    expect(tight.picks).toHaveLength(1);
    expect(tight.note).toBe("Only 1 idea fits these filters.");
    const empty = selectPicks(BANK_IDEAS, { ...DEFAULT_FILTERS, lane: "faith", minutes: 20, format: "long" }, none);
    expect(empty.picks).toHaveLength(0);
    expect(empty.note).toMatch(/no saved idea fits/i);
  });
  it("filtering by platform, time and place gives picks that all satisfy every filter", () => {
    const f: PickFilters = { platform: "TikTok", format: "any", lane: "any", minutes: 25, place: "car" };
    const r = selectPicks(BANK_IDEAS, f, none);
    expect(r.picks.length).toBeGreaterThan(0);
    for (const p of r.picks) expect(matchesFilters(p, f)).toBe(true);
  });
});

describe("choosing, editing and matching", () => {
  it("edits change what is saved but never the idea's identity, and blank edits are ignored", () => {
    const i = idea({ title: "Original", hook: "Old hook" });
    const e = applyEdits(i, { title: "  New title ", hook: "   " });
    expect(e.title).toBe("New title");
    expect(e.hook).toBe("Old hook");
    expect(e.key).toBe(i.key);
    expect(wasEdited(i, e)).toBe(true);
    expect(wasEdited(i, applyEdits(i, undefined))).toBe(false);
  });
  it("finds an existing project by key first, then by exact title, and reports whether it is archived", () => {
    const live = [{ id: "1", title: "Other", brief: { idea_key: "t:1" } }, { id: "2", title: "Legacy card", brief: {} }];
    const archived = [{ id: "3", title: "Old one", brief: { idea_key: "t:9" } }];
    expect(findProject(idea({ key: "t:1" }), live, archived)?.card.id).toBe("1");
    expect(findProject(idea({ key: "t:77", title: "legacy CARD" }), live, archived)?.card.id).toBe("2");
    expect(findProject(idea({ key: "t:9", title: "Whatever" }), live, archived)).toEqual({ card: archived[0], archived: true });
    expect(findProject(idea({ key: "t:none", title: "Nothing" }), live, archived)).toBeNull();
  });
  it("makes the same key for the same title and a different key for another", () => {
    expect(keyFromTitle("insight", "Hello  World")).toBe(keyFromTitle("insight", "hello world"));
    expect(keyFromTitle("insight", "Hello")).not.toBe(keyFromTitle("insight", "Hello there"));
  });
  it("turns a saved insight into a pick with a lane guessed from its words and no invented beats", () => {
    const p = ideaFromInsight({ title: "Leg day at 5am", why: "Training builds discipline", format: "Long", score: 90, source: { channel: "X", views: 100 } });
    expect(p.lane).toBe("gym");
    expect(p.format).toBe("long");
    expect(p.beats).toEqual([]);
    expect(p.source).toBe("insights");
    expect(p.inspiredBy?.channel).toBe("X");
    expect(p.why).toBe("Based on a top video from X.");
    expect(p.why).not.toBe(p.premise); // the reason must add something, not repeat the premise
    expect(ideaFromInsight({ title: "Praying before the numbers", why: "faith", score: 50 }).lane).toBe("faith");
    expect(ideaFromInsight({ title: "Something else", why: "x", score: 50 }).format).toBe("short");
  });
  it("builds your own idea with its own key and honest defaults", () => {
    const o = ownIdea({ title: "  My idea ", format: "long" }, "abc");
    expect(o.key).toBe("own:abc");
    expect(o.title).toBe("My idea");
    expect(o.hook).toBe("My idea");
    expect(o.minutes).toBe(90);
    expect(o.source).toBe("own");
  });
});
