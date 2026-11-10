// WP2 (onboarding audit 2026-11-10): the SPA and the edge functions must send a recruit to
// the SAME booking event for the same lifecycle step. Before this, the page embedded one
// licensed event, the welcome email and seminar-confirmation sent another, and the outreach
// templates sent unlicensed recruits the licensed call. The two sources cannot import each
// other (Vite vs Deno), so this test holds them equal.
import { describe, expect, it } from "vitest";
import {
  buildBookingUrl as spaBuild,
  LICENSING_COST as SPA_COST,
  SCHEDULING_LINKS as SPA,
} from "@/lib/apexConfig";
import {
  buildBookingUrl as edgeBuild,
  SCHEDULING_LINKS as EDGE,
  statusPageUrl,
} from "../../../supabase/functions/_shared/scheduling-links.ts";
import { LICENSING_COST as EDGE_COST } from "../../../supabase/functions/_shared/licensing-cost.ts";

const SHARED_KEYS = ["licensing", "unlicensed", "licensed", "onboarding", "questions"] as const;

describe("scheduling links parity (src/lib/apexConfig.ts <-> _shared/scheduling-links.ts)", () => {
  it.each(SHARED_KEYS)("%s is identical in both sources", (key) => {
    expect(EDGE[key]).toBe(SPA[key]);
  });

  it("the edge copy has no key the SPA lacks", () => {
    for (const key of Object.keys(EDGE)) expect(Object.keys(SPA)).toContain(key);
  });

  it("unlicensed is an alias of the licensing call, never the licensed-track event", () => {
    expect(SPA.unlicensed).toBe(SPA.licensing);
    expect(SPA.licensing).not.toBe(SPA.licensed);
    expect(SPA.licensing).toMatch(/\/licensing-call$/);
  });

  it("booking URLs are built the same way on both sides", () => {
    const cases = [
      [SPA.licensed, { applicationId: "app-1", firstName: "Jo", lastName: "Doe", email: "jo@example.com" }],
      [SPA.licensing, { applicationId: "app-2", firstName: "Jo" }],
      [SPA.onboarding, {}],
      [SPA.licensing, { applicationId: null, firstName: " ", lastName: null }],
    ] as const;
    for (const [base, prefill] of cases) {
      expect(edgeBuild(base, prefill)).toBe(spaBuild(base, prefill));
    }
  });

  it("a booking link carries utm_content=<application id> for webhook matching", () => {
    const url = new URL(spaBuild(SPA.licensing, { applicationId: "app-9", firstName: "Jo", lastName: "Doe" }));
    expect(url.searchParams.get("utm_source")).toBe("apply");
    expect(url.searchParams.get("utm_content")).toBe("app-9");
    expect(url.searchParams.get("name")).toBe("Jo Doe");
  });

  it("the status page is the unlicensed destination in emails", () => {
    expect(statusPageUrl("abc")).toBe("https://apex-financial.org/status/abc");
  });
});

describe("licensing cost parity (no cost claim until Sam answers N1)", () => {
  it("both copies are identical", () => {
    expect(EDGE_COST).toEqual(SPA_COST);
  });

  it("makes no claim about who pays while whoPays is null", () => {
    expect(SPA_COST.whoPays).toBeNull();
    for (const text of [SPA_COST.title, SPA_COST.short, SPA_COST.askFirst]) {
      expect(text).not.toMatch(/we (cover|pay|reimburse)|galaxy pays|on us|free|no upfront/i);
    }
  });
});
