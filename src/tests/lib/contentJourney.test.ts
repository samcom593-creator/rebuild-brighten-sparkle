import { afterEach, describe, expect, it, vi } from "vitest";
import { BANK_IDEAS } from "@/data/contentIdeaBank";
import { parsePack, togglePackItem } from "@/lib/contentFilmingPack";
import { DEFAULT_FILTERS, selectPicks, usedMarkers, type PickFilters } from "@/lib/contentPicks";
import { createProjectFromIdea, createRemake, dismissIdea, loadDismissals, savePack, undoDismissal, type ProjectCard } from "@/lib/contentProjects";
import { lifecycleOf, lifecycleText } from "@/lib/contentWorkflow";
import { measureWinners, remakeDraft, resultsFor, type ResultPost } from "@/lib/contentWinners";
import { fakeContentDb } from "../helpers/fakeContentDb";

/**
 * The whole content journey, through the real logic and a database that enforces the real uniqueness rules:
 *   filter -> choose (with an edit) -> tick the filming pack -> refresh -> publish -> recorded results -> remake a winner.
 * Nothing in it may touch the network or a model.
 */
const NOW = new Date("2026-10-09T19:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000 - 3600_000).toISOString();
const fetchSpy = vi.spyOn(globalThis, "fetch");
afterEach(() => { fetchSpy.mockClear(); });

const shorts = (): ResultPost[] => [900, 950, 1000, 1050, 1100].map((v, i) => ({
  id: 100 + i, platform: "youtube", account: "Samuel James", format: "short", title: `Older Short ${i}`, url: `https://youtu.be/old${i}abcdefg`, posted_at: ago(12 + i), views: v, external_id: `old${i}abcdefg`,
}));

describe("content journey", () => {
  it("filter, choose, edit the pack, refresh, publish, see results, remake the winner", async () => {
    const db = fakeContentDb();
    const ctx = () => ({ live: db.cards().filter((c) => !c.archived_at) as ProjectCard[], archived: db.cards().filter((c) => c.archived_at) as ProjectCard[], weekday: 5, plannedWeek: "2026-10-05" });

    // 1. Filter: a short, mindset idea, 25 minutes or less, filmed in the car.
    const filters: PickFilters = { ...DEFAULT_FILTERS, format: "short", lane: "mindset", minutes: 25, place: "car" };
    const { picks } = selectPicks(BANK_IDEAS, filters, { dismissed: new Set(), used: usedMarkers(db.cards() as never) });
    expect(picks.length).toBeGreaterThan(0);
    const chosen = picks[0];
    expect(chosen.minutes).toBeLessThanOrEqual(25);

    // 2. Choose it with an edit. One project, saved, in the Selected state.
    const created = await createProjectFromIdea(db, chosen, { hook: "My own opening line" }, ctx());
    expect(created.ok && created.created).toBe(true);
    expect(db.cards()).toHaveLength(1);
    const id = created.card!.id;
    expect(lifecycleOf(db.cards()[0] as never)).toBe("selected");
    expect(db.cards()[0].brief).toMatchObject({ idea_key: chosen.key, edited: true, lane: "mindset" });

    // 3. Tick two items in the pack and save each. Then "refresh": read the stored row fresh and parse it.
    let text: string = db.cards()[0].record_script;
    for (const item of parsePack(text).items.slice(0, 2)) {
      text = togglePackItem(text, item.line);
      expect((await savePack(db, id, text)).ok).toBe(true);
    }
    const reloaded = db.cards().find((c) => c.id === id)!;
    expect(parsePack(reloaded.record_script).done).toBe(2);
    expect(reloaded.record_script).toContain('Open on the hook: "My own opening line"');
    expect(lifecycleOf(reloaded as never)).toBe("filming");

    // 4. The same idea cannot be chosen twice, not by a second tap and not from a stale screen on another device.
    const again = await createProjectFromIdea(db, chosen, undefined, { ...ctx(), live: [], archived: [] });
    expect(again.ok && again.created).toBe(false);
    expect(again.card?.id).toBe(id);
    expect(db.cards()).toHaveLength(1);
    expect(selectPicks(BANK_IDEAS, filters, { dismissed: new Set(), used: usedMarkers(db.cards() as never) }).picks.map((p) => p.key)).not.toContain(chosen.key);

    // 5. Publish: the page records the live link and confirmation on the project.
    Object.assign(db.cards()[0], { status: "published", published_url: "https://youtu.be/new12345abc", publish_evidence: "manual_confirmation" });
    expect(lifecycleOf(db.cards()[0] as never)).toBe("published");
    expect(lifecycleText(db.cards()[0] as never)).toBe("Published");

    // 6. Results. Before any are recorded, the project says so; it is never called a winner.
    const baseline = shorts();
    const noResults = resultsFor("https://youtu.be/new12345abc", baseline, measureWinners(baseline, NOW), NOW);
    expect(noResults.state).toBe("none");
    expect(noResults.message).toMatch(/no results recorded/i);
    const withResults: ResultPost[] = [...baseline, { id: 999, platform: "youtube", account: "Samuel James", format: "short", title: chosen.title, url: "https://youtube.com/shorts/new12345abc", posted_at: ago(6), views: 4800, external_id: "new12345abc" }];
    const report = measureWinners(withResults, NOW);
    const measured = resultsFor("https://youtu.be/new12345abc", withResults, report, NOW);
    expect(measured.state).toBe("measured");
    expect(report.winners).toHaveLength(1);
    const winner = report.winners[0];
    expect(winner.post.id).toBe(999);
    expect(winner.ratio).toBeGreaterThanOrEqual(2);
    expect(measured.message).toContain("4,800 views after 6 days");

    // 7. Remake the measured winner. A linked draft appears; the original project and post are untouched.
    const before = JSON.stringify({ card: db.cards()[0], posts: withResults });
    const draft = remakeDraft(winner, "experiment", "hook", NOW.toISOString());
    const remade = await createRemake(db, draft, ctx());
    expect(remade.ok && remade.created).toBe(true);
    expect(db.cards()).toHaveLength(2);
    const remake = db.cards().find((c) => c.id !== id)!;
    expect(remake).toMatchObject({ status: "idea", title: draft.title });
    expect(remake.brief).toMatchObject({ source: "remake", variation: "experiment", change: "hook", remake_of: { post_id: 999, views: 4800 } });
    expect(remake.record_script).toContain(draft.hypothesis);
    expect(JSON.stringify({ card: db.cards()[0], posts: withResults })).toBe(before);

    // 8. Asking for the same remake again, even from a stale screen, opens the first one.
    const dup = await createRemake(db, draft, { ...ctx(), live: [], archived: [] });
    expect(dup.ok && dup.created).toBe(false);
    expect(dup.card?.id).toBe(remake.id);
    expect(db.cards()).toHaveLength(2);

    // 9. None of this used the network or a model.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dismiss with a reason, undo it, and the idea comes back without touching any project", async () => {
    const db = fakeContentDb({ cards: [{ id: "keep", title: "An existing project", status: "record", brief: {}, archived_at: null }] });
    const none = { dismissed: new Set<string>(), used: usedMarkers(db.cards() as never) };
    const first = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks[0];

    expect(await dismissIdea(db, first, "wrong season")).toMatchObject({ ok: true });
    const stored = await loadDismissals(db);
    expect(stored.rows.map((d) => [d.idea_key, d.reason])).toEqual([[first.key, "wrong season"]]);
    const hidden = selectPicks(BANK_IDEAS, DEFAULT_FILTERS, { ...none, dismissed: new Set(stored.rows.map((d) => d.idea_key)) });
    expect(hidden.picks.map((p) => p.key)).not.toContain(first.key);

    expect(await undoDismissal(db, first.key)).toMatchObject({ ok: true });
    const back = await loadDismissals(db);
    expect(back.rows).toEqual([]);
    expect(selectPicks(BANK_IDEAS, DEFAULT_FILTERS, none).picks.map((p) => p.key)).toContain(first.key);
    expect(db.cards()).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a published project whose post has no recorded views is shown as unmeasured, never as a winner", () => {
    const post: ResultPost = { id: 5, platform: "youtube", account: "Samuel James", format: "short", title: "No views yet", url: "https://youtu.be/noviews1234", posted_at: ago(10), views: null, external_id: "noviews1234" };
    const all = [...shorts(), post];
    const r = resultsFor(post.url, all, measureWinners(all, NOW), NOW);
    expect(r.state).toBe("unmeasured");
    expect(r.message).toMatch(/no view count/i);
    expect(measureWinners(all, NOW).winners).toHaveLength(0);
  });

  it("a save that fails mid-journey leaves the stored pack as it was and reports the failure", async () => {
    const db = fakeContentDb();
    const made = await createProjectFromIdea(db, BANK_IDEAS[3], undefined, { live: [], archived: [], weekday: 1, plannedWeek: "2026-10-05" });
    const stored = db.cards()[0].record_script;
    db.failures.push({ table: "content_cards", op: "update", error: { message: "network down" } });
    const r = await savePack(db, made.card!.id, togglePackItem(stored, parsePack(stored).items[0].line));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("network down");
    expect(db.cards()[0].record_script).toBe(stored);
  });
});
