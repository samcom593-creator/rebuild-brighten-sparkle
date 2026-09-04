#!/usr/bin/env node
/**
 * check-deployed-function-source.mjs — MP-423
 *
 * WHAT THIS GRADES
 * Every edge function that is ACTIVE in the Supabase project must have source
 * in supabase/functions/<slug>/. A slug deployed to prod with no source here is
 * code that NO repo guard can see and that version control cannot restore.
 *
 * WHY A PROD-SIDE CHECK AND NOT ANOTHER REPO GUARD
 * MP-422 proved a live auth bypass: `.ilike("email", rawInput)` on a
 * verify_jwt=false endpoint, where a single "%" matched 628 of 628 profiles and
 * minted a magic-link session as the newest one, unauthenticated. It shipped
 * check-ilike-user-input.mjs, which walks supabase/functions and src — and then
 * recorded its own limit: "the repo guard owns source only, and it is the
 * authority on nothing deployed."
 *
 * That limit had teeth. Measured 2026-09-04: 259 functions ACTIVE in prod, 253
 * source directories here, and 6 slugs deployed with no source at all — 3 of
 * them verify_jwt=false. Every guard this repo has ever shipped walks
 * supabase/functions, so all six have been ungraded for their whole life. This
 * is the same shape as MP-345 ("the sweep stopped one directory short") except
 * the missing directory is not in the repo to be swept.
 *
 * WHERE THE CREDENTIAL LIVES, AND WHY THE CHECK LIVES THERE TOO
 * The obvious home was apex-doctor. It cannot be: BOTH management PATs on the
 * laptop (~/.config/apex-creds/supabase-pat.token and the .dead.20260805 copy)
 * return 401 Unauthorized as of 2026-09-04, so no daemon on that box can read
 * deployed state at all. The only live management credential is
 * secrets.SUPABASE_ACCESS_TOKEN inside .github/workflows/deploy-supabase.yml,
 * proven alive by the deploys that succeed from it daily. So the guard runs
 * there, before the deploy step.
 *
 * "COULD NOT LOOK" IS NOT A PASS
 * MP-399 shipped a check whose filter matched zero rows on every run it ever
 * made and printed green for its whole life; MP-363 recorded that UNPROVEN must
 * never be green and never a mere warning. So: in CI, an absent token or an
 * unreadable API is exit 1, never a silent pass. On a developer laptop (no CI,
 * no token) it prints SKIPPED and exits 0, because requiring every contributor
 * to hold a production PAT would make the guard something people disable.
 * Transient blips get 3 attempts with backoff first — MP-290's lesson, where
 * one unretried curl blamed a function for the network on a weekly report.
 *
 * KEYED ON IDENTITY, NOT ON A COUNT
 * MP-356/MP-357: a count-only floor is fungible. The baseline is a named SET in
 * scripts/data/deployed-function-orphans.json. A slug that is not in it fails,
 * whatever the total. The set shrinks by recovering source, never by adding.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FN_DIR = "supabase/functions";
const BASELINE = "scripts/data/deployed-function-orphans.json";
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "xrzweoneiieddzxogewk";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const IN_CI = !!process.env.CI;
const ATTEMPTS = 3;

function fail(msg) {
  console.error(`✗ check:deployed-function-source — ${msg}`);
  process.exit(1);
}

/** Source directories this repo ships. `_shared` and `tests` are not functions. */
function repoSlugs() {
  if (!existsSync(FN_DIR)) fail(`${FN_DIR} does not exist — wrong working directory?`);
  return new Set(
    readdirSync(FN_DIR).filter((e) => {
      if (e.startsWith("_") || e === "tests") return false;
      return statSync(join(FN_DIR, e)).isDirectory();
    }),
  );
}

async function fetchDeployed() {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`;
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (res.status === 200) {
        const body = await res.json();
        // The API has returned both a bare array and { functions: [...] }.
        // An unrecognised shape is an unanswered question, not an empty result —
        // MP-399: a confident wrong zero prints green forever.
        const list = Array.isArray(body) ? body : body?.functions;
        if (!Array.isArray(list)) return { ok: false, why: `unrecognised response shape: ${JSON.stringify(body).slice(0, 200)}` };
        if (list.length === 0) return { ok: false, why: "API returned zero functions — prod has 250+; treating an empty read as unanswered, not as a clean bill" };
        return { ok: true, list };
      }
      last = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      // 401/403 will not improve on retry.
      if (res.status === 401 || res.status === 403) break;
    } catch (e) {
      last = String(e?.message ?? e);
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return { ok: false, why: last || "no response" };
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const allowed = new Map(baseline.orphans.map((o) => [o.slug, o]));

if (!TOKEN) {
  if (IN_CI) {
    fail(
      "SUPABASE_ACCESS_TOKEN is unset in CI. This guard is the only thing that\n" +
      "  looks at deployed state; a silent pass here is the blank-means-green\n" +
      "  failure it exists to prevent. Wire the secret into the job env.",
    );
  }
  console.log(
    "○ check:deployed-function-source — SKIPPED (no SUPABASE_ACCESS_TOKEN, not CI).\n" +
    "  This guard is authoritative only where a live management credential exists,\n" +
    "  which is .github/workflows/deploy-supabase.yml. Both PATs on Sam's laptop\n" +
    "  return 401 as of 2026-09-04, so a local run cannot answer the question.",
  );
  process.exit(0);
}

const got = await fetchDeployed();
if (!got.ok) fail(`could not read deployed functions after ${ATTEMPTS} attempt(s) — ${got.why}`);

const active = got.list.filter((f) => f.status === "ACTIVE");
const repo = repoSlugs();
const orphans = active.filter((f) => !repo.has(f.slug)).sort((a, b) => a.slug.localeCompare(b.slug));

const novel = orphans.filter((f) => !allowed.has(f.slug));
const paidDown = [...allowed.keys()].filter((s) => !orphans.some((f) => f.slug === s)).sort();

// Reported as context, never graded: a function added to the repo has no
// deployment until this very run creates one, so "in repo, not deployed" is the
// normal state mid-wave and failing on it would block every new function.
const undeployed = [...repo].filter((s) => !active.some((f) => f.slug === s)).sort();

if (novel.length) {
  console.error(`✗ check:deployed-function-source — ${novel.length} function(s) ACTIVE in prod with NO source in this repo:\n`);
  for (const f of novel) {
    const pub = f.verify_jwt === false ? "  ⚠ verify_jwt=false — PUBLIC, callable without a JWT" : "";
    console.error(`    ${f.slug}  (v${f.version})${pub}`);
  }
  console.error(
    "\n  Source that exists only in the edge runtime is not under version control,\n" +
    "  cannot be restored if prod loses it, and is invisible to every guard in\n" +
    "  scripts/ — all of which walk supabase/functions.\n\n" +
    "  Recover it, do not baseline it. The source is readable from the deployed\n" +
    "  bundle via the Supabase management API (GET /v1/projects/<ref>/functions/\n" +
    "  <slug>/body). Commit it to supabase/functions/<slug>/ and, if the function\n" +
    "  is verify_jwt=false, add a [functions.<slug>] verify_jwt = false block to\n" +
    "  supabase/config.toml FIRST — deploying without it defaults the endpoint to\n" +
    "  requiring a JWT and takes a live public endpoint down.",
  );
  process.exit(1);
}

for (const s of paidDown) console.log(`  ✓ paid down — ${s} now has source in the repo; drop it from ${BASELINE}`);
if (undeployed.length) console.log(`  · ${undeployed.length} source dir(s) not yet deployed (normal mid-wave): ${undeployed.slice(0, 5).join(", ")}${undeployed.length > 5 ? " …" : ""}`);

const pubOrphans = orphans.filter((f) => f.verify_jwt === false).length;
console.log(
  `✓ check:deployed-function-source — ${active.length} ACTIVE function(s) in prod, ` +
  `${orphans.length} without repo source (${pubOrphans} of them public), all named in the baseline. No novel orphan.`,
);
