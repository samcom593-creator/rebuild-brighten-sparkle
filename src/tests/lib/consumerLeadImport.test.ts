import { describe, expect, it } from "vitest";
import { consumerSourceDate, hasExplicitContactStop, parseConsumerTable, prepareConsumerImport } from "@/lib/consumerLeadImport";

describe("consumer source adapters", () => {
  it("retains the first master person, their consumer email and a source-only policy claim", () => {
    const row = [7, "Producer Example", "P7", "Taylor Example", "123 Example Way", "TN", "6152345678", "consumer@example.test", "1980-01-03", "", "Active (inforce)", "2021-02-03", "Whole life", "POLICY-DEMO", "75.00", "Example Carrier", "", "", "", "", "", "6159876543", "producer@example.test"];
    const preview = prepareConsumerImport([row], "master_pos");
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ email: "consumer@example.test", source_row: 1, policy_number: "POLICY-DEMO", phone_alt: null });
    expect(preview.rows[0].raw).toMatchObject({ supplier_amount: 75, supplier_amount_cadence: "unknown", policy_status_verified_at: null });
    expect(preview.rows[0]).not.toHaveProperty("policy_monthly_premium");
  });
  it("takes mortgage state from J, never from a VA loan type, and skips a header in the middle", () => {
    const row = ["7/2/2021", "Jordan Example", "8042345678", "", "jordan@example.test", "Interviewer", "Loan contact", "$250,000", "VA", "TX", "Investor", "do not call again"];
    const p = prepareConsumerImport([row, ["Date", "Borrower Name", "Borr Cell", "Borr Home Phone", "Borr Email"], row], "mortgage");
    expect(p.headersSkipped).toBe(1); expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ state: "TX", loan_type: "VA", loan_amount: 250000, dnc: true, last_disposition: "do not call" });
    expect(p.rows[0].raw.policy_ownership_claim).toBeNull();
  });
  it("holds Jt formula errors instead of deriving a state from the telephone", () => {
    const p = prepareConsumerImport([["Producer", "Jamie Example", "123 Example", "#NAME?", "6152345678", "2/3/1970", "3/4/2021", "Product", "DemoP", "$50", "called dint answer"]], "jt_pos");
    expect(p.rows[0]).toMatchObject({ state: null, last_disposition: "no answer" });
    expect(p.rows[0].raw.import_review_required).toBe(true);
  });
  it("keeps RFC 4180 cells and quoted multiline notes intact", () => {
    expect(parseConsumerTable('"Last, First",x,"one\ntwo"\r\n"a""b",y,z')).toEqual([["Last, First", "x", "one\ntwo"], ['a"b', "y", "z"]]);
    expect(() => parseConsumerTable('"unfinished')).toThrow();
  });
  it("rejects invalid calendar dates, malformed JSON and non-NANP suffixes", () => {
    expect(consumerSourceDate("2/30/2024")).toBeNull();
    expect(consumerSourceDate("2/29/2024")).toBe("2024-02-29");
    expect(consumerSourceDate("10-Aug-18")).toBe("2018-08-10");
    expect(consumerSourceDate("12-September-19")).toBe("2019-09-12");
    expect(() => parseConsumerTable('[{"phone":"x"}]')).toThrow();
    const p = prepareConsumerImport([["Producer", "Jamie Example", "Example", "TN", "+44 20 7946 0958"]], "jt_pos");
    expect(p.rows[0].phone_digits).toBeNull();
  });
  it("preserves stop-contact intent without treating no-answer as DNC", () => {
    expect(hasExplicitContactStop("don't call again")).toBe(true);
    expect(hasExplicitContactStop("remove my number")).toBe(true);
    expect(hasExplicitContactStop("no answer; callback requested")).toBe(false);
  });
});
