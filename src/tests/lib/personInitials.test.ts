import { describe, expect, it } from "vitest";
import { firstGrapheme, personInitials } from "@/lib/personInitials";

describe("person initials", () => {
  it("preserves an entire emoji sequence and combined letter", () => {
    expect(personInitials("👩🏽‍💻 Jamie Rivera")).toBe("👩🏽‍💻J");
    expect(firstGrapheme("e\u0301mile")).toBe("e\u0301");
  });
  it("handles RTL, whitespace, short and missing names", () => {
    expect(personInitials("محمد عبد الرحمن")).toBe("مع");
    expect(personInitials("  Sam   Lee ")).toBe("SL");
    expect(personInitials("J")).toBe("J");
    expect(personInitials(null)).toBe("?");
    expect(firstGrapheme(null)).toBe("");
  });
});
