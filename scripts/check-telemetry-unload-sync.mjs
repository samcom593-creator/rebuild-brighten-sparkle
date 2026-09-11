#!/usr/bin/env node
/**
 * check-telemetry-unload-sync — MP-514 (2026-09-11)
 *
 * WHAT HAPPENED. Both writers into public.analytics_events registered their
 * terminal flush like this:
 *
 *     window.addEventListener("pagehide", () => void flush());
 *
 * and flush() opened with `await import("@/integrations/supabase/client")`
 * before it touched the network. The document is discarded the moment that
 * handler returns, so the promise continuation holding the fetch never ran and
 * NO REQUEST WAS EVER ISSUED. Not a cancelled request — an unsent one.
 *
 * MEASURED IN CHROMIUM, not reasoned about. A recording sink, two independent
 * exit fixtures (same-origin hard navigation, cross-origin/cross-process
 * navigation), identical results in both:
 *
 *     cold dynamic import, then plain fetch ....... LOST
 *     WARM dynamic import, then plain fetch ....... LOST
 *     plain fetch, issued synchronously ........... LANDED
 *     keepalive fetch, issued synchronously ....... LANDED
 *     navigator.sendBeacon ........................ LANDED
 *
 * The warm-import leg is the one that matters: it resolves in a microtask and
 * still dies. So the fault is the `await`, NOT the chunk being cold and NOT the
 * missing keepalive. Any repair that only adds `keepalive: true` while leaving
 * the await in place fixes nothing, and would look like a fix in review.
 *
 * A third fixture (Playwright page.close()) lost all five legs including the
 * two proven to land. It had no surviving positive control, so it measured the
 * harness rather than the page, and it is recorded here as discarded rather
 * than reported as evidence.
 *
 * PROVEN END-TO-END on the real modules: a vite build of track.ts against a
 * local sink, one track() call, visitor leaving at t=1s (inside the 5s
 * debounce). At HEAD~ the insert never arrived; with the fix the full row
 * arrived. Same fixture, same bundle pipeline, opposite outcomes.
 *
 * SIZE: NOT MEASURABLE FROM PROD, and this guard does not pretend otherwise.
 * The lost rows are invisible by construction — a visitor who bounces inside
 * the debounce window writes zero rows, so the session has no session_id in
 * analytics_events to count. There is no second instrument to difference
 * against: Vercel Web Analytics is NOT enabled for prj_LVVbBCcAuQtilOXtJTTUkkiKAfXs
 * (the API returns 404 "Web Analytics not found"), which is itself worth
 * knowing — this site has exactly one visitor instrument.
 *
 * CONTRACT A — the unload writer must be synchronous. beacon.ts may contain no
 *   `await` and no dynamic `import(`. This is the whole defect in one line.
 *
 * CONTRACT B — the unload writer must set `keepalive: true`. The synchronous
 *   plain fetch did land against a local sink answering instantly, so this is
 *   belt-and-braces rather than the proven half; it is required because that
 *   fixture is the friendly case and keepalive is the only documented
 *   guarantee that a request outlives its document.
 *
 * CONTRACT C — no pagehide / visibilitychange-hidden handler in a telemetry
 *   writer may call the async flush directly. That is the exact shipped line.
 *
 * CONTRACT D — the terminal handler must actually hand the batch to the
 *   beacon. Contracts A-C are all satisfiable by a terminal handler that
 *   simply drops the queue: the writer would go dark instead of going late,
 *   which is the worse failure and the one the first three contracts pass.
 *   A guard that accepts the darker failure is not a guard. (Same reasoning
 *   MP-513 used for its own Contract B, one file over.)
 *
 * CONTRACT E — no OTHER file in src/ may register an async pagehide handler.
 *   Contracts A-D are about the two writers that exist today; E is about the
 *   third one somebody writes next, which is how this bug got into the second
 *   writer in the first place.
 *
 * Stripped source only (MP-277): "await", "pagehide" and "keepalive" all
 * appear in this repo's comments — including in the files under test, because
 * the fix documents itself. A comment must not be able to satisfy a contract
 * or fail one.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = resolve(process.cwd());
const SRC = join(ROOT, "src");
const BEACON = "src/shared/telemetry/beacon.ts";
const WRITERS = ["src/shared/telemetry/track.ts", "src/shared/lib/webVitals.ts"];

const failures = [];
const read = (rel) => {
  const full = join(ROOT, rel);
  if (!existsSync(full)) return null;
  return stripComments(readFileSync(full, "utf8"));
};

// ── CONTRACT A + B: the beacon itself ────────────────────────────────────────
const beacon = read(BEACON);
if (beacon === null) {
  failures.push(
    `${BEACON} does not exist. The unload path has no synchronous writer, so either the fix was reverted ` +
    `or it moved — and a guard that cannot find its subject must fail, not pass.`
  );
} else {
  if (/\bawait\b/.test(beacon)) {
    failures.push(
      `${BEACON}: contains \`await\`. CONTRACT A. A continuation scheduled after the document is discarded never ` +
      `runs, so the request is never issued at all — measured identical for a WARM chunk, which is why "the import ` +
      `is cached by then" is not a defence.`
    );
  }
  if (/\bimport\s*\(/.test(beacon)) {
    failures.push(
      `${BEACON}: contains a dynamic \`import(\`. CONTRACT A. Even when it resolves from the module registry it ` +
      `resolves as a promise, and the unload path has no promise ticks left.`
    );
  }
  if (!/keepalive\s*:\s*true/.test(beacon)) {
    failures.push(
      `${BEACON}: the fetch does not set \`keepalive: true\`. CONTRACT B. RecruitingShortLink.tsx has used it for ` +
      `this exact reason since it was written.`
    );
  }
  if (!/export\s+function\s+beaconAnalyticsRows/.test(beacon)) {
    failures.push(`${BEACON}: beaconAnalyticsRows is not exported. CONTRACT D cannot be evaluated, so this is a failure, not a pass.`);
  }
}

// ── CONTRACT C + D: the two writers ──────────────────────────────────────────
let terminalHandlersChecked = 0;
for (const rel of WRITERS) {
  const src = read(rel);
  if (src === null) {
    failures.push(`${rel}: writer not found. The guard matched nothing and must not report a pass.`);
    continue;
  }

  const pagehide = [...src.matchAll(/addEventListener\s*\(\s*["'`]pagehide["'`]\s*,([\s\S]{0,160}?)\)\s*;/g)];
  const visibility = [...src.matchAll(/visibilityState\s*===\s*["'`]hidden["'`]\s*\)([\s\S]{0,120}?)[;}]/g)];
  if (pagehide.length === 0) {
    failures.push(`${rel}: no pagehide listener found. A telemetry writer with no terminal flush loses its last batch by omission.`);
  }
  for (const [, body] of [...pagehide, ...visibility]) {
    terminalHandlersChecked++;
    if (/\bvoid\s+flush\s*\(|\bawait\b|\basync\b/.test(body)) {
      failures.push(
        `${rel}: a terminal handler calls the async flush (or is itself async): \`${body.trim().slice(0, 70)}\`. ` +
        `CONTRACT C. This is the shipped line that lost every terminal batch.`
      );
    }
  }

  if (!/beaconAnalyticsRows\s*\(/.test(src)) {
    failures.push(
      `${rel}: never calls beaconAnalyticsRows(). CONTRACT D — the terminal path must SEND the batch. ` +
      `Contracts A-C are all satisfied by a handler that silently drops the queue, which takes this writer dark ` +
      `instead of late. The darker failure must not be a pass.`
    );
  }
}

// ── CONTRACT E: every other pagehide handler in src/ ─────────────────────────
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (e === "node_modules" || e === "tests") continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
};
let otherScanned = 0;
for (const full of walk(SRC)) {
  const rel = relative(ROOT, full);
  if (WRITERS.includes(rel) || rel === BEACON) continue;
  const src = stripComments(readFileSync(full, "utf8"));
  if (!/addEventListener\s*\(\s*["'`]pagehide["'`]/.test(src)) continue;
  otherScanned++;
  for (const [, body] of src.matchAll(/addEventListener\s*\(\s*["'`]pagehide["'`]\s*,([\s\S]{0,160}?)\)\s*;/g)) {
    if (/\bawait\b|\basync\b/.test(body)) {
      failures.push(
        `${rel}: registers an async pagehide handler: \`${body.trim().slice(0, 70)}\`. CONTRACT E. ` +
        `Anything after an await in an unload handler is never issued.`
      );
    }
  }
}

if (terminalHandlersChecked === 0) {
  failures.push("no terminal (pagehide / visibilitychange-hidden) handler was found in any writer — the guard matched nothing and must not report a pass.");
}

if (failures.length) {
  console.error("check-telemetry-unload-sync FAILED\n");
  for (const f of failures) console.error("  - " + f);
  console.error(`\n${failures.length} violation(s). A telemetry write on the unload path must be issued synchronously.`);
  process.exit(1);
}

console.log(
  `check-telemetry-unload-sync PASS — beacon synchronous + keepalive; ${WRITERS.length} writer(s), ` +
  `${terminalHandlersChecked} terminal handler(s) reach the beacon; ${otherScanned} other pagehide site(s) scanned.`
);
