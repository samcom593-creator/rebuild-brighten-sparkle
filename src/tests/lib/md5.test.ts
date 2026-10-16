/**
 * md5Hex must return exactly what Postgres md5(text) returns, because
 * commissionLedger pairs a ledger row with its production row by reproducing
 * agentlink_book.deal_key = md5(<AgentLink deal id>). Every expected value
 * below was produced by md5() on project xrzweoneiieddzxogewk (2026-10-15);
 * the first four and the last are also the RFC 1321 test suite.
 */
import { describe, expect, it } from "vitest";
import { md5Hex } from "@/lib/md5";

describe("md5Hex", () => {
  it("matches the RFC 1321 vectors as Postgres computes them", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890")).toBe(
      "57edf4a22be3c955ac49da2e2107b67a",
    );
  });

  it("pads correctly on both sides of every block boundary", () => {
    expect(md5Hex("7".repeat(55))).toBe("9f3005012df6086429b856844bf31094");
    expect(md5Hex("7".repeat(56))).toBe("2716015f6878cf7d3fe72a98699e4318");
    expect(md5Hex("7".repeat(63))).toBe("6ed5481d825497660c7fe98d2d7eb69c");
    expect(md5Hex("7".repeat(64))).toBe("6bd57f3f25af796833b12721d82e9272");
    expect(md5Hex("7".repeat(65))).toBe("a347b31d6be98db34a78fbdac6c79f83");
  });

  it("hashes the UTF-8 bytes, as Postgres does on a UTF8 database", () => {
    expect(md5Hex("héllo wörld")).toBe("ed0c22cc110ede12327851863c078138");
  });

  it("reproduces a live production row key from its AgentLink deal id", () => {
    // deals.external_deal_id '1027' (a commission_ledger deal) sits in v_production_comp_truth under this row_key.
    expect(md5Hex("1027")).toBe("883e881bb4d22a7add958f2d6b052c9f");
    expect(md5Hex("992")).toBe("860320be12a1c050cd7731794e231bd3");
  });
});
