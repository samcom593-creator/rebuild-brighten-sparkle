import { describe, expect, it } from "vitest";
import {
  STAGE_LABEL, STORED_STATUSES, canWriteStatus, checkPublishUrl, fourQuestions, hasPublishEvidence, isLivePostUrl, nextAction,
  nextStatus, phoenixDate, phoenixWeekday, platformOf, previousStatus, scheduleLabel, stageOf, todayQueue, type WorkflowCard,
} from "@/lib/contentWorkflow";

const card = (over: Partial<WorkflowCard> = {}): WorkflowCard => ({ id: Math.random().toString(36).slice(2), title: "Synthetic card", status: "idea", ...over });
const LIVE = "https://www.youtube.com/shorts/abc123XYZ";

describe("status mapping", () => {
  it("maps every stored status, legacy included, onto the seven-stage workflow", () => {
    expect(stageOf(card({ status: "idea" }))).toBe("idea");
    expect(stageOf(card({ status: "record" }))).toBe("record");
    expect(stageOf(card({ status: "edit" }))).toBe("edit");
    expect(stageOf(card({ status: "review" }))).toBe("review");
    expect(stageOf(card({ status: "ready" }))).toBe("ready");
    expect(stageOf(card({ status: "scheduled" }))).toBe("scheduled");
    expect(stageOf(card({ status: "recorded" }))).toBe("edit");
  });
  it("legacy 'posted' is Published only with evidence, otherwise Published (unconfirmed)", () => {
    expect(stageOf(card({ status: "posted" }))).toBe("published_unconfirmed");
    expect(STAGE_LABEL[stageOf(card({ status: "posted" }))]).toBe("Published (unconfirmed)");
    expect(stageOf(card({ status: "posted", published_url: LIVE }))).toBe("published_unconfirmed");
    expect(stageOf(card({ status: "posted", published_url: LIVE, publish_evidence: "manual_confirmation" }))).toBe("published");
  });
  it("a stored 'published' without evidence is never shown as Published", () => {
    expect(stageOf(card({ status: "published" }))).toBe("published_unconfirmed");
    expect(stageOf(card({ status: "published", published_url: "https://www.youtube.com/", publish_evidence: "manual_confirmation" }))).toBe("published_unconfirmed");
    expect(stageOf(card({ status: "published", published_url: LIVE, publish_evidence: "provider" }))).toBe("published");
  });
  it("unknown values fall back to Idea, never to Published", () => {
    expect(stageOf(card({ status: "LIVE" }))).toBe("idea");
    expect(stageOf(card({ status: "" }))).toBe("idea");
  });
  it("walks forward Idea → Record → Edit → Review → Ready → Scheduled → Published and back", () => {
    expect(nextStatus("idea")).toBe("record");
    expect(nextStatus("record")).toBe("edit");
    expect(nextStatus("edit")).toBe("review");
    expect(nextStatus("review")).toBe("ready");
    expect(nextStatus("ready")).toBe("scheduled");
    expect(nextStatus("scheduled")).toBe("published");
    expect(nextStatus("published_unconfirmed")).toBe("published");
    expect(nextStatus("published")).toBeNull();
    expect(previousStatus("idea")).toBeNull();
    expect(previousStatus("ready")).toBe("edit");
    expect(previousStatus("published")).toBe("ready");
  });
  it("only pre-approval stages are plain writes; legacy values are never written", () => {
    expect(["idea", "record", "edit", "review"].every(canWriteStatus)).toBe(true);
    expect(["ready", "scheduled", "published", "recorded", "posted"].some(canWriteStatus)).toBe(false);
    // Must match the widened CHECK in supabase/migrations/20261006150000_launch_board_workflow.sql.
    expect(STORED_STATUSES).toEqual(["idea", "record", "edit", "review", "ready", "scheduled", "published", "recorded", "posted"]);
  });
});

describe("publish evidence rule", () => {
  it("accepts https post URLs on known platform domains", () => {
    for (const u of [LIVE, "https://youtu.be/abc", "https://www.tiktok.com/@sam/video/123", "https://m.youtube.com/watch?v=abc", "https://www.instagram.com/reel/XYZ/", "https://x.com/sam/status/1"]) {
      expect(checkPublishUrl(u, "SH").ok, u).toBe(true);
    }
  });
  it("refuses empty, http, unknown hosts, look-alike hosts and bare home pages", () => {
    const bad = ["", "   ", "http://www.youtube.com/watch?v=abc", "https://evil.example.com/youtube.com/x", "https://youtube.com.evil.com/x",
      "https://www.youtube.com/", "https://www.youtube.com", "https://user@youtube.com/x", "https://youtube.com:8443/x", "ftp://youtube.com/x", "youtube.com/watch?v=1", "https://dropbox.com/s/clip.mp4"];
    for (const u of bad) {
      const r = checkPublishUrl(u, "SH");
      expect(r.ok, u).toBe(false);
      expect(r.reason, u).toBeTruthy();
    }
  });
  it("names the platform and warns (not refuses) when it differs from the destination", () => {
    const r = checkPublishUrl("https://www.tiktok.com/@sam/video/1", "SH");
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("TikTok");
    expect(r.warning).toMatch(/YouTube/);
    expect(checkPublishUrl(LIVE, "SH").warning).toBeNull();
  });
  it("hasPublishEvidence needs BOTH an evidence kind and a live post URL", () => {
    expect(hasPublishEvidence({ published_url: LIVE, publish_evidence: null })).toBe(false);
    expect(hasPublishEvidence({ published_url: null, publish_evidence: "manual_confirmation" })).toBe(false);
    expect(hasPublishEvidence({ published_url: LIVE, publish_evidence: "copied_caption" })).toBe(false);
    expect(hasPublishEvidence({ published_url: LIVE, publish_evidence: "manual_confirmation" })).toBe(true);
  });
  it("platformOf / isLivePostUrl agree with the SQL rule shape", () => {
    expect(platformOf("https://www.youtube.com/watch?v=1")).toBe("YouTube");
    expect(platformOf("https://www.youtube.com?v=1")).toBeNull();
    expect(isLivePostUrl("https://www.youtube.com/")).toBe(false);
    expect(isLivePostUrl("https://www.youtube.com//")).toBe(false);
    expect(isLivePostUrl("https://www.youtube.com/@sam")).toBe(true);
  });
});

describe("scheduling honesty", () => {
  it("a time without a job reference is a Manual plan", () => {
    expect(scheduleLabel({ scheduled_for: "2026-10-07T17:00:00Z", schedule_kind: "manual" })).toEqual({ label: "Manual plan", isJob: false });
    expect(scheduleLabel({ scheduled_for: "2026-10-07T17:00:00Z", schedule_kind: "job", schedule_job_ref: "" })).toEqual({ label: "Manual plan", isJob: false });
    expect(scheduleLabel({ scheduled_for: "2026-10-07T17:00:00Z", schedule_kind: "job", schedule_job_ref: "metricool:123" })).toEqual({ label: "Scheduled job", isJob: true });
    expect(scheduleLabel({ scheduled_for: null })).toBeNull();
  });
});

describe("next action", () => {
  it("asks for what is missing, in order", () => {
    expect(nextAction(card({ status: "idea" }))).toBe("Write the hook");
    expect(nextAction(card({ status: "idea", hook: "h" }))).toBe("Write the shot list");
    expect(nextAction(card({ status: "recorded" }))).toBe("Attach the source footage");
    expect(nextAction(card({ status: "edit", clip: "Reels/a.mp4" }))).toBe("Write the edit instructions");
    expect(nextAction(card({ status: "edit", clip: "Reels/a.mp4", edit_prompt: "cut" }))).toBe("Write the caption");
    expect(nextAction(card({ status: "posted" }))).toBe("Add the live URL to confirm it was published");
    expect(nextAction(card({ status: "published", published_url: LIVE, publish_evidence: "manual_confirmation" }))).toBe("Done");
  });
});

describe("Today queue + four questions", () => {
  // 2026-10-06 18:00 UTC = 11:00 Tuesday in Phoenix.
  const now = new Date("2026-10-06T18:00:00Z");
  it("uses America/Phoenix for today and the weekday", () => {
    expect(phoenixDate(new Date("2026-10-07T05:30:00Z"))).toBe("2026-10-06");   // 22:30 Phoenix, still the 6th
    expect(phoenixWeekday(now)).toBe(2);
  });
  it("caps at 7, puts overdue first, never lists confirmed Published, and lists unconfirmed", () => {
    const cards = [
      card({ title: "pub", status: "published", published_url: LIVE, publish_evidence: "manual_confirmation" }),
      card({ title: "legacy posted", status: "posted" }),
      card({ title: "overdue idea", status: "idea", due_date: "2026-10-01" }),
      card({ title: "ready", status: "ready" }),
      card({ title: "review", status: "review" }),
      card({ title: "sched today", status: "scheduled", scheduled_for: "2026-10-06T23:00:00Z", schedule_kind: "manual" }),
      card({ title: "edit with clip", status: "edit", clip: "a" }),
      card({ title: "record", status: "record" }),
      card({ title: "today slot idea", status: "idea", day: 2 }),
      card({ title: "other idea", status: "idea", day: 5 }),
      card({ title: "edit no clip", status: "edit" }),
    ];
    const q = todayQueue(cards, now);
    expect(q.length).toBe(7);
    expect(q[0].card.title).toBe("overdue idea");
    expect(q[1].card.title).toBe("sched today");
    expect(q.map((t) => t.card.title)).not.toContain("pub");
    expect(q.map((t) => t.card.title)).not.toContain("other idea");
    expect(todayQueue(cards, now, 20).map((t) => t.card.title)).toContain("legacy posted");
  });
  it("answers the four questions from the same mapping", () => {
    const cards = [
      card({ status: "idea" }), card({ status: "record" }), card({ status: "recorded" }), card({ status: "edit" }),
      card({ status: "review" }), card({ status: "ready" }), card({ status: "scheduled", scheduled_for: "2026-10-07T00:00:00Z", schedule_kind: "manual" }),
      card({ status: "posted" }), card({ status: "published", published_url: LIVE, publish_evidence: "manual_confirmation" }),
    ];
    const f = fourQuestions(cards);
    expect(f.recordNext).toHaveLength(2);
    expect(f.needsEditing).toHaveLength(2);
    expect(f.awaitingApproval).toHaveLength(1);
    expect(f.readyToPublish).toHaveLength(2);
    expect(f.published).toHaveLength(1);
    expect(f.unconfirmed).toHaveLength(1);
  });
});
