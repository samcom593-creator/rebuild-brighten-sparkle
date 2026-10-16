import { describe, expect, it } from "vitest";
import { accessRequirementRoles, describeAccessRequirement, safeHomeHref } from "@/lib/accessRequirement";

describe("describeAccessRequirement (the sentence a denied visitor reads)", () => {
  it("names the admin gate", () => {
    expect(describeAccessRequirement({ requireAdmin: true })).toBe("an admin account");
  });

  it("adds managers when the route lets them through", () => {
    expect(describeAccessRequirement({ requireAdmin: true, allowManagers: true })).toBe("an admin or manager account");
  });

  it("adds presenters and extra roles in the order the gate checks them", () => {
    expect(
      describeAccessRequirement({
        requireAdmin: true,
        allowManagers: true,
        allowPresenters: true,
        allowRoles: ["va_manager", "va", "recruiter"],
      }),
    ).toBe("an admin, manager, active presenter, VA manager, VA or recruiter account");
  });

  it("never repeats a role that is both allowed by flag and listed", () => {
    expect(accessRequirementRoles({ requireAdmin: true, allowManagers: true, allowRoles: ["manager", "admin"] })).toEqual([
      "admin",
      "manager",
    ]);
  });

  it("falls back to a readable label for a role it has no label for", () => {
    expect(describeAccessRequirement({ requireAdmin: true, allowRoles: ["night_shift"] })).toBe(
      "an admin or night shift account",
    );
  });

  it("describes an ungated route as needing only a sign-in", () => {
    expect(accessRequirementRoles({})).toEqual([]);
    expect(describeAccessRequirement({ requireAdmin: false, allowManagers: true })).toBe("a signed-in account");
  });
});

describe("safeHomeHref", () => {
  it("keeps VA managers on their own portal and sends everyone else to the Home at /dashboard", () => {
    expect(safeHomeHref({ isVaManager: true })).toBe("/va-team");
    expect(safeHomeHref({ isVaManager: false })).toBe("/dashboard");
    expect(safeHomeHref({})).toBe("/dashboard");
  });
});
