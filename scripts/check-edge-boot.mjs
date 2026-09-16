#!/usr/bin/env node
/**
 * check-edge-boot — does every deployed edge function LOAD?
 *
 * WHY THIS EXISTS (MP-548). create-lead-checkout ran `v.enum(TIERS).optional()`
 * at MODULE scope. Validator<T> is a plain function with no such method, so the
 * TypeError fired at import: the worker never booted and every request got
 * 500 WORKER_ERROR. That lasted 142 days and NOTHING reported it, because the
 * repo's own error telemetry (function_errors, 258 rows and live) is written by
 * logFunctionError INSIDE createHandler — a handler that never loaded cannot
 * log that it never loaded. Every DB-based monitor is blind to this class by
 * construction, so the only place to ask the question is over the wire.
 *
 * THE PROBE IS `OPTIONS`, DELIBERATELY. A POST would boot-check too, but it
 * also RUNS the function — probing 228 of those sends real email, writes rows
 * and pings Discord. OPTIONS reaches the worker (so a dead module still throws)
 * while createHandler answers it from the CORS branch before any work. Boot
 * coverage with no side effects.
 *
 * VERDICTS — 'could not look' is never laundered into 'fine':
 *   boots      2xx/4xx that is not an auth rejection — the module loaded.
 *   DEAD       5xx carrying WORKER_ERROR/BOOT_ERROR — module threw at import.
 *   unproven   401/403: the gateway refused before the worker ran (verify_jwt),
 *              so boot state is UNKNOWN. Reported, never counted as passing.
 *   absent     404 — in the repo, not deployed.
 *   unknown    transport failure after retries. Reported, never passing.
 *
 * This grades PRODUCTION, not the working tree, so it is NOT a commit gate —
 * a tree can be correct while prod runs last week's bytes (MP-398). Run it
 * from apex-doctor or by hand.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.APEX_FUNCTIONS_BASE ?? "https://xrzweoneiieddzxogewk.supabase.co/functions/v1";
const ROOT = join(import.meta.dirname, "..", "supabase", "functions");
const CONCURRENCY = 8;
const ATTEMPTS = 3;

const slugs = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(ROOT, d.name, "index.ts")))
  .map((d) => d.name)
  .sort();

async function probe(slug) {
  let lastErr = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE}/${slug}`, {
        method: "OPTIONS",
        headers: { Origin: "https://apex-financial.org", "Access-Control-Request-Method": "POST" },
        signal: AbortSignal.timeout(20000),
      });
      const body = (await res.text()).slice(0, 300);
      const looksBoot = /WORKER_ERROR|BOOT_ERROR|worker boot error|Function exited due to an error/i.test(body);
      if (res.status >= 500 && looksBoot) return { slug, verdict: "DEAD", status: res.status, body };
      if (res.status >= 500) return { slug, verdict: "unknown", status: res.status, body }; // 5xx w/o boot marker
      if (res.status === 404) return { slug, verdict: "absent", status: 404, body: "" };
      if (res.status === 401 || res.status === 403) return { slug, verdict: "unproven", status: res.status, body: "" };
      return { slug, verdict: "boots", status: res.status, body: "" };
    } catch (e) {
      lastErr = e;
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  return { slug, verdict: "unknown", status: 0, body: String(lastErr?.message ?? lastErr) };
}

const results = [];
for (let i = 0; i < slugs.length; i += CONCURRENCY) {
  results.push(...(await Promise.all(slugs.slice(i, i + CONCURRENCY).map(probe))));
}

const by = (v) => results.filter((r) => r.verdict === v);
const dead = by("DEAD"), unproven = by("unproven"), unknown = by("unknown"), absent = by("absent");

console.log(`check:edge-boot — OPTIONS probe of ${slugs.length} function(s) at ${BASE}`);
console.log(
  `  ${by("boots").length} boot · ${dead.length} DEAD · ${unproven.length} unproven(auth) · ` +
  `${absent.length} not deployed · ${unknown.length} unknown`
);
for (const r of dead) console.log(`  DEAD      ${r.slug} — HTTP ${r.status} ${r.body.slice(0, 90)}`);
for (const r of unknown) console.log(`  unknown   ${r.slug} — ${r.status || "transport"} ${r.body.slice(0, 90)}`);
if (unproven.length) console.log(`  unproven  ${unproven.map((r) => r.slug).join(", ")}`);
if (absent.length) console.log(`  absent    ${absent.map((r) => r.slug).join(", ")}`);

// An absence of observations is not an all-clear. The first draft of this
// script printed "ok — every deployed function loads its module" after 228
// consecutive connection failures: with the endpoint unreachable every probe
// lands in `unknown`, dead.length is 0, and the happy path fires. That is the
// blank-reads-as-green disease this very file exists to treat, so observing
// nothing is its own failure and says so.
if (!dead.length && by("boots").length === 0) {
  console.log(`\ncheck:edge-boot FAILED — 0 of ${slugs.length} function(s) could be observed at all.`);
  console.log(`  This is NOT an all-clear: no probe reached a worker, so boot state`);
  console.log(`  is unknown for every function. Check the base URL and this network.`);
  process.exit(1);
}

if (dead.length) {
  console.log(`\ncheck:edge-boot FAILED — ${dead.length} deployed function(s) throw at import.`);
  console.log(`  Nothing else will tell you: a module that dies before createHandler`);
  console.log(`  loads cannot write to function_errors. Redeploy after fixing:`);
  for (const r of dead) console.log(`    supabase functions deploy ${r.slug}`);
  process.exit(1);
}
// Qualify the all-clear by what was actually observed — never let unproven
// or unknown slugs hide inside the word "every".
const unobserved = unproven.length + unknown.length;
console.log(
  unobserved
    ? `\nok — ${by("boots").length} function(s) load their module; ${unobserved} NOT observed (see above).`
    : `\nok — all ${by("boots").length} deployed function(s) load their module.`
);
