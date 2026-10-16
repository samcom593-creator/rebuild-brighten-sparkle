import { describe, expect, it } from "vitest";
import { legacyRedirectTarget } from "@/lib/legacyRedirect";

describe("legacyRedirectTarget (one-hop aliases keep what the visitor brought)", () => {
  it("returns the bare target when the visitor brought nothing", () => {
    expect(legacyRedirectTarget("/dashboard/team", { search: "", hash: "" })).toBe("/dashboard/team");
    expect(legacyRedirectTarget("/dashboard/team", {})).toBe("/dashboard/team");
  });

  it("keeps the visitor's query string", () => {
    expect(legacyRedirectTarget("/dashboard/team", { search: "?tab=roster&q=jo", hash: "" })).toBe(
      "/dashboard/team?tab=roster&q=jo",
    );
  });

  it("keeps the visitor's hash", () => {
    expect(legacyRedirectTarget("/dashboard/team", { search: "", hash: "#row-12" })).toBe("/dashboard/team#row-12");
    expect(legacyRedirectTarget("/dashboard/team", { search: "?q=a", hash: "#row-12" })).toBe("/dashboard/team?q=a#row-12");
  });

  it("merges a target that carries its own query without a second '?'", () => {
    const out = legacyRedirectTarget("/dashboard/team?view=contracting", { search: "?view=cases&q=a", hash: "" });
    expect(out).toBe("/dashboard/team?view=contracting&q=a");
    expect(out.split("?").length - 1).toBe(1);
  });

  it("keeps the target's own query when the visitor brought none", () => {
    expect(legacyRedirectTarget("/dashboard/launch-board?tab=queue", { search: "", hash: "" })).toBe(
      "/dashboard/launch-board?tab=queue",
    );
  });

  it("lets the target's keys win because the alias names a specific view", () => {
    expect(legacyRedirectTarget("/dashboard/launch-board?tab=queue", { search: "?tab=winners", hash: "" })).toBe(
      "/dashboard/launch-board?tab=queue",
    );
  });

  it("prefers the visitor's hash over the target's, and falls back to the target's", () => {
    expect(legacyRedirectTarget("/dashboard/team#top", { search: "", hash: "#row-3" })).toBe("/dashboard/team#row-3");
    expect(legacyRedirectTarget("/dashboard/team#top", { search: "", hash: "" })).toBe("/dashboard/team#top");
    expect(legacyRedirectTarget("/dashboard/team#top", { search: "", hash: "#" })).toBe("/dashboard/team#top");
  });

  it("tolerates a search string without the leading '?' and null fields", () => {
    expect(legacyRedirectTarget("/dashboard/team", { search: "q=a", hash: null })).toBe("/dashboard/team?q=a");
    expect(legacyRedirectTarget("/dashboard/team", { search: null, hash: null })).toBe("/dashboard/team");
  });
});
