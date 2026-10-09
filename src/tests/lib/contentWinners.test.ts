import { describe, expect, it } from "vitest";
import { WINNER_RULE, matchPost, measureWinners, remakeDraft, resultsFor, youtubeId, type ResultPost, type Winner } from "@/lib/contentWinners";

const NOW = new Date("2026-10-09T19:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000 - 3600_000).toISOString(); // a little over d days
let n = 0;
const post = (o: Partial<ResultPost> & { views: number | null }): ResultPost => ({
  id: ++n, platform: "youtube", account: "Samuel James", format: "short", title: `Post ${n}`, url: `https://youtube.com/shorts/vid${n}aaaa`, posted_at: daysAgo(10), external_id: `vid${n}aaaa`, ...o,
});
/** Five Shorts around 1,000 views plus the post under test. */
const group = (target: number | null, extra: Partial<ResultPost> = {}) => [
  ...[900, 950, 1000, 1050, 1100].map((v) => post({ views: v, ...extra })),
  post({ views: target, ...extra }),
];

describe("winner rule", () => {
  it("states its thresholds in one place", () => {
    expect(WINNER_RULE).toMatchObject({ minRatio: 2, minBaselinePosts: 5, lookbackDays: 30 });
    expect(WINNER_RULE.minAgeDays).toEqual({ short: 3, long: 7 });
  });
  it("a post at exactly twice the group median is a winner; just under is not", () => {
    // median of [900,950,1000,1050,1100,X] with X large is (1000+1050)/2 = 1025
    const at = measureWinners(group(2050), NOW);
    expect(at.winners.map((w) => w.post.views)).toEqual([2050]);
    expect(at.winners[0].ratio).toBe(2);
    expect(measureWinners(group(2049), NOW).winners).toHaveLength(0);
  });
  it("shows the numbers behind the call: views, days, baseline and sample size", () => {
    const w = measureWinners(group(5000), NOW).winners[0];
    expect(w.sample).toBe(6);
    expect(w.baseline).toBe(1025);
    expect(w.ageDays).toBe(10);
    expect(w.basis).toContain("5,000 views after 10 days");
    expect(w.basis).toContain("median of 1,025 across 6 Shorts on YouTube");
  });
  it("needs five measured posts: four is reported as not enough, five is judged", () => {
    const four = [900, 950, 1000, 5000].map((v) => post({ views: v }));
    const r4 = measureWinners(four, NOW);
    expect(r4.winners).toHaveLength(0);
    expect(r4.unmeasured).toEqual([expect.objectContaining({ have: 4, need: 5, format: "short" })]);
    const five = [900, 950, 1000, 1100, 5000].map((v) => post({ views: v }));
    expect(measureWinners(five, NOW).winners).toHaveLength(1);
  });
  it("a post must be old enough: three days for a Short, seven for long-form", () => {
    const shorts = (age: number) => [...[900, 950, 1000, 1050, 1100].map((v) => post({ views: v })), post({ views: 9000, posted_at: daysAgo(age) })];
    expect(measureWinners(shorts(2), NOW).winners).toHaveLength(0);
    expect(measureWinners(shorts(2), NOW).tooNew).toBe(1);
    expect(measureWinners(shorts(3), NOW).winners).toHaveLength(1);
    const longs = (age: number) => [...[900, 950, 1000, 1050, 1100].map((v) => post({ views: v, format: "long" })), post({ views: 9000, format: "long", posted_at: daysAgo(age) })];
    expect(measureWinners(longs(6), NOW).winners).toHaveLength(0);
    expect(measureWinners(longs(7), NOW).winners).toHaveLength(1);
  });
  it("a too-new post does not drag the baseline down", () => {
    const posts = [...group(2100), ...Array.from({ length: 10 }, () => post({ views: 5, posted_at: daysAgo(1) }))];
    expect(measureWinners(posts, NOW).winners.map((w) => w.post.views)).toEqual([2100]);
  });
  it("only the last 30 days count", () => {
    expect(measureWinners(group(9000, { posted_at: daysAgo(31) }), NOW).winners).toHaveLength(0);
    expect(measureWinners(group(9000, { posted_at: daysAgo(29) }), NOW).winners).toHaveLength(1);
  });
  it("compares like with like: Shorts never against long-form, one platform or account never against another", () => {
    const mixed = [
      ...[900, 950, 1000, 1050, 1100].map((v) => post({ views: v })),
      ...[40, 45, 50, 55, 60].map((v) => post({ views: v, format: "long", posted_at: daysAgo(12) })),
      post({ views: 1200, format: "long", posted_at: daysAgo(12) }), // 24x the long-form median, ordinary for a Short
      ...[200, 210, 220, 230, 240].map((v) => post({ views: v, platform: "instagram", account: "Fit for Daddy" })),
      post({ views: 1000, platform: "instagram", account: "Fit for Daddy" }), // 4x its own group, ordinary for YouTube
    ];
    const r = measureWinners(mixed, NOW);
    const picked = r.winners.map((w) => `${w.post.platform}:${w.post.format}:${w.post.views}`).sort();
    expect(picked).toEqual(["instagram:short:1000", "youtube:long:1200"]);
    expect(r.winners.find((w) => w.post.views === 1000)!.baseline).toBe(225);
  });
  it("counts posts with no views separately instead of treating them as zero", () => {
    const r = measureWinners([...group(5000), post({ views: null }), post({ views: null })], NOW);
    expect(r.missingViews).toBe(2);
    expect(r.winners).toHaveLength(1);
    expect(r.winners[0].sample).toBe(6);
  });
  it("returns nothing, with a reason, when there are no recorded results at all", () => {
    expect(measureWinners([], NOW)).toEqual({ winners: [], unmeasured: [], tooNew: 0, missingViews: 0 });
    const noViews = measureWinners([post({ views: null }), post({ views: null })], NOW);
    expect(noViews.winners).toHaveLength(0);
    expect(noViews.missingViews).toBe(2);
  });
  it("ranks by ratio, caps the list, and breaks ties deterministically", () => {
    const base = Array.from({ length: 20 }, (_, i) => post({ views: 900 + i * 10 }));
    const winners = [3000, 4000, 5000, 6000, 7000, 8000].map((v) => post({ views: v }));
    const r = measureWinners([...base, ...winners], NOW, 5);
    expect(r.winners).toHaveLength(5);
    expect(r.winners[0].post.views).toBe(8000);
    expect(r.winners.map((w) => w.ratio)).toEqual([...r.winners.map((w) => w.ratio)].sort((a, b) => b - a));
  });
  it("an even-sized group uses the average of the two middle values", () => {
    const r = measureWinners([100, 100, 200, 200, 300, 900].map((v) => post({ views: v })), NOW);
    expect(r.winners[0].baseline).toBe(200);
  });
});

describe("matching a published project to its recorded post", () => {
  it("reads the video id from every common YouTube link shape", () => {
    for (const u of ["https://youtu.be/abc12345XY?si=1", "https://www.youtube.com/watch?v=abc12345XY&t=3", "https://youtube.com/shorts/abc12345XY", "https://m.youtube.com/live/abc12345XY"]) expect(youtubeId(u)).toBe("abc12345XY");
    expect(youtubeId("https://instagram.com/reel/xyz/")).toBeNull();
    expect(youtubeId(null)).toBeNull();
  });
  it("matches by video id across link shapes, and by normalised URL for other platforms", () => {
    const yt = post({ views: 10, external_id: "abc12345XY", url: "https://youtube.com/shorts/abc12345XY" });
    const ig = post({ views: 10, platform: "instagram", external_id: null, url: "https://www.instagram.com/reel/ZZ/?utm=1" });
    expect(matchPost("https://youtu.be/abc12345XY", [yt, ig])?.id).toBe(yt.id);
    expect(matchPost("https://instagram.com/reel/ZZ", [yt, ig])?.id).toBe(ig.id);
    expect(matchPost("https://youtu.be/nothingelse1", [yt, ig])).toBeNull();
    expect(matchPost("", [yt, ig])).toBeNull();
  });
});

describe("results for a published project", () => {
  const posts = group(5000);
  const report = measureWinners(posts, NOW);
  const winnerPost = posts[posts.length - 1];
  it("no recorded post: says nothing is recorded and how to add it, never a number", () => {
    const r = resultsFor("https://youtu.be/unknownidxx", posts, report, NOW);
    expect(r.state).toBe("none");
    expect(r.message).toMatch(/no results recorded/i);
  });
  it("a recorded post with no view count is unmeasured", () => {
    const blank = post({ views: null });
    expect(resultsFor(blank.url, [blank], measureWinners([blank], NOW), NOW)).toMatchObject({ state: "unmeasured", message: expect.stringMatching(/no view count/i) });
  });
  it("a post that is too new is unmeasured and says how long to wait", () => {
    const fresh = post({ views: 50, posted_at: daysAgo(1) });
    const r = resultsFor(fresh.url, [...posts, fresh], measureWinners([...posts, fresh], NOW), NOW);
    expect(r).toMatchObject({ state: "unmeasured" });
    expect(r.message).toMatch(/3 days of views/);
  });
  it("a group with too few posts is unmeasured, not a verdict", () => {
    const few = [post({ views: 100 }), post({ views: 900 })];
    const r = resultsFor(few[1].url, few, measureWinners(few, NOW), NOW);
    expect(r).toMatchObject({ state: "unmeasured" });
    expect(r.message).toMatch(/2 measured Shorts on YouTube, 5 needed/);
  });
  it("a winner is reported with its basis; an ordinary post is measured but not a winner", () => {
    const win = resultsFor(winnerPost.url, posts, report, NOW);
    expect(win).toMatchObject({ state: "measured", winner: expect.objectContaining({ ratio: 4.9 }) });
    const ordinary = posts[2];
    const o = resultsFor(ordinary.url, posts, report, NOW);
    expect(o).toMatchObject({ state: "measured", winner: null });
    expect(o.message).toMatch(/not a winner/i);
  });
});

describe("remake draft", () => {
  const winner: Winner = { post: post({ views: 5000, title: "Why I stopped waiting", platform: "youtube", format: "short", id: 777 }), ratio: 4.9, baseline: 1025, sample: 6, ageDays: 10, group: "youtube|Samuel James|short", basis: "x" };
  it("keeps the proven premise, links the original, and states the hypothesis with the measured numbers", () => {
    const d = remakeDraft(winner, "experiment", "hook", "2026-10-09T19:00:00Z");
    expect(d.brief.premise).toBe("Why I stopped waiting");
    expect(d.brief.remake_of).toMatchObject({ post_id: 777, views: 5000, ratio: 4.9 });
    expect(d.hypothesis).toContain("4.9 times the usual views");
    expect(d.hypothesis).toMatch(/opening line/i);
    expect(d.hook).toBe("");
    expect(d.idea_key).toBe("remake:777:experiment:hook");
  });
  it("each variation titles the draft differently and never reuses the original title", () => {
    const titles = (["sequel", "fresh_application", "experiment"] as const).map((v) => remakeDraft(winner, v, "example", "t").title);
    expect(new Set(titles).size).toBe(3);
    expect(titles).not.toContain("Why I stopped waiting");
    expect(titles[0]).toBe("Part 2: Why I stopped waiting");
  });
  it("changing the format flips short to long and long to short, and any other change keeps it", () => {
    expect(remakeDraft(winner, "experiment", "format", "t").format).toBe("long");
    expect(remakeDraft(winner, "experiment", "hook", "t").format).toBe("short");
    const long = { ...winner, post: { ...winner.post, format: "long" } };
    expect(remakeDraft(long, "experiment", "format", "t").format).toBe("short");
  });
  it("a remake of a remake does not stack Part 2 prefixes", () => {
    const w2 = { ...winner, post: { ...winner.post, title: "Part 2: Why I stopped waiting" } };
    expect(remakeDraft(w2, "sequel", "hook", "t").title).toBe("Part 2: Why I stopped waiting");
  });
  it("the same remake always has the same key, a different choice a different key", () => {
    const a = remakeDraft(winner, "sequel", "hook", "t1").idea_key;
    expect(remakeDraft(winner, "sequel", "hook", "t2").idea_key).toBe(a);
    expect(remakeDraft(winner, "sequel", "example", "t").idea_key).not.toBe(a);
    expect(remakeDraft(winner, "experiment", "hook", "t").idea_key).not.toBe(a);
  });
});
