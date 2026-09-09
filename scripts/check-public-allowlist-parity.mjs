#!/usr/bin/env node
/**
 * check-public-allowlist-parity.mjs — MP-492
 *
 * Two files answer "is this endpoint public", and nothing bound them together.
 *
 *   scripts/sync-functions-config.sh    PUBLIC_ALLOWLIST (bash array)
 *       Governs the WRITE. When a function directory has no [functions.<name>]
 *       stanza, this list decides whether the generated stanza says
 *       verify_jwt = false (listed) or true (not listed).
 *
 *   scripts/check-function-contracts.mjs  PUBLIC_ALLOWLIST (JS Set)
 *       Governs the REVIEW. Membership means "this function is verify_jwt=false
 *       on purpose, the gate was READ, and the rationale is written down". The
 *       184 public functions NOT in it are tolerated legacy debt held by a
 *       name-keyed baseline.
 *
 * WHY THIS IS A CONTAINMENT CHECK AND NOT A SINGLE SOURCE.
 *
 * The obvious fix — merge them into one list — was measured and refused. The
 * union is not the answer in either direction:
 *
 *   - Forcing the writer's list into the reviewed set would promote
 *     `daily-brief` into an allowlist whose entries mean "reviewed and gated".
 *     Its own entry in the writer file says the opposite in capitals: it is a
 *     RECORD OF EXPOSURE, proven readable with no Authorization header at all.
 *     Dressing that as an endorsement is the fake-success shape this repo has
 *     paid for repeatedly. It stays in the baseline, where it reads as debt.
 *
 *   - `billing-portal-redirect` is in the writer's list on purpose while having
 *     no source directory and no stanza: it is pre-registered so that the
 *     commit which restores its source cannot flip a LIVE public Stripe
 *     billing-portal endpoint to JWT-required as a side effect.
 *
 * So the invariant is DIRECTIONAL: reviewed ⊆ defaulted. Everything the
 * security guard has approved as public must also be defaulted public by the
 * writer. The reverse is reported and never graded.
 *
 * THE FAILURE IT CLOSES. This script only writes a stanza that is ABSENT, so
 * the hazard is not today's tree — measured 227/227 directories carry a stanza.
 * It is the commit that removes a stanza while its directory survives. The
 * writer then supplies the default, and for the eight functions that were
 * reviewed-but-not-defaulted the default was `true`. verify_jwt = true refuses
 * `Bearer <apex_bot_token>` at the gateway with UNAUTHORIZED_INVALID_JWT_FORMAT
 * — the caller dies before the handler runs, and pg_cron goes on recording
 * "succeeded" because that column reports whether net.http_post enqueued. That
 * is MP-491, which cost agentlink-clients-sync sixteen silent days.
 *
 * LATENT, and says so. Across 144 commits touching config.toml, 34 stanzas have
 * been removed and 0 left a surviving directory. This closes the direction
 * before it is exercised. No dollar figure: nothing is broken today.
 *
 * PARSING. Each list is handed to its OWN language's parser rather than to a
 * regex of mine — bash sources the array, node evaluates the Set literal — so
 * this guard cannot disagree with the tools about what the lists contain
 * (comments, quoting, line continuations). A regex that quietly matches nothing
 * is how a check prints green for its whole life (MP-399), so both extractions
 * must clear a floor AND find a control member before any verdict is read.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SH = path.join(REPO_ROOT, "scripts/sync-functions-config.sh");
const MJS = path.join(REPO_ROOT, "scripts/check-function-contracts.mjs");

const GOOD = "✓";
const BAD = "✗";

/** Ask bash for the array, using bash's own parser for comments and quoting. */
function readWriterList() {
  const src = fs.readFileSync(SH, "utf8");
  const m = /^PUBLIC_ALLOWLIST=\(\n[\s\S]*?^\)$/m.exec(src);
  if (!m) throw new Error(`could not locate PUBLIC_ALLOWLIST=( ... ) in ${path.relative(REPO_ROOT, SH)}`);
  const out = execFileSync("bash", ["-c", `${m[0]}\nprintf '%s\\n' "\${PUBLIC_ALLOWLIST[@]}"`], {
    encoding: "utf8",
  });
  return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
}

/** Ask node for the Set, using node's own parser on the literal. */
function readReviewedList() {
  const src = fs.readFileSync(MJS, "utf8");
  const m = /const PUBLIC_ALLOWLIST = (new Set\(\[[\s\S]*?^\]\));/m.exec(src);
  if (!m) throw new Error(`could not locate 'const PUBLIC_ALLOWLIST = new Set([ ... ]);' in ${path.relative(REPO_ROOT, MJS)}`);
  const value = new Function(`"use strict"; return (${m[1]});`)();
  if (!(value instanceof Set)) throw new Error("PUBLIC_ALLOWLIST literal did not evaluate to a Set");
  return value;
}

// A guard whose extractor silently matches nothing reports green forever. Both
// sides must clear a floor and contain a member that is load-bearing elsewhere.
const FLOOR = 20;
const CONTROL = "submit-application";

let writer, reviewed;
try {
  writer = readWriterList();
  reviewed = readReviewedList();
} catch (e) {
  console.error(`\n${BAD} check-public-allowlist-parity could not read its operands: ${e.message}`);
  console.error("  This is a failure, not a pass. The lists were not compared.");
  process.exit(1);
}

for (const [label, set, file] of [
  ["writer (sync-functions-config.sh)", writer, SH],
  ["reviewed (check-function-contracts.mjs)", reviewed, MJS],
]) {
  if (set.size < FLOOR || !set.has(CONTROL)) {
    console.error(`\n${BAD} the ${label} allowlist parsed to ${set.size} entries` +
      `${set.has(CONTROL) ? "" : ` and is missing the control '${CONTROL}'`}.`);
    console.error(`  Refusing to grade a list this guard probably failed to read: ${path.relative(REPO_ROOT, file)}`);
    process.exit(1);
  }
}

const missingFromWriter = [...reviewed].filter((f) => !writer.has(f)).sort();
const writerOnly = [...writer].filter((f) => !reviewed.has(f)).sort();

console.log(`Public-allowlist parity — reviewed ${reviewed.size}, writer ${writer.size}, in both ${[...reviewed].filter((f) => writer.has(f)).length}`);

if (writerOnly.length) {
  console.log(`\n  Writer-only (reported, never graded — ${writerOnly.length}):`);
  for (const f of writerOnly) console.log(`    - ${f}`);
  console.log("    Allowed by design: the writer may pre-register a function whose source is not");
  console.log("    yet in the repo, and may record an exposure that must not be called reviewed.");
}

if (missingFromWriter.length) {
  console.error(`\n${BAD} ${missingFromWriter.length} function(s) are approved public by the security guard but`);
  console.error("  are NOT in the writer's PUBLIC_ALLOWLIST:");
  for (const f of missingFromWriter) console.error(`    - ${f}`);
  console.error("");
  console.error("  Consequence: if any of these loses its [functions.<name>] stanza while its");
  console.error("  directory survives, sync-functions-config.sh writes verify_jwt = true over a");
  console.error("  reviewed public endpoint. The gateway then refuses its non-JWT caller before");
  console.error("  the handler runs, and pg_cron still records 'succeeded' — a silent death that");
  console.error("  cost agentlink-clients-sync sixteen days (MP-491).");
  console.error("");
  console.error(`  Fix: add each name to PUBLIC_ALLOWLIST in ${path.relative(REPO_ROOT, SH)}.`);
  console.error("  That preserves a decision already reviewed; it does not make a new one.");
  process.exit(1);
}

console.log(`\n${GOOD} every reviewed-public function is also defaulted public by the writer.`);
