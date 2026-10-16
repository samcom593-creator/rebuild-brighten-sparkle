import { describe, expect, it } from "vitest";
import { ageEquation, ageFromDob, dobDisplay, realDob, splitClientName } from "@/lib/clientFacts";

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

  it("reads the carriers' 1900-01-01 placeholder and impossible dates as not on file, never as a 126-year-old", () => {
    const today = new Date(2026, 9, 16);
    expect(realDob("1900-01-01", today)).toBeNull();
    expect(ageFromDob("1900-01-01", today)).toBeNull();
    expect(dobDisplay("1900-01-01")).toBeNull();
    expect(realDob("2027-01-01", today)).toBeNull(); // not born yet
    expect(realDob("1958-13-01", today)).toBeNull();
    expect(realDob("1958-03-07T00:00:00Z", today)).toBe("1958-03-07");
    expect(realDob("2020-05-01", today)).toBe("2020-05-01"); // a child's policy is real
  });

  it("shows the age arithmetic, minus one before this year's birthday", () => {
    const today = new Date(2026, 9, 16); // Oct 16 2026
    expect(ageEquation("1958-03-07", today)).toEqual({ age: 68, text: "2026 − 1958 = 68" });
    expect(ageEquation("1958-11-03", today)).toEqual({ age: 67, text: "2026 − 1958 − 1 = 67 (birthday Nov 3 not yet)" });
    expect(ageEquation("1958-10-16", today)).toEqual({ age: 68, text: "2026 − 1958 = 68" }); // birthday today
    expect(ageEquation("1900-01-01", today)).toBeNull();
    expect(ageEquation(null, today)).toBeNull();
  });

  it("splits a client name into first and the rest", () => {
    expect(splitClientName("Mary Ann Smith")).toEqual({ firstName: "Mary", lastName: "Ann Smith" });
    expect(splitClientName("  Cher ")).toEqual({ firstName: "Cher", lastName: "" });
    expect(splitClientName(null)).toEqual({ firstName: "", lastName: "" });
  });
});
