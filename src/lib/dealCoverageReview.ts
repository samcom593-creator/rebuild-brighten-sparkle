import { z } from "zod";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();
const text = z.string().nullable();
export const COVERAGE_REVIEW_QUERY_KEY = "deal-coverage-reviews";

const matchedPolicy = z.object({
  deal_id: uuid, policy_number: text, client_name: text, carrier_name: text,
  product: text, status: text, agent_name: text,
});
const review = z.object({
  id: uuid, draft_id: uuid, owner_user_id: uuid, idempotency_key: uuid,
  agent_id: uuid, agent_name: text, manager_name: text,
  status: z.enum(["pending", "approved", "rejected", "submitted"]),
  version: z.number().int().positive(), client_name: z.string(), carrier_name: text,
  product: text, policy_number: text, application_date: text,
  annual_premium: z.number().finite().nonnegative().nullable(),
  match_count: z.number().int().positive(),
  match_signals: z.array(z.enum(["name_dob", "phone_dob"])).min(1),
  created_at: instant, updated_at: instant, reviewed_at: instant.nullable(),
  decision_reason: text, payload_current: z.boolean(), can_decide: z.boolean(),
  can_resume: z.boolean(), requires_admin: z.boolean(), deal_id: uuid.nullable(),
  matched_policies: z.array(matchedPolicy),
}).superRefine((value, ctx) => {
  if (value.matched_policies.length > value.match_count
    || (value.can_decide && (value.status !== "pending" || !value.payload_current))
    || (value.can_resume && (value.status !== "approved" || !value.payload_current))
    || (value.status === "submitted" && !value.deal_id)) {
    ctx.addIssue({ code: "custom", message: "Coverage review state is inconsistent." });
  }
});
const queue = z.object({
  viewer_user_id: uuid, as_of: instant, has_more: z.boolean(), reviews: z.array(review),
});
export type DealCoverageReview = z.infer<typeof review>;
export type DealCoverageReviewQueue = z.infer<typeof queue>;
export function parseDealCoverageReviewQueue(value: unknown, userId: string): DealCoverageReviewQueue {
  const data = queue.parse(value);
  if (data.viewer_user_id !== userId || new Set(data.reviews.map(row => row.id)).size !== data.reviews.length
    || data.reviews.some(row => row.can_resume && row.owner_user_id !== userId)) {
    throw new Error("The coverage review queue did not match this account.");
  }
  return data;
}

const decision = z.object({
  ok: z.literal(true), reviewId: uuid, status: z.enum(["approved", "rejected"]),
  version: z.number().int().positive(),
});
export function parseCoverageDecision(value: unknown, reviewId: string) {
  const data = decision.parse(value);
  if (data.reviewId !== reviewId) throw new Error("The decision did not match this coverage review.");
  return data;
}

const hold = z.object({
  ok: z.literal(false), status: z.enum(["review_required", "review_rejected"]),
  reviewId: uuid, reviewVersion: z.number().int().positive(), matchCount: count,
});
export type CoverageHold = z.infer<typeof hold>;
/** A held draft is neither a posted sale nor a network failure. */
export function readCoverageHold(value: unknown): CoverageHold | null {
  if (!value || typeof value !== "object" || !("status" in value)
    || !["review_required", "review_rejected"].includes(String(value.status))) return null;
  return hold.parse(value);
}
