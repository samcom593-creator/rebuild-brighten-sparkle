import { describe, expect, it } from "vitest";
import { financePolicySummary, financePolicyCoverage, financePremiumPaying, financePaidStatus, parseFinancePolicyBook, POLICY_COVERAGE_LABELS } from "@/lib/financePolicyBook";

const policy = (overrides: Record<string, unknown> = {}) => ({
  key: "Combined:synthetic-1", carrier: "Combined", underwriter: null, policy_number: "SYNTHETIC-1",
  client: "Synthetic Policyholder", product: "Whole life", bucket: "pending", label: "Submitted · awaiting issue / pay",
  status_raw: "issued", close_reason: null, annual_premium: "1200.50", face_amount: 25000,
  sold_on: "2026-11-01", effective_on: "2026-11-05", changed_on: null, chargeback: null, ...overrides,
});
const payload = (policies: unknown[] = [policy()]) => ({ agent_id: "agent-own", as_of: "2026-11-25T00:00:00Z", policies });

describe("financial carrier policy facts", () => {
  it("accepts a server-authorized canonical alias only when the requested identity is echoed", () => {
    const canonical = { ...payload(), agent_id: "canonical-agent", requested_agent_id: "agent-own" };
    expect(parseFinancePolicyBook(canonical, "agent-own").agentId).toBe("agent-own");
    expect(() => parseFinancePolicyBook({ ...canonical, requested_agent_id: "another-agent" }, "agent-own")).toThrow();
    expect(() => parseFinancePolicyBook({ ...payload(), requested_agent_id: "another-agent" }, "agent-own")).toThrow();
  });

  it("keeps carrier-recorded chargebacks separate from coverage and outstanding debt", () => {
    const book = parseFinancePolicyBook({ ...payload(), summary: { chargebacks: 2, chargeback_amount: "321.50", debt_outstanding: 123 } }, "agent-own");
    expect(book.chargebacks).toEqual({ count: 2, amount: 321.5, outstandingDebt: 123 });
    expect(parseFinancePolicyBook(payload(), "agent-own").chargebacks).toBeNull();
    expect(() => parseFinancePolicyBook({ ...payload(), summary: { chargebacks: 1.5, chargeback_amount: 100 } }, "agent-own")).toThrow();
  });

  it("resolves a generic pending bucket to the observed declined or paying status without promoting contradictory records", () => {
    const book = parseFinancePolicyBook(payload([
      policy({ key: "declined", bucket: "pending", status_raw: "DECLINED", annual_premium: 100 }),
      policy({ key: "paying", carrier: "Ethos", bucket: "pending", status_raw: "PREMIUM_PAYING", annual_premium: 1200 }),
      policy({ key: "paid", carrier: "Combined", bucket: "active", status_raw: "Issued and paid", annual_premium: 500 }),
      policy({ key: "conflict", carrier: "Ethos", bucket: "lapsed", status_raw: "PREMIUM_PAYING", annual_premium: 9000 }),
    ]), "agent-own");
    expect(book.policies.map(row => row.coverage)).toEqual(["declined", "active", "active", "unknown"]);
    expect(book.policies[3].statusConflict).toBe(true);
    expect(financePaidStatus(book.policies)).toEqual({ policies: 2, annualPremium: 1700, knownAnnualPremium: 1700, missingPremium: 0, carriers: ["Combined", "Ethos"], otherPolicies: 2 });
  });

  it("preserves carrier-specific refresh dates and pre-issue status", () => {
    const book = parseFinancePolicyBook({ ...payload([policy({ status_raw: null, status_pre: "IN_REVIEW", last_seen_on: "2026-11-20" })]),
      carrier_sources: [{ carrier: "Combined", policy_count: 1, last_seen_on: "2026-11-20" }] }, "agent-own");
    expect(book.carrierSources).toEqual([{ carrier: "Combined", policyCount: 1, lastSeenOn: "2026-11-20" }]);
    expect(book.policies[0]).toMatchObject({ preStatus: "IN_REVIEW", statusLabel: "In review", lastSeenOn: "2026-11-20" });
  });
  it("preserves raw issued status, coverage, effective date and missing chargeback independently", () => {
    const book = parseFinancePolicyBook(payload(), "agent-own");
    expect(book.policies[0]).toMatchObject({
      policyNumber: "SYNTHETIC-1", product: "Whole life", coverage: "pending", rawStatus: "issued",
      annualPremium: 1200.5, faceAmount: 25000, effectiveOn: "2026-11-05", chargeback: null,
    });
    expect(book.policies[0]).not.toHaveProperty("paid");
    expect(book.policies[0]).not.toHaveProperty("issuedOn");
    expect(POLICY_COVERAGE_LABELS.lapsed).toBe("Lapsed");
  });

  it("counts real rows and known premiums without treating missing amounts as zero or lapse as chargeback", () => {
    const book = parseFinancePolicyBook(payload([
      policy({ bucket: "active", status_raw: "In force" }),
      policy({ key: "Ethos:synthetic-2", bucket: "lapsed", status_raw: "lapsed", annual_premium: null }),
      policy({ key: "Ethos:synthetic-3", bucket: "at_risk", status_raw: "Lapse Pending", annual_premium: 600, chargeback: -90 }),
    ]), "agent-own");
    expect(financePolicySummary(book.policies)).toEqual({ policies: 3, inForce: 1, atRisk: 1, annualPremium: 1800.5, missingPremium: 1 });
    expect(book.policies[1].chargeback).toBeNull();
    expect(book.policies[2].chargeback).toBe(-90);
  });

  it("accepts an explicitly empty successful book", () => {
    expect(parseFinancePolicyBook(payload([]), "agent-own").policies).toEqual([]);
  });

  it("keeps the Ethos portal's issued and in-force amounts separate from policy totals and missing receipts", () => {
    const book = parseFinancePolicyBook({ ...payload(), ethos_portal: { issued_ap: "90240.50", inforce_ap: 70200 } }, "agent-own");
    expect(book.ethosPortal).toEqual({ issuedAnnualPremium: 90240.5, inforceIssuedAnnualPremium: 70200 });
    expect(financePolicySummary(book.policies).annualPremium).toBe(1200.5);
    expect(book).not.toHaveProperty("issuedPaidAnnualPremium");
    expect(book).not.toHaveProperty("placementRate");
    expect(parseFinancePolicyBook(payload(), "agent-own").ethosPortal).toBeNull();
    expect(parseFinancePolicyBook({ ...payload(), ethos_portal: { issued_ap: null, inforce_ap: 0 } }, "agent-own").ethosPortal)
      .toEqual({ issuedAnnualPremium: null, inforceIssuedAnnualPremium: 0 });
  });

  it("uses only explicit Ethos premium-paying status, never renewal processing, generic coverage or another carrier's vocabulary", () => {
    const book = parseFinancePolicyBook(payload([
      policy({ key: "paying", carrier: "Ethos", bucket: "active", status_raw: "PREMIUM_PAYING", annual_premium: 1200 }),
      policy({ key: "renewing", carrier: "Ethos", bucket: "active", status_raw: "RENEWAL_PREMIUM_PROCESSING", annual_premium: 600 }),
      policy({ key: "generic-active", carrier: "Ethos", bucket: "active", status_raw: "Active", annual_premium: 9000 }),
      policy({ key: "generic-issued", carrier: "Ethos", bucket: "active", status_raw: "Issued", annual_premium: 9000 }),
      policy({ key: "other-carrier", carrier: "Combined", bucket: "active", status_raw: "PREMIUM_PAYING", annual_premium: 9000 }),
      policy({ key: "contradiction", carrier: "Ethos", bucket: "lapsed", status_raw: "PREMIUM_PAYING", annual_premium: 9000 }),
    ]), "agent-own");
    expect(financePremiumPaying(book.policies)).toEqual({ policies: 1, annualPremium: 1200, knownAnnualPremium: 1200, missingPremium: 0, otherPolicies: 5 });
  });

  it("keeps the premium-paying amount incomplete when a matching policy lacks usable premium", () => {
    const book = parseFinancePolicyBook(payload([
      policy({ key: "paying-known", carrier: "Ethos", bucket: "active", status_raw: "PREMIUM_PAYING", annual_premium: 1200 }),
      policy({ key: "paying-missing", carrier: "Ethos", bucket: "active", status_raw: "PREMIUM_PAYING", annual_premium: null }),
      policy({ key: "paying-invalid", carrier: "Ethos", bucket: "active", status_raw: "PREMIUM_PAYING", annual_premium: -5 }),
    ]), "agent-own");
    expect(financePremiumPaying(book.policies)).toEqual({ policies: 3, annualPremium: null, knownAnnualPremium: 1200, missingPremium: 2, otherPolicies: 0 });
  });

  it("builds coverage charts from actual policy counts and preserves partial premium evidence", () => {
    const book = parseFinancePolicyBook(payload([
      policy({ annual_premium: 100 }), policy({ key: "pending-2", annual_premium: null }),
      policy({ key: "active-1", bucket: "active", status_raw: "In force", annual_premium: 9000 }),
      policy({ key: "lapsed-1", bucket: "lapsed", status_raw: "lapsed", annual_premium: null }),
    ]), "agent-own");
    expect(financePolicyCoverage(book.policies)).toEqual([
      { key: "pending", label: "Pending", count: 2, annualPremium: 100, missingPremium: 1 },
      { key: "active", label: "In force", count: 1, annualPremium: 9000, missingPremium: 0 },
      { key: "lapsed", label: "Lapsed", count: 1, annualPremium: 0, missingPremium: 1 },
    ]);
    expect(financePolicyCoverage([])).toEqual([]);
  });

  it.each([
    null,
    [],
    { ...payload(), agent_id: "another-agent" },
    { ...payload(), policies: null },
    payload([null]),
    payload([policy(), policy()]),
    payload([policy({ annual_premium: "not-a-number" })]),
    payload([policy({ face_amount: true })]),
    payload([policy({ chargeback: Infinity })]),
    payload([policy({ effective_on: "2026-02-30" })]),
    payload([policy({ bucket: "guessed-paid" })]),
    { ...payload(), ethos_portal: [] },
    { ...payload(), ethos_portal: { issued_ap: "bad" } },
    { ...payload(), ethos_portal: { issued_ap: -1200 } },
    { ...payload(), ethos_portal: { inforce_ap: Infinity } },
  ])("rejects unavailable, malformed, ambiguous, or wrong-agent payload %j", value => {
    expect(() => parseFinancePolicyBook(value, "agent-own")).toThrow();
  });
});
