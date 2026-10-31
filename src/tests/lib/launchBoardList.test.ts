/**
 * The Launch Board's one list (src/lib/launchBoardList.ts), OVERHAUL-launchboard 2026-10-31.
 *
 * Sam: "still pretty ugly." These pin what the page shows: where every video is (the word, the tone and how far
 * along the bar), the one next step and its button, when it is due or planned, the four numbers and the lists they
 * open (a number always equals its list), the order of work, and Sam's board as it stood that day.
 */
import { describe, expect, it } from "vitest";
import {
  VIDEO_BAR_STEPS, VIDEO_CHIP_LISTS, VIDEO_LISTS, VIDEO_STEPS, VIDEO_TILE_LISTS,
  compareVideos, defaultVideoList, hookLine, inVideoList, matchesVideoSearch, parseVideoList, plannedThisWeek, plannedTimeWords,
  shortDate, videoFormat, videoListCounts, videoListRows, videoNextStep, videoRank, videoStep, videoStepKey, videoUpNext, videoWhen,
  type BoardVideo, type VideoListKey,
} from "@/lib/launchBoardList";
import { contentStepTone } from "@/lib/tones";

// Friday, Oct 30, 2026, noon in Phoenix (UTC-7, no daylight saving). The Phoenix week starts Monday, Oct 26.
const NOW = new Date("2026-10-30T19:00:00Z");
const MONDAY = "2026-10-26";

let seq = 0;
function video(o: Partial<BoardVideo> = {}): BoardVideo {
  seq += 1;
  return {
    id: `v${String(seq).padStart(3, "0")}`, title: `Video ${seq}`, status: "idea", hook: "", record_script: "", clip: "", edit_prompt: "",
    caption: "", brand: "SH", content_type: "short", cta: "", owner: "", due_date: null, day: 0, approved_at: null, scheduled_for: null,
    schedule_kind: null, schedule_job_ref: null, published_url: null, publish_evidence: null, sort: 100, posted_at: null, planned_week: null, ...o,
  };
}
const pack = (done: number, total: number) =>
  ["FILM: x", "", "SCRIPT OUTLINE", ...Array.from({ length: total }, (_, i) => `- [${i < done ? "x" : " "}] ${i + 1}. Beat ${i + 1}`)].join("\n");
const LIVE = { published_url: "https://www.youtube.com/watch?v=abc123", publish_evidence: "manual_confirmation" };

describe("where a video is", () => {
  it("maps every stored status to one step, the legacy ones included, and never guesses published", () => {
    expect(videoStepKey(video({ status: "idea" }))).toBe("idea");
    expect(videoStepKey(video({ status: "record" }))).toBe("selected");
    expect(videoStepKey(video({ status: "record", record_script: pack(1, 4) }))).toBe("filming");
    expect(videoStepKey(video({ status: "record", clip: "Reels/a.mp4" }))).toBe("filming");
    expect(videoStepKey(video({ status: "edit" }))).toBe("editing");
    expect(videoStepKey(video({ status: "recorded" }))).toBe("editing");
    expect(videoStepKey(video({ status: "review" }))).toBe("editing");
    expect(videoStepKey(video({ status: "ready" }))).toBe("ready");
    expect(videoStepKey(video({ status: "scheduled" }))).toBe("ready");
    expect(videoStepKey(video({ status: "posted" }))).toBe("no_link");
    expect(videoStepKey(video({ status: "published" }))).toBe("no_link");
    expect(videoStepKey(video({ status: "published", ...LIVE }))).toBe("published");
    expect(videoStepKey(video({ status: "posted", ...LIVE }))).toBe("published");
    expect(videoStepKey(video({ status: "something_new" }))).toBe("idea");
  });

  it("draws six steps in five hues, with the word beside the colour, and never puts amber next to gold", () => {
    expect(VIDEO_BAR_STEPS).toBe(6);
    const ladder = ["idea", "selected", "filming", "editing", "ready", "published"] as const;
    const tones = ladder.map((k) => contentStepTone(k));
    // Selected and Filming are the two halves of the Record stage and share its blue; every other step has its own.
    expect(tones).toEqual(["slate", "cool", "cool", "royal", "gold", "good"]);
    expect(new Set(tones).size).toBe(5);
    // Warm reads as gold in a bar, so it is not on this ladder at all.
    expect(tones).not.toContain("warm");
    expect(ladder.map((k) => VIDEO_STEPS.find((s) => s.key === k)!.index)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const s of VIDEO_STEPS) {
      const step = videoStep(video(stepFixture(s.key)), NOW);
      expect(step.key).toBe(s.key);
      expect(step.label).toBe(s.label);
      expect(step.index).toBe(s.index);
      expect(step.tone).toBe(contentStepTone(s.key));
    }
    // Marked posted with no proof: a full bar in quiet grey, unlike the green of a confirmed post.
    expect(contentStepTone("no_link")).toBe("slate");
    expect(contentStepTone("anything else")).toBe("slate");
  });

  it("states one plain fact beside the word", () => {
    expect(videoStep(video({ status: "idea", day: 5, planned_week: MONDAY }), NOW).detail).toBe("On the plan for Friday");
    expect(videoStep(video({ status: "idea", day: 5, planned_week: "2026-10-05" }), NOW).detail).toBeNull();
    expect(videoStep(video({ status: "idea", record_script: pack(0, 3) }), NOW).detail).toBe("Filming pack ready");
    expect(videoStep(video({ status: "record" }), NOW).detail).toBe("No shot list yet");
    expect(videoStep(video({ status: "record", record_script: pack(0, 1) }), NOW).detail).toBe("1 shot to film");
    expect(videoStep(video({ status: "record", record_script: pack(0, 6) }), NOW).detail).toBe("6 shots to film");
    expect(videoStep(video({ status: "record", record_script: pack(2, 6) }), NOW).detail).toBe("2 of 6 shots done");
    expect(videoStep(video({ status: "record", clip: "Reels/a.mp4" }), NOW).detail).toBe("Footage attached");
    expect(videoStep(video({ status: "review" }), NOW).detail).toBe("Waiting on approval");
    expect(videoStep(video({ status: "edit" }), NOW).detail).toBe("Needs its footage");
    expect(videoStep(video({ status: "edit", clip: "a.mp4" }), NOW).detail).toBe("No edit instructions yet");
    expect(videoStep(video({ status: "edit", clip: "a.mp4", edit_prompt: "cut" }), NOW).detail).toBe("No caption yet");
    expect(videoStep(video({ status: "edit", clip: "a.mp4", edit_prompt: "cut", caption: "c" }), NOW).detail).toBe("Footage in");
    expect(videoStep(video({ status: "ready" }), NOW).detail).toBe("Approved");
    expect(videoStep(video({ status: "scheduled", scheduled_for: "2026-11-02T22:00:00Z", schedule_kind: "manual" }), NOW).detail).toBe("Planned, posts by hand");
    expect(videoStep(video({ status: "scheduled", scheduled_for: "2026-11-02T22:00:00Z", schedule_kind: "job", schedule_job_ref: "job-1" }), NOW).detail).toBe("Scheduled to post");
    expect(videoStep(video({ status: "posted" }), NOW).detail).toBe("No live link saved");
    expect(videoStep(video({ status: "published", ...LIVE }), NOW).detail).toBe("Live on YouTube");
    expect(videoStep(video({ status: "published", published_url: "https://www.tiktok.com/@sam/video/1", publish_evidence: "provider" }), NOW).detail).toBe("Live on TikTok");
  });

  it("knows this week's plan from the Phoenix week, not from the weekday alone", () => {
    expect(plannedThisWeek({ day: 3, planned_week: MONDAY }, NOW)).toBe(true);
    expect(plannedThisWeek({ day: 3, planned_week: "2026-10-19" }, NOW)).toBe(false);
    expect(plannedThisWeek({ day: 0, planned_week: MONDAY }, NOW)).toBe(false);
  });
});

/** The smallest card that sits on a given step. */
function stepFixture(key: string): Partial<BoardVideo> {
  switch (key) {
    case "idea": return { status: "idea" };
    case "selected": return { status: "record" };
    case "filming": return { status: "record", record_script: pack(1, 3) };
    case "editing": return { status: "edit" };
    case "ready": return { status: "ready" };
    case "no_link": return { status: "posted" };
    default: return { status: "published", ...LIVE };
  }
}

describe("the next step and its button", () => {
  const admin = { isAdmin: true, now: NOW };
  const editor = { isAdmin: false, now: NOW };

  it("an idea is filmed next, opening on its hook without the planning tag", () => {
    const step = videoNextStep(video({ status: "idea", hook: "[YT-80/20] I was homeless at 18. At 20 I run an agency." }), admin);
    expect(step).toMatchObject({ kind: "film", label: "Film this", title: "Film this next", to: "record" });
    expect(step.detail).toBe("It opens with: “I was homeless at 18.”");
    expect(videoNextStep(video({ status: "idea" }), admin).detail).toBe("Pick it and it moves to Selected, ready to film.");
  });

  it("a selected video opens its filming pack, or asks for a shot list when there is none", () => {
    expect(videoNextStep(video({ status: "record" }), admin)).toMatchObject({ kind: "write", label: "Write shot list" });
    const filmIt = videoNextStep(video({ status: "record", record_script: pack(0, 6) }), admin);
    expect(filmIt).toMatchObject({ kind: "pack", label: "Open filming pack", title: "Film it" });
    expect(filmIt.detail).toContain("6 shots");
    expect(videoNextStep(video({ status: "record", record_script: "Just a script, no checklist" }), admin).kind).toBe("pack");
  });

  it("filming: finish the shots, then attach the footage, then move it to editing", () => {
    expect(videoNextStep(video({ status: "record", record_script: pack(2, 6) }), admin)).toMatchObject({ kind: "pack", title: "Finish filming", detail: "2 of 6 shots done. Tick the rest as you film them." });
    expect(videoNextStep(video({ status: "record", record_script: pack(6, 6) }), admin)).toMatchObject({ kind: "attach", label: "Attach footage" });
    expect(videoNextStep(video({ status: "record", record_script: pack(2, 6), clip: "Reels/a.mp4" }), admin)).toMatchObject({ kind: "advance", to: "edit", label: "Start editing" });
  });

  it("editing asks for what is missing, in order, then sends it for approval", () => {
    expect(videoNextStep(video({ status: "edit" }), admin)).toMatchObject({ kind: "attach", label: "Attach footage" });
    expect(videoNextStep(video({ status: "recorded" }), admin)).toMatchObject({ kind: "attach" });
    expect(videoNextStep(video({ status: "edit", clip: "a.mp4" }), admin)).toMatchObject({ kind: "write", label: "Write instructions" });
    expect(videoNextStep(video({ status: "edit", clip: "a.mp4", edit_prompt: "cut" }), admin)).toMatchObject({ kind: "write", label: "Write caption" });
    expect(videoNextStep(video({ status: "edit", clip: "a.mp4", edit_prompt: "cut", caption: "c" }), admin)).toMatchObject({ kind: "advance", to: "review", label: "Send to review" });
  });

  it("only an admin approves; anyone else sees it waiting, with no button", () => {
    expect(videoNextStep(video({ status: "review", caption: "c" }), admin)).toMatchObject({ kind: "approve", label: "Approve" });
    expect(videoNextStep(video({ status: "review" }), admin)).toMatchObject({ kind: "write", label: "Write caption" });
    expect(videoNextStep(video({ status: "review", caption: "c" }), editor)).toMatchObject({ kind: "wait", label: null, title: "Waiting on approval" });
  });

  it("ready, planned and unproven posts all lead to the publish kit; a live one opens the post", () => {
    expect(videoNextStep(video({ status: "ready" }), admin)).toMatchObject({ kind: "post", label: "Post it", title: "Post it" });
    expect(videoNextStep(video({ status: "scheduled", scheduled_for: "2026-10-30T17:00:00Z" }), admin)).toMatchObject({ kind: "post", title: "Post it now" });
    expect(videoNextStep(video({ status: "scheduled", scheduled_for: "2026-10-30T22:00:00Z" }), admin).title).toBe("Post it today at 3:00 PM");
    expect(videoNextStep(video({ status: "scheduled", scheduled_for: "2026-11-02T22:00:00Z" }), admin).title).toBe("Post it on Mon, Nov 2, 3:00 PM");
    expect(videoNextStep(video({ status: "scheduled", scheduled_for: "2026-11-02T22:00:00Z" }), admin).detail).toContain("Nothing posts by itself");
    expect(videoNextStep(video({ status: "posted" }), admin)).toMatchObject({ kind: "link", label: "Add link" });
    expect(videoNextStep(video({ status: "published", ...LIVE }), admin)).toMatchObject({ kind: "view", label: "View post", detail: "Live on YouTube." });
  });

  it("every step has a button except the one that waits on someone else", () => {
    const all = ["idea", "record", "edit", "review", "ready", "scheduled", "posted", "published"];
    for (const status of all) {
      const step = videoNextStep(video({ status, caption: "c", ...(status === "published" ? LIVE : {}) }), admin);
      expect(step.label, status).toBeTruthy();
      expect(step.tone).toBe(contentStepTone(videoStepKey(video({ status, ...(status === "published" ? LIVE : {}) }))));
    }
  });

  it("hookLine keeps the first sentence, drops a planning tag and never runs past 140 characters", () => {
    expect(hookLine("[YT-80/20] Before/after: cash at 19. Then the team board at 20.")).toBe("Before/after: cash at 19.");
    expect(hookLine("no punctuation at all")).toBe("no punctuation at all");
    expect(hookLine(null)).toBe("");
    const long = hookLine("x".repeat(400));
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("when", () => {
  it("a late due date is red and wins over everything else; due today is amber; later is quiet", () => {
    expect(videoWhen(video({ status: "edit", due_date: "2026-10-27" }), NOW)).toEqual({ text: "Late: was due Oct 27", tone: "hot", emphasis: true });
    expect(videoWhen(video({ status: "scheduled", due_date: "2026-10-27", scheduled_for: "2026-11-02T22:00:00Z" }), NOW)?.text).toBe("Late: was due Oct 27");
    expect(videoWhen(video({ status: "edit", due_date: "2026-10-30" }), NOW)).toEqual({ text: "Due today", tone: "warm", emphasis: true });
    expect(videoWhen(video({ status: "edit", due_date: "2026-11-04" }), NOW)).toEqual({ text: "Due Nov 4", tone: "slate", emphasis: false });
    expect(videoWhen(video({ status: "idea" }), NOW)).toBeNull();
  });

  it("a planned post time says when, in Phoenix, and turns red once it has passed", () => {
    expect(videoWhen(video({ status: "scheduled", scheduled_for: "2026-10-30T17:00:00Z" }), NOW)).toEqual({ text: "Planned time passed (today, 10:00 AM)", tone: "hot", emphasis: true });
    expect(videoWhen(video({ status: "scheduled", scheduled_for: "2026-10-30T22:00:00Z" }), NOW)).toEqual({ text: "Planned for today, 3:00 PM", tone: "warm", emphasis: true });
    expect(videoWhen(video({ status: "scheduled", scheduled_for: "2026-11-02T22:00:00Z" }), NOW)).toEqual({ text: "Planned for Mon, Nov 2, 3:00 PM", tone: "cool", emphasis: false });
  });

  it("a published video says when it went up; a due date on it no longer matters", () => {
    expect(videoWhen(video({ status: "published", ...LIVE, posted_at: "2026-10-12T18:00:00Z", due_date: "2026-10-01" }), NOW)).toEqual({ text: "Posted Oct 12", tone: "slate", emphasis: false });
    expect(videoWhen(video({ status: "published", ...LIVE }), NOW)).toBeNull();
  });

  it("formats dates and planned times plainly", () => {
    expect(shortDate("2026-11-04")).toBe("Nov 4");
    expect(shortDate("not a date")).toBe("not a date");
    expect(plannedTimeWords("2026-10-30T22:00:00Z", NOW)).toBe("today, 3:00 PM");
    expect(plannedTimeWords("2026-10-31T16:30:00Z", NOW)).toBe("Sat, Oct 31, 9:30 AM");
    expect(plannedTimeWords("garbage", NOW)).toBe("an unreadable time");
  });
});

describe("the four numbers and the lists they open", () => {
  // Every step, a few times over, with dates and plans that move them around the order.
  const board = (): BoardVideo[] => [
    video({ status: "idea", title: "Idea old", sort: 10 }),
    video({ status: "idea", title: "Idea with pack", record_script: pack(0, 3), sort: 20 }),
    video({ status: "idea", title: "Idea on today's slot", day: 5, planned_week: MONDAY, sort: 5 }),
    video({ status: "idea", title: "Idea newest", sort: 90 }),
    video({ status: "record", title: "Selected" }),
    video({ status: "record", title: "Filming", record_script: pack(2, 5) }),
    video({ status: "edit", title: "Edit no footage" }),
    video({ status: "edit", title: "Edit with footage", clip: "a.mp4" }),
    video({ status: "review", title: "Review", caption: "c" }),
    video({ status: "edit", title: "Edit late", due_date: "2026-10-25" }),
    video({ status: "ready", title: "Ready" }),
    video({ status: "scheduled", title: "Planned later", scheduled_for: "2026-11-03T18:00:00Z" }),
    video({ status: "scheduled", title: "Planned passed", scheduled_for: "2026-10-29T18:00:00Z" }),
    video({ status: "posted", title: "No link" }),
    video({ status: "published", title: "Live old", ...LIVE, posted_at: "2026-10-01T18:00:00Z" }),
    video({ status: "published", title: "Live new", ...LIVE, posted_at: "2026-10-20T18:00:00Z" }),
  ];

  it("every number equals the rows of the list it opens", () => {
    const videos = board();
    const counts = videoListCounts(videos);
    for (const list of Object.keys(VIDEO_LISTS) as VideoListKey[]) {
      expect(counts[list], list).toBe(videoListRows(videos, list, NOW).length);
      expect(videoListRows(videos, list, NOW).every((v) => inVideoList(v, list))).toBe(true);
    }
    expect(counts).toEqual({ working: 10, ideas: 4, film: 2, edit: 4, post: 4, published: 2, everyone: 16 });
  });

  it("the four numbers and Published cover every video exactly once, and In progress is To film, To edit and To post", () => {
    const videos = board();
    const counts = videoListCounts(videos);
    expect(VIDEO_TILE_LISTS).toEqual(["ideas", "film", "edit", "post"]);
    expect(VIDEO_CHIP_LISTS).toEqual(["working", "published", "everyone"]);
    expect(counts.ideas + counts.film + counts.edit + counts.post + counts.published).toBe(counts.everyone);
    for (const v of videos) {
      const homes = [...VIDEO_TILE_LISTS, "published" as const].filter((list) => inVideoList(v, list));
      expect(homes, v.title).toHaveLength(1);
    }
    expect(counts.working).toBe(counts.film + counts.edit + counts.post);
  });

  it("orders the work: late first, then the closest to published, ideas after, live videos last and newest first", () => {
    const order = videoListRows(board(), "everyone", NOW).map((v) => v.title);
    expect(order).toEqual([
      "Edit late", "Planned passed", "Ready", "Planned later", "Review", "Edit with footage", "Edit no footage",
      "Filming", "Selected", "No link", "Idea on today's slot", "Idea with pack", "Idea newest", "Idea old", "Live new", "Live old",
    ]);
    expect(videoListRows(board(), "ideas", NOW).map((v) => v.title)).toEqual(["Idea on today's slot", "Idea with pack", "Idea newest", "Idea old"]);
    expect(videoListRows(board(), "published", NOW).map((v) => v.title)).toEqual(["Live new", "Live old"]);
  });

  it("ties break by the earliest due date, then the earliest planned time, then the newest card, then the title", () => {
    const a = video({ status: "ready", title: "B", due_date: "2026-11-05", sort: 1 });
    const b = video({ status: "ready", title: "A", due_date: "2026-11-09", sort: 99 });
    const c = video({ status: "ready", title: "C", sort: 50 });
    const d = video({ status: "ready", title: "D", sort: 50 });
    expect([d, c, b, a].sort((x, y) => compareVideos(x, y, NOW)).map((v) => v.title)).toEqual(["B", "A", "C", "D"]);
    expect(videoRank(video({ status: "edit", due_date: "2026-10-30" }), NOW)).toBe(1);
    expect(videoRank(video({ status: "scheduled", scheduled_for: "2026-10-30T23:00:00Z" }), NOW)).toBe(1);
    expect(videoRank(video({ status: "published", ...LIVE, due_date: "2026-10-01" }), NOW)).toBe(13);
  });

  it("opens on what is in progress, or on the ideas when nothing is", () => {
    expect(defaultVideoList(videoListCounts(board()))).toBe("working");
    expect(defaultVideoList(videoListCounts([video({ status: "idea" })]))).toBe("ideas");
    expect(defaultVideoList(videoListCounts([]))).toBe("working");
    expect(defaultVideoList(videoListCounts([video({ status: "published", ...LIVE })]))).toBe("working");
  });

  it("reads the list from the URL and ignores anything it does not know", () => {
    expect(parseVideoList("post")).toBe("post");
    expect(parseVideoList("everyone")).toBe("everyone");
    expect(parseVideoList("board")).toBeNull();
    expect(parseVideoList("constructor")).toBeNull();
    expect(parseVideoList(null)).toBeNull();
  });

  it("Up next is the first row, unless that row is already live", () => {
    const rows = videoListRows(board(), "working", NOW);
    expect(videoUpNext(rows)?.title).toBe("Edit late");
    expect(videoUpNext(videoListRows(board(), "published", NOW))).toBeNull();
    expect(videoUpNext([])).toBeNull();
  });
});

describe("search and labels", () => {
  it("finds a video by title, opening line, caption or owner, whatever the case or accents", () => {
    const v = video({ title: "Café talk at 6 AM", hook: "The routine", caption: "Apply now", owner: "Mía" });
    expect(matchesVideoSearch(v, "cafe")).toBe(true);
    expect(matchesVideoSearch(v, "ROUTINE")).toBe(true);
    expect(matchesVideoSearch(v, "apply cafe")).toBe(true);
    expect(matchesVideoSearch(v, "mia")).toBe(true);
    expect(matchesVideoSearch(v, "gym")).toBe(false);
    expect(matchesVideoSearch(v, "   ")).toBe(true);
  });

  it("says Long-form or Short from the destination, and names a retired Instagram card", () => {
    expect(videoFormat({ brand: "YT", content_type: "short" })).toBe("Long-form");
    expect(videoFormat({ brand: "SH", content_type: "long" })).toBe("Long-form");
    expect(videoFormat({ brand: "SH", content_type: "vlog" })).toBe("Short");
    expect(videoFormat({ brand: "IMS", content_type: "short" })).toBe("Instagram (retired)");
  });
});

describe("Sam's board on Oct 31", () => {
  // 31 ideas, 1 picked to film with no shot list yet, 2 marked posted with no live link. Nothing in editing,
  // nothing ready, nothing published with a link.
  const sams = (): BoardVideo[] => [
    ...Array.from({ length: 31 }, (_, i) => video({ status: "idea", title: `Idea ${i + 1}`, record_script: i < 18 ? pack(0, 5) : "", sort: 400 - i })),
    video({ status: "record", title: "How I'd make your first $10K in the next 90 days starting with nothing", brand: "YT", content_type: "long", day: 2, planned_week: "2026-10-05" }),
    video({ status: "posted", title: "A Weekend In My Life at 20 - Arizona", brand: "YT" }),
    video({ status: "posted", title: "Day in My Life Running a $1.4M Agency at 20", brand: "YT" }),
  ];

  it("shows Ideas 31, To film 1, To edit 0, To post 2, and opens on the three in progress", () => {
    const counts = videoListCounts(sams());
    expect([counts.ideas, counts.film, counts.edit, counts.post]).toEqual([31, 1, 0, 2]);
    expect(counts.working).toBe(3);
    expect(counts.published).toBe(0);
    expect(counts.everyone).toBe(34);
    expect(defaultVideoList(counts)).toBe("working");
  });

  it("puts the video picked to film up next, and its next step is the shot list", () => {
    const rows = videoListRows(sams(), "working", new Date("2026-10-31T19:00:00Z"));
    const up = videoUpNext(rows)!;
    expect(up.title).toMatch(/first \$10K/);
    expect(videoNextStep(up, { isAdmin: true, now: new Date("2026-10-31T19:00:00Z") })).toMatchObject({ kind: "write", label: "Write shot list" });
    expect(rows.slice(1).map((v) => videoStep(v, NOW).label)).toEqual(["Published, no link", "Published, no link"]);
  });
});
