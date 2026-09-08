// Single source for "where the recovered orphan-function mirrors live".
//
// MP-478 recovered source for five edge functions that existed ONLY inside the
// Supabase edge runtime, and deliberately placed the mirrors OUTSIDE
// supabase/functions/. That placement is the whole safety property:
//
//   deploy-supabase.yml can only ever deploy a directory under
//   supabase/functions/. The deploy-all path does `cd supabase/functions`
//   and iterates `*/`; the deploy-changed path derives slugs with
//   `awk -F/ '$1=="supabase" && $2=="functions" && NF>=4'`. Neither can
//   name a path outside that directory.
//
// So a mirror cannot be deployed BY CONSTRUCTION, not by a list someone
// maintains. MP-479 was handed a spec to move the mirrors INTO
// supabase/functions/ behind a deploy skip-list; that trades an
// impossible-by-construction hazard for a mutable named set plus a drift
// guard, which is strictly weaker (MP-356/MP-357: a maintained list is
// fungible in a way a structural impossibility is not). The mirrors stay
// put; the GUARDS come to them instead.
//
// Roots are derived from scripts/data/deployed-function-orphans.json rather
// than hardcoded in each guard, so the scanned set and the manifest cannot
// drift apart — five guards restating one path is how Check #23 and Check #58
// ended up sharing variables 5,300 lines apart (MP-471), and how curl's
// --max-time and fn_agentlink_reap_stuck disagreed for 36 false pages a day.
//
// A slug is PAID DOWN by restoring its types and moving it to
// supabase/functions/<slug>/. When that happens it leaves this manifest, so it
// automatically stops being scanned as a mirror and starts being scanned as an
// ordinary function by the same guards. No guard edit is needed to hand a slug
// over.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const MANIFEST = path.join(repoRoot, "scripts", "data", "deployed-function-orphans.json");

// The directory the mirrors live under. Asserted to be outside
// supabase/functions/ by check-orphan-mirror-containment.mjs.
export const ORPHAN_MIRROR_DIR = "supabase/_recovered-orphans";

export function readOrphanManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

/**
 * Repo-relative directories holding recovered mirror source, derived from the
 * manifest. Only entries whose mirror path actually exists are returned; a
 * manifest entry pointing at a missing file is a drift fault owned by
 * check-orphan-mirror-containment.mjs, NOT silently swallowed here — a scan
 * root that quietly shrinks is how a guard stops measuring without going red.
 */
export function orphanMirrorRoots() {
  const manifest = readOrphanManifest();
  const dirs = new Set();
  for (const o of manifest.orphans ?? []) {
    const rel = o.recovered_mirror?.path;
    if (!rel) continue;
    if (!fs.existsSync(path.join(repoRoot, rel))) continue;
    dirs.add(path.dirname(rel));
  }
  return [...dirs].sort();
}

/** Manifest entries that declare a mirror, with their recorded sha256. */
export function orphanMirrorFiles() {
  const manifest = readOrphanManifest();
  return (manifest.orphans ?? [])
    .filter((o) => o.recovered_mirror?.path)
    .map((o) => ({
      slug: o.slug,
      rel: o.recovered_mirror.path,
      sha256: o.recovered_mirror.sha256,
      bytes: o.recovered_mirror.source_bytes,
      verify_jwt: o.verify_jwt,
    }));
}

/**
 * Split a mirror file into its provenance banner and the recovered body.
 *
 * The manifest's sha256/source_bytes describe the BODY — the bytes the Supabase
 * edge runtime actually returned — not the file on disk, which carries a ~1.6KB
 * banner on top. That rule was written in prose inside the banner itself, which
 * means the obvious checker (sha256 of the whole file) disagrees with the
 * manifest on every entry and reads as 5-of-5 drift on a set that is perfectly
 * intact. It did, when MP-479 ran exactly that check. A receipt whose
 * verification procedure lives only in prose is a receipt nobody can check, so
 * the split is a machine-readable field (body_sentinel / banner_bytes) and this
 * is the single implementation of it.
 */
export function splitMirror(text, sentinel) {
  const lines = text.split("\n");
  const marks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === sentinel) marks.push(i);
  }
  if (marks.length < 2) return { ok: false, reason: "banner terminator not found" };
  const body = lines.slice(marks[1] + 1).join("\n").replace(/^\n+/, "");
  return { ok: true, body, bannerBytes: Buffer.byteLength(text) - Buffer.byteLength(body) };
}
