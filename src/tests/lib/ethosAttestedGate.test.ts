import { describe, expect, test } from "vitest";
// The SAME gate the dispatcher runs before any Ethos signup write.
import { evaluateSignupGate, SIGNUP_HEADERS, S } from "../../../supabase/functions/_shared/ethos-contract.ts";

// MP-304: a manager attests licence/E&O for their own downline. Attested must (1) pass the gate, (2) never read as
// verified — every attested item is a REVIEW finding on the receipt, (3) write K/L from the attestation, never a
// hardcoded TRUE, and (4) be impossible to fake by setting evidence_mode alone.
const NOW = Date.parse("2026-11-23T20:00:00Z");
const cand = { first_name: "Test", last_name: "Agent", npn: "21000001", mobile: "+15550100001", email: "test.agent@example.com" };
const approvalBase = {
  approved_comp_level: "Level 12", approved_advance_tier: "6 Month Advance", approved_upline_npn: "21346366",
  approved_sub_agency: "Apex Financial Empire", approved_sub_agent_head: false, approved_by: "mgr-1", approved_at: "2026-11-23T19:00:00Z",
  contact_confirmed_at: "2026-11-23T19:00:00Z",
};
const attested = { ...approvalBase, evidence_mode: "attested", attested_by: "mgr-1", attested_at: "2026-11-23T19:00:00Z", license_attested: true, eo_attested: true };
const codes = (list: { code: string }[]) => list.map((x) => x.code);
const sheet = [[...SIGNUP_HEADERS]];

describe("ethos gate · attested evidence (MP-304)", () => {
  test("attested licence + E&O: ready, no blockers, three review findings, K/L true", () => {
    const g = evaluateSignupGate(cand, attested, { now: NOW, sheetRows: sheet });
    expect(g.blockers).toEqual([]);
    expect(g.ready).toBe(true);
    expect(codes(g.review)).toEqual(expect.arrayContaining(["npn_attested_not_verified", "license_attested_not_verified", "eo_attested_not_verified"]));
    expect(g.payload?.[S.LICENSED]).toBe(true);
    expect(g.payload?.[S.EO]).toBe(true);
    expect(g.payload?.[S.LEVEL]).toBe("Level 12");
    expect(g.payload?.[S.ADVANCE]).toBe("6 Month Advance");
  });

  test("E&O not attested: still ready, column L is FALSE (never a hardcoded TRUE), review says so", () => {
    const g = evaluateSignupGate(cand, { ...attested, eo_attested: false }, { now: NOW, sheetRows: sheet });
    expect(g.ready).toBe(true);
    expect(g.payload?.[S.EO]).toBe(false);
    expect(codes(g.review)).toContain("eo_not_attested");
  });

  test("licence not attested: BLOCKED — Ethos contracts licensed agents only", () => {
    const g = evaluateSignupGate(cand, { ...attested, license_attested: false }, { now: NOW, sheetRows: sheet });
    expect(g.ready).toBe(false);
    expect(codes(g.blockers)).toContain("license_not_attested");
    expect(g.payload).toBeNull();
  });

  test("evidence_mode alone is not an attestation: without attested_by/at the verified rules apply", () => {
    const g = evaluateSignupGate(cand, { ...approvalBase, evidence_mode: "attested", license_attested: true, eo_attested: true }, { now: NOW, sheetRows: sheet });
    expect(g.ready).toBe(false);
    expect(codes(g.blockers)).toEqual(expect.arrayContaining(["npn_not_verified", "license_not_verified", "eo_not_verified"]));
  });

  test("verified mode is unchanged: K/L true from verification, no attested review codes", () => {
    const verified = { ...approvalBase, npn_verified_at: "2026-10-01T00:00:00Z", license_verified_at: "2026-10-01T00:00:00Z", eo_verified_at: "2026-10-01T00:00:00Z", eo_expires_at: "2027-06-30" };
    const g = evaluateSignupGate(cand, verified, { now: NOW, sheetRows: sheet });
    expect(g.ready).toBe(true);
    expect(g.payload?.[S.LICENSED]).toBe(true);
    expect(g.payload?.[S.EO]).toBe(true);
    expect(codes(g.review)).not.toContain("npn_attested_not_verified");
  });
});
