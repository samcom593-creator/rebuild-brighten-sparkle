import { z } from "zod";

const count = z.number().int().nonnegative();
const amount = z.number().finite().nonnegative().nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const totals = z.object({
  posted_policies: count, posted_ap: amount, matched_policies: count, unmatched_policies: count,
  ambiguous_policies: count, status_known_policies: count, payment_supported_policies: count,
  paying_status_policies: count, paying_status_ap: amount, in_force_policies: count,
  pending_policies: count, not_placed_policies: count, at_risk_policies: count,
  lapsed_policies: count, conflicting_policies: count,
  oldest_observed_on: date.nullable(), newest_observed_on: date.nullable(),
}).superRefine((d, ctx) => {
  if (d.matched_policies + d.unmatched_policies + d.ambiguous_policies !== d.posted_policies
    || d.status_known_policies > d.matched_policies || d.payment_supported_policies > d.status_known_policies
    || d.paying_status_policies > d.payment_supported_policies || d.conflicting_policies > d.matched_policies
    || d.in_force_policies + d.pending_policies + d.not_placed_policies + d.at_risk_policies + d.lapsed_policies !== d.status_known_policies) {
    ctx.addIssue({ code: "custom", message: "The cohort counts do not reconcile." });
  }
});
export type CarrierCohortTotals = z.infer<typeof totals>;
export type CarrierCohortScope = "personal" | "downline" | "agency";
const schema = z.object({
  viewer_user_id: z.string(), requested_agent_id: z.string().nullable(), agent_id: z.string().nullable(),
  window: z.object({ start: date, end_exclusive: date }),
  as_of: z.string().datetime({ offset: true }), timezone: z.literal("America/Phoenix"),
  scopes: z.object({ personal: totals, downline: totals.optional(), agency: totals.optional() }),
  basis: z.string(),
});
export type CarrierPolicyCohort = z.infer<typeof schema>;

export function parseCarrierPolicyCohort(value: unknown, expected: { userId: string; agentId?: string | null; start: string; endExclusive: string }) {
  const data = schema.parse(value);
  if (data.viewer_user_id !== expected.userId || data.requested_agent_id !== (expected.agentId ?? null)
    || data.window.start !== expected.start || data.window.end_exclusive !== expected.endExclusive
    || (expected.agentId && !data.agent_id)) throw new Error("The policy cohort did not match this account, producer and date window.");
  return data;
}

/** A current carrier-payment-status rate for this exact posted cohort. Missing,
 * ambiguous or unsupported payment evidence leaves the total rate unknown. */
export function cohortPlacement(totals: CarrierCohortTotals) {
  const missingEvidence = totals.posted_policies - totals.payment_supported_policies;
  return {
    missingEvidence,
    percent: totals.posted_policies > 0 && missingEvidence === 0
      ? Math.round(totals.paying_status_policies / totals.posted_policies * 1000) / 10 : null,
  };
}
