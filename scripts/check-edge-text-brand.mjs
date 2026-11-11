#!/usr/bin/env node
/**
 * Edge-function TEXT brand guard — retired brand name in outbound recruit copy.
 *
 * WHY THIS EXISTS (2026-11-11, Website Integrity Bot)
 * The Galaxy rebrand (2026-10-08, PL-GALAXY-AFLAC) renamed the agency from APEX
 * to Galaxy. src/config/brand.ts and supabase/functions/_shared/brand.ts both
 * now resolve to "Galaxy Financial", and every outbound email/SMS/DM/caption
 * was swept clean the same day. This guard holds that line.
 *
 * It is the FIFTH guard in the src/-only-ratchet-blind-spot class. The others:
 *   check-brand-literals  → src/**.tsx?        (component copy)
 *   check-index-brand     → index.html         (<title>/<meta> share cards)
 *   check-manifest-brand  → vite.config.ts     (PWA install name)
 *   check-edge-svg-brand  → functions/ <text>  (brand burned onto award IMAGES)
 * and check-calendly-brand lives outside the repo entirely. Each covered a
 * surface the src/-only ratchet cannot see; each of those surfaces drifted for
 * a MONTH before it was caught (the Calendly event name, the PWA manifest,
 * index.html's twitter:site, the plaque footer @handle).
 *
 * THIS surface is the one with the widest blast radius and no watcher: the TEXT
 * BODY of edge-function email subjects, HTML, SMS, DM and social captions — the
 * words a recruit or agent actually reads in their inbox/phone. check-edge-svg
 * -brand watches the IMAGE a plaque draws; nothing watches the SENTENCE an
 * onboarding email writes. "Welcome to Apex Financial" shipping into a recruit
 * email is a dead-brand leak on the exact surface the whole rebrand was for —
 * and until this guard, it would land with no CI complaint.
 *
 * WHAT THIS GUARD CHECKS
 * NEGATIVE only: the retired brand's DISPLAY NAME ("Apex Financial") and a small
 * set of recruit-facing prose phrases ("Welcome to Apex", "the Apex family/
 * team/community", "join Apex", "Team Apex") must not appear in any edge-
 * function .ts file. The display name is the precise string BRAND_NAME replaced,
 * so a hit is unambiguously the dead brand a reader would see.
 *
 * WHAT THIS GUARD DELIBERATELY DOES NOT TOUCH (measured: 320 files, 0 hits)
 *   - Comments. Stripped via scripts/lib/strip-comments.mjs (the ONE repo
 *     stripper; a hand-rolled one mis-lexes apostrophes in prose — MP-474).
 *     Most Apex references in functions/ are code comments documenting the live
 *     Slack workspace name, the apply site, etc.
 *   - The domain apex-financial.org / Calendly org apexfinancialempire.com —
 *     these stay Apex by design (the Resend sending domain is verified; a
 *     rename resets reputation). Allowlisted and blanked before the test.
 *   - The social HASHTAG #APEXFinancialEmpire (post-plaque-to-instagram) — it
 *     matches the LIVE @apexfinancialempire IG handle, which content/social
 *     accounts keep on purpose (memory: project_apex_to_galaxy_rebrand). It has
 *     no space so "Apex Financial" never matches it; allowlisted belt-and-braces.
 *   - Env var names (APEX_BOT_TOKEN…), Gmail labels (Apex/XCEL), code
 *     identifiers, User-Agent strings — none are a reader's prose; the
 *     display-name-with-a-space pattern cannot collide with APEX_UNDERSCORE or
 *     apex-hyphen forms, and the allowlist blanks the rest.
 *
 * FAIL-LOUD: if brand.ts is unparseable or the functions tree yields zero .ts
 * files, the scan seam is broken and this exits non-zero. A guard that cannot
 * find its operand must never report green (the 465 fake-success rows).
 *
 * Literal/structural check, no build. Prove both directions instantly:
 *   node scripts/check-edge-text-brand.mjs --selftest
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BRAND = join(ROOT, "src/config/brand.ts");
const FUNCS = join(ROOT, "supabase/functions");

function die(msg) {
  console.error(`❌ check:edge-text-brand FAIL\n   ${msg}`);
  process.exit(1);
}

// --- retired-brand prose patterns (the words a recruit reads) -------------
// "Apex Financial" is the display name BRAND_NAME replaced; the rest are
// recruit-facing phrases that only ever appear in body copy, never identifiers.
const PATS = [
  /\bApex Financial\b/gi,
  /Welcome to Apex\b/gi,
  /\bthe Apex (family|team|community|standard|way|movement)\b/gi,
  /\bApex (family|team|community|movement|nation)\b/gi,
  /\bjoin(ing)? Apex\b/gi,
  /\bTeam Apex\b/gi,
];
// Blanked BEFORE the negative test — intentional Apex surfaces (domain, live IG
// handle hashtag, env var names, Gmail label). Blank (not delete) to keep byte
// offsets so reported line numbers stay true.
const ALLOW = [
  /apex-financial\.org/gi,
  /apexfinancialempire\.com/gi,
  /APEX_[A-Z0-9_]+/g,
  /#APEXFinancial\w*/gi,
  /#ApexFinancial\w*/gi,
  /Apex\/XCEL\w*/g,
  // The registered LEGAL entity in the CAN-SPAM postal address (_shared/email.ts
  // COMPANY_POSTAL_ADDRESS, "Galaxy Financial, a brand of Apex Financial Empire LLC,
  // 30 North Gould Street..."). Mail to the registered agent is accepted for the
  // LLC's legal name, so it must appear verbatim; the brand around it stays Galaxy.
  // Exact string only: "Apex Financial" anywhere else still fails.
  /Apex Financial Empire LLC/g,
];

function scan(src) {
  // 1) blank comments so documentation prose never votes
  let text = stripComments(src);
  // 2) blank the allowlisted intentional-Apex constructs, preserving offsets
  for (const re of ALLOW) text = text.replace(re, (m) => " ".repeat(m.length));
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const hits = [];
  for (const p of PATS) {
    p.lastIndex = 0;
    for (const m of text.matchAll(p)) {
      hits.push({ line: lineOf(m.index), match: m[0] });
    }
  }
  return hits;
}

// --- selftest: prove both directions, no filesystem writes ----------------
if (process.argv.includes("--selftest")) {
  const fails = [];
  // POSITIVE: the dead display name in a template literal must be caught
  const bad = 'const html = `<p>Welcome to Apex Financial — your contract is ready.</p>`;';
  if (scan(bad).length === 0) fails.push("dead-brand 'Apex Financial' body copy NOT caught");
  const badPhrase = 'const sms = "You just joined the Apex family. Reply STOP to opt out.";';
  if (scan(badPhrase).length === 0) fails.push("'the Apex family' prose NOT caught");
  // NEGATIVE: comment, domain, env var, and intentional IG hashtag must pass
  const okComment = '// Welcome to Apex Financial workspace — verified live 2026-09-07';
  if (scan(okComment).length > 0) fails.push("comment referencing dead brand wrongly flagged");
  const okDomain = 'const from = "sam@apex-financial.org";';
  if (scan(okDomain).length > 0) fails.push("sending domain apex-financial.org wrongly flagged");
  const okEnv = 'const tok = Deno.env.get("APEX_BOT_TOKEN") ?? "";';
  if (scan(okEnv).length > 0) fails.push("env var APEX_BOT_TOKEN wrongly flagged");
  const okHashtag = 'return `${label}\\n\\n#APEXFinancialEmpire #IUL #closer`;';
  if (scan(okHashtag).length > 0) fails.push("intentional live IG hashtag wrongly flagged");
  const okGalaxy = 'const html = `<p>Welcome to Galaxy Financial — your contract is ready.</p>`;';
  if (scan(okGalaxy).length > 0) fails.push("current brand 'Galaxy Financial' wrongly flagged");
  if (fails.length) die("SELFTEST FAILED:\n   - " + fails.join("\n   - "));
  console.log("✅ check:edge-text-brand --selftest OK — positive+negative both proven.");
  process.exit(0);
}

// --- live brand name, from brand.ts (same seam as the sibling brand guards) ---
let platform = "the current brand";
try {
  const pm = readFileSync(BRAND, "utf8").match(/platformName:\s*"([^"]+)"/);
  if (!pm) die("could not extract platformName from src/config/brand.ts");
  platform = pm[1];
} catch (e) {
  if (e && e.code === "EACCES") throw e;
  die(`cannot read brand config (${BRAND}). A guard that can't find its operand is not green.`);
}

// --- collect every edge-function .ts (skip tests + generated) -------------
function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    die(`cannot read ${dir} — the edge-function tree is the operand; scan seam broken.`);
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__pycache__") continue;
      out = out.concat(walk(p));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(FUNCS);
if (files.length === 0) die("found 0 edge-function .ts files — scan seam broken, refusing to report green.");

const leaks = [];
for (const file of files) {
  for (const h of scan(readFileSync(file, "utf8"))) {
    leaks.push({ file: file.slice(ROOT.length), line: h.line, match: h.match });
  }
}

if (leaks.length > 0) {
  const detail = leaks.map((l) => `   ${l.file}:${l.line}  "${l.match}"`).join("\n");
  die(
    `retired brand name appears in outbound edge-function copy — this is the ` +
      `SENTENCE a recruit/agent reads in an email, SMS, DM or social caption. ` +
      `Change it to the current brand "${platform}" (import BRAND_NAME from ` +
      `_shared/brand.ts rather than hardcoding the name):\n${detail}`
  );
}

console.log(
  `✅ check:edge-text-brand OK — ${files.length} edge-function files scanned; ` +
    `no retired "Apex Financial" brand name in any outbound email/SMS/DM/caption ` +
    `copy (brand "${platform}").`
);
