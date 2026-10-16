import { describe, expect, it } from "vitest";
import { refLinkOutcome } from "@/lib/refLinkNotice";

describe("refLinkOutcome", () => {
  it("credits a resolved agent and trims the display name", () => {
    expect(refLinkOutcome({ resolved: true, agent_id: "a1", display_name: " Jontay Taylor " }, null)).toEqual({
      kind: "credited",
      agentId: "a1",
      displayName: "Jontay Taylor",
    });
  });

  it("a resolved payload without an agent id is not a credit", () => {
    expect(refLinkOutcome({ resolved: true }, null).kind).toBe("unknown");
  });

  it("an unknown code gets a public message that still invites the application", () => {
    const out = refLinkOutcome({ resolved: false }, null);
    expect(out.kind).toBe("unknown");
    expect(out).toMatchObject({ message: expect.stringContaining("not recognized") });
    expect(out).toMatchObject({ message: expect.stringContaining("still apply") });
  });

  it("a deactivated agent is named as such, not as an unknown link", () => {
    const out = refLinkOutcome({ resolved: false, reason: "deactivated" }, null);
    expect(out.kind).toBe("deactivated");
    expect(out).toMatchObject({ message: expect.stringContaining("no longer active") });
  });

  it("a failed call is unchecked, never reported as a bad link", () => {
    const out = refLinkOutcome(undefined, { message: "Failed to fetch" });
    expect(out.kind).toBe("unchecked");
    expect(out).toMatchObject({ message: expect.stringContaining("could not check") });
  });

  it("garbage payloads are unknown, not a crash", () => {
    expect(refLinkOutcome("nope", null).kind).toBe("unknown");
    expect(refLinkOutcome(null, null).kind).toBe("unknown");
  });
});
