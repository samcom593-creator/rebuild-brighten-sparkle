import { describe, expect, it } from "vitest";
import { parseCarrierContractReceipts } from "@/lib/carrierContractReceipts";

const empty = { chubb: false, chubb_at: null, ethos: false, ethos_at: null, ahl: false, ahl_at: null, ahl_exempt: false };

describe("verified carrier receipt payloads", () => {
  it("preserves true saved receipt dates and hierarchy exemption without converting other carriers into requirements", () => {
    const payload = { ...empty, ethos: true, ethos_at: "2026-11-24T17:30:00Z", ahl_exempt: true, source: "contract_review_marks" };
    expect(parseCarrierContractReceipts(payload)).toEqual({ ...empty, ethos: true, ethos_at: payload.ethos_at, ahl_exempt: true });
    expect(payload.source).toBe("contract_review_marks");
  });
  it("accepts a verified empty receipt state", () => expect(parseCarrierContractReceipts(empty)).toEqual(empty));
  it.each([null, undefined, [], {}, "", { ...empty, ethos: "false" }, { ...empty, ahl_exempt: null }, { ...empty, chubb_at: "not-a-date" }, { ...empty, ethos_at: undefined }])("rejects unavailable or malformed data instead of inventing unreceived contracts: %j", (payload) => {
    expect(() => parseCarrierContractReceipts(payload)).toThrow();
  });
  it.each([{ ...empty, chubb: true }, { ...empty, ahl_at: "2026-11-24T17:30:00Z" }])("rejects a date that contradicts receipt state", (payload) => {
    expect(() => parseCarrierContractReceipts(payload)).toThrow("did not agree");
  });
});
