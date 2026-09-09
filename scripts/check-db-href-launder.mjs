#!/usr/bin/env node
// check-db-href-launder.mjs — MP-497
//
// THE CLASS: a value that arrives from the database and is handed straight to
// an <a href>. If it carries no scheme, the browser resolves it RELATIVE to the
// current page. MP-495 found this live on 2026-09-09: three carrier rows held
// `aflac.com` / `gtlic.com` / `instabrain.io`, so the "Website" button on
// /dashboard/contracting navigated to /dashboard/contracting/aflac.com. Nothing
// could see it — vercel.json serves 200 for any URL (MP-295) so uptime
// monitoring reads health, check-dead-internal-links only reads literal hrefs
// in source, and tsc sees a string. It was fixed at ONE page. This guard owns
// the class so the next one cannot ship.
//
// WHAT WAS ACTUALLY MEASURED, so nobody quotes this as a leak
//
//   Every URL-ish text column in prod was swept (132 matched by name, 119 after
//   dropping analytics partitions and _backup mirrors). SEVEN hold scheme-less
//   values, and six of those are the SAME carrier family MP-495 already found:
//     carriers.website 3/16 · agentlink_carriers.website 3/16
//     apex_carrier_contracts.carrier_portal_url 1/10 · plus their views
//   The seventh was REFUSED as a name-shape false positive:
//   v_mentorship_payment_links.payment_link_id reads "4 scheme-less of 4", and
//   its values are `plink_1TYfhsC3Khd8IPVm...` — Stripe payment-link IDs, not
//   URLs. A column-name regex answers "what is this column called", not "what
//   does it hold" (the operand error this repo keeps re-learning).
//
//   Every column feeding the 15 sites below measures ZERO scheme-less values
//   today: next_step_stages.next_action_url is https://apex-financial.org/...,
//   interview_events.reschedule_url is https://calendly.com/..., and
//   onboarding_modules.video_url is 19/19 anchored. So this guard ships as
//   PREVENTION. It is LATENT, and it says so rather than implying a live leak.
//
// THE FIX THAT WOULD BREAK PRODUCTION, written down because it is the obvious one
//
//   "Route all 15 through externalHref()" is WRONG and would delete working
//   links. externalHref refuses anything without a hostname, and several of
//   these values are INTERNAL PATHS: AgentOnboardingStepper.tsx:164 sets
//   action_url to "/dashboard/profile", :184 to "/start-contracting". Passing
//   those through externalHref returns null and the caller renders its no-link
//   state — an onboarding step whose button vanishes. A value needs a helper
//   that passes a leading-slash path through and only prefixes https:// on a
//   bare domain. Fix per site, on the values that site actually receives.
//
// WHY THE BASELINE IS A SET OF IDENTITIES AND NOT A COUNT
//
//   A count-only floor is fungible: MP-356 proved a real regression can sit red
//   for 8 commits and then be absorbed by an unrelated pay-down, and MP-357
//   proved an auth floor could be satisfied by allowlisting a bystander. Keyed
//   on file + expression, fixing one site can never buy the right to add
//   another. New identity => red, regardless of the total.

import fs from "node:fs";
import path from "node:path";
import { scanHrefSites, DB_ROW_SHAPE, REPO_ROOT } from "./lib/href-anchor.mjs";

const BASELINE_PATH = path.join(REPO_ROOT, "scripts/data/db-href-baseline.json");
const ROOTS = [path.join(REPO_ROOT, "src")];

const rows = scanHrefSites(ROOTS);
if (rows.length === 0) {
  // An empty scan is "could not look", never a pass (MP-399).
  console.error("✗ check:db-href-launder — scanned 0 href sites; the scan roots or the parser are broken, not the code");
  process.exit(1);
}

const unproven = rows.filter((r) => !r.safe);
const dbShaped = unproven.filter((r) => DB_ROW_SHAPE.test(r.expr));
const key = (r) => `${r.file}::${r.expr}`;
const live = new Set(dbShaped.map(key));

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).sites);
const added = [...live].filter((k) => !baseline.has(k)).sort();
const fixed = [...baseline].filter((k) => !live.has(k)).sort();

const t = `${rows.length} href sites · ${rows.length - unproven.length} anchored/laundered/guarded · ${dbShaped.length} DB-row-shaped`;

if (added.length) {
  console.error(`✗ check:db-href-launder — ${added.length} new DB-row-shaped href site(s) not laundered (${t})`);
  for (const k of added) {
    const r = dbShaped.find((x) => key(x) === k);
    console.error(`    ${r.file}:${r.line}  href={${r.expr}}`);
  }
  console.error("  A scheme-less DB value in an href navigates INSIDE the app (MP-495).");
  console.error("  Do NOT reach for externalHref() blindly — it returns null for an internal");
  console.error("  path like \"/dashboard/profile\" and deletes the link. See this file's header.");
  process.exit(1);
}

if (fixed.length) {
  console.log(`✓ check:db-href-launder — ${dbShaped.length} known, ${fixed.length} newly laundered (${t})`);
  for (const k of fixed) console.log(`    fixed: ${k}`);
  console.log(`  Ratchet drop available: remove these from ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
} else {
  console.log(`✓ check:db-href-launder — ${dbShaped.length} known DB-row-shaped sites, 0 new (${t})`);
}
// Context, never a verdict: these could not be proven either way, and this
// guard does not claim they are defects (MP-276: unprovable is its own outcome).
console.log(`  ${unproven.length - dbShaped.length} further href sites unprovable by call shape — reported, not graded`);
