#!/usr/bin/env node
// Fails the build if a founder-headshot image that Sam explicitly ordered OFF
// the public surface is present under public/img/ (and would therefore deploy
// to galaxyfinancial.org/img/<name> on the next Vercel build).
// Owned by Website Integrity Bot.
//
// Why this guard exists:
//   2026-09-08, commit 3e58b71b ("remove shirtless founder photo") removed the
//   founder-credit <picture> REFERENCE from HeroSection.tsx — but the three
//   image FILES baked into public/img/ by the wave-56 perf change (1c368fe4)
//   were never deleted. Vite copies public/ verbatim into dist/, so the exact
//   shirtless club photo Sam pulled kept shipping and stayed publicly fetchable
//   at /img/founder-headshot-{88,132}.* for 73 days (verified HTTP 200 on prod
//   2026-11-20) even though the rendered hero shows a text "SJ" monogram. A
//   directive half-executed is a leak: the rejected image was off the page but
//   still on the origin.
//
// Precision: this pins the EXACT rejected filenames, NOT a founder-headshot-*
//   glob. The wave-56 scheme is "a future re-headshot just changes the filename
//   and busts cache" — so a NEW, approved professional headshot will arrive
//   under a new hash-suffixed filename and must NOT be blocked. Banning the glob
//   would stop the very fix the trust gap is waiting on. We ban only the three
//   files that ARE the 2026-09-08-rejected shirtless set.
//
// To clear a legitimate future headshot through this guard: ship it under a new
//   filename (e.g. founder-headshot-<newsha>-{88,132}.webp) and wire it into
//   HeroSection's founder credit. Never re-create the names below.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");

// The exact files removed from the public surface on 2026-09-08 (3e58b71b).
// Relative to the scanned "public" directory.
export const FORBIDDEN_PUBLIC_ASSETS = [
  "img/founder-headshot-132.webp",
  "img/founder-headshot-88.webp",
  "img/founder-headshot-88.jpg",
];

// Pure, testable: returns the subset of FORBIDDEN_PUBLIC_ASSETS that exist
// under `publicDir`.
export function scanForForbidden(publicDir) {
  const offenders = [];
  for (const rel of FORBIDDEN_PUBLIC_ASSETS) {
    const abs = path.join(publicDir, rel);
    if (fs.existsSync(abs)) offenders.push(rel);
  }
  return offenders;
}

function runSelftest() {
  const failures = [];

  // Direction 1: a tree carrying a rejected file MUST be flagged.
  const dirtyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmfp-dirty-"));
  try {
    const imgDir = path.join(dirtyRoot, "img");
    fs.mkdirSync(imgDir, { recursive: true });
    fs.writeFileSync(path.join(imgDir, "founder-headshot-88.webp"), "fake-bytes");
    const hits = scanForForbidden(dirtyRoot);
    if (!hits.includes("img/founder-headshot-88.webp")) {
      failures.push("selftest D1: detector did NOT flag a present rejected file (coverage is vacuous)");
    }
  } finally {
    fs.rmSync(dirtyRoot, { recursive: true, force: true });
  }

  // Direction 2a: an empty tree passes.
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rmfp-clean-"));
  try {
    const hits = scanForForbidden(cleanRoot);
    if (hits.length !== 0) {
      failures.push(`selftest D2a: clean tree flagged ${JSON.stringify(hits)}`);
    }
    // Direction 2b: a NEW, differently-named approved headshot must PASS —
    // the guard must not block the future-headshot path.
    const imgDir = path.join(cleanRoot, "img");
    fs.mkdirSync(imgDir, { recursive: true });
    fs.writeFileSync(path.join(imgDir, "founder-headshot-9f3a1c-88.webp"), "new-approved");
    const hits2 = scanForForbidden(cleanRoot);
    if (hits2.length !== 0) {
      failures.push(`selftest D2b: a new hash-suffixed headshot was wrongly flagged ${JSON.stringify(hits2)}`);
    }
  } finally {
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error("check-removed-founder-photo SELFTEST FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("check-removed-founder-photo selftest OK (3/3 directions)");
  process.exit(0);
}

function main() {
  if (process.argv.includes("--selftest")) return runSelftest();

  const publicDir = path.join(repoRoot, "public");
  const offenders = scanForForbidden(publicDir);
  if (offenders.length) {
    console.error(
      "check-removed-founder-photo FAILED: a founder-headshot image Sam ordered off\n" +
      "the public surface on 2026-09-08 (commit 3e58b71b) is present under public/ and\n" +
      "will deploy to galaxyfinancial.org/img/<name>:",
    );
    for (const rel of offenders) console.error("  - public/" + rel);
    console.error(
      "\nThese are the rejected shirtless-photo files. Remove them. A NEW approved\n" +
      "headshot must ship under a new hash-suffixed filename (see this script's header).",
    );
    process.exit(1);
  }
  console.log(`check-removed-founder-photo OK — none of ${FORBIDDEN_PUBLIC_ASSETS.length} rejected founder-headshot files present in public/`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
