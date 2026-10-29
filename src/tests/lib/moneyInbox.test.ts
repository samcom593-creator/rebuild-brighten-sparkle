import { describe, it, expect } from "vitest";
import {
  absoluteTime,
  relativeTime,
  phoenixDay,
  contactLabel,
} from "@/lib/moneyInbox";
describe("Money Inbox time and identity", () => {
  it("uses Arizona rather than browser zone or UTC day", () => {
    expect(absoluteTime("2026-10-29T00:42:00Z")).toBe("Oct 28, 5:42 PM MST");
    expect(phoenixDay("2026-10-29T00:42:00Z")).toBe("2026-10-28");
  });
  it("handles absent, future, and relative timestamps honestly", () => {
    expect(relativeTime(null)).toBe("Time unavailable");
    expect(
      relativeTime("2026-10-28T12:00:00Z", Date.parse("2026-10-28T12:12:00Z")),
    ).toBe("12m ago");
    expect(relativeTime("2027-01-01", 0)).toContain("future");
  });
  it("preserves email and formats US numbers", () => {
    expect(contactLabel(null, "+14697676068")).toBe("(469) 767-6068");
    expect(contactLabel(null, "sam@example.com")).toBe("sam@example.com");
  });
});
