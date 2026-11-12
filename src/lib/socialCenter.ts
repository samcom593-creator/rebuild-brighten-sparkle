/**
 * Social Media Center rules (MP-302, 2026-11-12). Pure: what a draft's state is called and
 * what proves it. The page only draws these.
 *
 *   Approved is not scheduled. "Scheduled in Postiz" needs a real post id from Postiz.
 *   Scheduled is not published. Published needs status shipped.
 *   An approved draft whose day has passed with no post is "Missed its slot": it stays
 *   visible until it is posted or sent back.
 */
import type { Tone } from "@/lib/tones";
import { ACCOUNT_BY_KEY, type AccountKey } from "@/lib/brand";

export type SocialView = "approval" | "scheduled" | "published" | "inbound";

export const SOCIAL_VIEWS: ReadonlyArray<{ key: SocialView; label: string }> = [
  { key: "approval", label: "Needs approval" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "inbound", label: "Inbound" },
];

export function isSocialView(value: unknown): value is SocialView {
  return typeof value === "string" && SOCIAL_VIEWS.some((v) => v.key === value);
}

export interface DraftLike {
  status: string;
  draft_date: string | null;
  slot: string | null;
  platform: string | null;
  account: string | null;
  postiz_post_id: string | null;
  ship_source?: string | null;
  shipped_at?: string | null;
  shipped_url?: string | null;
}

export interface DraftState {
  label: string;
  tone: Tone;
  /** Postiz holds this post. */
  scheduled: boolean;
  /** Approved, its day has passed, and nothing was posted. */
  missed: boolean;
}

/** A post id that is a real Postiz id, not the claim marker written while scheduling is in flight. */
export function hasPostizId(d: Pick<DraftLike, "postiz_post_id">): boolean {
  const id = (d.postiz_post_id ?? "").trim();
  return id !== "" && id !== "pending";
}

export function draftState(d: DraftLike, todayKey: string, postizConnected: boolean): DraftState {
  if (d.status === "awaiting_approval") return { label: "Needs approval", tone: "gold", scheduled: false, missed: false };
  if (d.status === "shipped") return { label: "Published", tone: "good", scheduled: false, missed: false };
  if (d.status === "approved") {
    const scheduled = hasPostizId(d);
    const missed = !!d.draft_date && d.draft_date < todayKey;
    if (missed) return { label: "Missed its slot", tone: "hot", scheduled, missed: true };
    if (scheduled) return { label: "Scheduled in Postiz", tone: "cool", scheduled: true, missed: false };
    return { label: postizConnected ? "Approved, not scheduled" : "Approved, post it by hand", tone: "warm", scheduled: false, missed: false };
  }
  return { label: d.status.replace(/_/g, " "), tone: "slate", scheduled: false, missed: false };
}

/** How we know a post is live. */
export function publishedSource(d: Pick<DraftLike, "ship_source">): string {
  return d.ship_source === "postiz" ? "Confirmed by Postiz" : "Link added by hand";
}

const ACCOUNT_WORDS: Record<AccountKey, string[]> = {
  youtube: ["youtube", "yt "],
  "tiktok-main": ["tiktok"],
  "tiktok-sales": ["tiktok"],
  "tiktok-rant": ["tiktok"],
  snapchat: ["snap"],
  instagram: ["instagram", " ig "],
};

/**
 * Blockers carry no account column, so they are matched on their words. With one account
 * selected a blocker shows when it names that platform, or names no platform at all (Postiz,
 * a missing key): a blocker that names a DIFFERENT platform is left out.
 */
export function blockerMatchesAccount(b: { title: string; description?: string | null; fix_action?: string | null }, account: AccountKey | "all"): boolean {
  if (account === "all" || !ACCOUNT_BY_KEY[account]) return true;
  const text = ` ${b.title} ${b.description ?? ""} ${b.fix_action ?? ""} `.toLowerCase();
  if (ACCOUNT_WORDS[account].some((w) => text.includes(w))) return true;
  const namesAnother = Object.entries(ACCOUNT_WORDS).some(([key, words]) => key !== account && words.some((w) => text.includes(w)));
  return !namesAnother;
}
