import { describe, expect, it } from "vitest";
import { homeForRoles } from "@/lib/homeForRoles";

describe("homeForRoles — where a sign-in link lands", () => {
  it("sends an admin to the dashboard, not the agent portal", () => {
    // The owner holds BOTH admin and agent. Admin must win.
    expect(homeForRoles(["admin", "agent"])).toBe("dashboard");
  });
  it("sends a manager to the dashboard", () => {
    expect(homeForRoles(["manager", "agent"])).toBe("dashboard");
  });
  it("sends a VA manager to the VA team page, ahead of any other role", () => {
    expect(homeForRoles(["va_manager", "admin"])).toBe("va-team");
  });
  it("sends a VA to the recovery queue", () => {
    expect(homeForRoles(["va"])).toBe("admin/recovery-queue");
  });
  it("keeps a plain agent, and anyone with no roles, on the agent portal", () => {
    expect(homeForRoles(["agent"])).toBe("agent-portal");
    expect(homeForRoles([])).toBe("agent-portal");
    expect(homeForRoles([null, undefined])).toBe("agent-portal");
  });
});
