import { describe, expect, it } from "vitest";
import { countPieces, piecesByDay } from "@/lib/contentWeek";

// Repurpose posts every Short to each platform. These counts must show pieces, not platform posts.
const p = (posted_at: string, platform: string, format = "short") => ({ posted_at, platform, format });

describe("piece counting", () => {
  const posts = [
    // Tue Oct 6 (Phoenix): 2 Shorts, each on 3 platforms, plus 1 long-form.
    p("2026-10-06T16:00:00Z", "youtube"), p("2026-10-06T16:00:00Z", "instagram"), p("2026-10-06T16:00:00Z", "tiktok"),
    p("2026-10-06T20:00:00Z", "youtube"), p("2026-10-06T20:00:00Z", "instagram"), p("2026-10-06T20:00:00Z", "tiktok"),
    p("2026-10-06T22:00:00Z", "youtube", "long"),
    // 02:00Z on Oct 7 is still Oct 6 in Phoenix (UTC-7).
    p("2026-10-07T02:00:00Z", "youtube"),
    // Mon Oct 5: 1 Short, Instagram only.
    p("2026-10-05T18:00:00Z", "instagram"),
  ];

  it("counts a day's Shorts as its busiest platform, in Phoenix days", () => {
    expect(piecesByDay(posts, "short")).toEqual({ "2026-10-06": 3, "2026-10-05": 1 });
  });

  it("sums pieces across days and keeps formats apart", () => {
    expect(countPieces(posts, "short")).toBe(4);
    expect(countPieces(posts, "long")).toBe(1);
    expect(countPieces([], "short")).toBe(0);
  });
});
