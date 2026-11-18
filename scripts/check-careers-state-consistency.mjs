#!/usr/bin/env node
// check-careers-state-consistency.mjs — every /careers/<state> row must be
// INTERNALLY consistent: its slug, display name, and USPS abbr must all name the
// SAME real US state. Owned by the Website Integrity Bot.
//
// WHY THIS EXISTS. The 10 /careers/<state> pages (StateCareerLanding.tsx, the
// single STATES array) exist to win the free Google-for-Jobs SERP slot for
// "life insurance agent jobs in <state>" — the highest-intent recruiting query.
// Each row feeds the per-state JobPosting structured data crawlers read:
//   title/description/addressLocality  <- cfg.name   ("Texas")
//   addressRegion (the Google geo code) <- cfg.abbr   ("TX")
//   url / route                         <- cfg.slug   ("texas")
// If a row's three fields disagree — a copy-paste typo like
//   { slug: "michigan", name: "Michigan", abbr: "MN" }   (wrong abbr)
//   { slug: "michigan", name: "Minnesota", abbr: "MN" }  (wrong name+abbr)
// — then /careers/michigan ships a JobPosting whose addressRegion/addressLocality
// point at the WRONG state. Google for Jobs shows the Michigan job under the
// wrong geography (or distrusts the mismatch and drops it), and the #1 recruiting
// channel for that market is silently wasted.
//
// EVERY EXISTING GUARD IS BLIND TO THIS:
//   - check-canonical-url.mjs Rule D extracts ONLY the `slug:` literals and
//     checks them against the sitemap (slug set ↔ sitemap parity). It never
//     reads `name:` or `abbr:`, so a row whose slug is a valid, sitemap-listed
//     slug but whose abbr names a different state passes clean.
//   - check-careers-hub.mjs proves /careers is a declared, advertised,
//     data-driven hub; it maps STATES into links but never validates a row's
//     internal name↔abbr↔slug agreement.
//   - scripts/careers-jobposting-render.mjs (seo:render) renders the live
//     JobPosting and grades the 5 Google-required fields — but it SAMPLES 2 of 10
//     state pages by design (florida + texas, one shared render path). The abbr
//     on the other 8 states is never read by anything. A typo on, say, ohio or
//     pennsylvania ships straight to Google.
// Same family as the src-only-ratchet blind spots and the careers render gap:
// a high-$ recruiting surface whose correctness no guard asserts across ALL rows.
//
// WHY PURE SOURCE, COMMIT-TIME, NO NETWORK. The STATES array is the single
// source of truth; the JobPosting is a deterministic projection of it. Validate
// the source once at commit time and every one of the 10 (or N) rows is covered
// — no 2-of-10 sampling, no live fetch, no false-page risk (this is NOT a timer
// daemon; that class has a long false-page history on this repo). A row can only
// be wrong if its literal is wrong, and the literal is right here in the tree.
//
// NO CURRENT LEAK (measured 2026-11-17): all 10 rows are internally consistent.
// This is PREVENTION for the day an 11th state is added or an abbr is
// fat-fingered — the same posture as the validThrough freshness guard.
//
// VERDICT. slug must equal slugify(name); abbr must equal the canonical USPS
// code for name (looked up in the 50-state + DC map below, so ANY future state
// Sam adds is validated, not just today's 10); abbr must be two uppercase
// letters and slug lowercase/hyphen. A name that is not a real US state fails the
// abbr lookup (catches "Minnnesota"-class typos too). Any mismatch -> exit 1.
// An empty/missing STATES array -> exit 1 (moved/renamed: same defensive posture
// as check-canonical-url Rule D's "no slug literals found").

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_LANDING =
  process.env.CAREERS_STATE_SOURCE ||
  resolve(__dirname, "../src/pages/StateCareerLanding.tsx");

// Canonical US state (+ DC) name -> USPS two-letter abbreviation. The single
// authority this guard grades against. Keyed by the exact display-name spelling
// used in StateCareerLanding's STATES array (title case, full name).
const US_STATE_ABBR = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
  "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI",
  "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
  "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME",
  "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
  "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE",
  "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
  "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
  "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
  "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
};

// slug := name lowercased, non-alphanumerics -> single hyphen, trimmed. This is
// the exact human-readable slug convention the STATES array uses
// (e.g. "North Carolina" -> "north-carolina").
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Parse the STATES array out of the source. Returns the ordered list of
// { slug, name, abbr } rows (region intentionally ignored — it feeds nothing a
// crawler reads). Returns [] if the array can't be located.
function parseStates(src) {
  const text = String(src || "");
  // Isolate the STATES array body so stray slug:/name: elsewhere can't leak in.
  // The regex ENDS at the array's opening "[" (anchoring here is load-bearing:
  // a plain indexOf("[") would grab the "[" inside "StateConfig[]" and read an
  // empty body).
  const header = /\bSTATES\s*:\s*StateConfig\[\]\s*=\s*\[/.exec(text);
  if (!header) return [];
  const from = header.index + header[0].length - 1; // index of the array's "["
  // Walk to the matching close bracket (the array is flat objects, depth<=1).
  let depth = 0;
  let end = -1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const body = text.slice(from + 1, end);
  const rows = [];
  const objRe = /\{[^{}]*\}/g;
  let m;
  while ((m = objRe.exec(body)) !== null) {
    const obj = m[0];
    const slug = (obj.match(/\bslug\s*:\s*["']([^"']*)["']/) || [])[1];
    const name = (obj.match(/\bname\s*:\s*["']([^"']*)["']/) || [])[1];
    const abbr = (obj.match(/\babbr\s*:\s*["']([^"']*)["']/) || [])[1];
    // Only count objects that look like a StateConfig (have all three).
    if (slug != null && name != null && abbr != null) {
      rows.push({ slug, name, abbr });
    }
  }
  return rows;
}

// Grade the parsed rows. Pure function: returns { fail: string[], ok: string[] }.
function gradeStates(rows) {
  const fail = [];
  const ok = [];
  if (!rows || rows.length === 0) {
    fail.push(
      "StateCareerLanding.tsx: STATES array not found or empty — cannot verify /careers state consistency (moved/renamed array?)."
    );
    return { fail, ok };
  }
  const seenSlug = new Set();
  for (const r of rows) {
    const { slug, name, abbr } = r;
    const problems = [];

    if (!slug || !name || !abbr) {
      problems.push(`missing field(s) (slug=${JSON.stringify(slug)} name=${JSON.stringify(name)} abbr=${JSON.stringify(abbr)})`);
    }
    if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      problems.push(`slug "${slug}" is not lowercase/hyphen form`);
    }
    if (slug && seenSlug.has(slug)) {
      problems.push(`slug "${slug}" is duplicated — a second row shadows it in VALID_BY_SLUG`);
    }
    if (slug) seenSlug.add(slug);

    if (abbr && !/^[A-Z]{2}$/.test(abbr)) {
      problems.push(`abbr "${abbr}" is not two uppercase letters (Google addressRegion expects a USPS code)`);
    }

    // The core cross-field invariants.
    if (name && slug) {
      const expectSlug = slugify(name);
      if (slug !== expectSlug) {
        problems.push(`slug "${slug}" != slugify(name "${name}") = "${expectSlug}" — /careers/${slug} renders "${name}" content under the wrong URL`);
      }
    }
    if (name) {
      const expectAbbr = US_STATE_ABBR[name];
      if (expectAbbr == null) {
        problems.push(`name "${name}" is not a real US state/DC (not in the canonical map) — JobPosting would ship an unrecognized location`);
      } else if (abbr && abbr !== expectAbbr) {
        problems.push(`abbr "${abbr}" != canonical USPS code "${expectAbbr}" for "${name}" — JobPosting addressRegion points at the WRONG state`);
      }
    }

    if (problems.length) {
      fail.push(`row { slug:"${slug}", name:"${name}", abbr:"${abbr}" }: ${problems.join("; ")}`);
    } else {
      ok.push(`${slug} -> ${name} (${abbr})`);
    }
  }
  return { fail, ok };
}

function runLive() {
  let src;
  try {
    src = readFileSync(STATE_LANDING, "utf8");
  } catch (e) {
    console.error(`❌ check:careers-state-consistency — cannot read ${STATE_LANDING}: ${e.message}`);
    process.exit(1);
  }
  const rows = parseStates(src);
  const { fail, ok } = gradeStates(rows);
  if (fail.length) {
    console.error("❌ check:careers-state-consistency — /careers state row(s) are internally inconsistent:");
    for (const f of fail) console.error("   • " + f);
    console.error(`\n${ok.length} row(s) clean, ${fail.length} broken. A wrong slug/name/abbr ships a mis-geo-tagged Google-for-Jobs JobPosting on the highest-intent recruiting query.`);
    process.exit(1);
  }
  console.log(`✅ check:careers-state-consistency CLEAN — ${ok.length} /careers state row(s) internally consistent (slug == slugify(name), abbr == canonical USPS code, no dup slugs):`);
  for (const o of ok) console.log("   ✓ " + o);
  process.exit(0);
}

function runSelftest() {
  let passed = 0;
  let failed = 0;
  const check = (label, cond) => {
    if (cond) {
      passed++;
      console.log(`  ✓ ${label}`);
    } else {
      failed++;
      console.error(`  ✗ ${label}`);
    }
  };

  // slugify behavior.
  check('slugify("North Carolina") === "north-carolina"', slugify("North Carolina") === "north-carolina");
  check('slugify("Ohio") === "ohio"', slugify("Ohio") === "ohio");
  check('slugify("District of Columbia") === "district-of-columbia"', slugify("District of Columbia") === "district-of-columbia");

  // CLEAN set passes (both single- and multi-word).
  const clean = [
    { slug: "florida", name: "Florida", abbr: "FL" },
    { slug: "north-carolina", name: "North Carolina", abbr: "NC" },
    { slug: "texas", name: "Texas", abbr: "TX" },
  ];
  check("clean rows -> 0 failures", gradeStates(clean).fail.length === 0 && gradeStates(clean).ok.length === 3);

  // DIRECTION 1: wrong abbr (the subtle, review-surviving typo).
  check(
    "wrong abbr {michigan,Michigan,MN} -> fail",
    gradeStates([{ slug: "michigan", name: "Michigan", abbr: "MN" }]).fail.length === 1
  );

  // DIRECTION 2: wrong name (slug/name disagree).
  check(
    "slug!=slugify(name) {florida,Georgia,GA} -> fail",
    gradeStates([{ slug: "florida", name: "Georgia", abbr: "GA" }]).fail.length === 1
  );

  // DIRECTION 3: name that is not a real US state.
  check(
    "non-state name {franklin,Franklin,FR} -> fail",
    gradeStates([{ slug: "franklin", name: "Franklin", abbr: "FR" }]).fail.length === 1
  );

  // DIRECTION 4: malformed abbr casing.
  check(
    "lowercase abbr {ohio,Ohio,oh} -> fail",
    gradeStates([{ slug: "ohio", name: "Ohio", abbr: "oh" }]).fail.length === 1
  );

  // DIRECTION 5: duplicate slug (shadows in VALID_BY_SLUG).
  check(
    "duplicate slug -> fail",
    gradeStates([
      { slug: "texas", name: "Texas", abbr: "TX" },
      { slug: "texas", name: "Tennessee", abbr: "TN" },
    ]).fail.length >= 1
  );

  // DIRECTION 6: empty STATES.
  check("empty rows -> fail", gradeStates([]).fail.length === 1);

  // parseStates actually extracts rows from a STATES-array source string.
  const synthSrc = `
export const STATES: StateConfig[] = [
  { slug: "florida",       name: "Florida",        abbr: "FL", region: "Southeast" },
  { slug: "north-carolina",name: "North Carolina", abbr: "NC", region: "Southeast" },
];
`;
  const parsed = parseStates(synthSrc);
  check("parseStates extracts 2 rows from a synthetic STATES array", parsed.length === 2);
  check("parseStates row 0 is florida/Florida/FL", parsed[0] && parsed[0].slug === "florida" && parsed[0].name === "Florida" && parsed[0].abbr === "FL");
  check("parseStates row 1 is north-carolina/North Carolina/NC", parsed[1] && parsed[1].name === "North Carolina" && parsed[1].abbr === "NC");
  // parseStates returns [] when the array is absent.
  check("parseStates returns [] when STATES array absent", parseStates("const x = 1;").length === 0);

  // parse+grade a corrupted source end-to-end (the real failure path). Assert
  // BOTH rows parsed and the failure is specifically the abbr mismatch — not a
  // vacuous empty-parse that trivially "fails" via the empty-array branch.
  const corruptSrc = synthSrc.replace('abbr: "NC"', 'abbr: "SC"');
  const corruptRows = parseStates(corruptSrc);
  const corruptGrade = gradeStates(corruptRows);
  check(
    "parse+grade catches an abbr typo injected into source (non-vacuously)",
    corruptRows.length === 2 && corruptGrade.fail.length === 1 && /USPS code "NC"/.test(corruptGrade.fail[0])
  );

  // The real shipped file must be CLEAN (guards against this guard rotting).
  let realClean = false;
  try {
    const realRows = parseStates(readFileSync(STATE_LANDING, "utf8"));
    realClean = realRows.length >= 1 && gradeStates(realRows).fail.length === 0;
  } catch { realClean = false; }
  check("the real StateCareerLanding.tsx parses and grades CLEAN", realClean);

  console.log(`\nselftest: ${passed}/${passed + failed} OK`);
  if (failed) {
    console.error("✗ selftest FAILED — detector is not firing in both directions.");
    process.exit(1);
  }
  console.log("✅ selftest OK — consistency detector fires in both directions (clean passes, every corruption class fails).");
  process.exit(0);
}

if (process.argv.includes("--selftest")) runSelftest();
else runLive();
