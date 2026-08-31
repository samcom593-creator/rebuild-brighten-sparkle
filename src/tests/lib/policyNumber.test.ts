import { describe, expect, it } from "vitest";
import { normalizePolicyNumber, sanitizePolicyInput } from "@/lib/policyNumber";

describe("normalizePolicyNumber", () => {
  it("accepts the exact paste that lost a deal on 2026-08-28", () => {
    expect(normalizePolicyNumber("3002725\t")).toBe("3002725");
  });

  it("strips the invisibles a browser copy drags along", () => {
    expect(normalizePolicyNumber(" TA5055501079\u200b")).toBe("TA5055501079");
    expect(normalizePolicyNumber("\ufeffAMH6326916")).toBe("AMH6326916");
    expect(normalizePolicyNumber("\nPOL 123\r\n")).toBe("POL 123");
    expect(normalizePolicyNumber("\u00a0POL9\u00a0")).toBe("POL9");
  });

  it("still reduces a whitespace-only entry to nothing, so the server refuses it", () => {
    expect(normalizePolicyNumber("\t \n")).toBe("");
    expect(normalizePolicyNumber(null)).toBe("");
  });

  it("leaves an ordinary number untouched", () => {
    expect(normalizePolicyNumber("AB-12/34")).toBe("AB-12/34");
    expect(normalizePolicyNumber("0056759380")).toBe("0056759380");
  });

  it("does not trim while typing, so an internal space survives keystrokes", () => {
    expect(sanitizePolicyInput("POL 1")).toBe("POL 1");
    expect(sanitizePolicyInput("POL ")).toBe("POL ");
    expect(sanitizePolicyInput("POL\t")).toBe("POL ");
  });
});
