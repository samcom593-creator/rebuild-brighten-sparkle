/**
 * Pure sell4daddy funnel-door parser — the single detector for the repo's two
 * live-edge funnel guards.
 *
 * WHY THIS LIB EXISTS (MP-WIB-GLOWUP-DOOR, 2026-11-17). The door set was parsed
 * by TWO guards with byte-identical copies of the same KEYWORDS slicer:
 *   check-lead-magnet-cta-live.mjs  — is each door's PAGE alive?
 *   check-funnel-share-card-live.mjs — is each door's OG/twitter CARD alive?
 * Two copies of a detector is the 21-copies-of-strip-comments disease: one copy
 * drifts, the guards silently watch different surfaces, and the newer one
 * acquits a dead door the other would catch. One lib, both import, no drift.
 *
 * The split that forced this lib: /glowup — "The 30-Day Glow-Up", an active
 * lead-magnet landing page on sell4daddy.com with its OWN nurture ladder
 * (BrandGrowthPanels "Glow-Up Ladder": live lead counts + a 5-email sequence) —
 * is a REAL public funnel door Sam links agents to, but it is NOT a keyword-CTA
 * reply door, so it was never in the KEYWORDS array, so NEITHER guard watched
 * it. Its page could 404 and its share card could die while every guard stayed
 * green — the exact blind spot 70d0c107 closed for team/body/build, one door
 * over.
 *
 * TWO SOURCE ARRAYS IN src/lib/brand.ts:
 *   KEYWORDS      — inbound keyword-CTA reply doors (TEAM/BODY/BUILD). REQUIRED.
 *                   Its absence/emptiness means brand.ts shape changed, so we
 *                   REFUSE to assert any surface dead (parseError, not []).
 *   LANDING_DOORS — public funnel landing pages that are live-edge watched but
 *                   carry no inbound reply (GLOWUP). OPTIONAL: an older brand.ts
 *                   without it simply contributes 0 extra doors, never an error.
 *
 * All pure: a string in, structured doors out. No fs, no network, no process.
 */

// Parse one `export const <NAME>: ... = [ ... ];` array of { key, ..., url }
// objects out of a brand-source string. Returns { doors, present }. `present`
// is false when the named array is absent (lets callers treat absence as fatal
// for KEYWORDS and benign for LANDING_DOORS). Only quoted key/url pairs match,
// so a `key: Keyword` TYPE annotation never counts as an entry.
export function parseNamedDoors(brandSrc, name) {
  const src = String(brandSrc || "");
  const anchor = src.indexOf(name);
  if (anchor < 0) return { doors: [], present: false };
  // slice from the declaration to the first "];" after it (the array close)
  const tail = src.slice(anchor);
  const closeIdx = tail.indexOf("];");
  const block = closeIdx >= 0 ? tail.slice(0, closeIdx) : tail;
  const doors = [];
  const seen = new Set();
  // match: key: "TEAM", ... url: "https://..."  — pull key+url pairs
  const entryRe = /key:\s*["']([A-Z0-9_]+)["'][\s\S]*?\burl:\s*["'](https?:\/\/[^"']+)["']/g;
  let m;
  while ((m = entryRe.exec(block))) {
    const key = m[1];
    const url = m[2].replace(/[.,;]+$/, "");
    if (seen.has(url)) continue; // a reply-string dup of the same url is not a 2nd door
    seen.add(url);
    doors.push({ key, url, label: `${key} door (${url})` });
  }
  return { doors, present: true };
}

// The full funnel door set BOTH live-edge guards must watch:
//   KEYWORDS (required) ∪ LANDING_DOORS (optional), deduped by url.
// Returns { doors, parseError }. parseError is non-null ONLY when the REQUIRED
// KEYWORDS array is missing or yields no doors — i.e. brand.ts shape changed and
// we must not assert anything dead off a broken parse (each guard's prior
// "refuse to assert" contract, preserved).
export function parseFunnelDoors(brandSrc) {
  const kw = parseNamedDoors(brandSrc, "KEYWORDS");
  if (!kw.present) {
    return { doors: [], parseError: "no KEYWORDS declaration found in brand source" };
  }
  if (!kw.doors.length) {
    return {
      doors: [],
      parseError: "KEYWORDS array found but no key/url door pairs parsed — brand.ts shape changed; refusing to assert any surface dead",
    };
  }
  const ld = parseNamedDoors(brandSrc, "LANDING_DOORS"); // optional; absence = 0 extra doors
  const seen = new Set(kw.doors.map((d) => d.url));
  const doors = [...kw.doors];
  for (const d of ld.doors) {
    if (seen.has(d.url)) continue;
    seen.add(d.url);
    doors.push(d);
  }
  return { doors, parseError: null };
}
