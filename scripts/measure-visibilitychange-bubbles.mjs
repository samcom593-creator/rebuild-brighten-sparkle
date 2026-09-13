#!/usr/bin/env node
/**
 * MEASURE: does `visibilitychange` carry bubbles:true in the installed Chrome?
 *
 * WHY THIS EXISTS
 * MP-525 moved the telemetry terminal-flush listener from `window` to `document`
 * in src/shared/telemetry/track.ts and src/shared/lib/webVitals.ts. The event is
 * dispatched AT the Document, so a window-scoped listener receives it ONLY by
 * bubbling. MP-525 shipped the document form because it is correct under BOTH
 * values of that flag -- and left behind an open question it could not answer:
 * was production ever LOSING tab-switch terminal batches under the old window
 * form? Three fixtures died trying to answer it, none with a positive control,
 * so "the window listener stayed silent" was indistinguishable from "the fixture
 * never hid the page". The code comment concluded the flag was one "this repo
 * cannot observe from its test env". This script observes it.
 *
 * WHY NOT PLAYWRIGHT
 * Playwright keeps every page `visible` by design, so page.bringToFront() cannot
 * background a sibling tab -- measured across headless shell, full headed Chrome,
 * and CDP Emulation/Page lifecycle overrides: all five attempts left the page
 * visible. The missing chromium binary was never the blocker. Raw CDP against a
 * real Chrome, with a second tab opened in ONE window, does hide it.
 *
 * THIS IS A MEASUREMENT TOOL, NOT A GATE. It is deliberately NOT wired into
 * verify:core: it spawns a browser and needs a Chrome binary CI is not
 * guaranteed to have. Nothing here should be read as a guard that runs on push.
 *
 * EXIT CODES -- UNPROVEN is never laundered into a pass:
 *   0  MEASURED bubbles:true  -- a window listener DOES receive it; the pre-MP-525
 *                               form was not dropping events. Document form is
 *                               spec-correctness, not a recovered loss.
 *   1  MEASURED bubbles:false -- a window listener does NOT receive it; MP-525's
 *                               move is load-bearing and prevented real loss.
 *   2  UNPROVEN -- the fixture could not hide the page, or no Chrome was found.
 *                  Says so; concludes nothing in either direction.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.CDP_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (!fs.existsSync(cache)) return null;
  const builds = fs.readdirSync(cache)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const b of builds) {
    const bin = path.join(cache, b, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return {
    ready: new Promise((res) => ws.addEventListener("open", res)),
    send: (method, params = {}) =>
      new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }),
  };
}

const bin = findChrome();
if (!bin) {
  console.log("UNPROVEN: no Chrome binary found (set CHROME_BIN, or `npx playwright install chromium`).");
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vis-bubbles-"));
const chrome = spawn(bin, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
  "--headless=new", "--no-first-run", "--no-default-browser-check",
], { stdio: "ignore" });

function cleanup() {
  try { chrome.kill(); } catch { /* already gone */ }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp dir, best effort */ }
}

let code = 2;
try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) version = await r.json();
    } catch { /* not listening yet */ }
    if (!version) await sleep(250);
  }
  if (!version) {
    console.log("UNPROVEN: Chrome never opened a debugging port.");
  } else {
    const tabA = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
    const A = connect(tabA.webSocketDebuggerUrl);
    await A.ready;
    const evalIn = async (expression) =>
      (await A.send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

    // Arm BOTH registrations: `window` is the pre-MP-525 form under test,
    // `document` is the post-MP-525 form and doubles as the positive control --
    // if it never fires, the fixture failed and nothing may be concluded.
    await evalIn(`(()=>{window.__r={win:0,doc:0,bubbles:null};
      window.addEventListener('visibilitychange',()=>{window.__r.win++;});
      document.addEventListener('visibilitychange',e=>{window.__r.doc++;window.__r.bubbles=e.bubbles;});
      return 'armed';})()`);

    const before = await evalIn("document.visibilityState");
    // Opening a second tab in the SAME window backgrounds the first one. An
    // explicit /json/activate call was here and M1 proved it inert -- creation
    // alone is what hides tab A -- so it is gone rather than left looking
    // load-bearing. M2 (never create tab B) is the one that flips this to UNPROVEN.
    await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
    await sleep(900);
    const after = await evalIn("document.visibilityState");
    const r = JSON.parse((await evalIn("JSON.stringify(window.__r)")) || "{}");

    const hid = before === "visible" && after === "hidden";
    const dispatched = r.doc > 0;
    console.log(`browser                       : ${version.Browser}`);
    console.log(`visibilityState before/after  : ${before} -> ${after}`);
    console.log(`POSITIVE CONTROL page hidden  : ${hid}`);
    console.log(`POSITIVE CONTROL doc received : ${dispatched}`);
    console.log(`MEASURED window received      : ${r.win > 0}`);
    console.log(`MEASURED event.bubbles        : ${r.bubbles}`);

    if (!hid || !dispatched) {
      console.log("\nUNPROVEN: the fixture never hid the page, so a silent window listener proves nothing.");
    } else if (r.bubbles === true && r.win > 0) {
      console.log("\nMEASURED bubbles:true -- a window listener DOES receive visibilitychange.");
      console.log("The pre-MP-525 window form was NOT losing tab-switch terminal batches.");
      code = 0;
    } else if (r.bubbles === false || r.win === 0) {
      console.log("\nMEASURED bubbles:false -- a window listener does NOT receive visibilitychange.");
      console.log("MP-525's move to document is load-bearing; the window form lost terminal batches.");
      code = 1;
    } else {
      console.log("\nUNPROVEN: controls passed but the readback was incoherent.");
    }
  }
} finally {
  cleanup();
}
process.exit(code);
