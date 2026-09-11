#!/usr/bin/env node
/**
 * check-funnel-telemetry-sink — MP-512 (2026-09-11)
 *
 * Two contracts, graded separately. Both exist because of one measured bug.
 *
 * WHAT HAPPENED. src/lib/analytics.ts fans out to GA4 + PostHog + Meta Pixel,
 * each leg gated on a VITE_* key. The production bundle carries none of those
 * keys (MP-511 brace-matched the inlined import.meta.env object: 27 keys, no
 * GA4/PostHog/Meta), so every call was a clean no-op. Four product files
 * imported THIS track() — HeroSection, StickyMobileCTA, RecruitFAQ, Apply —
 * and exactly one file imported the emitter that actually writes to
 * public.analytics_events. Result: event_category='interaction' held 0 rows of
 * 2,070,597 while 'navigation' held 36,010. The site recorded where people
 * went and nothing about what they did.
 *
 * That is not a dead feature; it is the reason a 22.0% -> 10.6% collapse in
 * apply-page -> submission conversion (MP-511, well-powered at n=1,761) could
 * be measured and could not be localised to a step.
 *
 * CONTRACT A — the forward must exist.
 *   lib/analytics.ts's track() must call the first-party emitter. This is the
 *   load-bearing one: delete that single line and every funnel event goes dark
 *   again, silently, with no error, no 4xx and no failing test. Exactly how it
 *   went dark the first time.
 *
 * CONTRACT B — a declared event must have a product emitter.
 *   META_EVENT_MAP declared apply_start and apply_submitted, and
 *   src/tests/lib/analytics.test.ts asserted their pixel mapping across 7
 *   cases. No product file has ever called either one. The map plus the tests
 *   read exactly like coverage, which is why four waves inherited "the funnel
 *   is instrumented" without checking. A test that exercises an event the
 *   product never fires is this repo's oldest disease wearing a green badge.
 *
 * WHY STRIPPED SOURCE (MP-277's footnote bug): the string "apply_submitted"
 * appears in comments and in the pixel map itself. Matching raw source would
 * let a file document an event into existence. Call sites are counted only in
 * stripped product source, and src/tests/ is NOT product source — counting it
 * would make the tests vouch for themselves, which is the bug.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANALYTICS = resolve(ROOT, "src/lib/analytics.ts");
const EMITTER_SPECIFIER = "@/shared/telemetry/track";

/**
 * Events declared in META_EVENT_MAP that no product file emits, each with the
 * reason it is tolerated. Kept NAMED rather than counted: a count lets a new
 * unemitted event hide behind an old one being wired (MP-356's laundering).
 * Anything not listed here must have a real call site.
 */
const KNOWN_UNEMITTED = {
  page_view:
    "lib/analytics's own pageView() is its only caller and pageView() has no " +
    "product call site (verified MP-512). First-party pageviews come from " +
    "useRouteTelemetry as navigation.page_view instead, which is what " +
    "v_apply_funnel_conversion counts. Wiring this would add a SECOND pageview " +
    "writer, so it stays unemitted deliberately, not by oversight.",
};

const failures = [];
const notices = [];

// ── CONTRACT A ──────────────────────────────────────────────────────────────
const rawAnalytics = readFileSync(ANALYTICS, "utf8");
const analytics = stripComments(rawAnalytics);

const importMatch = analytics.match(
  new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${EMITTER_SPECIFIER.replace(/[/@]/g, "\\$&")}["']`)
);
let emitterLocalName = null;
if (!importMatch) {
  failures.push(
    `A: src/lib/analytics.ts does not import the first-party emitter from "${EMITTER_SPECIFIER}".\n` +
    `   Without it every product funnel event is a no-op against three unconfigured vendors.`
  );
} else {
  const clause = importMatch[1];
  const m = clause.match(/\btrack\b(?:\s+as\s+(\w+))?/);
  if (!m) {
    failures.push(`A: src/lib/analytics.ts imports from "${EMITTER_SPECIFIER}" but not its track export.`);
  } else {
    emitterLocalName = m[1] || "track";
  }
}

// The forward must live INSIDE the exported track(), not merely somewhere in
// the file — an import that nothing calls is the same darkness with an extra
// line of evidence against it.
const bodyMatch = analytics.match(/export\s+function\s+track\s*\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n\}/);
if (!bodyMatch) {
  failures.push("A: could not locate `export function track(...): void {` in src/lib/analytics.ts.");
} else if (emitterLocalName) {
  const body = bodyMatch[1];
  if (!new RegExp(`\\b${emitterLocalName}\\s*\\(`).test(body)) {
    failures.push(
      `A: src/lib/analytics.ts imports the first-party emitter as \`${emitterLocalName}\` but never calls it\n` +
      `   inside track(). The import alone writes nothing to public.analytics_events.`
    );
  }
}

// ── CONTRACT B ──────────────────────────────────────────────────────────────
const mapMatch = analytics.match(/const\s+META_EVENT_MAP\s*:\s*Record<[^>]*>\s*=\s*\{([\s\S]*?)\n\}/);
if (!mapMatch) {
  failures.push("B: could not locate META_EVENT_MAP in src/lib/analytics.ts.");
}
const declared = mapMatch
  ? [...mapMatch[1].matchAll(/^\s*([A-Za-z_][\w]*)\s*:/gm)].map((m) => m[1])
  : [];

// Product source = src/**, minus the tests (they must not vouch for
// themselves), minus the two telemetry modules (the map and the emitter are
// the things under test, not emitters of product intent).
const EXCLUDE_DIRS = new Set(["tests", "__tests__", "node_modules"]);
const EXCLUDE_FILES = new Set([
  resolve(ROOT, "src/lib/analytics.ts"),
  resolve(ROOT, "src/shared/telemetry/track.ts"),
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry)) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !EXCLUDE_FILES.has(full)) {
      out.push(full);
    }
  }
  return out;
}

const emitters = new Map(); // event name -> [files]
for (const file of walk(resolve(ROOT, "src"))) {
  const src = stripComments(readFileSync(file, "utf8"));
  for (const m of src.matchAll(/\btrack\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    if (!emitters.has(m[1])) emitters.set(m[1], []);
    emitters.get(m[1]).push(relative(ROOT, file));
  }
}

for (const event of declared) {
  if (emitters.has(event)) continue;
  const reason = KNOWN_UNEMITTED[event];
  if (reason) {
    notices.push(`  - ${event}: declared, deliberately unemitted. ${reason}`);
  } else {
    failures.push(
      `B: META_EVENT_MAP declares "${event}" but no product file calls track("${event}").\n` +
      `   It will never fire, for any vendor, no matter which keys are set. Either add the\n` +
      `   call site or record it in KNOWN_UNEMITTED with the reason it stays dark.`
    );
  }
}

// Stale allowlist entries rot into the 465-fake-success shape: an exemption
// that silently stopped applying still reads as a considered decision.
for (const event of Object.keys(KNOWN_UNEMITTED)) {
  if (!declared.includes(event)) {
    failures.push(`B: KNOWN_UNEMITTED lists "${event}", which META_EVENT_MAP no longer declares. Drop it.`);
  } else if (emitters.has(event)) {
    failures.push(
      `B: KNOWN_UNEMITTED says "${event}" is deliberately unemitted, but ${emitters.get(event)[0]} now emits it.\n` +
      `   Remove the exemption so the contract grades it.`
    );
  }
}

if (notices.length) {
  console.log("[check-funnel-telemetry-sink] declared-but-unemitted, by decision:");
  for (const n of notices) console.log(n);
}

if (failures.length) {
  console.error(`[check-funnel-telemetry-sink] ${failures.length} violation(s):\n`);
  for (const f of failures) console.error(f + "\n");
  process.exit(1);
}

console.log(
  `[check-funnel-telemetry-sink] OK — forward present; ` +
  `${declared.length - notices.length}/${declared.length} declared events have product emitters ` +
  `(${emitters.size} distinct events emitted across src/).`
);
