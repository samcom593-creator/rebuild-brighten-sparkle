import { describe, expect, it } from "vitest";
import { externalHref } from "@/lib/externalHref";

describe("externalHref", () => {
  it("adds a scheme to the bare domains that shipped in prod", () => {
    // The three live carrier rows, measured 2026-09-09 against the carriers
    // table. Without a scheme each resolved same-origin into the catch-all.
    expect(externalHref("aflac.com")).toBe("https://aflac.com/");
    expect(externalHref("gtlic.com")).toBe("https://gtlic.com/");
    expect(externalHref("instabrain.io")).toBe("https://instabrain.io/");
  });

  it("leaves a real URL alone", () => {
    expect(externalHref("https://www.newbridgelife.com/")).toBe("https://www.newbridgelife.com/");
    expect(externalHref("http://example.com/path?a=1")).toBe("http://example.com/path?a=1");
  });

  it("handles protocol-relative and surrounding whitespace", () => {
    expect(externalHref("//example.com")).toBe("https://example.com/");
    expect(externalHref("  aflac.com  ")).toBe("https://aflac.com/");
  });

  it("returns null instead of a link that goes nowhere", () => {
    expect(externalHref(null)).toBeNull();
    expect(externalHref(undefined)).toBeNull();
    expect(externalHref("")).toBeNull();
    expect(externalHref("   ")).toBeNull();
    // No dot in the host: "No URL on file" is the honest render, not a link.
    expect(externalHref("not a url")).toBeNull();
    expect(externalHref("https://")).toBeNull();
  });

  it("refuses a non-http scheme rather than passing it into an href", () => {
    // A database column reaching an href is an XSS sink if any scheme is let
    // through. These must not become links.
    expect(externalHref("javascript:alert(1)")).toBeNull();
    expect(externalHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(externalHref("mailto:a@b.com")).toBeNull();
  });
});
