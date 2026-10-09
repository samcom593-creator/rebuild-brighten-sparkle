/**
 * Saving the Launch Board's choices. Every write here goes through one place so the rules hold wherever it is called
 * from:
 *   - One live project per idea. The database enforces it (a unique index on the idea key); this code makes the loser
 *     of a race re-read the winner and open it, rather than showing an error or creating a twin.
 *   - A write that did not land is never reported as saved.
 *   - Dismissing and bringing back an idea only ever touches the dismissal row, never a project.
 *   - A remake creates a new, linked draft and never touches the original post or its numbers.
 *
 * The database client is passed in, so the same code runs against the real client and against a fake in tests.
 */
import { applyEdits, briefFromIdea, findProject, wasEdited, type IdeaEdits, type PickIdea } from "@/lib/contentPicks";
import { buildFilmingPack } from "@/lib/contentFilmingPack";
import type { RemakeDraft } from "@/lib/contentWinners";

// The query builder is deliberately loose: it is the shape of the supabase client, and the tests pass a fake with the
// same chain. Rows are typed where they are used.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type DbClient = { from: (table: string) => any };
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ProjectCard { id: string; title: string; status: string; brief?: Record<string, unknown> | null; archived_at?: string | null; record_script?: string | null }
// Result shapes are flat on purpose: this repo does not compile in strict mode, where a union discriminated on `ok`
// would not narrow. A caller checks `ok`, then reads `error` or `card`.
export interface ProjectResult { ok: boolean; card: ProjectCard | null; created: boolean; restored: boolean; error: string | null }
export interface SimpleResult { ok: boolean; error: string | null }
export interface SaveResult { ok: boolean; card: ProjectCard | null; error: string | null }
export interface DismissResult { ok: boolean; alreadyDismissed: boolean; error: string | null }
export interface DismissalsResult { ok: boolean; rows: Dismissal[]; error: string | null }
const found = (card: ProjectCard, created = false, restored = false): ProjectResult => ({ ok: true, card, created, restored, error: null });
const failed = (error: string): ProjectResult => ({ ok: false, card: null, created: false, restored: false, error });

const UNIQUE_VIOLATION = "23505";
const err = (e: unknown): string => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "save failed").slice(0, 200);
const code = (e: unknown): string | undefined => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : undefined);

export interface CreateContext {
  live: readonly ProjectCard[];
  archived: readonly ProjectCard[];
  /** 1 = Monday ... 7 = Sunday in Phoenix. */
  weekday: number;
  plannedWeek: string;
  /** The card's edit instructions, built from the final title and hook. Optional. */
  editPrompt?: (d: { title: string; hook: string; brand: string; content_type: string }) => string;
}

async function projectByKey(db: DbClient, key: string): Promise<ProjectCard | null> {
  // single-row-allow:content_cards_idea_key_live_uniq-is-a-partial-unique-index-so-at-most-one-live-row-per-key
  const { data, error } = await db.from("content_cards").select("*").filter("brief->>idea_key", "eq", key).is("archived_at", null).maybeSingle();
  if (error || !data) return null;
  return data as ProjectCard;
}

/**
 * Choose an idea: save it as the one live project for that idea and return it. If a project already exists, return it
 * instead (restoring it first if it was archived). Edits made before choosing are kept on the project.
 */
export async function createProjectFromIdea(db: DbClient, idea: PickIdea, edits: IdeaEdits | undefined, ctx: CreateContext): Promise<ProjectResult> {
  const final = applyEdits(idea, edits);
  const existing = findProject(idea, ctx.live, ctx.archived);
  if (existing && !existing.archived) {
    // An idea-stage card that already exists is moved forward to Record when it is chosen, keeping any pack it has.
    if (existing.card.status === "idea") {
      const { data, error } = await db.from("content_cards")
        .update({ status: "record", record_script: existing.card.record_script || buildFilmingPack(final), day: ctx.weekday, planned_week: ctx.plannedWeek })
        .eq("id", existing.card.id).eq("status", "idea").select("*").maybeSingle();
      if (error) return failed(err(error));
      if (data) return found(data as ProjectCard);
      // Someone moved it first: return what is there now.
      const fresh = await db.from("content_cards").select("*").eq("id", existing.card.id).maybeSingle();
      return fresh.data ? found(fresh.data as ProjectCard) : failed("The idea could not be found. Reload the board.");
    }
    return found(existing.card);
  }

  if (existing && existing.archived) {
    const pack = existing.card.record_script || buildFilmingPack(final);
    const { data, error } = await db.from("content_cards")
      .update({ archived_at: null, status: "record", record_script: pack, day: ctx.weekday, planned_week: ctx.plannedWeek })
      .eq("id", existing.card.id).eq("status", "idea").select("*").maybeSingle();
    if (error) {
      if (code(error) === UNIQUE_VIOLATION) { const live = await projectByKey(db, idea.key); if (live) return found(live); }
      return failed(err(error));
    }
    if (!data) return failed("The idea could not be restored. Reload the board.");
    return found(data as ProjectCard, false, true);
  }

  const brand = final.format === "short" ? "SH" : "YT";
  const row = {
    title: final.title, brand, content_type: final.format, job: "REACH", hook: final.hook, caption: "", clip: "", status: "record", day: ctx.weekday,
    planned_week: ctx.plannedWeek, due_date: null as string | null, cta: "", owner: "",
    record_script: buildFilmingPack(final),
    edit_prompt: ctx.editPrompt ? ctx.editPrompt({ title: final.title, hook: final.hook, brand, content_type: final.format }) : "",
    brief: briefFromIdea(idea, wasEdited(idea, final)),
  };
  const { data, error } = await db.from("content_cards").insert(row).select("*").single();
  if (error) {
    if (code(error) === UNIQUE_VIOLATION) {
      // Another tap, tab or device made it first. Open that one.
      const live = await projectByKey(db, idea.key);
      if (live) return found(live);
    }
    return failed(err(error));
  }
  return found(data as ProjectCard, true);
}

/** Save an idea for later without starting it: an Idea-stage project with its brief and no pack yet. */
export async function saveIdeaForLater(db: DbClient, idea: PickIdea, ctx: Pick<CreateContext, "live" | "archived">): Promise<ProjectResult> {
  const existing = findProject(idea, ctx.live, ctx.archived);
  if (existing && !existing.archived) return found(existing.card);
  const brand = idea.format === "short" ? "SH" : "YT";
  const row = { title: idea.title, brand, content_type: idea.format, job: "REACH", hook: idea.hook, caption: "", clip: "", status: "idea", day: 0, cta: "", owner: "", record_script: "", edit_prompt: "", brief: briefFromIdea(idea) };
  const { data, error } = await db.from("content_cards").insert(row).select("*").single();
  if (error) {
    if (code(error) === UNIQUE_VIOLATION) { const live = await projectByKey(db, idea.key); if (live) return found(live); }
    return failed(err(error));
  }
  return found(data as ProjectCard, true);
}

// ── Dismissals ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Dismissal { idea_key: string; title: string | null; reason: string | null; dismissed_at: string }

export async function loadDismissals(db: DbClient): Promise<DismissalsResult> {
  const { data, error } = await db.from("content_idea_dismissals").select("idea_key, title, reason, dismissed_at").order("dismissed_at", { ascending: false });
  if (error) return { ok: false, rows: [], error: err(error) };
  return { ok: true, rows: (data ?? []) as Dismissal[], error: null };
}

/** Dismiss a suggestion. A second dismissal of the same idea is treated as already done, not as a failure. */
export async function dismissIdea(db: DbClient, idea: Pick<PickIdea, "key" | "title">, reason?: string): Promise<DismissResult> {
  const r = (reason ?? "").trim().slice(0, 300);
  const { error } = await db.from("content_idea_dismissals").insert({ idea_key: idea.key, title: idea.title.slice(0, 300), reason: r || null });
  if (error) {
    if (code(error) === UNIQUE_VIOLATION) return { ok: true, alreadyDismissed: true, error: null };
    return { ok: false, alreadyDismissed: false, error: err(error) };
  }
  return { ok: true, alreadyDismissed: false, error: null };
}

/** Undo a dismissal. It deletes the dismissal row and nothing else. */
export async function undoDismissal(db: DbClient, ideaKey: string): Promise<SimpleResult> {
  const { error } = await db.from("content_idea_dismissals").delete().eq("idea_key", ideaKey);
  return error ? { ok: false, error: err(error) } : { ok: true, error: null };
}

// ── The pack, and remakes ───────────────────────────────────────────────────────────────────────────────────────

/** Save the filming pack text. Returns the row the database now holds, so the screen shows what is stored. */
export async function savePack(db: DbClient, cardId: string, text: string): Promise<SaveResult> {
  const { data, error } = await db.from("content_cards").update({ record_script: text }).eq("id", cardId).select("*").maybeSingle();
  if (error) return { ok: false, card: null, error: err(error) };
  if (!data) return { ok: false, card: null, error: "Not saved: the project was not found or you no longer have access." };
  return { ok: true, card: data as ProjectCard, error: null };
}

export async function createRemake(db: DbClient, draft: RemakeDraft, ctx: Pick<CreateContext, "live" | "archived" | "weekday" | "plannedWeek">): Promise<ProjectResult> {
  const existing = [...ctx.live, ...ctx.archived].find((c) => c.brief?.idea_key === draft.idea_key);
  if (existing && !existing.archived_at) return found(existing);
  const brand = draft.format === "short" ? "SH" : "YT";
  const pack = buildFilmingPack({
    title: draft.title, format: draft.format, kind: "talking_head", minutes: draft.format === "long" ? 90 : 30, hook: "Write the new opening line.",
    premise: String(draft.brief.premise ?? ""), payoff: "", beats: [], shots: [], ending: "",
  });
  const row = {
    title: draft.title, brand, content_type: draft.format, job: "REACH", hook: draft.hook, caption: "", clip: "", status: "idea", day: ctx.weekday, planned_week: ctx.plannedWeek,
    cta: "", owner: "", record_script: `${pack}\n\nWHY THIS REMAKE\n${draft.hypothesis}`, edit_prompt: "", brief: draft.brief,
  };
  const { data, error } = await db.from("content_cards").insert(row).select("*").single();
  if (error) {
    if (code(error) === UNIQUE_VIOLATION) { const live = await projectByKey(db, draft.idea_key); if (live) return found(live); }
    return failed(err(error));
  }
  return found(data as ProjectCard, true);
}
