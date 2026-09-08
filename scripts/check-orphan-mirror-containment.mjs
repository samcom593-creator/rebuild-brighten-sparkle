#!/usr/bin/env node
/**
 * check:orphan-mirror-containment — the recovered orphan mirrors must stay
 * un-deployable, and must stay honest about what production contains.
 *
 * WHY THIS EXISTS (MP-479)
 *
 * Five edge functions run in production with no source in this repo. MP-478
 * recovered their source out of the Supabase edge runtime and put the mirrors
 * at supabase/_recovered-orphans/<slug>/index.ts. Those mirrors are TRANSPILED
 * — types erased, formatting normalised — so deploying one would push a
 * machine-recovered approximation over hand-written live code. For
 * create-va-account and set-va-account that is an auth-level ban/unban path.
 *
 * Today that is impossible, and impossible for a good reason:
 * deploy-supabase.yml can only ever name a directory under supabase/functions/.
 * The deploy-all path runs `cd supabase/functions` then iterates every
 * subdirectory glob; the deploy-changed path derives slugs with
 * `awk -F/ '$1=="supabase" && $2=="functions" && NF>=4'`; workflow_dispatch's
 * only_function resolves to supabase/functions/<name>. Nothing outside that
 * directory is reachable by any of the three.
 *
 * But that safety is currently an accident of where someone put the files. This
 * guard makes it a contract. MP-479 was handed a spec to move the mirrors INTO
 * supabase/functions/ behind a deploy skip-list; that swaps an
 * impossible-by-construction property for a list a human maintains plus a guard
 * watching the list. MP-356 and MP-357 both shipped fixes for what happens to a
 * maintained set: it gets absorbed, allowlisted, or quietly widened, and the
 * gate stays green. A structural impossibility cannot be allowlisted.
 *
 * WHAT IT GRADES
 *   1. containment — no mirror path resolves under supabase/functions/.
 *   2. no double-life — a slug is a mirror OR a real function, never both.
 *      Both at once means it was paid down without leaving the manifest, so it
 *      is graded as evidence and armed for deploy at the same time.
 *   3. evidence intact — the body below the banner still hashes to the sha256
 *      the manifest recorded, so a mirror cannot be edited to silence one of
 *      the five guards that now read it. A finding in a mirror is a fact about
 *      PRODUCTION; the fix is a prod deploy, never a repo edit.
 *   4. no drift either way — every manifest entry has a file, and every
 *      directory under the mirror root has a manifest entry.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not require the mirrors to be clean. They are a record of code that
 * already runs. If a mirror contains a real defect, the remedy is a production
 * deploy that needs a Management PAT this machine does not have — so grading
 * "mirror has a violation" as a blocking failure would be a permanently-red
 * gate whose remedy no process here can perform. apex-doctor Check #9 and
 * Check #19 both carry that lesson. The five widened guards report mirror
 * findings on their own terms; this one owns containment and integrity only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ORPHAN_MIRROR_DIR,
  readOrphanManifest,
  splitMirror,
} from "./lib/orphan-mirrors.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const manifest = readOrphanManifest();
const failures = [];
const notes = [];

const entries = (manifest.orphans ?? []).filter((o) => o.recovered_mirror?.path);
const listedDirs = new Set();

for (const o of entries) {
  const m = o.recovered_mirror;
  const rel = m.path.split(path.sep).join("/");
  listedDirs.add(path.dirname(rel));

  // (1) containment
  if (rel.startsWith("supabase/functions/")) {
    failures.push(
      `${o.slug}: mirror lives at ${rel} — INSIDE supabase/functions/, which every ` +
        `deploy path iterates. A transpiled mirror is now armed to overwrite live prod.`,
    );
    continue;
  }
  if (!rel.startsWith(`${ORPHAN_MIRROR_DIR}/`)) {
    failures.push(`${o.slug}: mirror at ${rel} is outside ${ORPHAN_MIRROR_DIR}/ — unclassified location.`);
    continue;
  }

  // (2) no double-life
  const realDir = path.join(repoRoot, "supabase", "functions", o.slug);
  if (fs.existsSync(realDir)) {
    failures.push(
      `${o.slug}: listed as an un-recovered orphan AND has real source at ` +
        `supabase/functions/${o.slug}/. If it was paid down, remove it from the ` +
        `manifest; until then it is graded as evidence and armed for deploy at once.`,
    );
  }

  // (4a) manifest -> file
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${o.slug}: manifest names ${rel} but no such file exists.`);
    continue;
  }

  // (3) evidence intact — body sha, using the manifest's own split contract
  const text = fs.readFileSync(abs, "utf8");
  const sentinel = m.body_sentinel;
  if (!sentinel) {
    failures.push(`${o.slug}: recovered_mirror has no body_sentinel — the sha256 cannot be verified from the record alone.`);
    continue;
  }
  const split = splitMirror(text, sentinel);
  if (!split.ok) {
    failures.push(`${o.slug}: ${split.reason} in ${rel} — banner structure changed, body cannot be located.`);
    continue;
  }
  const bodyBytes = Buffer.byteLength(split.body);
  const sha = crypto.createHash("sha256").update(split.body).digest("hex");
  if (sha !== m.sha256 || bodyBytes !== m.source_bytes) {
    failures.push(
      `${o.slug}: recovered body no longer matches the manifest.\n` +
        `      expected sha ${m.sha256} (${m.source_bytes}B)\n` +
        `      actual   sha ${sha} (${bodyBytes}B)\n` +
        `      A mirror is EVIDENCE of what prod runs. Editing it to silence a guard ` +
        `manufactures a false record of production; fix prod and re-recover instead.`,
    );
  }
  if (typeof m.banner_bytes === "number" && m.banner_bytes !== split.bannerBytes) {
    failures.push(
      `${o.slug}: banner_bytes says ${m.banner_bytes}, measured ${split.bannerBytes} — ` +
        `the two ways of locating the body disagree.`,
    );
  }
  notes.push(`  ok  ${o.slug.padEnd(26)} verify_jwt=${String(o.verify_jwt).padEnd(5)} body ${bodyBytes}B sha verified, outside the deploy path`);
}

// (4b) filesystem -> manifest
const mirrorRootAbs = path.join(repoRoot, ORPHAN_MIRROR_DIR);
if (fs.existsSync(mirrorRootAbs)) {
  for (const e of fs.readdirSync(mirrorRootAbs)) {
    const abs = path.join(mirrorRootAbs, e);
    if (!fs.statSync(abs).isDirectory()) continue;
    const rel = `${ORPHAN_MIRROR_DIR}/${e}`;
    if (!listedDirs.has(rel)) {
      failures.push(
        `${rel}/ exists on disk with no entry in deployed-function-orphans.json — ` +
          `an ungoverned mirror is read by no guard and vouched for by nothing.`,
      );
    }
  }
}

if (failures.length) {
  console.error(`\n✗ check:orphan-mirror-containment — ${failures.length} fault(s):\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error(
    `\n  These mirrors are the only copy of five live production edge functions.\n` +
      `  They stay OUTSIDE supabase/functions/ because that is the only thing that\n` +
      `  makes deploying a transpilation over live prod impossible rather than merely\n` +
      `  discouraged. See scripts/lib/orphan-mirrors.mjs.\n`,
  );
  process.exit(1);
}

console.log(
  `✓ check:orphan-mirror-containment — ${entries.length} recovered mirror(s) contained and verified.`,
);
for (const n of notes) console.log(n);
