import { describe, expect, it } from "vitest";
import {
  BUCKET_HINT, BUCKET_LABEL, BUCKET_ORDER, BUCKET_TONE, LANE_TONE, bucketCounts, filterInbox, groupDrafts, laneLink, laneStatus, laneVerdictLabel, poolSummary,
  profileHref, replyRate, replyRateTone, silentFor, sortLanes,
  type Bucket, type DraftRow, type FunnelRow, type InboxRow, type LaneRow,
} from "@/lib/socialCommand";
import { inboxBucketTone, laneTone, tonePill } from "@/lib/tones";

let n = 0;
const row = (over: Partial<InboxRow>): InboxRow => ({
  source: "instagram", sender_handle: `person${++n}`, sender_name: null, avatar: null,
  last_in: "2026-10-27T20:00:00Z", last_out: null, inbound_count: 1, last_intent: "casual", sam_touched: false,
  last_text: "yo", application_id: null, lead_score: null, media_id: null, waiting_on_us: true, bucket: "waiting",
  application_status: null, application_license: null, ...over,
});

describe("social command center: who gets worked first", () => {
  it("orders hot, then Sam's threads, then waiting, and hides silent-by-design from 'all'", () => {
    const rows = [
      row({ bucket: "answered", last_in: "2026-10-27T23:00:00Z" }),
      row({ bucket: "silent", last_intent: "flirty" }),
      row({ bucket: "waiting", last_in: "2026-10-27T10:00:00Z" }),
      row({ bucket: "hot", last_intent: "licensed", last_in: "2026-10-26T10:00:00Z" }),
      row({ bucket: "human_lane", sam_touched: true }),
    ];
    const out = filterInbox(rows, "all", "all", "");
    expect(out.map((r) => r.bucket)).toEqual(["hot", "human_lane", "waiting", "answered"]);
    expect(filterInbox(rows, "silent", "all", "")).toHaveLength(1);
  });

  it("filters by platform and search across handle, name, text and intent", () => {
    const rows = [
      row({ source: "tiktok", sender_handle: "kadin", last_text: "how do i get licensed" }),
      row({ source: "youtube", sender_handle: "UCabc", sender_name: "Marcus", last_intent: "opportunity" }),
    ];
    expect(filterInbox(rows, "all", "tiktok", "")).toHaveLength(1);
    expect(filterInbox(rows, "all", "all", "licensed")).toHaveLength(1);
    expect(filterInbox(rows, "all", "all", "marcus")).toHaveLength(1);
    expect(filterInbox(rows, "all", "all", "opportunity")[0].sender_handle).toBe("UCabc");
  });

  it("counts buckets and links each platform's profile correctly", () => {
    const rows = [row({ bucket: "hot" }), row({ bucket: "hot" }), row({ bucket: "booked" })];
    expect(bucketCounts(rows)).toMatchObject({ hot: 2, booked: 1, waiting: 0 });
    expect(profileHref(row({ source: "instagram", sender_handle: "@sell4daddy" }))).toBe("https://www.instagram.com/sell4daddy/");
    expect(profileHref(row({ source: "tiktok", sender_handle: "h0ll0wp3arl" }))).toBe("https://www.tiktok.com/@h0ll0wp3arl");
    expect(profileHref(row({ source: "youtube", sender_handle: "UC33uBvetH8gBcSqHVpf3Ayg" }))).toBe("https://www.youtube.com/channel/UC33uBvetH8gBcSqHVpf3Ayg");
    expect(profileHref(row({ source: "snapchat", sender_handle: "x" }))).toBeNull();
  });
});

describe("funnel and lanes", () => {
  it("reply rate is people replied over people who wrote in, null when nobody wrote", () => {
    const f = (people_in: number, people_replied: number): FunnelRow => ({
      platform: "tiktok", posts: 0, views: 0, post_comments: 0, messages_in: 0, people_in, people_replied,
      partials_abandoned: 0, applications: 0, licensed: 0, booked_or_further: 0,
    });
    expect(replyRate(f(566, 65))).toBeCloseTo(0.1148, 3);
    expect(replyRate(f(0, 0))).toBeNull();
  });

  it("dead lanes come first, the YouTube lanes link to the consent page, and status reads plainly", () => {
    const base = { tier: "page" as const, expires_at: null, owner: "x", fix: null, hours_left: null };
    const lanes: LaneRow[] = [
      { ...base, lane: "instagram_comments", tier: "report", last_seen: "2026-10-28T00:00:00Z", verdict: "alive", hours_silent: 3 },
      { ...base, lane: "content_posts_tiktok", tier: "report", last_seen: null, verdict: "never", hours_silent: null },
      { ...base, lane: "youtube_oauth", last_seen: "2026-10-05T02:00:00Z", verdict: "dead", hours_silent: 559, fix: "Open the reconnect link" },
    ];
    expect(sortLanes(lanes).map((l) => l.lane)).toEqual(["youtube_oauth", "instagram_comments", "content_posts_tiktok"]);
    expect(laneLink("youtube_oauth", "https://x/y?k=1")).toBe("https://x/y?k=1");
    expect(laneLink("youtube_oauth", null)).toBeNull();
    expect(laneLink("tiktok_comments_in", "https://x/y?k=1")).toBeNull();
    expect(laneStatus({ verdict: "dead", hours_silent: 559, hours_left: null })).toBe("dead · 23d 7h");
    expect(laneStatus({ verdict: "alive", hours_silent: 3, hours_left: null })).toBe("ok · 3h ago");
    expect(laneStatus({ verdict: "alive", hours_silent: null, hours_left: 985 })).toBe("ok · expires in 41d");
    expect(laneStatus({ verdict: "dead", hours_silent: null, hours_left: 100 })).toBe("dead · expires in 4d");
    expect(laneStatus({ verdict: "dead", hours_silent: null, hours_left: -5 })).toBe("dead · token expired");
    expect(laneStatus({ verdict: "never", hours_silent: null, hours_left: null })).toBe("never built");
    expect(silentFor(null, "never")).toBe("never");
  });

  it("groups drafts by platform, biggest queue first", () => {
    const d = (platform: string): DraftRow => ({
      id: ++n, draft_date: null, platform, slot: null, pillar: null, title: "t", hook: null, cta: null, status: "awaiting_approval",
      approved_at: null, shipped_at: null, notes: null, created_at: "2026-10-27T00:00:00Z",
    });
    const g = groupDrafts([d("tiktok"), d("yt"), d("tiktok"), d("instagram"), d("tt"), d("youtube"), d("snap")]);
    expect(g.map((x) => [x.platform, x.drafts.length])).toEqual([["tiktok", 3], ["youtube", 2], ["instagram", 1], ["snapchat", 1]]);
  });
});

describe("colour comes from the shared tones (2026-10-28 colour layer)", () => {
  it("every bucket pill and lane pill is the shared tone's pill, never a colour picked by hand", () => {
    for (const b of BUCKET_ORDER) expect(BUCKET_TONE[b]).toBe(tonePill(inboxBucketTone(b)));
    expect(BUCKET_TONE.hot).toContain("text-tone-hot");
    expect(BUCKET_TONE.human_lane).toContain("text-tone-gold");
    expect(BUCKET_TONE.waiting).toContain("text-tone-warm");
    expect(BUCKET_TONE.booked).toContain("text-tone-cool");
    expect(BUCKET_TONE.answered).toContain("text-tone-slate");
    for (const v of ["alive", "dead", "never"] as const) expect(LANE_TONE[v]).toBe(tonePill(laneTone(v)));
    expect(LANE_TONE.dead).toContain("text-tone-hot");
    expect(LANE_TONE.alive).toContain("text-tone-good");
    // No raw palette classes anywhere in either map.
    for (const cls of [...Object.values(BUCKET_TONE), ...Object.values(LANE_TONE)]) expect(cls).not.toMatch(/rose|amber|sky|primary|muted/);
  });

  it("gives every bucket a label and a plain hint, and the verdict a plain word", () => {
    for (const b of BUCKET_ORDER) {
      expect(BUCKET_LABEL[b as Bucket]).toBeTruthy();
      expect(BUCKET_HINT[b as Bucket]).toBeTruthy();
    }
    expect(BUCKET_HINT.hot).toBe("Business intent, nobody answered");
    expect(BUCKET_HINT.human_lane).toBe("Only Sam answers these");
    expect(BUCKET_HINT.waiting).toBe("They wrote, we owe a reply");
    expect(BUCKET_HINT.booked).toBe("Interview on the calendar");
    expect(laneVerdictLabel("alive")).toBe("Alive");
    expect(laneVerdictLabel("dead")).toBe("Dead");
    expect(laneVerdictLabel("never")).toBe("Never built");
  });

  it("reads the reply rate as good from 70%, warm from 50%, hot below, and slate when nobody wrote in", () => {
    expect(replyRateTone({ people_in: 100, people_replied: 70 })).toBe("good");
    expect(replyRateTone({ people_in: 100, people_replied: 69 })).toBe("warm");
    expect(replyRateTone({ people_in: 100, people_replied: 50 })).toBe("warm");
    expect(replyRateTone({ people_in: 100, people_replied: 49 })).toBe("hot");
    expect(replyRateTone({ people_in: 566, people_replied: 65 })).toBe("hot");
    expect(replyRateTone({ people_in: 0, people_replied: 0 })).toBe("slate");
  });
});

describe("call lists", () => {
  it("summarises the two pools in one line each and says nothing when absent", () => {
    const p = poolSummary({ readymode_leads: 664, readymode_licensed: 75, readymode_never_contacted: 2, winback_agents: 66, winback_with_phone: 51, readymode_csv_url: "https://x/csv?list=readymode&k=1", winback_csv_url: null });
    expect(p.readymode).toBe("664 old applicants with a dialable number, 75 already licensed, 2 never called");
    expect(p.winback).toBe("66 former agents worth a call, 51 with a phone on file");
    expect(poolSummary(null)).toEqual({ readymode: "", winback: "" });
  });
});
