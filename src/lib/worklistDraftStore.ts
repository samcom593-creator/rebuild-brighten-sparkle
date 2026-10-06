import { CONTACT_CHANNELS, CONTACT_OUTCOMES, EMPTY_DRAFT, type OutcomeDraft } from "@/lib/recruitingQueues";

/**
 * Unfinished work survives a reload, a crash or a failed save.
 *
 * Drafts live in sessionStorage keyed by viewer + record, so a typed note is never
 * lost to a refresh and never leaks to another signed-in person on the same browser
 * tab history. A draft is cleared ONLY after the server confirms the save; a failed
 * save keeps it exactly as typed.
 *
 * Storage access can throw (private mode, blocked site data, quota). Every access is
 * wrapped and degrades to "no persistence", never to a crash.
 */

const PREFIX = "recruiting-worklist:v1";

type MinimalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): MinimalStorage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch (error) {
    // empty-catch-allow: storage access throws when site data is blocked; persistence is optional
    void error;
    return null;
  }
}

export function draftKey(userId: string | null, applicationId: string): string {
  return `${PREFIX}:draft:${userId ?? "anon"}:${applicationId}`;
}

export function scrollKey(userId: string | null, scope: string): string {
  return `${PREFIX}:scroll:${userId ?? "anon"}:${scope}`;
}

function sanitiseDraft(value: unknown): OutcomeDraft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const outcome = typeof v.outcome === "string" && (CONTACT_OUTCOMES as readonly string[]).includes(v.outcome)
    ? (v.outcome as OutcomeDraft["outcome"])
    : null;
  const channel = typeof v.channel === "string" && (CONTACT_CHANNELS as readonly string[]).includes(v.channel)
    ? (v.channel as OutcomeDraft["channel"])
    : EMPTY_DRAFT.channel;
  return {
    outcome,
    channel,
    notes: str(v.notes),
    nextAction: str(v.nextAction),
    nextActionDue: str(v.nextActionDue),
    waitingReason: str(v.waitingReason),
    nextReview: str(v.nextReview),
  };
}

export function isDraftEmpty(draft: OutcomeDraft): boolean {
  return !draft.outcome && !draft.notes.trim() && !draft.nextAction.trim() && !draft.nextActionDue
    && !draft.waitingReason.trim() && !draft.nextReview;
}

export function loadDraft(userId: string | null, applicationId: string, storage = defaultStorage()): OutcomeDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(userId, applicationId));
    return raw ? sanitiseDraft(JSON.parse(raw)) : null;
  } catch (error) {
    // empty-catch-allow: a corrupt or unreadable draft is treated as no draft
    void error;
    return null;
  }
}

export function saveDraft(userId: string | null, applicationId: string, draft: OutcomeDraft, storage = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (isDraftEmpty(draft)) storage.removeItem(draftKey(userId, applicationId));
    else storage.setItem(draftKey(userId, applicationId), JSON.stringify(draft));
    return true;
  } catch (error) {
    // empty-catch-allow: quota/blocked storage; the in-memory draft is still intact
    void error;
    return false;
  }
}

export function clearDraft(userId: string | null, applicationId: string, storage = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(userId, applicationId));
  } catch (error) {
    // empty-catch-allow: nothing to clear when storage is unavailable
    void error;
  }
}

export function loadNumber(key: string, storage = defaultStorage()): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch (error) {
    // empty-catch-allow: unreadable storage means no remembered position
    void error;
    return null;
  }
}

export function saveNumber(key: string, value: number, storage = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(Math.round(value)));
  } catch (error) {
    // empty-catch-allow: position memory is a convenience
    void error;
  }
}
