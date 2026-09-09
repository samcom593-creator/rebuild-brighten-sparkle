#!/usr/bin/env node
/**
 * check-deployed-function-freshness.mjs — MP-490
 *
 * WHAT THIS GRADES
 * For every edge function with source here, is the CODE RUNNING IN PROD the code
 * this repo committed? Not "did the workflow go green" — the deployed body itself.
 *
 * WHY IT EXISTS
 * MP-423 shipped check-deployed-function-source.mjs, which grades prod -> repo:
 * every ACTIVE slug must have a source directory. That is one direction only. A
 * function can be ACTIVE, have a source directory, pass that guard, and still be
 * running code from five days ago. Nothing graded the other direction.
 *
 * It had teeth. Measured 2026-09-09: send-password-reset was serving version 173,
 * deployed 09-06, while MP-443's fix to it had been committed on 09-08 — the fix
 * for the exact thing Sam reported ("Isaiah and other agents ... we can't log in").
 * Proven by marker, not by timestamp: three distinct strings from that commit were
 * present in the repo and absent from the deployed body. send-instagram-dm was
 * 31 days behind its own source.
 *
 * THE MECHANISM, WHICH IS STRUCTURAL AND WILL RECUR
 * deploy-supabase.yml deploys CHANGED_FUNCTIONS — the functions touched by THAT
 * commit's diff. So when a deploy is skipped or fails (the SUPABASE_ACCESS_TOKEN
 * was 401 from 2026-09-04 until it was replaced 09-09T02:57Z), the functions
 * committed during that window are never retried. No later commit's diff contains
 * them. They stay stale until a human happens to touch the file again. There is no
 * self-healing path, and until this guard there was no detection either.
 *
 * WHY THE VERDICT IS BODY-CONTAINMENT AND NOT A TIMESTAMP
 * updated_at vs commit-time is the cheap PREFILTER and it is sound in one
 * direction only: a deploy that happened AFTER the newest commit touching a
 * function cannot be missing that commit, so those are skipped without a fetch.
 * The reverse is not sound — commit and deploy timestamps land seconds apart in
 * either order on a normal push, which produced 15 false candidates out of 17 when
 * graded on time alone. So every candidate is settled by reading the deployed body
 * and requiring the current entry file's signature lines to be present in it.
 *
 * KNOWN LIMIT, STATED RATHER THAN HIDDEN: containment proves the deployed bundle
 * CONTAINS today's source lines. A commit that only DELETES lines leaves no
 * missing line to find, so this guard does not see deletion-only drift. It owns
 * "new code never reached prod", which is the failure mode that was live.
 *
 * WHY A GRACE WINDOW, AND WHY IT IS NOT A WAY TO GO GREEN
 * A commit that touches a function is stale by construction for the minutes
 * between the push and the deploy job finishing. Grading that as failure makes
 * this a permanently-red guard on every function-touching commit — the disease
 * apex-doctor Check #19's own header warns about and that this repo has now
 * shipped six costumes of. Candidates newer than DEPLOY_GRACE_MIN (default 120)
 * are reported as `pending` and do not vote. They are still PRINTED, so a deploy
 * that never lands does not disappear between runs; it ages into STALE on its own.
 *
 * UNKNOWN IS NOT A PASS
 * The management API throttles body reads with HTTP 403 — verified transient here
 * (applicant-magic-link 403 under load, 200 on a spaced retry), which is why this
 * paces requests and backs off. A body that cannot be read is UNKNOWN: it never
 * counts as fresh, and with --strict it fails the run rather than quietly
 * shrinking the graded set. An absence is not a verdict (MP-485).
 *
 * CREDENTIAL
 * SUPABASE_ACCESS_TOKEN if set (CI), else ~/.config/apex-creds/call-lab-deploy.token.
 * That laptop token is scoped: 200 on /functions, 403 on /secrets and on listing
 * projects. It is the credential that performs this read, which is the one that
 * gets probed (MP-486). Note the file ~/.config/apex-creds/supabase-pat.token is
 * 401 and governs NOTHING in the CI deploy path — two waves read its 401 as
 * "nothing can deploy" while CI was deploying fine from a different credential.
 *
 * USAGE
 *   node scripts/check-deployed-function-freshness.mjs            # report + fail on STALE
 *   node scripts/check-deployed-function-freshness.mjs --report   # never fail (observation)
 *   node scripts/check-deployed-function-freshness.mjs --strict   # UNKNOWN also fails
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "xrzweoneiieddzxogewk";
const API = "https://api.supabase.com";
const FN_ROOT = "supabase/functions";
const GRACE_MIN = Number(process.env.DEPLOY_GRACE_MIN || 120);
const SIG_COUNT = 25;
const SIG_MIN_LEN = 45;

const argv = new Set(process.argv.slice(2));
const REPORT_ONLY = argv.has("--report");
const STRICT = argv.has("--strict");

/**
 * SELF-RETIRING ALLOWLIST.
 *
 * These two are stale for a reason a redeploy would make WORSE: config.toml
 * declares `verify_jwt = true` while prod serves them with verify_jwt = false,
 * so shipping today's source would flip a live surface's auth posture as a side
 * effect of a freshness fix. MP-483 was an entire wave on prod and the repo
 * disagreeing about exactly this on the content-* pair.
 *
 * An allowlist is how a gate becomes fungible (MP-357: a security floor graded
 * on a count let a brand-new endpoint with no auth pass green). So each entry
 * must KEEP EARNING its exemption: the guard re-derives the declared-vs-live
 * verify_jwt mismatch every run, and if the mismatch is gone the exemption is no
 * longer justified and the run FAILS until the entry is deleted. An exemption
 * that outlives its reason is the thing being prevented.
 */
const ALLOWLIST = new Map([
  ["content-library", "config.toml verify_jwt=true vs prod false — redeploy would gate a live surface"],
  ["slack-unlicensed-welcome", "config.toml verify_jwt=true vs prod false — redeploy would gate a live surface"],
]);

/** Declared verify_jwt per slug, from config.toml. `undefined` = no section (CLI default is true). */
function declaredVerifyJwt() {
  const out = new Map();
  let cfg = "";
  try { cfg = readFileSync("supabase/config.toml", "utf8"); } catch { return out; }
  const re = /\[functions\.([A-Za-z0-9_-]+)\]([\s\S]*?)(?=\n\[|$)/g;
  for (const m of cfg.matchAll(re)) {
    const vm = /verify_jwt\s*=\s*(true|false)/.exec(m[2]);
    out.set(m[1], vm ? vm[1] === "true" : undefined);
  }
  return out;
}

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const p = join(homedir(), ".config/apex-creds/call-lab-deploy.token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(path, tok, { text = false, attempts = 4 } = {}) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
      if (res.ok) return text ? await res.text() : await res.json();
      lastErr = `HTTP${res.status}`;
      // 403/429 from this endpoint is throttling, not a permission verdict.
      if (res.status !== 403 && res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastErr = e?.name || "fetch_error";
    }
    await sleep(2000 + i * 4000);
  }
  return { __error: lastErr };
}

function newestCommitEpoch(dir) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", dir], { encoding: "utf8" }).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

/** Longest substantive lines of the entry file — resilient to formatting, ignores comments. */
function signatureLines(file) {
  const lines = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= SIG_MIN_LEN && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
  return [...new Set(lines)].sort((a, b) => b.length - a.length).slice(0, SIG_COUNT);
}

async function main() {
  const tok = token();
  if (!tok) {
    console.error("✗ no management credential (SUPABASE_ACCESS_TOKEN or ~/.config/apex-creds/call-lab-deploy.token)");
    process.exit(REPORT_ONLY ? 0 : 1);
  }

  // A shallow clone (actions/checkout default fetch-depth: 1) answers
  // `git log -1 -- <dir>` with NOTHING for every function the head commit did
  // not touch. Every slug would then fall out of the candidate set and the run
  // would print a confident green while grading almost nothing — a silent
  // disable, which is worse than the staleness it is looking for. Refuse.
  let shallow = "false";
  try {
    shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim();
  } catch {
    console.error("✗ cannot run git here, so 'what did this repo commit' is UNKNOWN — refusing to grade.");
    process.exit(REPORT_ONLY ? 0 : 1);
  }
  if (shallow === "true") {
    console.error("✗ shallow clone: `git log` cannot see when each function last changed.");
    console.error("  This check needs full history — set `fetch-depth: 0` on actions/checkout.");
    console.error("  Refusing to report green off a history that is not there.");
    process.exit(REPORT_ONLY ? 0 : 1);
  }

  const list = await apiGet(`/v1/projects/${PROJECT_REF}/functions`, tok);
  if (list.__error || !Array.isArray(list)) {
    console.error(`✗ could not list functions (${list.__error || "unexpected shape"}) — UNKNOWN, not green`);
    process.exit(REPORT_ONLY ? 0 : 1);
  }
  const deployed = new Map(list.map((f) => [f.slug, f]));

  const slugs = readdirSync(FN_ROOT).filter((d) => {
    if (d.startsWith("_") || d === "tests") return false;
    try { return statSync(join(FN_ROOT, d)).isDirectory(); } catch { return false; }
  });

  const now = Date.now();
  const candidates = [];
  let skippedFresh = 0;
  for (const slug of slugs.sort()) {
    const fn = deployed.get(slug);
    if (!fn) continue; // prod->repo direction is MP-423's guard, not this one
    const ct = newestCommitEpoch(join(FN_ROOT, slug));
    if (!ct) continue;
    // Sound prefilter: deployed AFTER the newest commit => cannot be missing it.
    if (ct * 1000 <= fn.updated_at) { skippedFresh++; continue; }
    candidates.push({ slug, commitMs: ct * 1000, fn });
  }

  console.log(`deployed function freshness — ${slugs.length} source dirs, ${skippedFresh} provably current, ${candidates.length} to settle`);

  const stale = [], unknown = [], pending = [], fresh = [];
  for (const c of candidates) {
    const ageMin = (now - c.commitMs) / 60000;
    const entry = join(FN_ROOT, c.slug, "index.ts");
    if (!existsSync(entry)) { unknown.push({ ...c, why: "no index.ts" }); continue; }

    const body = await apiGet(`/v1/projects/${PROJECT_REF}/functions/${c.slug}/body`, tok, { text: true });
    if (typeof body !== "string") {
      unknown.push({ ...c, why: body.__error || "unreadable" });
      await sleep(900);
      continue;
    }
    const sig = signatureLines(entry);
    const missing = sig.filter((l) => !body.includes(l));
    if (missing.length === 0) fresh.push(c);
    else if (ageMin < GRACE_MIN) pending.push({ ...c, missing: missing.length, sig: sig.length, ageMin });
    else stale.push({ ...c, missing: missing.length, sig: sig.length, ageMin });
    await sleep(900);
  }

  // Split the exempt slugs out, and make each exemption re-prove itself.
  const declared = declaredVerifyJwt();
  const exempt = [], unjustified = [];
  for (let i = stale.length - 1; i >= 0; i--) {
    const s = stale[i];
    if (!ALLOWLIST.has(s.slug)) continue;
    stale.splice(i, 1);
    const d = declared.has(s.slug) ? declared.get(s.slug) : undefined;
    const effective = d === undefined ? true : d; // CLI default when unspecified
    if (effective === s.fn.verify_jwt) unjustified.push(s);
    else exempt.push(s);
  }

  const day = (ms) => ((now - ms) / 86400000).toFixed(2);
  for (const s of stale)
    console.log(`  🔴 STALE   ${s.slug} — prod is missing ${s.missing}/${s.sig} signature lines; newest commit ${day(s.commitMs)}d old, deployed ${new Date(s.fn.updated_at).toISOString().slice(0, 16)} (v${s.fn.version})`);
  for (const p of pending)
    console.log(`  ⏳ pending ${p.slug} — committed ${Math.round(p.ageMin)}m ago, inside the ${GRACE_MIN}m deploy window; not voting`);
  for (const u of unknown)
    console.log(`  ⚠️  UNKNOWN ${u.slug} — could not read deployed body (${u.why}); NOT counted as fresh`);
  for (const e of exempt)
    console.log(`  🟡 EXEMPT  ${e.slug} — stale ${day(e.commitMs)}d and NOT auto-deployable: ${ALLOWLIST.get(e.slug)}`);
  for (const u of unjustified)
    console.log(`  🔴 ALLOWLIST NO LONGER JUSTIFIED  ${u.slug} — config.toml and prod now AGREE on verify_jwt, so the reason for the exemption is gone. Deploy it and delete its ALLOWLIST entry.`);
  if (fresh.length) console.log(`  ✓ ${fresh.length} candidate(s) settled fresh by body read`);

  if (stale.length === 0 && unknown.length === 0 && unjustified.length === 0) {
    console.log(`✓ every function with source here is running its committed code${exempt.length ? ` (${exempt.length} exempt, named above)` : ""}`);
  }

  if (REPORT_ONLY) { console.log("(--report: observation only, not voting)"); return; }
  if (unjustified.length) {
    console.error(`\n✗ ${unjustified.length} allowlist entr(y/ies) no longer earn their exemption.`);
    process.exit(1);
  }
  if (stale.length) {
    console.error(`\n✗ ${stale.length} function(s) in prod are NOT running committed code.`);
    console.error(`  Redeploy each: supabase functions deploy <slug> --project-ref ${PROJECT_REF}`);
    console.error(`  A green deploy workflow does not clear this — deploy-supabase.yml only ships`);
    console.error(`  functions changed by that commit, so a skipped deploy is never retried.`);
    process.exit(1);
  }
  if (unknown.length && STRICT) {
    console.error(`\n✗ --strict: ${unknown.length} function(s) unreadable; an absence is not an all-clear.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("✗ check failed:", e?.message || e); process.exit(REPORT_ONLY ? 0 : 1); });
