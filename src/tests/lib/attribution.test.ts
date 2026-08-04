/**
 * attribution.test.ts
 *
 * Tests for src/lib/attribution.ts — first-touch + last-touch marketing
 * attribution capture.
 *
 * The bug these lock down (2026-08-04): Apply.tsx read utm_* straight off the
 * /apply URL at submit time. A visitor landing on /?utm_source=google&gclid=...
 * and clicking through to /apply lost every param on the client-side route
 * change, so 776 of 783 production applications recorded utm_source = NULL and
 * gclid was never captured at all.
 *
 * Coverage targets:
 *   ✅ captureAttribution — stores first-touch when the landing URL has params
 *   ✅ first-touch SURVIVES a simulated navigation to a param-less URL
 *   ✅ first-touch is NEVER overwritten by a later campaign
 *   ✅ last-touch DOES update on a later campaign (first-touch stays intact)
 *   ✅ gclid + the other click ids are captured
 *   ✅ no signal (no params, no external referrer) stores nothing
 *   ✅ external referrer alone counts as a signal; internal referrer does not
 *   ✅ referrer is reduced to origin + pathname (no query leak)
 *   ✅ absurdly long param values are dropped
 *   ✅ getAttribution falls back to the live URL when nothing is stored
 *   ✅ localStorage throwing does NOT crash capture or read (in-memory fallback)
 *   ✅ attributionJson carries first + last + current snapshots
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  captureAttribution,
  getAttribution,
  getFirstTouch,
  getLastTouch,
  clearAttribution,
} from "@/lib/attribution";

const ORIGIN = "http://localhost:3000";

/**
 * jsdom 26 under this vitest setup does not expose window.localStorage /
 * window.sessionStorage (verified: both are `undefined` while the `Storage`
 * constructor exists). The module under test is written to survive exactly
 * that — but these tests need real storage to prove persistence works, so we
 * install a minimal spec-shaped implementation per file.
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
}

function installStorage(): void {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

/** Point jsdom at a URL without triggering a real navigation. */
function navigateTo(path: string, referrer = ""): void {
  window.history.replaceState({}, "", path);
  Object.defineProperty(document, "referrer", {
    value: referrer,
    configurable: true,
  });
}

beforeEach(() => {
  installStorage();
  clearAttribution();
  navigateTo("/");
});

afterEach(() => {
  vi.restoreAllMocks();
  clearAttribution();
});

// ── first-touch capture + persistence ────────────────────────────────────────
describe("captureAttribution — first touch", () => {
  it("stores first-touch when the landing URL carries campaign params", () => {
    navigateTo("/?utm_source=google&utm_medium=cpc&utm_campaign=agents");
    captureAttribution();

    const first = getFirstTouch();
    expect(first).not.toBeNull();
    expect(first?.params.utm_source).toBe("google");
    expect(first?.params.utm_medium).toBe("cpc");
    expect(first?.params.utm_campaign).toBe("agents");
  });

  it("SURVIVES navigation to a param-less URL — the actual production bug", () => {
    // 1. Visitor lands on the paid link.
    navigateTo("/?utm_source=google&utm_medium=cpc&gclid=Cj0KCQiA_TEST");
    captureAttribution();

    // 2. SPA route change to /apply — query string is gone, exactly what
    //    React Router does on an internal <Link to="/apply">.
    navigateTo("/apply");
    captureAttribution();

    // 3. The submit path still sees the campaign that earned the lead.
    const merged = getAttribution();
    expect(merged.utmSource).toBe("google");
    expect(merged.utmMedium).toBe("cpc");
    expect(merged.gclid).toBe("Cj0KCQiA_TEST");
    expect(merged.firstTouchAt).toBeTruthy();
    expect(merged.firstLandingUrl).toBe("/?utm_source=google&utm_medium=cpc&gclid=Cj0KCQiA_TEST");
    // landingUrl reflects where the form was actually submitted from.
    expect(merged.landingUrl).toBe("/apply");
  });

  it("NEVER overwrites an existing first-touch", () => {
    navigateTo("/?utm_source=google&utm_campaign=first");
    captureAttribution();
    const firstAt = getFirstTouch()?.at;

    // Visitor comes back days later through a different campaign.
    navigateTo("/?utm_source=facebook&utm_campaign=second");
    captureAttribution();

    const first = getFirstTouch();
    expect(first?.params.utm_source).toBe("google");
    expect(first?.params.utm_campaign).toBe("first");
    expect(first?.at).toBe(firstAt);

    // And first-touch is what the submit path reports.
    expect(getAttribution().utmSource).toBe("google");
  });

  it("updates last-touch on the later campaign while first-touch holds", () => {
    navigateTo("/?utm_source=google&utm_campaign=first");
    captureAttribution();

    navigateTo("/?utm_source=facebook&utm_campaign=second");
    captureAttribution();

    expect(getFirstTouch()?.params.utm_source).toBe("google");
    expect(getLastTouch()?.params.utm_source).toBe("facebook");
  });
});

// ── click ids ───────────────────────────────────────────────────────────────
describe("click id capture", () => {
  it("captures gclid — the field Google Ads offline conversion import needs", () => {
    navigateTo("/?gclid=Cj0KCQjw_ABCDEFG123");
    captureAttribution();
    expect(getAttribution().gclid).toBe("Cj0KCQjw_ABCDEFG123");
  });

  it("captures every supported click id", () => {
    navigateTo(
      "/?gclid=g1&gbraid=g2&wbraid=g3&fbclid=f1&ttclid=t1&msclkid=m1",
    );
    captureAttribution();

    const merged = getAttribution();
    expect(merged.gclid).toBe("g1");
    expect(merged.gbraid).toBe("g2");
    expect(merged.wbraid).toBe("g3");
    expect(merged.fbclid).toBe("f1");
    expect(merged.ttclid).toBe("t1");
    expect(merged.msclkid).toBe("m1");
  });

  it("a click id alone (no utm) is enough to record a first touch", () => {
    navigateTo("/apply?gclid=solo_click");
    captureAttribution();
    expect(getFirstTouch()?.params.gclid).toBe("solo_click");
  });
});

// ── signal detection ────────────────────────────────────────────────────────
describe("signal detection", () => {
  it("stores nothing for a bare direct visit", () => {
    navigateTo("/");
    captureAttribution();
    expect(getFirstTouch()).toBeNull();
    expect(getLastTouch()).toBeNull();
  });

  it("treats an external referrer as a signal", () => {
    navigateTo("/", "https://www.google.com/search");
    captureAttribution();
    expect(getFirstTouch()).not.toBeNull();
    expect(getFirstTouch()?.referrer).toBe("https://www.google.com/search");
  });

  it("ignores an internal referrer (same-origin SPA nav)", () => {
    navigateTo("/apply", `${ORIGIN}/`);
    captureAttribution();
    expect(getFirstTouch()).toBeNull();
  });

  it("strips the referrer query string so it cannot leak data", () => {
    navigateTo("/", "https://partner.example.com/page?email=leak@test.com&x=1");
    captureAttribution();
    expect(getFirstTouch()?.referrer).toBe("https://partner.example.com/page");
  });
});

// ── defensive value handling ────────────────────────────────────────────────
describe("defensive value handling", () => {
  it("drops absurdly long param values", () => {
    const junk = "x".repeat(5000);
    navigateTo(`/?utm_source=google&utm_campaign=${junk}`);
    captureAttribution();

    const first = getFirstTouch();
    expect(first?.params.utm_source).toBe("google");
    expect(first?.params.utm_campaign).toBeUndefined();
  });

  it("ignores blank params", () => {
    navigateTo("/?utm_source=&gclid=real");
    captureAttribution();
    const first = getFirstTouch();
    expect(first?.params.utm_source).toBeUndefined();
    expect(first?.params.gclid).toBe("real");
  });
});

// ── storage failure fallback ────────────────────────────────────────────────
describe("storage failure fallback (Safari private mode / disabled storage)", () => {
  it("does not crash when localStorage.setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    navigateTo("/?utm_source=google&gclid=quota_test");
    expect(() => captureAttribution()).not.toThrow();
    expect(() => getAttribution()).not.toThrow();
  });

  it("does not crash when localStorage.getItem throws", () => {
    navigateTo("/?utm_source=google");
    captureAttribution();

    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });

    expect(() => getAttribution()).not.toThrow();
    expect(() => getFirstTouch()).not.toThrow();
  });

  it("does not crash when storage is entirely absent", () => {
    // Safari private mode historically, and jsdom here, expose no storage at
    // all — window.localStorage is undefined, not a throwing object.
    Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });
    Object.defineProperty(window, "sessionStorage", { value: undefined, configurable: true });

    navigateTo("/?utm_source=google&gclid=absent_storage");
    expect(() => captureAttribution()).not.toThrow();
    expect(() => getAttribution()).not.toThrow();
  });

  it("falls back to memory so attribution still survives the SPA nav", () => {
    // Writes throw, but the in-memory mirror keeps the value for this page.
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    vi.spyOn(window.localStorage, "getItem").mockReturnValue(null);
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    vi.spyOn(window.sessionStorage, "getItem").mockReturnValue(null);

    navigateTo("/?utm_source=google&gclid=memory_fallback");
    captureAttribution();

    navigateTo("/apply");
    expect(getAttribution().gclid).toBe("memory_fallback");
  });

  it("survives malformed JSON already sitting in storage", () => {
    window.localStorage.setItem("apex_attr_first", "{not json");
    navigateTo("/apply");
    expect(() => getAttribution()).not.toThrow();
    expect(getFirstTouch()).toBeNull();
  });
});

// ── merge behavior ──────────────────────────────────────────────────────────
describe("getAttribution merge", () => {
  it("falls back to the live URL when nothing is stored", () => {
    navigateTo("/apply?utm_source=direct_link&gclid=live_only");
    // Deliberately no captureAttribution() call — simulates a browser where
    // storage is unavailable and the only signal is the current URL.
    const merged = getAttribution();
    expect(merged.utmSource).toBe("direct_link");
    expect(merged.gclid).toBe("live_only");
  });

  it("returns all-null attribution for a clean direct visit", () => {
    navigateTo("/apply");
    const merged = getAttribution();
    expect(merged.utmSource).toBeNull();
    expect(merged.gclid).toBeNull();
    expect(merged.firstTouchAt).toBeNull();
    expect(merged.landingUrl).toBe("/apply");
  });

  it("packs first + last + current snapshots into attributionJson", () => {
    navigateTo("/?utm_source=google");
    captureAttribution();
    navigateTo("/?utm_source=facebook");
    captureAttribution();
    navigateTo("/apply");

    const json = getAttribution().attributionJson as {
      first: { params: Record<string, string> } | null;
      last: { params: Record<string, string> } | null;
      current: { params: Record<string, string> };
      v: number;
    };

    expect(json.first?.params.utm_source).toBe("google");
    expect(json.last?.params.utm_source).toBe("facebook");
    expect(json.current.params.utm_source).toBeUndefined();
    expect(json.v).toBe(1);
  });
});
