import { describe, expect, it } from "vitest";
import { isPlausibleEmail, normalizeEmailInput, suggestEmailCorrection } from "@/lib/emailValidation";

describe("email entry hygiene", () => {
  it("suggests, never rewrites: common domain typos map to the real provider", () => {
    expect(suggestEmailCorrection("Jane.Doe@GMAI.com ")).toBe("jane.doe@gmail.com");
    expect(suggestEmailCorrection("x@gmil.com")).toBe("x@gmail.com");
    expect(suggestEmailCorrection("x@yahoo.con")).toBe("x@yahoo.com");
    expect(suggestEmailCorrection("x@company.cmo")).toBe("x@company.com");
  });
  it("stays quiet for correct or unknown domains and for partial input", () => {
    expect(suggestEmailCorrection("x@gmail.com")).toBeNull();
    expect(suggestEmailCorrection("x@apex-financial.org")).toBeNull();
    expect(suggestEmailCorrection("x@")).toBeNull();
    expect(suggestEmailCorrection("")).toBeNull();
  });
  it("normalizes for comparison and rejects malformed addresses", () => {
    expect(normalizeEmailInput("  A@B.CO ")).toBe("a@b.co");
    expect(isPlausibleEmail("a@b.co")).toBe(true);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a..b@c.com")).toBe(false);
    expect(isPlausibleEmail("a b@c.com")).toBe(false);
  });
});
