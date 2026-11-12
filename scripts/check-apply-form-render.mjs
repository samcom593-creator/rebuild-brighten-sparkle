#!/usr/bin/env node
/**
 * check-apply-form-render — does the recruit APPLICATION FORM actually render?
 *
 * WHY THIS EXISTS (MP-WIB-APPLY-FORM-RENDER, 2026-11-12). /apply is the single
 * conversion point of the recruiting funnel: every lead a recruit on
 * apex-financial.org becomes walks through this form (quick-qualify step 1 ->
 * full submit). check-funnel-capture-handler proves the ENDPOINT it POSTs to
 * (submit-application) runs — but nothing proves the BROWSER FORM that calls
 * that endpoint actually renders. Those are different failure surfaces: a
 * React render crash swallowed by an error boundary, a conditional/gating
 * regression that hides the fields, a dropped step-1->step-2 transition, or a
 * data regression that empties the state picker all leave the endpoint healthy
 * while the form a recruit sees is gone or unusable.
 *
 * EVERY EXISTING GUARD IS BLIND TO THIS CLASS (measured 2026-11-12):
 *   - route-smoke.mjs fetches /apply and sees the SPA shell 200 — it never
 *     renders, so a vanished form is a 200 to it.
 *   - live-render-integrity.mjs renders /apply but asserts only: status<400,
 *     not-a-404-white-screen, no mobile overflow, no NaN/lorem/coming-soon
 *     token, no React crash. A form whose <select>s and inputs silently did not
 *     render — while the hero marketing copy and no crash remain — passes it
 *     GREEN (verified: its `ok` is `defects.length===0` and none of its defects
 *     inspect form structure).
 *   - mobile-overflow.mjs measures layout width, not whether a form exists.
 *   - check-funnel-capture-handler proves the server endpoint, not the client.
 *
 * So the recruiting funnel's conversion point could go dark and every gate in
 * the repo stays green. This guard renders /apply in a real browser and asserts
 * the application ENTRY FORM is present and populated:
 *   >= 2 native <select> (the state picker + the carrier picker),
 *   the largest of them populated to >= STATE_FLOOR options (a 50-state list;
 *   a collapse to a near-empty dropdown is the data regression that makes the
 *   geographic gate unselectable), and
 *   >= MIN_CONTROLS form controls total, with no render crash / 404 shell.
 * Measured on prod 2026-11-12: step 1 renders 8 controls, state <select> 51
 * options, carrier <select> 9, "Next Step" present — born green.
 *
 * It asserts the CURRENT two-select entry form on purpose. If /apply is
 * redesigned (e.g. the state picker becomes a typeahead), this guard reds and
 * forces a conscious update — the same source/live contract check-vsl-media-live
 * has with vslMedia.ts and check-share-card-live has with share-card.json. A
 * redesign is a deploy the author controls; silent drift is what this catches.
 *
 * VERDICTS — 'could not look' is never laundered into 'healthy':
 *   HEALTHY      2xx, no crash/404-shell, the entry form rendered + populated.
 *   DEFECT       the form is BROKEN on a page we demonstrably reached:
 *     form_absent   controls/selects did not render (crash-free vanished form)
 *     fields_empty  the state picker collapsed below STATE_FLOOR options
 *     page_error    a React crash, a 404 white-screen under 200, or /apply
 *                   itself served a 4xx (route/deploy broken)
 *   UNRESOLVED   transient 5xx/429, a nav timeout while egress is up, or a
 *                partial — re-run, never a defect (we never saw a broken form).
 *   UNKNOWN      the egress control is itself down — this runner/network is
 *                offline, so no verdict is trusted (MP-291/MP-304: a wifi
 *                outage must never read as a dead form).
 *
 * This grades PRODUCTION, so the LIVE probe is NOT a commit gate — a correct
 * tree can front last week's deployed bytes (MP-398). The pure classifier +
 * verdict logic is proven every commit via `--selftest` (NO browser, NO
 * network); the live render runs on a schedule (.github/workflows/apply-form-render.yml)
 * and by hand. The e2e both-directions proof (live-prod HEALTHY + a crafted
 * broken page -> DEFECT) is run by hand at ship time — a browser cannot run in
 * verify:core, so the committed selftest stays pure.
 *
 * Exit contract (mirrors check-vsl-media-live / check-share-card-live):
 *   0 HEALTHY | 0 UNKNOWN (network) | 1 DEFECT | 3 UNRESOLVED/transient
 */

const SITE = process.env.APEX_SITE_ORIGIN || "https://apex-financial.org";
const ROUTE = process.env.APEX_APPLY_ROUTE || "/apply";
const CONTROL = process.env.APPLY_CONTROL_URL || "https://www.google.com/generate_204";
const NAV_TIMEOUT = 40000;
const SETTLE_MS = 2500;
const HYDRATE_TIMEOUT = 9000;

// The form the recruit sees must be present and populated. Floors are set well
// inside the observed shape (51-option state select, 8 controls) so a trimmed
// territory list or an added "select…" placeholder never flaps, while a
// collapsed-empty dropdown or a vanished form crosses them.
const STATE_FLOOR = 20;   // the state <select> populated to a real 50-state list
const MIN_CONTROLS = 3;   // state select + carrier select + at least one field

const DEFECT_STATES = new Set(["form_absent", "fields_empty", "page_error"]);

/**
 * Pure classifier — the whole per-render verdict, given only the observation a
 * browser produced. Side-effect-free so --selftest drives every branch with no
 * browser and no network.
 *
 *   obs = { transport, status, is404, crash, controls, selectCount, selectOptionCounts }
 *   transport=true  -> the navigation threw, no HTTP response came back at all.
 */
export function classify(obs) {
  if (obs.transport) return "transport";
  if (obs.status == null || obs.status === 429 || obs.status >= 500) return "transient";
  if (obs.status >= 400) return "page_error"; // /apply served a 4xx itself (route/deploy broken)
  // 2xx — a page was served and rendered; now judge the form.
  if (obs.crash || obs.is404) return "page_error";
  if ((obs.controls ?? 0) < MIN_CONTROLS || (obs.selectCount ?? 0) < 2) return "form_absent";
  const maxOpts = Array.isArray(obs.selectOptionCounts) && obs.selectOptionCounts.length
    ? Math.max(...obs.selectOptionCounts) : 0;
  if (maxOpts < STATE_FLOOR) return "fields_empty";
  return "healthy";
}

/**
 * Map a classifier state + egress control to a verdict + exit code. The DEFECT
 * states are only reachable when a page was actually served and rendered (2xx
 * or 4xx response), so we demonstrably reached the site and they need no
 * control-gating. Only `transport` (no response at all) is control-gated, and
 * it can NEVER become a DEFECT — a nav that never completed is not a positive
 * "the form is broken" signal, so it is UNRESOLVED (egress up) or UNKNOWN
 * (egress down), never red.
 */
export function decideVerdict(state, controlUp) {
  if (state === "healthy") return { verdict: "HEALTHY", code: 0 };
  if (DEFECT_STATES.has(state)) return { verdict: "DEFECT", code: 1 };
  if (state === "transient") return { verdict: "UNRESOLVED", code: 3 };
  // transport: the browser never got a response.
  if (controlUp) return { verdict: "UNRESOLVED", code: 3 };
  return { verdict: "UNKNOWN", code: 0, downgradeDead: true };
}

// The DOM read, as a string so the browser leg uses exactly this. It returns
// only primitives/arrays (structured-clone safe) and never votes — classify()
// owns the verdict.
const EXTRACT = `(() => {
  const body = document.body ? (document.body.innerText || "") : "";
  const is404 = /page not found|404\\s*·|404 not found/i.test(body) && body.length < 800;
  const selects = Array.from(document.querySelectorAll("select"));
  const selectOptionCounts = selects.map((s) => s.options ? s.options.length : 0);
  const controls = document.querySelectorAll("input, select, textarea").length;
  const btnText = Array.from(document.querySelectorAll("button, [role=button]"))
    .map((b) => (b.textContent || "").trim().toLowerCase());
  const hasForward = btnText.some((t) => /next step|continue|submit|apply|get started|start/.test(t));
  return { bodyLen: body.length, is404, selectCount: selects.length, selectOptionCounts, controls, hasForward };
})()`;

async function controlReachable(url) {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(15000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

// ── selftest: prove classify() + decideVerdict() both directions, NO browser ──
function selftest() {
  let pass = 0, total = 0;
  const ok = (cond, name) => { total++; if (cond) { pass++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

  // classify — the healthy shape and every way it can break.
  const healthy = { status: 200, is404: false, crash: false, controls: 8, selectCount: 2, selectOptionCounts: [51, 9] };
  ok(classify(healthy) === "healthy", "live-prod shape (8 controls, 2 selects, 51-opt state) -> healthy");
  ok(classify({ ...healthy, selectOptionCounts: [51, 9], controls: 20 }) === "healthy", "extra controls still healthy");
  ok(classify({ ...healthy, controls: 2 }) === "form_absent", "too few controls -> form_absent (vanished form)");
  ok(classify({ ...healthy, selectCount: 1 }) === "form_absent", "one select (carrier picker gone) -> form_absent");
  ok(classify({ ...healthy, selectCount: 0, controls: 0, selectOptionCounts: [] }) === "form_absent", "no form at all -> form_absent");
  ok(classify({ ...healthy, selectOptionCounts: [3, 9] }) === "fields_empty", "state picker collapsed to 3 opts -> fields_empty");
  ok(classify({ ...healthy, selectOptionCounts: [0, 0] }) === "fields_empty", "both selects empty -> fields_empty");
  ok(classify({ ...healthy, selectOptionCounts: [20, 9] }) === "healthy", "state exactly at floor (20) -> healthy");
  ok(classify({ ...healthy, selectOptionCounts: [19, 9] }) === "fields_empty", "state one below floor (19) -> fields_empty");
  ok(classify({ ...healthy, crash: true }) === "page_error", "React crash on a 200 -> page_error");
  ok(classify({ ...healthy, is404: true }) === "page_error", "SPA 404 white-screen under 200 -> page_error");
  ok(classify({ status: 404, is404: false, crash: false, controls: 0, selectCount: 0, selectOptionCounts: [] }) === "page_error", "/apply itself 404 -> page_error");
  ok(classify({ status: 403 }) === "page_error", "/apply itself 403 (protection/route broken) -> page_error");
  ok(classify({ status: 500 }) === "transient", "5xx -> transient");
  ok(classify({ status: 503 }) === "transient", "503 -> transient");
  ok(classify({ status: 429 }) === "transient", "429 rate-limited -> transient");
  ok(classify({ status: null }) === "transient", "no status (null) -> transient");
  ok(classify({ transport: true }) === "transport", "nav threw, no response -> transport");

  // decideVerdict — codes both directions; the DEFECT set; the control gate.
  ok(decideVerdict("healthy", true).verdict === "HEALTHY" && decideVerdict("healthy", true).code === 0, "healthy -> HEALTHY(0)");
  ok(decideVerdict("form_absent", true).verdict === "DEFECT" && decideVerdict("form_absent", true).code === 1, "form_absent -> DEFECT(1)");
  ok(decideVerdict("fields_empty", true).verdict === "DEFECT" && decideVerdict("fields_empty", true).code === 1, "fields_empty -> DEFECT(1)");
  ok(decideVerdict("page_error", true).verdict === "DEFECT" && decideVerdict("page_error", true).code === 1, "page_error -> DEFECT(1)");
  ok(decideVerdict("transient", true).verdict === "UNRESOLVED" && decideVerdict("transient", true).code === 3, "transient -> UNRESOLVED(3)");
  ok(decideVerdict("transport", true).verdict === "UNRESOLVED" && decideVerdict("transport", true).code === 3, "transport + egress up -> UNRESOLVED(3), never DEFECT");
  ok(decideVerdict("transport", false).verdict === "UNKNOWN" && decideVerdict("transport", false).code === 0, "transport + egress DOWN -> UNKNOWN(0), not trusted");
  // The DEFECT set is exactly these three, so a future edit can't silently stop paging on a real break.
  ok([...DEFECT_STATES].sort().join(",") === "fields_empty,form_absent,page_error", "DEFECT_STATES is {fields_empty,form_absent,page_error}");
  // A DEFECT can never be produced from a no-response render — structurally.
  ok(!DEFECT_STATES.has("transport") && !DEFECT_STATES.has("transient"), "transport/transient are NOT in DEFECT_STATES (a nav that never landed can't red)");

  console.log(`\ncheck:apply-form-render --selftest — ${pass}/${total} assertions pass (both directions).`);
  if (pass !== total) { console.error("SELFTEST FAILED — the apply-form render detector is wrong."); process.exit(1); }
  process.exit(0);
}

if (process.argv.includes("--selftest")) selftest();

// ── live probe ────────────────────────────────────────────────────────────────
// playwright is dynamically imported HERE so --selftest never touches a browser.
const { chromium } = await import("playwright");

async function render() {
  const launchOpts = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {};
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const hardErrs = [];
  page.on("pageerror", (e) => hardErrs.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") hardErrs.push(m.text().slice(0, 160)); });
  const obs = { transport: false, status: null, is404: false, crash: false, controls: 0, selectCount: 0, selectOptionCounts: [], hasForward: false };
  try {
    const resp = await page.goto(SITE + ROUTE, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    obs.status = resp ? resp.status() : null;
    // Give hydration a real chance before concluding the form is absent.
    await page.waitForSelector("select, form, input", { timeout: HYDRATE_TIMEOUT }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    const read = await page.evaluate(EXTRACT);
    Object.assign(obs, read);
    // A hard React error counts as a crash only if it is an app crash, not a
    // console warning (mirrors live-render-integrity's hardErrs filter).
    obs.crash = hardErrs.some((e) => /Minified React error|is not defined|Cannot read|PAGEERROR|Uncaught/i.test(e));
  } catch (e) {
    obs.transport = true;
    obs.navErr = String(e).split("\n")[0].slice(0, 160);
  } finally {
    await browser.close();
  }
  return obs;
}

const obs = await render();
const state = classify(obs);
// Only a no-response render needs the egress gate; a served page already proved reachability.
const controlUp = state === "transport" ? await controlReachable(CONTROL) : true;
const { verdict, code } = decideVerdict(state, controlUp);

const maxOpts = Array.isArray(obs.selectOptionCounts) && obs.selectOptionCounts.length ? Math.max(...obs.selectOptionCounts) : 0;
console.log(`check:apply-form-render — rendered ${SITE}${ROUTE}`);
console.log(`  HTTP ${obs.status ?? "(no response)"}  controls=${obs.controls}  selects=${obs.selectCount} [${(obs.selectOptionCounts || []).join(",")}]  maxOpts=${maxOpts}  forward=${obs.hasForward}  crash=${obs.crash}  is404=${obs.is404}${obs.navErr ? "  navErr=" + obs.navErr : ""}`);
console.log(`  classifier=${state} -> verdict=${verdict}`);

if (verdict === "DEFECT") {
  console.error(`\nAPPLY-FORM DEFECT — the recruiting funnel's single conversion point does not render a usable application form:`);
  const why = {
    form_absent: "the entry form did not render (controls/selects missing) on a 2xx page with no crash — a recruit lands on /apply and cannot start applying",
    fields_empty: `the state picker collapsed below ${STATE_FLOOR} options (largest select has ${maxOpts}) — the geographic gate is unselectable, every application stalls`,
    page_error: obs.status >= 400 ? `/apply served HTTP ${obs.status} — the route/deploy is broken` : "a React crash or 404 white-screen under a 200 — the form component threw",
  }[state];
  console.error(`  ${state}: ${why}`);
  process.exit(1);
}
if (verdict === "UNRESOLVED") {
  console.log(`\n⚠️  apply-form UNRESOLVED — ${state === "transport" ? "the navigation did not complete while egress is up" : "a transient " + (obs.status ?? "5xx") + " / partial render"}. NOT a defect; re-run to confirm.`);
  process.exit(3);
}
if (verdict === "UNKNOWN") {
  console.log(`\napply-form UNKNOWN — egress control (${CONTROL}) is down, so this runner/network is offline. The form verdict is NOT trusted (not an all-clear, not a defect).`);
  process.exit(0);
}
console.log(`\nok — /apply renders the application entry form: ${obs.controls} controls, ${obs.selectCount} selects, state picker ${maxOpts} options.`);
process.exit(0);
