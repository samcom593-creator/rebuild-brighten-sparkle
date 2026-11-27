import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { approveSocialDraftReview, safeContentUrl, verifyReviewedDraft } from "@/lib/socialDraftReview";
import { reviewContentQueue } from "@/lib/contentQueueReview";
import { parseSnapshotNumber, snapshotAccounts, snapshotObservation, snapshotWindow, socialProfileUrl, type SocialSnapshot } from "@/lib/socialSnapshots";

const reviewed = { id: 1, title: "Title", hook: null, body: "Full body", caption: null, cta: null, hashtags: null, platform: "tiktok", account: "account", file_path: null, status: "awaiting_approval", content_hash: "a".repeat(32), approved_content_hash: null, shipped_at: null, shipped_url: null };
const snapshot = (over: Partial<SocialSnapshot> = {}): SocialSnapshot => ({ platform: "instagram", handle: "actual_account", followers: 10, following: null, posts_total: null, engagement_rate: null, growth_7d: null, views_7d: 100, reach_7d: null, source: "import", taken_at: "2026-11-01T12:00:00Z", ...over });
const rpc = vi.mocked(supabase.rpc as unknown as (name: string, args: unknown) => Promise<{ data: unknown; error: null }>);

beforeEach(() => rpc.mockReset());

describe("versioned review receipts", () => {
  it("rejects incomplete, mismatched or unversioned review payloads", () => {
    expect(verifyReviewedDraft(reviewed, 1)).toEqual(reviewed);
    for (const payload of [null, { ...reviewed, id: 2 }, { ...reviewed, content_hash: null }, { ...reviewed, body: undefined }]) expect(() => verifyReviewedDraft(payload, 1)).toThrow();
  });
  it("keeps owner approval on the established hash-bound RPC", async () => {
    rpc.mockResolvedValue({ data: "approved", error: null });
    await approveSocialDraftReview(reviewed, true);
    expect(rpc).toHaveBeenCalledWith("approve_social_draft", { p_id: 1, p_seen_hash: "a".repeat(32) });
  });
  it.each([null, true, "changed", "already_handled", "not_found"])("rejects absent or conflict queue write receipts: %s", async data => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(reviewContentQueue("clip-1", "2026-11-01T12:00:00Z", "APPROVED")).rejects.toThrow();
  });
  it("submits the viewed timestamp and accepts only the requested queue result", async () => {
    rpc.mockResolvedValue({ data: "APPROVED", error: null });
    await reviewContentQueue("clip-1", "2026-11-01T12:00:00Z", "APPROVED");
    expect(rpc).toHaveBeenCalledWith("content_queue_review_set_status", { p_content_id: "clip-1", p_seen_updated_at: "2026-11-01T12:00:00Z", p_status: "APPROVED" });
  });
  it("never exposes local file, credential-bearing or executable source links", () => {
    for (const url of ["file:///Users/sam/file.mp4", "javascript:alert(1)", "https://user:pass@example.com/media", "http://example.com"]) expect(safeContentUrl(url)).toBeNull();
    expect(safeContentUrl("https://example.com/media")).toBe("https://example.com/media");
  });
});

describe("truthful social observations", () => {
  it("uses each actual account and its latest observation", () => {
    const old = snapshot({ handle: "@Account", taken_at: "2026-11-01T00:00:00Z" });
    const recent = snapshot({ handle: "account", taken_at: "2026-11-02T00:00:00Z" });
    const other = snapshot({ handle: "other" });
    expect(snapshotAccounts([old, other, recent, snapshot({ handle: "", platform: "instagram" })], "instagram")).toEqual([recent, other]);
    expect(socialProfileUrl("instagram", recent.handle)).toBe("https://www.instagram.com/account/");
    expect(socialProfileUrl("instagram", "https://other.example/path")).toBeNull();
  });
  it("shows recorded source, observation age and the actual reported window", () => {
    expect(snapshotObservation(snapshot(), Date.parse("2026-11-27T12:00:00Z"))).toMatch(/Imported observation.*Nov 1, 2026.*older than 24 hours/);
    expect(snapshotObservation(snapshot({ source: "manual" }), Date.parse("2026-11-27T12:00:00Z"))).toMatch(/^Manual entry/);
    expect(snapshotObservation(snapshot({ taken_at: "invalid" }))).toBe("Observation time unavailable");
    expect(snapshotWindow(snapshot({ payload: { window_days: 30 } }))).toBe(30);
    expect(snapshotWindow(snapshot())).toBe(7);
  });
  it("keeps blanks unknown, permits negative growth and rejects invalid counts", () => {
    expect(parseSnapshotNumber("", "Followers")).toBeNull();
    expect(parseSnapshotNumber("1,200", "Followers")).toBe(1200);
    expect(parseSnapshotNumber("-5", "Growth", true)).toBe(-5);
    for (const input of ["-2", "1.5", "NaN", "Infinity"]) expect(() => parseSnapshotNumber(input, "Followers")).toThrow();
    expect(() => parseSnapshotNumber("101", "Engagement", false, true)).toThrow();
  });
});
