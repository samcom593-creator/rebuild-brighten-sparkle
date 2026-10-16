import { describe, expect, it } from "vitest";
import { ageFromDob, dobDisplay, splitClientName } from "@/lib/clientFacts";

describe("clientFacts", () => {
  it("reads whole years of age and refuses dates it cannot place", () => {
    const today = new Date(2026, 9, 16); // Oct 16 2026, local
    expect(ageFromDob("1958-03-07", today)).toBe(68);
    expect(ageFromDob("1958-10-17", today)).toBe(67); // birthday tomorrow
    expect(ageFromDob("1958-10-16", today)).toBe(68); // birthday today
    expect(ageFromDob("not a date", today)).toBeNull();
    expect(ageFromDob(null, today)).toBeNull();
  });

  it("shows a date of birth the way an application asks for it", () => {
    expect(dobDisplay("1958-03-07")).toBe("03/07/1958");
    expect(dobDisplay("1958-03-07T00:00:00Z")).toBe("03/07/1958");
    expect(dobDisplay("")).toBeNull();
  });

  it("splits a client name into first and the rest", () => {
    expect(splitClientName("Mary Ann Smith")).toEqual({ firstName: "Mary", lastName: "Ann Smith" });
    expect(splitClientName("  Cher ")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitClientName(null)).toEqual({ firstName: "", lastName: "" });
  });
});
