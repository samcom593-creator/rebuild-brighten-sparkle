/**
 * RouteCanonical.test.tsx
 *
 * Proves the canonical-URL fix at the DOM level, not just that the code exists.
 *
 * Gaps covered:
 *   ✅ canonicalHref normalizes: root is bare origin, deep paths append,
 *      a trailing slash is collapsed, empty path falls back to root.
 *   ✅ Rendering a route rewrites <link rel="canonical"> to a SELF-referencing
 *      URL (not the homepage) — the exact leak this component closes.
 *   ✅ The existing static index.html canonical tag is REUSED, never duplicated
 *      (two canonicals are ignored by crawlers).
 *   ✅ A route with no pre-existing tag gets one created.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RouteCanonical, canonicalHref, PROD_ORIGIN } from "@/components/seo/RouteCanonical";

function canonicalEls() {
  return Array.from(document.head.querySelectorAll('link[rel="canonical"]'));
}

afterEach(() => {
  cleanup();
  canonicalEls().forEach((el) => el.remove());
});

describe("canonicalHref", () => {
  it("root is the bare prod origin (matches index.html static canonical + og:url)", () => {
    expect(canonicalHref("/")).toBe(PROD_ORIGIN);
    expect(canonicalHref("")).toBe(PROD_ORIGIN);
  });

  it("deep paths append to the prod origin", () => {
    expect(canonicalHref("/apply")).toBe(`${PROD_ORIGIN}/apply`);
    expect(canonicalHref("/get-licensed")).toBe(`${PROD_ORIGIN}/get-licensed`);
  });

  it("collapses a trailing slash so /apply and /apply/ are one canonical", () => {
    expect(canonicalHref("/apply/")).toBe(`${PROD_ORIGIN}/apply`);
  });

  it("never emits a preview host — always the fixed prod origin", () => {
    expect(PROD_ORIGIN).toMatch(/^https:\/\/apex-financial\.org$/);
  });
});

describe("<RouteCanonical />", () => {
  it("rewrites a pre-existing homepage canonical to the self-referencing route URL", () => {
    // Simulate the static tag index.html ships for every route.
    const seed = document.createElement("link");
    seed.setAttribute("rel", "canonical");
    seed.setAttribute("href", PROD_ORIGIN); // homepage — the leak
    document.head.appendChild(seed);

    render(
      <MemoryRouter initialEntries={["/apply"]}>
        <RouteCanonical />
      </MemoryRouter>,
    );

    const els = canonicalEls();
    expect(els).toHaveLength(1); // reused, not duplicated
    expect(els[0].getAttribute("href")).toBe(`${PROD_ORIGIN}/apply`);
  });

  it("creates a canonical tag when none exists, self-referencing the route", () => {
    expect(canonicalEls()).toHaveLength(0);

    render(
      <MemoryRouter initialEntries={["/vsl"]}>
        <RouteCanonical />
      </MemoryRouter>,
    );

    const els = canonicalEls();
    expect(els).toHaveLength(1);
    expect(els[0].getAttribute("href")).toBe(`${PROD_ORIGIN}/vsl`);
  });

  it("keeps the homepage canonical bare (no trailing slash)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RouteCanonical />
      </MemoryRouter>,
    );
    expect(canonicalEls()[0].getAttribute("href")).toBe(PROD_ORIGIN);
  });
});
