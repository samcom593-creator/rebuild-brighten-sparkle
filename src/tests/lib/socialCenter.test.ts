import { describe, expect, it } from "vitest";
import { blockerMatchesAccount, draftState, hasPostizId, isSocialView, publishedSource, type DraftLike } from "@/lib/socialCenter";

const base: DraftLike = { status: "approved", draft_date: "2026-11-13", slot: "12:00", platform: "youtube", account: "youtube", postiz_post_id: null };
const TODAY = "2026-11-12";

describe("draftState", () => {
  it("approved is not scheduled without a real Postiz id", () => {
    expect(draftState(base, TODAY, false)).toMatchObject({ label: "Approved, post it by hand", scheduled: false });
    expect(draftState(base, TODAY, true)).toMatchObject({ label: "Approved, not scheduled", scheduled: false });
    expect(draftState({ ...base, postiz_post_id: "pending" }, TODAY, true).scheduled).toBe(false);
    expect(draftState({ ...base, postiz_post_id: "pz_123" }, TODAY, true)).toMatchObject({ label: "Scheduled in Postiz", scheduled: true });
  });
  it("an approved draft past its day stays visible as missed, even when Postiz holds it", () => {
    expect(draftState({ ...base, draft_date: "2026-11-10" }, TODAY, false)).toMatchObject({ label: "Missed its slot", tone: "hot", missed: true });
    expect(draftState({ ...base, draft_date: "2026-11-10", postiz_post_id: "pz_1" }, TODAY, true).missed).toBe(true);
    expect(draftState({ ...base, draft_date: TODAY }, TODAY, false).missed).toBe(false);
  });
  it("scheduled is not published; only shipped is", () => {
    expect(draftState({ ...base, postiz_post_id: "pz_1" }, TODAY, true).label).not.toBe("Published");
    expect(draftState({ ...base, status: "shipped" }, TODAY, true).label).toBe("Published");
    expect(publishedSource({ ship_source: "postiz" })).toBe("Confirmed by Postiz");
    expect(publishedSource({ ship_source: "manual" })).toBe("Link added by hand");
  });
  it("helpers", () => {
    expect(hasPostizId({ postiz_post_id: " " })).toBe(false);
    expect(isSocialView("published")).toBe(true);
    expect(isSocialView("engine")).toBe(false);
  });
});

describe("blockerMatchesAccount", () => {
  const yt = { title: "YouTube OAuth expired" };
  const generic = { title: "Postiz key missing", fix_action: "Add POSTIZ_API_KEY" };
  it("All accounts shows every blocker", () => {
    expect(blockerMatchesAccount(yt, "all")).toBe(true);
  });
  it("a selected account hides a blocker that names a different platform and keeps one that names none", () => {
    expect(blockerMatchesAccount(yt, "youtube")).toBe(true);
    expect(blockerMatchesAccount(yt, "instagram")).toBe(false);
    expect(blockerMatchesAccount(generic, "instagram")).toBe(true);
  });
});
