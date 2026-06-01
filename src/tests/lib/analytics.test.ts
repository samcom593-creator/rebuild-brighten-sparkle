/**
 * analytics.test.ts
 *
 * Tests for src/lib/analytics.ts — the universal fan-out analytics shim
 * (GA4 + PostHog + Meta Pixel).
 *
 * Coverage targets:
 *   ✅ scrubMetaProps — strips email, phone, first_name, last_name, address (PII)
 *   ✅ scrubMetaProps — retains non-PII props
 *   ✅ track — fans out to gtag when configured
 *   ✅ track — fans out to posthog.capture when configured
 *   ✅ track — fires Meta Pixel only for mapped standard events
 *   ✅ track — does NOT fire Meta for unmapped events
 *   ✅ track — does not throw when no vendors are configured
 *   ✅ track — swallows individual vendor errors silently
 *   ✅ identify — calls posthog.identify with correct args
 *   ✅ identify — calls gtag set with user_id
 *   ✅ identify — does not throw when vendors are absent
 *   ✅ pageView — does not throw, fires track("page_view", ...)
 *   ✅ META_EVENT_MAP — apply_start→Lead, apply_submitted→CompleteRegistration,
 *                       hero_cta_click→InitiateCheckout, page_view→PageView
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { track, identify, pageView } from "@/lib/analytics";

// scrubMetaProps is private — we exercise it by triggering a mapped Meta event
// (apply_submitted → CompleteRegistration) so the fbq call goes through scrubMetaProps.

function setupVendors() {
  (window as any).gtag = vi.fn();
  (window as any).posthog = {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  };
  (window as any).fbq = vi.fn();
}

function teardownVendors() {
  delete (window as any).gtag;
  delete (window as any).posthog;
  delete (window as any).fbq;
}

beforeEach(() => {
  teardownVendors();
});

// ── scrubMetaProps (via track with mapped events) ────────────────────────────
describe("PII scrubbing (scrubMetaProps via Meta Pixel)", () => {
  beforeEach(setupVendors);

  it("strips email from props sent to Meta Pixel", () => {
    track("apply_submitted", { email: "sam@test.com", step: "final" });
    const props = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(props).not.toHaveProperty("email");
    expect(props).toHaveProperty("step", "final");
  });

  it("strips phone from Meta Pixel props", () => {
    track("apply_submitted", { phone: "555-1234", source: "organic" });
    const props = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(props).not.toHaveProperty("phone");
    expect(props).toHaveProperty("source", "organic");
  });

  it("strips first_name and last_name", () => {
    track("apply_submitted", { first_name: "Sam", last_name: "James", utm: "ig" });
    const props = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(props).not.toHaveProperty("first_name");
    expect(props).not.toHaveProperty("last_name");
    expect(props).toHaveProperty("utm", "ig");
  });

  it("strips address-related keys", () => {
    track("apply_submitted", { address: "123 Main St", city: "Chicago" });
    const props = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(props).not.toHaveProperty("address");
    // city is not in the PII list, so it passes through
    expect(props).toHaveProperty("city", "Chicago");
  });

  it("strips userEmail (case-insensitive match on 'email' substring)", () => {
    track("apply_submitted", { userEmail: "x@y.com", value: 1 });
    const props = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(props).not.toHaveProperty("userEmail");
  });

  it("retains all non-PII props", () => {
    track("apply_submitted", { utm_source: "ig", step: 3, licensed: false });
    const props = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<string, unknown>;
    expect(props).toEqual({ utm_source: "ig", step: 3, licensed: false });
  });
});

// ── META_EVENT_MAP — correct event mapping ────────────────────────────────────
describe("track — Meta Pixel event mapping", () => {
  beforeEach(setupVendors);

  it("maps page_view → PageView", () => {
    track("page_view", {});
    const [, event] = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(event).toBe("PageView");
  });

  it("maps apply_start → Lead", () => {
    track("apply_start", {});
    const [, event] = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(event).toBe("Lead");
  });

  it("maps apply_submitted → CompleteRegistration", () => {
    track("apply_submitted", {});
    const [, event] = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(event).toBe("CompleteRegistration");
  });

  it("maps hero_cta_click → InitiateCheckout", () => {
    track("hero_cta_click", {});
    const [, event] = (window.fbq as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(event).toBe("InitiateCheckout");
  });

  it("does NOT fire Meta for unmapped events", () => {
    (window as any).fbq = vi.fn();
    track("some_internal_event", { foo: "bar" });
    expect(window.fbq).not.toHaveBeenCalled();
  });
});

// ── track — fan-out to all vendors ───────────────────────────────────────────
describe("track — vendor fan-out", () => {
  it("calls gtag when window.gtag is set", () => {
    (window as any).gtag = vi.fn();
    track("page_view", { path: "/dashboard" });
    expect(window.gtag).toHaveBeenCalledWith("event", "page_view", { path: "/dashboard" });
  });

  it("calls posthog.capture when configured", () => {
    (window as any).posthog = { capture: vi.fn() };
    track("hero_cta_click", { cta: "apply" });
    expect(window.posthog.capture).toHaveBeenCalledWith("hero_cta_click", { cta: "apply" });
  });

  it("does not throw when no vendors are configured", () => {
    teardownVendors();
    expect(() => track("anything", { a: 1 })).not.toThrow();
  });

  it("does not throw when gtag throws internally", () => {
    (window as any).gtag = vi.fn().mockImplementation(() => { throw new Error("gtag exploded"); });
    expect(() => track("page_view", {})).not.toThrow();
  });

  it("does not throw when posthog.capture throws internally", () => {
    (window as any).posthog = { capture: vi.fn().mockImplementation(() => { throw new Error("ph exploded"); }) };
    expect(() => track("page_view", {})).not.toThrow();
  });

  it("still fans out to other vendors even if one throws", () => {
    (window as any).gtag = vi.fn().mockImplementation(() => { throw new Error("gtag down"); });
    (window as any).posthog = { capture: vi.fn() };
    track("page_view", {});
    expect(window.posthog.capture).toHaveBeenCalled();
  });
});

// ── identify ──────────────────────────────────────────────────────────────────
describe("identify", () => {
  it("calls posthog.identify with user id and props", () => {
    (window as any).posthog = { identify: vi.fn() };
    identify("user-abc", { plan: "elite" });
    expect(window.posthog.identify).toHaveBeenCalledWith("user-abc", { plan: "elite" });
  });

  it("calls gtag set with user_id", () => {
    (window as any).gtag = vi.fn();
    identify("user-abc");
    expect(window.gtag).toHaveBeenCalledWith("set", { user_id: "user-abc" });
  });

  it("does not throw when no vendors configured", () => {
    teardownVendors();
    expect(() => identify("user-xyz")).not.toThrow();
  });
});

// ── pageView ──────────────────────────────────────────────────────────────────
describe("pageView", () => {
  it("does not throw when called", () => {
    (window as any).gtag = vi.fn();
    (window as any).posthog = { capture: vi.fn() };
    expect(() => pageView("/apply")).not.toThrow();
  });

  it("fans the event to gtag as 'page_view'", () => {
    (window as any).gtag = vi.fn();
    pageView("/dashboard");
    expect(window.gtag).toHaveBeenCalledWith("event", "page_view", expect.objectContaining({ path: "/dashboard" }));
  });

  it("does not throw when no vendors configured", () => {
    teardownVendors();
    expect(() => pageView("/")).not.toThrow();
  });
});
