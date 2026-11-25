import { isDateKey } from "@/lib/commissionLedger";

export const POLICY_COVERAGE_LABELS = {
  pending: "Pending",
  active: "In force",
  claim: "In force · claim",
  at_risk: "At risk",
  lapsed: "Lapsed",
  not_taken: "Not taken",
  declined: "Declined",
  abandoned: "Abandoned",
  unknown: "Unknown",
} as const;

export type PolicyCoverage = keyof typeof POLICY_COVERAGE_LABELS;

export interface FinancePolicy {
  key: string;
  carrier: string;
  underwriter: string | null;
  policyNumber: string | null;
  client: string | null;
  product: string | null;
  coverage: PolicyCoverage;
  rawStatus: string | null;
  closeReason: string | null;
  annualPremium: number | null;
  faceAmount: number | null;
  soldOn: string | null;
  effectiveOn: string | null;
  changedOn: string | null;
  chargeback: number | null;
}

export interface FinancePolicyBook {
  agentId: string;
  asOf: string | null;
  policies: FinancePolicy[];
  /** Latest ALL_TIME hierarchical Ethos portal report for a matched NPN.
   * It is not the policy-row total and is not evidence of premium receipts. */
  ethosPortal: {
    issuedAnnualPremium: number | null;
    inforceIssuedAnnualPremium: number | null;
  } | null;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, required = false): string | null {
  if (value == null && !required) return null;
  if (typeof value !== "string") throw new Error("The policy book returned an invalid text field.");
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error("The policy book returned an empty identifier.");
  return trimmed || null;
}

function amount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) {
    throw new Error("The policy book returned an invalid amount.");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("The policy book returned an invalid amount.");
  return parsed;
}

function day(value: unknown): string | null {
  const parsed = text(value);
  if (parsed !== null) {
    const instant = Date.parse(`${parsed}T00:00:00Z`);
    if (!isDateKey(parsed) || !Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== parsed) {
      throw new Error("The policy book returned an invalid date.");
    }
  }
  return parsed;
}

/** Validate both the RPC contract and the identity before any financial facts render. */
export function parseFinancePolicyBook(value: unknown, expectedAgentId: string): FinancePolicyBook {
  if (!object(value) || value.agent_id !== expectedAgentId || !Array.isArray(value.policies)) {
    throw new Error("The policy book did not return a valid result for your agent record.");
  }
  const asOf = text(value.as_of);
  if (asOf !== null && !Number.isFinite(Date.parse(asOf))) throw new Error("The policy book returned an invalid refresh time.");
  const seen = new Set<string>();
  const policies = value.policies.map((row): FinancePolicy => {
    if (!object(row)) throw new Error("The policy book returned an invalid policy row.");
    const key = text(row.key, true)!;
    if (seen.has(key)) throw new Error("The policy book returned a duplicate policy identity.");
    seen.add(key);
    if (typeof row.bucket !== "string" || !Object.prototype.hasOwnProperty.call(POLICY_COVERAGE_LABELS, row.bucket)) {
      throw new Error("The policy book returned an unknown coverage category.");
    }
    return {
      key, carrier: text(row.carrier, true)!, underwriter: text(row.underwriter),
      policyNumber: text(row.policy_number), client: text(row.client), product: text(row.product),
      coverage: row.bucket as PolicyCoverage, rawStatus: text(row.status_raw), closeReason: text(row.close_reason),
      annualPremium: amount(row.annual_premium), faceAmount: amount(row.face_amount),
      soldOn: day(row.sold_on), effectiveOn: day(row.effective_on), changedOn: day(row.changed_on),
      chargeback: amount(row.chargeback),
    };
  });
  let ethosPortal: FinancePolicyBook["ethosPortal"] = null;
  if (value.ethos_portal != null) {
    if (!object(value.ethos_portal)) throw new Error("The carrier portal returned invalid production totals.");
    const issuedAnnualPremium = amount(value.ethos_portal.issued_ap);
    const inforceIssuedAnnualPremium = amount(value.ethos_portal.inforce_ap);
    if ((issuedAnnualPremium !== null && issuedAnnualPremium < 0) ||
      (inforceIssuedAnnualPremium !== null && inforceIssuedAnnualPremium < 0)) {
      throw new Error("The carrier portal returned invalid production totals.");
    }
    ethosPortal = { issuedAnnualPremium, inforceIssuedAnnualPremium };
  }
  return { agentId: expectedAgentId, asOf, policies, ethosPortal };
}

/** Counts reflect returned carrier policies. No policy/ledger join or payment inference. */
export function financePolicySummary(policies: readonly FinancePolicy[]) {
  return policies.reduce((summary, policy) => {
    summary.policies += 1;
    if (policy.coverage === "active" || policy.coverage === "claim") summary.inForce += 1;
    if (policy.coverage === "at_risk") summary.atRisk += 1;
    if (policy.annualPremium === null) summary.missingPremium += 1;
    else summary.annualPremium += policy.annualPremium;
    return summary;
  }, { policies: 0, inForce: 0, atRisk: 0, annualPremium: 0, missingPremium: 0 });
}

/** Coverage counts and known AP, with missing amounts retained as a visible gap. */
export function financePolicyCoverage(policies: readonly FinancePolicy[]) {
  return (Object.entries(POLICY_COVERAGE_LABELS) as Array<[PolicyCoverage, string]>).map(([key, label]) => {
    const matches = policies.filter(policy => policy.coverage === key);
    return {
      key, label, count: matches.length,
      annualPremium: matches.reduce((total, policy) => total + (policy.annualPremium ?? 0), 0),
      missingPremium: matches.filter(policy => policy.annualPremium === null).length,
    };
  }).filter(group => group.count > 0);
}

/**
 * A precise carrier-status observation, never an issued-and-paid receipt total.
 * Only Ethos's literal PREMIUM_PAYING status is included. Renewal processing,
 * generic Active/Issued, Combined In force, dates and commission amounts do not
 * establish this status.
 * Unknown or contradictory facts remain outside the observed subtotal.
 */
export function financePremiumPaying(policies: readonly FinancePolicy[]) {
  const matches = policies.filter(policy => policy.carrier === "Ethos" && policy.coverage === "active" &&
    policy.rawStatus?.trim().toUpperCase() === "PREMIUM_PAYING");
  const known = matches.filter(policy => policy.annualPremium !== null && policy.annualPremium >= 0);
  return {
    policies: matches.length,
    annualPremium: known.length === matches.length ? known.reduce((sum, policy) => sum + policy.annualPremium!, 0) : null,
    knownAnnualPremium: known.reduce((sum, policy) => sum + policy.annualPremium!, 0),
    missingPremium: matches.length - known.length,
    otherPolicies: policies.length - matches.length,
  };
}
