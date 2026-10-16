/**
 * commissionLedger (F12 / F14 / F15 / F16): the rules My Commissions renders.
 *
 * Fixtures mirror what was measured live on 2026-10-15: every ledger row is a
 * trigger-written 'override' row at a fraction of a percent, its deal is an
 * AgentLink import whose production row keys on md5 of the AgentLink deal id,
 * and the production view reuses placeholder policy numbers ('1234', 'POL')
 * across different clients. A date is a "YYYY-MM-DD" key; the ledger instant is
 * bucketed in America/Phoenix, never in the test runner's zone. The estimate
 * tile figures are the ones finances_overview('mine') returned for real
 * on-file managers: a structural 0 for overrides and fixed 0.25 and 0.05
 * multiples of direct for trail and renewal.
 */
import { describe, expect, it } from "vitest";
import {
  LEDGER_PAGE_SIZE,
  MAX_PAGES,
  businessDateOf,
  clientMatchKey,
  closedDealPhrase,
  collectAllPages,
  commissionTypeTiles,
  dealStatusLabel,
  isClosedDealStatus,
  isLiveLedgerPart,
  ledgerDealKeys,
  ledgerRateLabel,
  ledgerSectionStatus,
  ledgerStatusLabel,
  ledgerSummary,
  ledgerVisibility,
  monthBuckets,
  monthLabel,
  normalizePolicyNumber,
  paidYearToDate,
  policyMatchKey,
  rateSourcePhrase,
  rateVerdictFromContracts,
  reconcileCommissions,
  type CommissionRow,
  type LedgerRow,
  type ProductionEstimate,
} from "@/lib/commissionLedger";

/** md5('1027'): the live row_key of AgentLink deal 1027 in v_production_comp_truth. */
const KEY_1027 = "883e881bb4d22a7add958f2d6b052c9f";

function ledgerRow(patch: Partial<LedgerRow> & { id: string }): LedgerRow {
  return {
    deal_id: `deal-${patch.id}`,
    deal_source: "agent_link",
    external_deal_id: null,
    deal_status: "active",
    policy_number: null,
    annual_premium: 1200,
    rate_pct: 0.5,
    rate_source: "override",
    amount: 6,
    status: "pending",
    expected_paid_date: null,
    actual_paid_date: null,
    created_at: "2026-10-10T09:00:00Z",
    carrier_name: "Carrier A",
    client_name: "Client A",
    product: "Term",
    ...patch,
  };
}

function production(patch: Partial<ProductionEstimate> & { row_key: string }): ProductionEstimate {
  return {
    policy_number: null,
    annual_premium: 1000,
    seller_comp_pct: 85,
    direct_estimate: 850,
    posted_date: "2026-10-01",
    status: "active",
    carrier: "Carrier B",
    client_name: "Client B",
    product: "Whole",
    ...patch,
  };
}

describe("normalizePolicyNumber", () => {
  it("trims and lower-cases, and treats blank as none", () => {
    expect(normalizePolicyNumber("  ABC-123 ")).toBe("abc-123");
    expect(normalizePolicyNumber("")).toBeNull();
    expect(normalizePolicyNumber("   ")).toBeNull();
    expect(normalizePolicyNumber(null)).toBeNull();
    expect(normalizePolicyNumber(undefined)).toBeNull();
  });
});

describe("policyMatchKey", () => {
  it("refuses every placeholder shape measured in production", () => {
    for (const value of ["1234", "123456", "POL", "00000", "000000000", "4321", "000", "12345", "na", "n/a", "0123456", "654321", "POL-12345", "AMH123456", "pending texas", "amh", "1357", "A1B2C", "", null]) {
      expect(policyMatchKey(value), String(value)).toBeNull();
    }
  });

  it("keeps real policy numbers, ignoring case, spaces and punctuation", () => {
    expect(policyMatchKey("AMH6299047")).toBe("amh6299047");
    expect(policyMatchKey("NXTWHXDXVJ-00-PL")).toBe("nxtwhxdxvj00pl");
    expect(policyMatchKey("000008253920")).toBe("000008253920");
    expect(policyMatchKey(" 7gg 73157 ")).toBe("7gg73157");
    expect(policyMatchKey("ABC-123 457")).toBe(policyMatchKey("abc123457"));
  });
});

describe("clientMatchKey", () => {
  it("compares names without case, accents, punctuation or extra spaces", () => {
    expect(clientMatchKey("  José   O'Neil ")).toBe("jose o neil");
    expect(clientMatchKey("JOSE O NEIL")).toBe("jose o neil");
  });

  it("refuses blank and placeholder names", () => {
    for (const value of ["", "   ", "N/A", "unknown", "Test", "x", "123", null, undefined]) {
      expect(clientMatchKey(value), String(value)).toBeNull();
    }
  });
});

describe("ledgerDealKeys", () => {
  it("adds md5 of the AgentLink deal id for an AgentLink import", () => {
    expect(ledgerDealKeys({ deal_id: "d1", deal_source: "agent_link", external_deal_id: "1027" })).toEqual(["d1", KEY_1027]);
  });

  it("uses only the deal id for a native deal or an AgentLink deal without an id", () => {
    expect(ledgerDealKeys({ deal_id: "d1", deal_source: "apex_native", external_deal_id: "1027" })).toEqual(["d1"]);
    expect(ledgerDealKeys({ deal_id: "d1", deal_source: "agent_link", external_deal_id: "" })).toEqual(["d1"]);
    expect(ledgerDealKeys({ deal_id: "d1", deal_source: "agent_link", external_deal_id: null })).toEqual(["d1"]);
  });
});

describe("rateVerdictFromContracts", () => {
  it("is not_on_file when nothing has a known provenance", () => {
    expect(rateVerdictFromContracts([])).toBe("not_on_file");
    expect(rateVerdictFromContracts([{ pct: null, provenance: "unknown" }])).toBe("not_on_file");
    expect(rateVerdictFromContracts([{ pct: 60, provenance: "unknown" }])).toBe("not_on_file");
    expect(rateVerdictFromContracts([{ pct: 60, provenance: null }])).toBe("not_on_file");
    expect(rateVerdictFromContracts([{ pct: Number.NaN, provenance: "admin_ui" }])).toBe("not_on_file");
  });

  it("is on_file when any row carries a finite pct with a real provenance", () => {
    expect(rateVerdictFromContracts([{ pct: 75, provenance: "admin_ui" }])).toBe("on_file");
    expect(rateVerdictFromContracts([{ pct: null, provenance: "unknown" }, { pct: 85, provenance: "agentlink_carrier_max_2026-08-26" }])).toBe("on_file");
  });
});

describe("businessDateOf", () => {
  it("buckets an instant in the business zone, not the runner's zone", () => {
    // 05:30Z on Oct 1 is 22:30 on Sep 30 in Phoenix (UTC-7, no DST).
    expect(businessDateOf("2026-10-01T05:30:00Z")).toBe("2026-09-30");
    expect(businessDateOf("2026-10-01T07:00:00Z")).toBe("2026-10-01");
  });

  it("is null for a missing or unparsable instant", () => {
    expect(businessDateOf(null)).toBeNull();
    expect(businessDateOf("")).toBeNull();
    expect(businessDateOf("not a date")).toBeNull();
  });
});

describe("labels", () => {
  it("names the ledger rate by its own source, never as the contract rate", () => {
    expect(ledgerRateLabel(0.5, "override")).toBe("0.5% override rate");
    expect(ledgerRateLabel(0, "override")).toBe("0% override rate");
    expect(ledgerRateLabel(85, "contract")).toBe("85% contract rate");
  });

  it("summarises rate sources", () => {
    expect(rateSourcePhrase([])).toBe("");
    expect(rateSourcePhrase(["override", "override"])).toBe("override rate");
    expect(rateSourcePhrase(["override", "contract"])).toBe("contract and override rates");
  });

  it("never presents an undated paid row as a payment", () => {
    expect(ledgerStatusLabel({ status: "pending", actualPaidDate: null })).toBe("ledger pending");
    expect(ledgerStatusLabel({ status: "paid", actualPaidDate: "2026-10-01" })).toBe("paid");
    expect(ledgerStatusLabel({ status: "paid", actualPaidDate: null })).toBe("paid, no payment date");
    expect(ledgerStatusLabel({ status: "clawed_back", actualPaidDate: null })).toBe("clawed back");
    expect(ledgerStatusLabel({ status: "voided", actualPaidDate: null })).toBe("voided");
    expect(ledgerStatusLabel({ status: "on_hold", actualPaidDate: null })).toBe("on_hold");
  });
});

describe("closed deals", () => {
  it("recognises every closed status the deals table allows, in any case", () => {
    for (const s of ["lapsed", "cancelled", "chargeback", "charged_back", "withdrawn", "declined", " Lapsed ", "CANCELLED"]) {
      expect(isClosedDealStatus(s), s).toBe(true);
    }
    for (const s of ["active", "submitted", "issued", "in_force", "approved", "draft", "needs_review", "", null, undefined]) {
      expect(isClosedDealStatus(s), String(s)).toBe(false);
    }
  });

  it("labels a closed deal beside its ledger row and nothing for an open one", () => {
    expect(dealStatusLabel("lapsed")).toBe("deal lapsed");
    expect(dealStatusLabel("cancelled")).toBe("deal cancelled");
    expect(dealStatusLabel("charged_back")).toBe("deal charged back");
    expect(dealStatusLabel("active")).toBeNull();
    expect(dealStatusLabel(null)).toBeNull();
  });

  it("names the closed statuses present, once each", () => {
    expect(closedDealPhrase([])).toBe("");
    expect(closedDealPhrase(["lapsed", "lapsed"])).toBe("lapsed");
    expect(closedDealPhrase(["lapsed", "cancelled"])).toBe("cancelled or lapsed");
    expect(closedDealPhrase(["withdrawn", "lapsed", "cancelled", "active"])).toBe("cancelled, lapsed or withdrawn");
    expect(closedDealPhrase(["chargeback", "charged_back"])).toBe("charged back");
  });

  it("treats a pending row on a closed deal as not payable, and a paid row as paid whatever the deal says", () => {
    expect(isLiveLedgerPart({ status: "pending", dealClosed: false })).toBe(true);
    expect(isLiveLedgerPart({ status: "pending", dealClosed: true })).toBe(false);
    expect(isLiveLedgerPart({ status: "paid", dealClosed: true })).toBe(true);
    expect(isLiveLedgerPart({ status: "voided", dealClosed: false })).toBe(false);
    expect(isLiveLedgerPart({ status: "clawed_back", dealClosed: false })).toBe(false);
  });
});

describe("commissionTypeTiles", () => {
  // What finances_overview('mine') returns for an on-file manager with a downline: override 0 by construction,
  // trail a 0.25 multiple of direct, renewal 0 only because nothing is 730 days old yet.
  const types = { direct_ytd: 217935.04, override_pending: 0, trail_pending: 54483.76, renewal_pending: 0 };

  it("never shows the 'mine' override, trail or renewal figure as money, for any rate verdict or login", () => {
    for (const rate of ["on_file", "not_on_file", "unknown"] as const) {
      for (const rateChecking of [false, true]) {
        for (const financesVisible of [false, true]) {
          const tiles = commissionTypeTiles({ types: { ...types, override_pending: 53195.52, renewal_pending: 12 }, rate, rateChecking, financesVisible });
          const label = `${rate} checking=${rateChecking} finances=${financesVisible}`;
          expect(tiles.map((t) => t.id), label).toEqual(["direct", "advance", "override", "trail", "renewal"]);
          expect(tiles.find((t) => t.id === "advance")?.figure, label).toEqual({ kind: "text", text: "Unknown" });
          expect(tiles.find((t) => t.id === "override")?.figure, label).toEqual({ kind: "text", text: "Not in this view" });
          expect(tiles.find((t) => t.id === "trail")?.figure, label).toEqual({ kind: "text", text: "Unknown" });
          expect(tiles.find((t) => t.id === "renewal")?.figure, label).toEqual({ kind: "text", text: "Unknown" });
        }
      }
    }
  });

  it("says why trail and renewal have no figure, naming the server's assumed multipliers", () => {
    const tiles = commissionTypeTiles({ types, rate: "on_file", rateChecking: false, financesVisible: false });
    expect(tiles.find((t) => t.id === "trail")?.detail).toBe("The carrier as-earned schedule is not on file; the server assumes 25% of direct.");
    expect(tiles.find((t) => t.id === "renewal")?.detail).toBe("The renewal schedule is not on file; the server assumes 5% of direct.");
  });

  it("points only admin logins at Finances, the one page with the team view", () => {
    const forAdmin = commissionTypeTiles({ types, rate: "on_file", rateChecking: false, financesVisible: true });
    const forOthers = commissionTypeTiles({ types, rate: "on_file", rateChecking: false, financesVisible: false });
    expect(forAdmin.find((t) => t.id === "override")?.detail).toBe("Your own-production read leaves out team overrides; see Finances for the team view.");
    expect(forOthers.find((t) => t.id === "override")?.detail).toBe("Your own-production read leaves out team overrides.");
  });

  it("shows Direct YTD as money only with the contract rate on file", () => {
    const direct = (rate: "on_file" | "not_on_file" | "unknown", rateChecking = false) =>
      commissionTypeTiles({ types, rate, rateChecking, financesVisible: false }).find((t) => t.id === "direct");
    expect(direct("on_file")?.figure).toEqual({ kind: "amount", amount: 217935.04 });
    expect(direct("not_on_file")).toMatchObject({ figure: { kind: "text", text: "Unavailable" }, detail: "comp level not on file; the server figure assumes a default" });
    expect(direct("unknown", true)?.figure).toEqual({ kind: "text", text: "Loading" });
    expect(direct("unknown")).toMatchObject({ figure: { kind: "text", text: "Unavailable" }, detail: "comp level unverified" });
  });

  it("never turns a missing or non-numeric direct figure into a zero", () => {
    for (const value of [undefined, null, "", "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
      const tile = commissionTypeTiles({ types: { direct_ytd: value }, rate: "on_file", rateChecking: false, financesVisible: false }).find((t) => t.id === "direct");
      expect(tile?.figure, String(value)).toEqual({ kind: "text", text: "Unavailable" });
    }
    const fromString = commissionTypeTiles({ types: { direct_ytd: "1200.5" }, rate: "on_file", rateChecking: false, financesVisible: false });
    expect(fromString.find((t) => t.id === "direct")?.figure).toEqual({ kind: "amount", amount: 1200.5 });
  });
});

describe("ledgerVisibility", () => {
  // Kaeden Vaughns' login resolves through a merge to KJ Vaughn's record, which carries another login.
  const merged = { mergedFromAgentId: "own-merged-row", recordUserId: "kj-login", viewerUserId: "kaeden-login", isAdmin: false, rolesLoading: false };

  it("is complete when the login resolved to its own record", () => {
    expect(ledgerVisibility({ ...merged, mergedFromAgentId: undefined })).toBe("complete");
    expect(ledgerVisibility({ ...merged, mergedFromAgentId: null })).toBe("complete");
    expect(ledgerVisibility({ ...merged, recordUserId: "kaeden-login" })).toBe("complete");
  });

  it("is restricted for a non-admin login that reaches another login's record, or a record with no login", () => {
    expect(ledgerVisibility(merged)).toBe("restricted");
    expect(ledgerVisibility({ ...merged, recordUserId: null })).toBe("restricted");
    expect(ledgerVisibility({ ...merged, viewerUserId: null, recordUserId: null })).toBe("restricted");
  });

  it("is complete for an admin, whose read passes the admin policy", () => {
    expect(ledgerVisibility({ ...merged, isAdmin: true })).toBe("complete");
  });

  it("is checking while the roles load, never complete or restricted", () => {
    expect(ledgerVisibility({ ...merged, rolesLoading: true })).toBe("checking");
  });
});

describe("reconcileCommissions", () => {
  it("pairs by AgentLink deal id and never lets a shared placeholder number touch another client's deal", () => {
    // The live failure: one ledger row with policy 'POL' used to erase every other client's 'POL' deal.
    const ledger = [ledgerRow({ id: "a1", external_deal_id: "1027", policy_number: "POL", client_name: "Tara Doe", amount: 0 })];
    const estimates = [
      production({ row_key: KEY_1027, policy_number: "POL", client_name: "Tara Doe", direct_estimate: 541 }),
      production({ row_key: "hash-2", policy_number: "POL", client_name: "Other Client", direct_estimate: 700 }),
      production({ row_key: "hash-3", policy_number: "pol", client_name: "Third Client", direct_estimate: 300 }),
    ];
    const r = reconcileCommissions(ledger, estimates, "on_file");
    expect(r.production).toEqual({
      rowCount: 3,
      pairedByDealId: 1,
      pairedByPolicyAndClient: 0,
      ambiguousLedgerCount: 0,
      excludedCount: 0,
      estimateTotal: 1541,
    });
    expect(r.rows.map((x) => [x.id, x.ledger?.ledgerId ?? null, x.estimate?.rowKey ?? null, x.pairedBy])).toEqual([
      ["ledger:a1", "a1", KEY_1027, "deal_id"],
      ["estimate:hash-2", null, "hash-2", null],
      ["estimate:hash-3", null, "hash-3", null],
    ]);
  });

  it("keeps the contract-rate estimate beside a $0 override row instead of replacing it", () => {
    const ledger = [ledgerRow({ id: "a1", external_deal_id: "1027", rate_pct: 0, amount: 0 })];
    const r = reconcileCommissions(ledger, [production({ row_key: KEY_1027, direct_estimate: 850 })], "on_file");
    const row = r.rows[0];
    expect(r.rows).toHaveLength(1);
    expect(row.ledger).toMatchObject({ amount: 0, ratePct: 0, rateSource: "override", rateLabel: "0% override rate", status: "pending" });
    expect(row.estimate).toMatchObject({ amount: 850, ratePct: 85, rateLabel: "85% comp level" });
    // The estimate total is the contract-rate figure for every production row; the ledger's $0 never stands in for it.
    expect(r.production?.estimateTotal).toBe(850);
  });

  it("pairs a native deal whose production row_key is the ledger deal id", () => {
    const ledger = [ledgerRow({ id: "a1", deal_id: "uuid-1", deal_source: "apex_native" })];
    const r = reconcileCommissions(ledger, [production({ row_key: "uuid-1" }), production({ row_key: "hash-9" })], "on_file");
    expect(r.production?.pairedByDealId).toBe(1);
    expect(r.rows.map((x) => x.id)).toEqual(["ledger:a1", "estimate:hash-9"]);
  });

  it("falls back to the same policy number AND the same client name", () => {
    const ledger = [ledgerRow({ id: "a1", policy_number: "AMH-6299047", client_name: "Jane  Roe" })];
    const estimates = [
      production({ row_key: "h1", policy_number: "amh6299047", client_name: "jane roe" }),
      production({ row_key: "h2", policy_number: "AMH6299047", client_name: "Someone Else" }),
    ];
    const r = reconcileCommissions(ledger, estimates, "on_file");
    expect(r.production).toMatchObject({ pairedByDealId: 0, pairedByPolicyAndClient: 1, ambiguousLedgerCount: 0, estimateTotal: 1700 });
    expect(r.rows.find((x) => x.id === "ledger:a1")?.estimate?.rowKey).toBe("h1");
    expect(r.rows.find((x) => x.id === "estimate:h2")?.ledger).toBeNull();
  });

  it("never pairs on a placeholder or blank policy number, even with the same client", () => {
    const ledger = [ledgerRow({ id: "a1", policy_number: "1234", client_name: "Jane Roe" }), ledgerRow({ id: "a2", policy_number: "  ", client_name: "Jane Roe" })];
    const estimates = [production({ row_key: "h1", policy_number: "1234", client_name: "Jane Roe" }), production({ row_key: "h2", policy_number: "", client_name: "Jane Roe" })];
    const r = reconcileCommissions(ledger, estimates, "on_file");
    expect(r.production).toMatchObject({ pairedByDealId: 0, pairedByPolicyAndClient: 0, ambiguousLedgerCount: 0 });
    expect(r.rows).toHaveLength(4);
  });

  it("pairs nothing when the policy number and client match more than one production row", () => {
    const ledger = [ledgerRow({ id: "a1", policy_number: "AMH6299047", client_name: "Jane Roe" })];
    const estimates = [
      production({ row_key: "h1", policy_number: "AMH6299047", client_name: "Jane Roe" }),
      production({ row_key: "h2", policy_number: "AMH6299047", client_name: "Jane Roe" }),
    ];
    const r = reconcileCommissions(ledger, estimates, "on_file");
    expect(r.production).toMatchObject({ pairedByPolicyAndClient: 0, ambiguousLedgerCount: 1, rowCount: 2, estimateTotal: 1700 });
    expect(r.rows).toHaveLength(3);
    expect(r.rows.find((x) => x.id === "ledger:a1")?.ambiguous).toBe(true);
  });

  it("pairs nothing when two ledger rows claim the same production row", () => {
    const ledger = [
      ledgerRow({ id: "a1", deal_id: "d1", external_deal_id: "1027" }),
      ledgerRow({ id: "a2", deal_id: "d2", external_deal_id: "1027" }),
    ];
    const r = reconcileCommissions(ledger, [production({ row_key: KEY_1027 })], "on_file");
    expect(r.production).toMatchObject({ pairedByDealId: 0, ambiguousLedgerCount: 2 });
    expect(r.rows.map((x) => [x.id, x.ambiguous])).toEqual([
      ["ledger:a1", true],
      ["ledger:a2", true],
      [`estimate:${KEY_1027}`, false],
    ]);
  });

  it("does not offer a production row the deal id already points at to the policy fallback", () => {
    // a1 owns the production row by deal id; a2 (a duplicate deal, same policy and client) must not take it.
    const ledger = [
      ledgerRow({ id: "a1", external_deal_id: "1027", policy_number: "AMH6299047", client_name: "Jane Roe" }),
      ledgerRow({ id: "a2", deal_source: "apex_native", policy_number: "AMH6299047", client_name: "Jane Roe" }),
    ];
    const r = reconcileCommissions(ledger, [production({ row_key: KEY_1027, policy_number: "AMH6299047", client_name: "Jane Roe" })], "on_file");
    expect(r.production).toMatchObject({ pairedByDealId: 1, pairedByPolicyAndClient: 0, ambiguousLedgerCount: 0 });
    expect(r.rows.find((x) => x.id === "ledger:a2")?.estimate).toBeNull();
  });

  it("carries the deal's own status on the ledger part", () => {
    const r = reconcileCommissions([ledgerRow({ id: "a1", deal_status: "lapsed" }), ledgerRow({ id: "a2" })], [], "on_file");
    expect(r.rows.find((x) => x.id === "ledger:a1")?.ledger).toMatchObject({ dealStatus: "lapsed", dealClosed: true });
    expect(r.rows.find((x) => x.id === "ledger:a2")?.ledger).toMatchObject({ dealStatus: "active", dealClosed: false });
  });

  it("keeps a voided ledger row on its deal, with the estimate still counted", () => {
    const ledger = [ledgerRow({ id: "a1", external_deal_id: "1027", status: "voided" })];
    const r = reconcileCommissions(ledger, [production({ row_key: KEY_1027 })], "on_file");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].ledger?.status).toBe("voided");
    expect(r.production?.estimateTotal).toBe(850);
  });

  it("shows estimates without an amount, and no total, when the rate is not on file", () => {
    const r = reconcileCommissions([], [production({ row_key: "h1" }), production({ row_key: "h2" })], "not_on_file");
    expect(r.production).toMatchObject({ rowCount: 2, excludedCount: 2, estimateTotal: null });
    for (const row of r.rows) {
      expect(row.estimate?.amount).toBeNull();
      expect(row.estimate?.ratePct).toBeNull();
      expect(row.estimate?.rateLabel).toBe("rate not on file");
    }
  });

  it("reports an unverified rate as no total at all, never zero", () => {
    const r = reconcileCommissions([], [production({ row_key: "h1" })], "unknown");
    expect(r.production?.estimateTotal).toBeNull();
    expect(r.rows[0].estimate?.amount).toBeNull();
    expect(r.rows[0].estimate?.rateLabel).toBe("rate unverified");
    expect(r.production?.excludedCount).toBe(1);
  });

  it("excludes an estimate the view could not price even when the rate is on file", () => {
    const r = reconcileCommissions([], [production({ row_key: "h1", direct_estimate: null }), production({ row_key: "h2" })], "on_file");
    expect(r.rows.find((x) => x.id === "estimate:h1")?.estimate).toMatchObject({ amount: null, rateLabel: "estimate not available" });
    expect(r.production).toMatchObject({ excludedCount: 1, estimateTotal: 850 });
  });

  it("returns no production figures at all, never zeros, when the production read is unavailable", () => {
    const r = reconcileCommissions([ledgerRow({ id: "a1", external_deal_id: "1027" })], undefined, "on_file");
    expect(r.production).toBeNull();
    expect(r.ledgerRowCount).toBe(1);
    expect(r.rows.map((x) => [x.id, x.estimate, x.pairedBy, x.ambiguous])).toEqual([["ledger:a1", null, null, false]]);
  });

  it("dates a paired deal by its posted date, a ledger-only row by its Phoenix booking day, newest first", () => {
    const ledger = [
      ledgerRow({ id: "a1", external_deal_id: "1027", created_at: "2026-10-10T09:00:00Z" }),
      ledgerRow({ id: "a2", created_at: "2026-10-01T05:30:00Z" }),
      ledgerRow({ id: "a3", created_at: null }),
    ];
    const estimates = [production({ row_key: KEY_1027, posted_date: "2026-09-02" }), production({ row_key: "h2", posted_date: "2026-09-30" })];
    const r = reconcileCommissions(ledger, estimates, "on_file");
    expect(r.rows.map((x) => [x.id, x.businessDate])).toEqual([
      ["ledger:a2", "2026-09-30"],
      ["estimate:h2", "2026-09-30"],
      ["ledger:a1", "2026-09-02"],
      ["ledger:a3", null],
    ]);
    expect(r.rows.find((x) => x.id === "ledger:a1")?.ledger?.bookedDate).toBe("2026-10-10");
  });

  it("shows production's deal details on a paired row and the ledger's own figures unchanged", () => {
    const ledger = [ledgerRow({ id: "a1", external_deal_id: "1027", annual_premium: 2400, rate_pct: 0.5, amount: 12, expected_paid_date: "2026-07-24" })];
    const r = reconcileCommissions(ledger, [production({ row_key: KEY_1027, annual_premium: 2400, carrier: "Book Carrier" })], "unknown");
    const row = r.rows[0];
    expect(row.carrierName).toBe("Book Carrier");
    expect(row.annualPremium).toBe(2400);
    expect(row.ledger).toMatchObject({ annualPremium: 2400, ratePct: 0.5, amount: 12, expectedPaidDate: "2026-07-24" });
    expect(row.estimate?.amount).toBeNull();
  });
});

describe("ledgerSummary", () => {
  it("totals by status and counts pending rows past their expected pay date", () => {
    const rows = [
      ledgerRow({ id: "p1", amount: 6, expected_paid_date: "2026-07-24" }),
      ledgerRow({ id: "p2", amount: 0, expected_paid_date: "2026-10-15" }),
      ledgerRow({ id: "p3", amount: 4, expected_paid_date: null, rate_source: "contract" }),
      ledgerRow({ id: "c1", status: "clawed_back", amount: 9 }),
      ledgerRow({ id: "v1", status: "voided", amount: 7 }),
      ledgerRow({ id: "x1", status: "paid", amount: 100, actual_paid_date: "2026-03-01" }),
    ];
    expect(ledgerSummary(rows, "2026-10-15")).toEqual({
      pending: { count: 3, total: 10, pastExpectedCount: 1, rateSources: ["contract", "override"] },
      pendingOnClosedDeals: { count: 0, total: 0, dealStatuses: [] },
      paid: { count: 1, total: 100 },
      clawedBack: { count: 1, total: 9 },
      voided: { count: 1, total: 7 },
    });
  });

  it("counts pending rows on lapsed or cancelled deals apart, never in pending", () => {
    // Live on 2026-10-15: 9 pending rows on lapsed deals and 4 on cancelled ones, none ever voided.
    const rows = [
      ledgerRow({ id: "open", amount: 6, expected_paid_date: "2026-07-24" }),
      ledgerRow({ id: "lapsed", amount: 5.5, deal_status: "lapsed", expected_paid_date: "2026-07-24" }),
      ledgerRow({ id: "cancelled", amount: 2, deal_status: "Cancelled", rate_source: "contract" }),
      ledgerRow({ id: "voided-lapsed", status: "voided", amount: 3, deal_status: "lapsed" }),
      ledgerRow({ id: "paid-lapsed", status: "paid", amount: 9, actual_paid_date: "2026-05-01", deal_status: "lapsed" }),
    ];
    const s = ledgerSummary(rows, "2026-10-15");
    expect(s.pending).toEqual({ count: 1, total: 6, pastExpectedCount: 1, rateSources: ["override"] });
    expect(s.pendingOnClosedDeals).toEqual({ count: 2, total: 7.5, dealStatuses: ["cancelled", "lapsed"] });
    expect(s.voided).toEqual({ count: 1, total: 3 });
    expect(s.paid).toEqual({ count: 1, total: 9 });
  });

  it("is all zeros for a complete read with no rows, and refuses a bad today key", () => {
    expect(ledgerSummary([], "2026-10-15").pending).toEqual({ count: 0, total: 0, pastExpectedCount: 0, rateSources: [] });
    expect(() => ledgerSummary([], "today")).toThrow(RangeError);
  });
});

describe("paidYearToDate", () => {
  const today = "2026-10-15";

  it("counts only paid rows dated inside the business year up to today", () => {
    const rows = [
      ledgerRow({ id: "prior", status: "paid", amount: 100, actual_paid_date: "2025-12-31" }),
      ledgerRow({ id: "jan1", status: "paid", amount: 200, actual_paid_date: "2026-01-01" }),
      ledgerRow({ id: "today", status: "paid", amount: 300, actual_paid_date: "2026-10-15" }),
      ledgerRow({ id: "pending", status: "pending", amount: 500, actual_paid_date: "2026-05-05" }),
    ];
    const r = paidYearToDate(rows, today);
    expect(r.yearStart).toBe("2026-01-01");
    expect(r.total).toBe(500);
    expect(r.count).toBe(2);
    expect(r.undatedPaidCount).toBe(0);
    expect(r.futureDatedPaidCount).toBe(0);
  });

  it("reports undated and future-dated paid rows separately instead of dating or counting them", () => {
    const rows = [
      ledgerRow({ id: "nodate", status: "paid", amount: 100, actual_paid_date: null }),
      ledgerRow({ id: "garbage", status: "paid", amount: 100, actual_paid_date: "yesterday" }),
      ledgerRow({ id: "future", status: "paid", amount: 400, actual_paid_date: "2026-10-16" }),
      ledgerRow({ id: "ok", status: "paid", amount: 50, actual_paid_date: "2026-03-03" }),
    ];
    const r = paidYearToDate(rows, today);
    expect(r.total).toBe(50);
    expect(r.count).toBe(1);
    expect(r.undatedPaidCount).toBe(2);
    expect(r.futureDatedPaidCount).toBe(1);
  });

  it("is zero with zero counts for a complete read that holds no paid rows", () => {
    const r = paidYearToDate([ledgerRow({ id: "p", status: "pending" })], today);
    expect(r).toEqual({ total: 0, count: 0, yearStart: "2026-01-01", undatedPaidCount: 0, futureDatedPaidCount: 0 });
  });

  it("refuses a today key that is not a date key", () => {
    expect(() => paidYearToDate([], "2026-10-15T00:00:00Z")).toThrow(RangeError);
  });
});

describe("monthLabel", () => {
  it("names the month from the key alone", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("2026-01")).toBe("Jan 2026");
    expect(() => monthLabel("2026-13")).toThrow(RangeError);
    expect(() => monthLabel("2026-10-01")).toThrow(RangeError);
  });
});

describe("monthBuckets", () => {
  function row(patch: Partial<CommissionRow> & { id: string }): CommissionRow {
    return {
      ledger: null,
      estimate: null,
      pairedBy: null,
      ambiguous: false,
      policyNumber: null,
      clientName: null,
      carrierName: null,
      product: null,
      annualPremium: 1000,
      businessDate: "2026-10-01",
      ...patch,
    };
  }
  const ledgerPart = (status: string, amount: number, dealStatus = "active") => ({
    ledgerId: "l",
    dealId: "d",
    amount,
    annualPremium: 1000,
    ratePct: 0.5,
    rateSource: "override",
    rateLabel: "0.5% override rate",
    status,
    expectedPaidDate: null,
    actualPaidDate: null,
    bookedDate: "2026-10-01",
    dealStatus,
    dealClosed: isClosedDealStatus(dealStatus),
  });
  const estimatePart = (amount: number | null, annualPremium: number | null = 1000) => ({
    rowKey: "k",
    amount,
    annualPremium,
    ratePct: amount === null ? null : 85,
    rateLabel: "x",
    postedDate: "2026-10-01",
  });
  const nothingLeftOut = { closedLedgerOnlyCount: 0, closedDealLedgerOnlyCount: 0, futureDatedCount: 0, undatedCount: 0 };

  it("counts production rows as deals, ledger-only rows on their own, and keeps ledger and estimate sums apart", () => {
    const rows = [
      row({ id: "paired", businessDate: "2026-10-02", ledger: ledgerPart("pending", 0.05), estimate: estimatePart(8.5, 10) }),
      row({ id: "est-only", businessDate: "2026-10-30", estimate: estimatePart(17, 20) }),
      row({ id: "unpriced", businessDate: "2026-10-30", estimate: estimatePart(null, 5) }),
      row({ id: "paid-ledger-only", businessDate: "2026-09-15", annualPremium: 30, ledger: ledgerPart("paid", 25) }),
      row({ id: "prior-year", businessDate: "2025-12-31", estimate: estimatePart(999) }),
    ];
    expect(monthBuckets(rows, "2026-10-31")).toEqual({
      months: [
        { key: "2026-10", label: "Oct 2026", deals: 3, ledgerOnlyRows: 0, premium: 35, ledger: 0.05, estimate: 25.5, estimateExcluded: 1 },
        { key: "2026-09", label: "Sep 2026", deals: 0, ledgerOnlyRows: 1, premium: 0, ledger: 25, estimate: 0, estimateExcluded: 0 },
      ],
      ...nothingLeftOut,
    });
  });

  it("leaves voided, clawed-back and closed-deal ledger-only rows out of every figure and counts them", () => {
    const rows = [
      row({ id: "voided-only", ledger: ledgerPart("voided", 7) }),
      row({ id: "clawed-only", ledger: ledgerPart("clawed_back", 9) }),
      row({ id: "lapsed-only", ledger: ledgerPart("pending", 5, "lapsed") }),
      row({ id: "cancelled-only", ledger: ledgerPart("pending", 3, "cancelled") }),
      row({ id: "voided-with-production", ledger: ledgerPart("voided", 7), estimate: estimatePart(34, 40) }),
      row({ id: "lapsed-with-production", ledger: ledgerPart("pending", 2, "lapsed"), estimate: estimatePart(10, 12) }),
    ];
    expect(monthBuckets(rows, "2026-10-15")).toEqual({
      months: [{ key: "2026-10", label: "Oct 2026", deals: 2, ledgerOnlyRows: 0, premium: 52, ledger: 0, estimate: 44, estimateExcluded: 0 }],
      ...nothingLeftOut,
      closedLedgerOnlyCount: 2,
      closedDealLedgerOnlyCount: 2,
    });
  });

  it("counts rows dated after today, and rows with no date, instead of dropping them", () => {
    const rows = [
      row({ id: "after-today", businessDate: "2026-11-01", estimate: estimatePart(999) }),
      row({ id: "next-year", businessDate: "2027-01-02", ledger: ledgerPart("pending", 1) }),
      row({ id: "undated", businessDate: null, estimate: estimatePart(999) }),
      row({ id: "today", businessDate: "2026-10-31", estimate: estimatePart(1, 100) }),
    ];
    expect(monthBuckets(rows, "2026-10-31")).toEqual({
      months: [{ key: "2026-10", label: "Oct 2026", deals: 1, ledgerOnlyRows: 0, premium: 100, ledger: 0, estimate: 1, estimateExcluded: 0 }],
      ...nothingLeftOut,
      futureDatedCount: 2,
      undatedCount: 1,
    });
  });

  it("never counts a ledger row that could not be paired as a second production deal", () => {
    // Two ledger rows on one AgentLink id beside its one production row: neither can be paired one to one.
    const twoClaims = reconcileCommissions(
      [ledgerRow({ id: "a1", deal_id: "d1", external_deal_id: "1027" }), ledgerRow({ id: "a2", deal_id: "d2", external_deal_id: "1027" })],
      [production({ row_key: KEY_1027, annual_premium: 1000 })],
      "on_file",
    );
    expect(monthBuckets(twoClaims.rows, "2026-10-15").months).toEqual([
      { key: "2026-10", label: "Oct 2026", deals: 1, ledgerOnlyRows: 2, premium: 1000, ledger: 12, estimate: 850, estimateExcluded: 0 },
    ]);
    // A 'POL' ledger row beside its own 'POL' production row with no deal id: a placeholder never pairs.
    const placeholder = reconcileCommissions(
      [ledgerRow({ id: "a1", policy_number: "POL", client_name: "Tara Doe" })],
      [production({ row_key: "hash-1", policy_number: "POL", client_name: "Tara Doe" })],
      "on_file",
    );
    expect(monthBuckets(placeholder.rows, "2026-10-15").months).toEqual([
      { key: "2026-10", label: "Oct 2026", deals: 1, ledgerOnlyRows: 1, premium: 1000, ledger: 6, estimate: 850, estimateExcluded: 0 },
    ]);
  });

  it("is empty for no rows in the year", () => {
    expect(monthBuckets([row({ id: "old", businessDate: "2025-06-01", estimate: estimatePart(1) })], "2026-10-15")).toEqual({ months: [], ...nothingLeftOut });
  });
});

describe("ledgerSectionStatus", () => {
  const loaded = { data: [] as unknown[], isError: false };
  const loading = { isPending: true, isError: false };

  it("is error when the ledger failed with nothing cached, whatever the other reads say", () => {
    expect(ledgerSectionStatus({ ledger: { isError: true }, estimates: loaded, contract: loaded, rowCount: 5 })).toBe("error");
    expect(ledgerSectionStatus({ ledger: { isError: true }, estimates: loading, contract: loading, rowCount: 0 })).toBe("error");
  });

  it("is loading while any read is still pending", () => {
    expect(ledgerSectionStatus({ ledger: loading, estimates: loaded, contract: loaded, rowCount: 0 })).toBe("loading");
    expect(ledgerSectionStatus({ ledger: loaded, estimates: loading, contract: loaded, rowCount: 0 })).toBe("loading");
    expect(ledgerSectionStatus({ ledger: loaded, estimates: loaded, contract: loading, rowCount: 0 })).toBe("loading");
    expect(ledgerSectionStatus({ ledger: {}, estimates: loaded, contract: loaded, rowCount: 0 })).toBe("loading");
  });

  it("is empty only when all three reads completed and there is nothing to show", () => {
    expect(ledgerSectionStatus({ ledger: loaded, estimates: loaded, contract: loaded, rowCount: 0 })).toBe("empty");
    expect(ledgerSectionStatus({ ledger: loaded, estimates: loaded, contract: loaded, rowCount: 3 })).toBe("ready");
  });

  it("is ready, not empty, when the estimates or contract read failed with nothing cached", () => {
    expect(ledgerSectionStatus({ ledger: loaded, estimates: { isError: true }, contract: loaded, rowCount: 0 })).toBe("ready");
    expect(ledgerSectionStatus({ ledger: loaded, estimates: loaded, contract: { isError: true }, rowCount: 0 })).toBe("ready");
  });

  it("keeps a stale ledger (failed refresh with data cached) on screen as ready", () => {
    expect(ledgerSectionStatus({ ledger: { data: [1], isError: true }, estimates: loaded, contract: loaded, rowCount: 1 })).toBe("ready");
  });
});

describe("collectAllPages", () => {
  it("walks inclusive ranges until a short page and returns every row", async () => {
    const source = [1, 2, 3, 4, 5];
    const ranges: Array<[number, number]> = [];
    const rows = await collectAllPages<number>(async (from, to) => {
      ranges.push([from, to]);
      return { data: source.slice(from, to + 1), error: null };
    }, 2);
    expect(rows).toEqual(source);
    expect(ranges).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("stops after one page when it is already short, and defaults to the PostgREST cap", async () => {
    const ranges: Array<[number, number]> = [];
    const rows = await collectAllPages<number>(async (from, to) => {
      ranges.push([from, to]);
      return { data: [7], error: null };
    });
    expect(rows).toEqual([7]);
    expect(ranges).toEqual([[0, LEDGER_PAGE_SIZE - 1]]);
  });

  it("throws on a failed first page instead of returning an empty list", async () => {
    await expect(collectAllPages(async () => ({ data: null, error: { message: "permission denied", code: "42501" } }), 2)).rejects.toThrow(
      "You do not have permission to view this.",
    );
  });

  it("throws on a failed later page instead of returning the partial read", async () => {
    let calls = 0;
    await expect(
      collectAllPages<number>(async () => {
        calls += 1;
        return calls === 1 ? { data: [1, 2], error: null } : { data: null, error: new Error("socket closed") };
      }, 2),
    ).rejects.toThrow("socket closed");
  });

  it("throws when a page returns no result set", async () => {
    await expect(collectAllPages(async () => ({ data: null, error: null }), 2)).rejects.toThrow("no result set");
  });

  it("refuses to loop forever on a server that ignores the range", async () => {
    let calls = 0;
    await expect(
      collectAllPages<number>(async () => {
        calls += 1;
        return { data: [1, 2], error: null };
      }, 2),
    ).rejects.toThrow("more than");
    expect(calls).toBe(MAX_PAGES);
  });

  it("rejects a page size that is not a positive integer", async () => {
    await expect(collectAllPages(async () => ({ data: [], error: null }), 0)).rejects.toThrow(RangeError);
  });
});
