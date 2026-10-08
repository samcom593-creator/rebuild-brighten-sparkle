import { describe, expect, it } from "vitest";
import { level, nextMilestone, streak, totalPieces, weekOverWeek, type MomentumPost } from "@/lib/contentMomentum";

const NOW = new Date("2026-10-08T20:00:00Z"); // 13:00 America/Phoenix (UTC-7, no DST)
const DAY = 86400_000;
const ago = (days: number, extra: Partial<MomentumPost> = {}): MomentumPost => ({ posted_at: new Date(NOW.getTime() - days * DAY).toISOString(), platform: "youtube", format: "short", views: 0, ...extra });

describe("streak", () => {
  it("counts consecutive Phoenix days ending today", () => {
    const s = streak([ago(0), ago(1), ago(2), ago(4)], NOW); // gap at day 3
    expect(s.days).toBe(3);
    expect(s.alive).toBe(true);
    expect(s.atRisk).toBe(false);
  });
  it("is at risk when the last post was yesterday", () => {
    const s = streak([ago(1), ago(2), ago(3)], NOW);
    expect(s.days).toBe(3);
    expect(s.alive).toBe(false);
    expect(s.atRisk).toBe(true);
  });
  it("is zero when the chain broke (nothing today or yesterday)", () => {
    const s = streak([ago(3), ago(4)], NOW);
    expect(s).toEqual({ days: 0, alive: false, atRisk: false });
  });
  it("is zero with no posts", () => {
    expect(streak([], NOW).days).toBe(0);
  });
});

describe("level", () => {
  it("level 1 at zero posts, climbing with uploads", () => {
    expect(level(0).level).toBe(1);
    expect(level(10).level).toBe(2);
  });
  it("380 posts is level 7, 87% toward 400", () => {
    const l = level(380);
    expect(l.level).toBe(7);
    expect(l.next).toBe(400);
    expect(l.into).toBe(130);
    expect(l.pct).toBe(87);
  });
  it("caps at the top of the ladder", () => {
    const l = level(50000);
    expect(l.next).toBeNull();
    expect(l.pct).toBe(100);
  });
});

describe("nextMilestone", () => {
  it("769 subs climbs toward 1,000 (231 to go, 54%)", () => {
    const m = nextMilestone(769)!;
    expect(m.next).toBe(1000);
    expect(m.from).toBe(500);
    expect(m.remaining).toBe(231);
    expect(m.pct).toBe(54);
  });
  it("brand-new channel aims at 100 from zero", () => {
    const m = nextMilestone(0)!;
    expect(m.next).toBe(100);
    expect(m.from).toBe(0);
    expect(m.pct).toBe(0);
  });
  it("returns null past the top of the ladder and for missing data", () => {
    expect(nextMilestone(2_000_000)).toBeNull();
    expect(nextMilestone(null)).toBeNull();
    expect(nextMilestone(undefined)).toBeNull();
  });
});

describe("weekOverWeek", () => {
  it("compares the last 7 days with the prior 7 days", () => {
    const posts = [
      ago(1, { views: 100 }), ago(2, { views: 50 }), ago(3, { views: 50 }), // this week: 3 pieces, 200 views
      ago(8, { views: 100 }), ago(9, { views: 100 }),                        // prior week: 2 pieces, 200 views
    ];
    const w = weekOverWeek(posts, NOW);
    expect(w.uploads.now).toBe(3);
    expect(w.uploads.prev).toBe(2);
    expect(w.uploads.deltaPct).toBe(50);
    expect(w.views.now).toBe(200);
    expect(w.views.deltaPct).toBe(0);
  });
  it("delta is null against an empty prior week (no percentage against zero)", () => {
    const w = weekOverWeek([ago(1), ago(2)], NOW);
    expect(w.uploads.now).toBe(2);
    expect(w.uploads.prev).toBe(0);
    expect(w.uploads.deltaPct).toBeNull();
  });
});

describe("totalPieces", () => {
  it("counts short + long, de-duped per platform per day", () => {
    // Same Short to youtube + instagram the same day counts once; a long the next day adds one.
    expect(totalPieces([
      { posted_at: new Date(NOW.getTime() - 1 * DAY).toISOString(), platform: "youtube", format: "short" },
      { posted_at: new Date(NOW.getTime() - 1 * DAY).toISOString(), platform: "instagram", format: "short" },
      { posted_at: new Date(NOW.getTime() - 2 * DAY).toISOString(), platform: "youtube", format: "long" },
    ])).toBe(2);
  });
});
