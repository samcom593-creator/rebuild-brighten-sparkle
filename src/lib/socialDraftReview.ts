import { supabase } from "@/integrations/supabase/client";

export interface ReviewedSocialDraft {
  id: number; title: string | null; hook: string | null; body: string | null; caption: string | null;
  cta: string | null; hashtags: string | null; platform: string | null; account: string | null;
  file_path: string | null; status: string; content_hash: string; approved_content_hash: string | null;
  shipped_at: string | null; shipped_url: string | null;
}
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = (name: string, args: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(name, args);
export const REVIEW_CHANGED = "This draft changed. Refresh the review before approving.";
export function verifyReviewedDraft(value: unknown, id: number): ReviewedSocialDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This draft is no longer available for review.");
  const draft = value as Record<string, unknown>;
  if (draft.id !== id || typeof draft.status !== "string" || typeof draft.content_hash !== "string" || !/^[a-f0-9]{32}$/i.test(draft.content_hash)) throw new Error("Draft details could not be verified. Refresh the review.");
  for (const key of ["title", "hook", "body", "caption", "cta", "hashtags", "platform", "account", "file_path", "approved_content_hash", "shipped_at", "shipped_url"]) {
    if (draft[key] !== null && typeof draft[key] !== "string") throw new Error("The complete draft could not be loaded. Refresh the review.");
  }
  return draft as unknown as ReviewedSocialDraft;
}
export async function readSocialDraftReview(id: number): Promise<ReviewedSocialDraft> {
  const { data, error } = await rpc("social_draft_review", { p_id: id });
  if (error) throw new Error(error.message);
  return verifyReviewedDraft(data, id);
}
export async function approveSocialDraftReview(draft: ReviewedSocialDraft, ownerOnly = false): Promise<void> {
  const { data, error } = await rpc(ownerOnly ? "approve_social_draft" : "social_draft_review_set_status", ownerOnly
    ? { p_id: draft.id, p_seen_hash: draft.content_hash }
    : { p_id: draft.id, p_seen_hash: draft.content_hash, p_status: "approved" });
  if (error) throw new Error(error.message);
  if (data === "changed") throw new Error(REVIEW_CHANGED);
  if (data === "already_handled") throw new Error("This draft was already handled. Refresh the review.");
  if (data !== "approved") throw new Error("Approval was not confirmed. Refresh the review before retrying.");
}
export function safeContentUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
