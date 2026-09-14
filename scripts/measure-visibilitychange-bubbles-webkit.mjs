#!/usr/bin/env node
// measure-visibilitychange-bubbles-webkit.mjs — MP-529.
//
// Companion to measure-visibilitychange-bubbles.mjs, which drives a real
// Chrome over CDP and therefore answers for Blink ONLY. MP-528 closed with the
// open item in plain words: "Sam's real traffic is iPhone Safari per the bot
// charter, and WebKit was NOT measured." This closes it, and it is a SCRIPT
// rather than a line in a ledger so the answer stays re-measurable when
// WebKit ships a new version.
//
// The question: MP-525 moved both telemetry writers from
//   window.addEventListener("visibilitychange", ...)
// to the document, on the grounds that the browser dispatches that event AT
// the document. If the event does NOT bubble to the window on some engine,
// the pre-MP-525 form silently drops terminal telemetry on that engine.
//
// MEASURED 2026-09-14, WebKit 26.5 (playwright v2336, arm64 macOS),
// iPhone 14 device profile: bubbles = TRUE. Same answer Chrome 151 gave in
// MP-528. So the document form is correct on both engines and the old window
// form was never losing batches on either — recorded as an answer, not as a
// fix, because nothing was broken.
//
// Exit codes, deliberately distinct so an absence never reads as an answer:
//   0  measured, and the value matches the expectation below
//   1  measured, and the value FLIPPED — re-measure and revisit MP-525
//   2  UNPROVEN: the engine is not installed here, so nothing was measured
//
// Usage: node scripts/measure-visibilitychange-bubbles-webkit.mjs

import { webkit, devices } from "playwright";

const EXPECTED = true; // what this engine measured at the timestamp above

let browser;
try {
  browser = await webkit.launch({ headless: true });
} catch (e) {
  // An engine that could not launch has measured nothing. Never print an
  // answer here — that is the blank-reads-as-green failure this repo keeps
  // paying for.
  console.log("UNPROVEN: no WebKit build on this machine, nothing was measured.");
  console.log("  remedy: npx playwright install webkit");
  console.log("  cause:  " + String(e).split("\n")[0].slice(0, 160));
  process.exit(2);
}

const ctx = await browser.newContext({ ...devices["iPhone 14"] });
const pg = await ctx.newPage();
await pg.goto("about:blank");

const measured = await pg.evaluate(
  () =>
    new Promise((resolve) => {
      // Arm the pre-MP-525 form (window) and dispatch where the browser
      // dispatches it (document). If the window handler runs, it bubbles.
      let sawOnWindow = false;
      const onWindow = () => { sawOnWindow = true; };
      window.addEventListener("visibilitychange", onWindow);
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      setTimeout(() => {
        window.removeEventListener("visibilitychange", onWindow);
        resolve(sawOnWindow);
      }, 50);
    })
);

const version = browser.version();
await browser.close();

console.log(JSON.stringify({
  engine: "webkit", version, profile: "iPhone 14",
  visibilitychangeBubblesToWindow: measured, expected: EXPECTED,
}, null, 2));

if (measured !== EXPECTED) {
  console.error(`\nFLIPPED: WebKit ${version} now reports bubbles=${measured}, expected ${EXPECTED}.`);
  console.error("The document-node listener in webVitals/telemetry is still correct either way,");
  console.error("but MP-525's reasoning was measured against the old value — re-read it.");
  process.exit(1);
}
console.log(`\n✅ WebKit ${version}: visibilitychange bubbles to the window (${measured}) — matches Blink, matches MP-525.`);
