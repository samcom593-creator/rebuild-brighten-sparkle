import { describe, expect, it } from "vitest";
import { buildAflacNotice } from "../../../supabase/functions/_shared/aflac-notice.ts";

describe("buildAflacNotice", () => {
  it("tells a licensed hire that Aflac emails them right away, using the brand name", () => {
    const n = buildAflacNotice({ firstName: "Dana", email: "dana@example.com" });
    expect(n.subject).toMatch(/Aflac/);
    expect(n.text).toContain("Dana");
    expect(n.text).toMatch(/Aflac will email you directly right away/);
    expect(n.text).toContain("Galaxy Financial");
    expect(n.html).toContain("Galaxy Financial");
  });

  it("escapes markup in a name so a hostile first name cannot inject HTML", () => {
    const n = buildAflacNotice({ firstName: '<img src=x onerror=alert(1)>', email: "x@example.com" });
    expect(n.html).not.toContain("<img");
    expect(n.html).toContain("&lt;img");
  });

  it("does not promise a sender address or a delivery time it cannot know", () => {
    const n = buildAflacNotice({ firstName: "Sam", email: "s@example.com" });
    expect(n.text).not.toMatch(/@aflac\.com/i);
    expect(n.text).not.toMatch(/within \d+ (minutes|hours)/i);
  });

  it("falls back gracefully when the first name is blank", () => {
    const n = buildAflacNotice({ firstName: "   ", email: "s@example.com" });
    expect(n.html).toContain("there, your Aflac onboarding");
  });
});
