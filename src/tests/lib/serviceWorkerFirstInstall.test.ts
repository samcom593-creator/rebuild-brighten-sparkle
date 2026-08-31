import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A service worker taking control for the FIRST time must not reload the page.
 *
 * 2026-08-30: it did. controllerchange fires when a first install goes from
 * no-controller to active, so every first-time visitor loaded the whole site
 * twice — measured as 3 main-frame navigations on a cold profile and a
 * Lighthouse `redirects` score of 0 ("Est savings of 4,150 ms") listing the
 * same URL twice. The `reloading` boolean that was there could only stop a
 * repeat fire inside one page instance, never the first-install reload.
 *
 * This asserts the guard is the one that distinguishes first install from a
 * genuine controller REPLACEMENT — reading the source, because the behaviour
 * only reproduces against a real registered SW.
 */
const SRC = readFileSync(resolve(__dirname, "../../..", "src/main.tsx"), "utf8")
  // strip comments so the prose above (which names these very identifiers)
  // cannot satisfy the assertions — MP-277's footnote bug.
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

describe("service worker first-install reload guard", () => {
  it("captures whether a controller existed before listening", () => {
    expect(SRC).toMatch(/const hadController = Boolean\(navigator\.serviceWorker\.controller\)/);
  });

  it("controllerchange reloads only when a previous controller was replaced", () => {
    const handler = SRC.match(/addEventListener\("controllerchange",[\s\S]{0,320}?\}\);/);
    expect(handler, "controllerchange handler not found").toBeTruthy();
    const body = handler![0];
    expect(body).toMatch(/if \(!hadController/);
    expect(body).toMatch(/window\.location\.reload\(\)/);
    // the early return must come before the reload, or the guard is decorative
    expect(body.indexOf("!hadController")).toBeLessThan(body.indexOf("window.location.reload"));
  });
});
