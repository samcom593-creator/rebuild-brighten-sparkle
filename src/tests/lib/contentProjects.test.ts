import { beforeEach, describe, expect, it } from "vitest";
import { BANK_IDEAS } from "@/data/contentIdeaBank";
import { parsePack } from "@/lib/contentFilmingPack";
import { createProjectFromIdea, createRemake, dismissIdea, loadDismissals, saveIdeaForLater, savePack, undoDismissal, type CreateContext, type ProjectCard } from "@/lib/contentProjects";
import { remakeDraft, type Winner } from "@/lib/contentWinners";
import { fakeContentDb } from "../helpers/fakeContentDb";

const idea = BANK_IDEAS[0];
const ctx = (db: ReturnType<typeof fakeContentDb>, over: Partial<CreateContext> = {}): CreateContext => ({
  live: db.cards().filter((c) => !c.archived_at) as ProjectCard[], archived: db.cards().filter((c) => c.archived_at) as ProjectCard[], weekday: 5, plannedWeek: "2026-10-05", ...over,
});
let db: ReturnType<typeof fakeContentDb>;
beforeEach(() => { db = fakeContentDb(); });

describe("choosing an idea saves one persistent project", () => {
  it("creates a project in the Record stage with the brief, the idea key and a filming pack", async () => {
    const r = await createProjectFromIdea(db, idea, undefined, ctx(db));
    expect(r.ok && r.created).toBe(true);
    const row = db.cards()[0];
    expect(row).toMatchObject({ title: idea.title, status: "record", brand: "YT", content_type: "long", day: 5, planned_week: "2026-10-05", hook: idea.hook });
    expect(row.brief).toMatchObject({ idea_key: idea.key, source: "bank", lane: "gym", premise: idea.premise, payoff: idea.payoff, effort_minutes: 120 });
    expect(parsePack(row.record_script).total).toBeGreaterThan(5);
    expect(row.brief.edited).toBeUndefined();
    expect(row.due_date).toBeNull(); // a date column: an empty string here once made every pick fail with a 400
  });
  it("keeps the edits made before choosing, marks the brief as edited, and keeps the idea's identity", async () => {
    await createProjectFromIdea(db, idea, { title: "My version", hook: "My own opening" }, ctx(db));
    const row = db.cards()[0];
    expect(row.title).toBe("My version");
    expect(row.hook).toBe("My own opening");
    expect(row.record_script).toContain('Open on the hook: "My own opening"');
    expect(row.brief).toMatchObject({ idea_key: idea.key, edited: true });
  });
  it("choosing the same idea again opens the existing project instead of creating a second", async () => {
    await createProjectFromIdea(db, idea, undefined, ctx(db));
    const again = await createProjectFromIdea(db, idea, undefined, ctx(db));
    expect(again.ok && again.created).toBe(false);
    expect(db.cards()).toHaveLength(1);
  });
  it("two taps, tabs or devices at the same moment still make exactly one project", async () => {
    const stale = ctx(db); // both callers read the board before either saved
    const [a, b] = await Promise.all([createProjectFromIdea(db, idea, undefined, stale), createProjectFromIdea(db, idea, undefined, stale)]);
    expect(db.cards()).toHaveLength(1);
    expect(a.ok && b.ok).toBe(true);
    const created = [a, b].filter((r) => r.ok && r.created).length;
    expect(created).toBe(1);
    expect(a.card?.id).toBe(b.card?.id); // the loser was handed the winner's project
  });
  it("matches an old card by exact title when it has no key, so a legacy card is never duplicated", async () => {
    db = fakeContentDb({ cards: [{ id: "old", title: idea.title.toUpperCase(), status: "record", brief: {}, archived_at: null }] });
    const r = await createProjectFromIdea(db, idea, undefined, ctx(db));
    expect(r.ok && r.created).toBe(false);
    expect(db.cards()).toHaveLength(1);
  });
  it("choosing an idea that already exists at the Idea stage moves it to Record and keeps what it had", async () => {
    db = fakeContentDb({ cards: [{ id: "old", title: idea.title, status: "idea", brief: {}, archived_at: null, record_script: "my own notes" }] });
    const r = await createProjectFromIdea(db, idea, undefined, ctx(db));
    expect(r.ok && r.created).toBe(false);
    expect(db.cards()).toHaveLength(1);
    expect(db.cards()[0]).toMatchObject({ status: "record", record_script: "my own notes", day: 5, planned_week: "2026-10-05" });
  });
  it("restores an archived project instead of creating a new one, and keeps its work", async () => {
    db = fakeContentDb({ cards: [{ id: "arch", title: idea.title, status: "idea", brief: { idea_key: idea.key }, archived_at: "2026-10-01T00:00:00Z", record_script: "" }] });
    const r = await createProjectFromIdea(db, idea, undefined, ctx(db));
    expect(r.ok && r.restored).toBe(true);
    expect(db.cards()).toHaveLength(1);
    expect(db.cards()[0]).toMatchObject({ id: "arch", archived_at: null, status: "record" });
    expect(parsePack(db.cards()[0].record_script).total).toBeGreaterThan(0);
  });
  it("a save that fails is reported as a failure and creates nothing", async () => {
    db.failures.push({ table: "content_cards", op: "insert", error: { message: "permission denied" } });
    const r = await createProjectFromIdea(db, idea, undefined, ctx(db));
    expect(r).toMatchObject({ ok: false, error: "permission denied", card: null });
    expect(db.cards()).toHaveLength(0);
  });
  it("saving for later makes an Idea-stage project with the brief and no pack, once", async () => {
    const r = await saveIdeaForLater(db, idea, ctx(db));
    expect(r.ok && r.created).toBe(true);
    expect(db.cards()[0]).toMatchObject({ status: "idea", record_script: "" });
    const again = await saveIdeaForLater(db, idea, ctx(db));
    expect(again.ok && again.created).toBe(false);
    expect(db.cards()).toHaveLength(1);
  });
});

describe("dismissing and bringing back", () => {
  it("dismisses with an optional reason, trimmed and capped, and never touches a card", async () => {
    await createProjectFromIdea(db, BANK_IDEAS[1], undefined, ctx(db));
    const r = await dismissIdea(db, idea, `  not my lane ${"x".repeat(400)}`);
    expect(r).toMatchObject({ ok: true, alreadyDismissed: false });
    expect(db.dismissals()[0].reason.length).toBe(300);
    expect(db.dismissals()[0].reason.startsWith("not my lane")).toBe(true);
    expect(db.cards()).toHaveLength(1);
    await dismissIdea(db, BANK_IDEAS[2]);
    expect(db.dismissals()[1].reason).toBeNull();
  });
  it("a double tap on Not for me is already done, not an error", async () => {
    await dismissIdea(db, idea);
    expect(await dismissIdea(db, idea)).toMatchObject({ ok: true, alreadyDismissed: true });
    expect(db.dismissals()).toHaveLength(1);
  });
  it("Undo deletes exactly that dismissal and no project", async () => {
    await createProjectFromIdea(db, BANK_IDEAS[1], undefined, ctx(db));
    await dismissIdea(db, idea, "later");
    await dismissIdea(db, BANK_IDEAS[2], "no");
    expect(await undoDismissal(db, idea.key)).toMatchObject({ ok: true });
    expect(db.dismissals().map((d) => d.idea_key)).toEqual([BANK_IDEAS[2].key]);
    expect(db.cards()).toHaveLength(1);
  });
  it("reports a failed dismissal, a failed undo and a failed load as failures", async () => {
    db.failures.push({ table: "content_idea_dismissals", op: "insert", error: { message: "no access" } });
    expect(await dismissIdea(db, idea)).toMatchObject({ ok: false, error: "no access" });
    db.failures.push({ table: "content_idea_dismissals", op: "delete", error: { message: "no access" } });
    expect(await undoDismissal(db, idea.key)).toMatchObject({ ok: false, error: "no access" });
    db.failures.push({ table: "content_idea_dismissals", op: "select", error: { message: "down" } });
    expect(await loadDismissals(db)).toMatchObject({ ok: false, error: "down", rows: [] });
  });
  it("loads the dismissals that exist", async () => {
    await dismissIdea(db, idea, "later");
    const r = await loadDismissals(db);
    expect(r.rows.map((x) => [x.idea_key, x.reason])).toEqual([[idea.key, "later"]]);
  });
});

describe("saving the filming pack", () => {
  it("stores the text and returns the row the database now holds", async () => {
    await createProjectFromIdea(db, idea, undefined, ctx(db));
    const r = await savePack(db, db.cards()[0].id, "FILM: edited\n- [x] 1. done");
    expect(r.ok).toBe(true);
    expect(r.card?.record_script).toBe("FILM: edited\n- [x] 1. done");
    expect(db.cards()[0].record_script).toBe("FILM: edited\n- [x] 1. done");
  });
  it("a failed save leaves the stored pack exactly as it was and says so", async () => {
    await createProjectFromIdea(db, idea, undefined, ctx(db));
    const before = db.cards()[0].record_script;
    db.failures.push({ table: "content_cards", op: "update", error: { message: "offline" } });
    expect(await savePack(db, db.cards()[0].id, "changed")).toMatchObject({ ok: false, error: "offline" });
    expect(db.cards()[0].record_script).toBe(before);
  });
  it("a save that matched no row (deleted or no access) is a failure, never a silent success", async () => {
    const r = await savePack(db, "does-not-exist", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not saved/i);
  });
});

describe("remakes", () => {
  const winner: Winner = {
    post: { id: 321, platform: "youtube", account: "Samuel James", format: "short", title: "Why I stopped waiting", url: "https://youtu.be/abc12345XY", posted_at: "2026-09-25T00:00:00Z", views: 5000, external_id: "abc12345XY" },
    ratio: 4.9, baseline: 1025, sample: 6, ageDays: 10, group: "youtube|Samuel James|short", basis: "x",
  };
  it("creates a linked Idea-stage draft with the hypothesis, and leaves the original untouched", async () => {
    const original = { id: "orig", title: "Why I stopped waiting", status: "published", published_url: "https://youtu.be/abc12345XY", brief: {}, archived_at: null, record_script: "original script" };
    db = fakeContentDb({ cards: [original] });
    const draft = remakeDraft(winner, "experiment", "hook", "2026-10-09T19:00:00Z");
    const r = await createRemake(db, draft, ctx(db));
    expect(r.ok && r.created).toBe(true);
    const row = db.cards().find((c) => c.id !== "orig")!;
    expect(row).toMatchObject({ status: "idea", title: draft.title, hook: "" });
    expect(row.brief).toMatchObject({ source: "remake", variation: "experiment", change: "hook", remake_of: { post_id: 321, views: 5000 } });
    expect(row.record_script).toContain("WHY THIS REMAKE");
    expect(row.record_script).toContain(draft.hypothesis);
    expect(db.cards().find((c) => c.id === "orig")).toEqual(original);
  });
  it("asking for the same remake twice, even at once, opens the first instead of making a second", async () => {
    const draft = remakeDraft(winner, "sequel", "example", "t");
    const stale = ctx(db);
    const [a, b] = await Promise.all([createRemake(db, draft, stale), createRemake(db, draft, stale)]);
    expect(db.cards()).toHaveLength(1);
    expect(a.ok && b.ok).toBe(true);
    const third = await createRemake(db, draft, ctx(db));
    expect(third.ok && third.created).toBe(false);
  });
  it("a different choice for the same winner is a different draft", async () => {
    await createRemake(db, remakeDraft(winner, "sequel", "example", "t"), ctx(db));
    await createRemake(db, remakeDraft(winner, "sequel", "format", "t"), ctx(db));
    expect(db.cards()).toHaveLength(2);
  });
  it("a failed remake save is a failure and creates nothing", async () => {
    db.failures.push({ table: "content_cards", op: "insert", error: { message: "denied" } });
    expect(await createRemake(db, remakeDraft(winner, "sequel", "hook", "t"), ctx(db))).toMatchObject({ ok: false, error: "denied" });
    expect(db.cards()).toHaveLength(0);
  });
});
