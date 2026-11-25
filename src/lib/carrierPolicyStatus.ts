/** Carrier observations describe coverage and payment state separately.
 * A status is not a dated premium receipt, and a lapse is not a chargeback. */
export type CarrierCoverage = "pending" | "active" | "claim" | "at_risk" | "lapsed" | "not_taken" | "declined" | "abandoned" | "started" | "quote" | "unknown";
export type CarrierPayment = "premium_paying" | "paid" | "awaiting_payment" | "processing" | "unknown";
export interface CarrierPolicyStatusInput {
  carrier?: string | null;
  bucket?: string | null;
  rawStatus?: string | null;
  preStatus?: string | null;
  chargeback?: number | null;
}
export const CARRIER_COVERAGE_LABELS: Record<CarrierCoverage, string> = {
  pending: "Pending", active: "In force", claim: "Claim pending", at_risk: "At risk",
  lapsed: "Lapsed / cancelled", not_taken: "Not taken", declined: "Declined / ineligible",
  abandoned: "Abandoned", started: "Application started", quote: "Quote", unknown: "Status unknown",
};
const STATUS: Record<string, { label: string; coverage: CarrierCoverage; payment?: CarrierPayment }> = {
  premium_paying: { label: "Premium paying", coverage: "active", payment: "premium_paying" },
  renewal_premium_processing: { label: "Renewal premium processing", coverage: "active", payment: "processing" },
  pending_initial_premium: { label: "Awaiting initial premium", coverage: "pending", payment: "awaiting_payment" },
  pending_death_claim: { label: "Death claim pending", coverage: "claim" },
  grace_period: { label: "Grace period", coverage: "at_risk" },
  late_offer_period: { label: "Late offer period", coverage: "at_risk" },
  lapse_pending: { label: "Lapse pending", coverage: "at_risk" },
  lapsed: { label: "Lapsed", coverage: "lapsed" },
  cancelled: { label: "Cancelled", coverage: "lapsed" },
  canceled: { label: "Cancelled", coverage: "lapsed" },
  terminated: { label: "Terminated", coverage: "lapsed" },
  free_look_surrendered: { label: "Surrendered during free look", coverage: "lapsed" },
  not_taken_initial_premium_failed: { label: "Not taken · initial premium failed", coverage: "not_taken" },
  unissued_initial_premium_failed: { label: "Unissued · initial premium failed", coverage: "not_taken" },
  invalid_application: { label: "Invalid application", coverage: "declined" },
  declined: { label: "Declined", coverage: "declined" },
  disqualified_instant_no_reroute: { label: "Ineligible", coverage: "declined" },
  policy_unissued: { label: "Policy unissued", coverage: "declined" },
  withdrawn: { label: "Withdrawn", coverage: "not_taken" },
  not_taken: { label: "Not taken", coverage: "not_taken" },
  abandoned: { label: "Abandoned", coverage: "abandoned" },
  closed_administrative: { label: "Administratively closed", coverage: "abandoned" },
  closed_external_trustage: { label: "Closed externally", coverage: "abandoned" },
  in_force: { label: "In force", coverage: "active" },
  active: { label: "Active", coverage: "active" },
  paid: { label: "Paid · carrier reported", coverage: "active", payment: "paid" },
  issued_and_paid: { label: "Issued & paid · carrier reported", coverage: "active", payment: "paid" },
  issued: { label: "Issued · payment unverified", coverage: "pending" },
  issued_not_paid: { label: "Issued · awaiting payment", coverage: "pending", payment: "awaiting_payment" },
  approved: { label: "Approved", coverage: "pending" },
  approved_instant: { label: "Approved · awaiting issue", coverage: "pending" },
  approved_not_issued: { label: "Approved · awaiting issue", coverage: "pending" },
  pending: { label: "Pending", coverage: "pending" },
  in_review: { label: "In review", coverage: "pending" },
  underwriting: { label: "Underwriting", coverage: "pending" },
  submitted: { label: "Submitted", coverage: "pending" },
  submitted_for_future_issuance: { label: "Submitted for future issue", coverage: "pending" },
  completed: { label: "Application completed", coverage: "pending" },
  rerouted_trustage: { label: "Referred to TruStage", coverage: "pending" },
  policy_activated_external_trustage: { label: "Activated externally", coverage: "active" },
  started: { label: "Application started", coverage: "started" },
  quote: { label: "Quote only", coverage: "quote" },
};
const keyOf = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const aliases: Record<string, string> = { inforce: "in_force", lapsepending: "lapse_pending", nottaken: "not_taken", issued_paid: "issued_and_paid" };

export function carrierPolicyStatus(input: CarrierPolicyStatusInput) {
  const rawStatus = input.rawStatus?.trim() || null;
  const preStatus = input.preStatus?.trim() || null;
  const rawKey = keyOf(rawStatus ?? "");
  const raw = STATUS[aliases[rawKey] ?? rawKey];
  const pre = STATUS[keyOf(preStatus ?? "")];
  const observed = raw ?? (!rawStatus ? pre : undefined);
  const bucket = input.bucket && Object.prototype.hasOwnProperty.call(CARRIER_COVERAGE_LABELS, input.bucket)
    ? input.bucket as CarrierCoverage : "unknown";
  const conflict = ["lapsed", "declined", "not_taken", "abandoned"].includes(bucket)
    && observed !== undefined && observed.coverage !== bucket;
  const coverage = conflict ? "unknown" : observed?.coverage ?? bucket;
  // Ethos-specific payment tokens cannot be transplanted onto another carrier.
  const payment: CarrierPayment = conflict || (observed?.payment === "premium_paying" && input.carrier !== "Ethos")
    ? "unknown" : observed?.payment ?? "unknown";
  const paymentLabel: Record<CarrierPayment, string> = {
    premium_paying: "Premium paying · carrier status", paid: "Paid · carrier status",
    awaiting_payment: "Awaiting payment", processing: "Payment processing", unknown: "Payment unverified",
  };
  return {
    coverage, coverageLabel: CARRIER_COVERAGE_LABELS[coverage],
    statusLabel: conflict ? `${observed?.label} · conflicting carrier classification`
      : observed?.label ?? (rawStatus ? rawStatus.replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase()) : CARRIER_COVERAGE_LABELS[coverage]),
    rawStatus, payment, paymentLabel: paymentLabel[payment],
    conflict,
    recordedChargeback: typeof input.chargeback === "number" && Number.isFinite(input.chargeback) && input.chargeback !== 0,
  };
}

/** A current-state share of the carrier records supplied, not a submission-cohort rate.
 * Explicit quote/started and unknown rows remain outside the denominator. */
export function carrierPlacementSnapshot(policies: readonly CarrierPolicyStatusInput[]) {
  const states = policies.map(carrierPolicyStatus);
  // A cancelled/terminated record may have ended before issue. Only an explicit
  // lapse/free-look status proves historical placement in this broad bucket.
  const ambiguous = (p: ReturnType<typeof carrierPolicyStatus>) => p.coverage === "unknown"
    || (p.coverage === "lapsed" && !["lapsed", "free_look_surrendered"].includes(keyOf(p.rawStatus ?? "")));
  const known = states.filter(p => !ambiguous(p) && !["quote", "started"].includes(p.coverage));
  const placed = known.filter(p => ["active", "claim", "at_risk", "lapsed"].includes(p.coverage));
  const unknown = states.filter(ambiguous).length;
  return {
    placed: placed.length, known: known.length, unknown,
    excludedBeforeSubmission: states.length - known.length - unknown,
    percent: known.length > 0 ? Math.round(placed.length / known.length * 1000) / 10 : null,
  };
}
