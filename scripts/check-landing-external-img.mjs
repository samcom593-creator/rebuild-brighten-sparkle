#!/usr/bin/env node
// check-landing-external-img — Website Integrity Bot (2026-11-10).
//
// Fails the build if any user-facing surface pulls an image/avatar from a
// third-party stock / generated-avatar / placeholder CDN.
//
// WHY THIS CLASS IS BANNED (two independent harms, both measured on this repo):
//
//  1. Runtime single-point-of-failure on the conversion surface. The landing
//     page's Testimonials section ("Real agents · real receipts") rendered its
//     three agent avatars from https://api.dicebear.com/9.x/initials/svg?seed=…
//     — a third-party HTTP call on every page load. DiceBear being up the
//     minute you check is luck, not a guarantee; the day it rate-limits, is
//     blocked by a corporate network, or 500s, a recruit deciding whether to
//     join Galaxy sees three broken images directly under the word "Real".
//     The fix (f-this-wave) was pure inline initials: zero network, same look.
//
//  2. Fake imagery under a truth claim. Every host below serves generated,
//     random, or stock pictures. A stock/generated face sitting beside a named
//     agent's real quote and real production number is the visual version of
//     the placeholder-testimonial strings check-forbidden-language already
//     bans ("real results from a real …", wired once to "VSL Test"). This app
//     has a real image home — Supabase storage (getAvatarUrl) — plus inline
//     initials for people with no photo. These CDNs have no legitimate use
//     here, which is exactly why a host banlist is zero-false-positive.
//
// High-confidence bans only, same philosophy as check-forbidden-language:
// a guard that cries wolf is one nobody reads. First-party hosts
// (apex-financial.org, *.supabase.co, youtube.com, calendly.com) are NOT
// listed and never trip. data: URIs are fine. Comments are skipped so a
// receipt line naming a host for the record does not self-trigger.
//
// To add a host: append to BANNED_IMG_HOSTS with a one-line reason.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const SRC = path.join(repoRoot, "src");

// Third-party stock / generated-avatar / placeholder image CDNs. Each has no
// legitimate use in this product (real photos live in Supabase storage; people
// without a photo get an inline initials avatar).
const BANNED_IMG_HOSTS = [
  ["api.dicebear.com", "generated-initials avatar CDN — render initials inline (zero network); this app's real avatars live in Supabase storage"],
  ["dicebear.com", "generated-avatar CDN — render inline instead"],
  ["gravatar.com", "third-party avatar CDN — a stock monogram under a real name reads as fake; use Supabase storage or inline initials"],
  ["ui-avatars.com", "generated-initials avatar CDN — render inline instead"],
  ["pravatar.cc", "random-face avatar CDN — a stranger's face under a real testimonial is a lie; use the real agent's photo or inline initials"],
  ["randomuser.me", "random fake-person API — never ship a fabricated identity on a page selling real results"],
  ["unsplash.com", "stock-photo CDN — name the real asset; stock imagery under a truth claim reads as fake"],
  ["images.unsplash.com", "stock-photo CDN — use a first-party asset"],
  ["source.unsplash.com", "stock-photo CDN — use a first-party asset"],
  ["loremflickr.com", "placeholder-image CDN — placeholder content must never ship"],
  ["picsum.photos", "placeholder-image CDN — placeholder content must never ship"],
  ["placehold.co", "placeholder-image CDN — placeholder content must never ship"],
  ["placeholder.com", "placeholder-image CDN — placeholder content must never ship"],
  ["placekitten.com", "placeholder-image CDN — placeholder content must never ship"],
];

const TEXT_EXTS = new Set([".tsx", ".ts", ".jsx", ".js", ".html", ".css"]);

// The SHIPPED banner is a prose fix-record: it NAMES the banned hosts by
// design (that's the whole point of a receipt), and a prose string can never
// render an <img src>, so the risk this guard exists for cannot live here.
// Same exemption posture as check-forbidden-language carries for banner/receipt
// files. Add sparingly — the goal is live, user-facing image sources.
const SKIP_FILES = new Set([
  "src/data/shipped-data.ts",
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (TEXT_EXTS.has(path.extname(entry))) {
      if (!SKIP_FILES.has(path.relative(repoRoot, full))) out.push(full);
    }
  }
  return out;
}

// Strip // line comments and /* */ block comments so a host named in a comment
// (e.g. this very mechanism documented in another file) never self-triggers.
// Line-based: good enough for our source and matches check-forbidden-language's
// posture — a banned host in a string literal is what we are after.
function stripComments(src) {
  // remove block comments first (across lines), then line comments
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      // crude but safe: only strip when // is not obviously inside a URL scheme
      // (https://). We look for "//" NOT immediately preceded by ":".
      if (i === -1) return line;
      if (i > 0 && line[i - 1] === ":") {
        // could still have a trailing comment after the URL; find a later //
        const j = line.indexOf("//", i + 2);
        if (j === -1) return line;
        if (line[j - 1] === ":") return line;
        return line.slice(0, j);
      }
      return line.slice(0, i);
    })
    .join("\n");
}

const violations = [];
for (const file of walk(SRC)) {
  const raw = readFileSync(file, "utf8");
  const scrubbed = stripComments(raw);
  const lines = scrubbed.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const lower = lines[n].toLowerCase();
    for (const [host, reason] of BANNED_IMG_HOSTS) {
      if (lower.includes(host)) {
        violations.push({
          file: path.relative(repoRoot, file),
          line: n + 1,
          host,
          reason,
          text: lines[n].trim().slice(0, 120),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\n❌ check-landing-external-img: ${violations.length} third-party image/avatar CDN reference(s) in user-facing source.\n`
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.host}]`);
    console.error(`     ${v.reason}`);
    console.error(`     > ${v.text}`);
  }
  console.error(
    `\n  Real photos belong in Supabase storage (getAvatarUrl); people without one`
  );
  console.error(`  get an inline initials avatar. These CDNs are a runtime SPOF and read`);
  console.error(`  as fake imagery under real claims. Replace with an inline/first-party asset.\n`);
  process.exit(1);
}

console.log(
  `check-landing-external-img: 0 third-party image/avatar CDN references across src/ (${BANNED_IMG_HOSTS.length} hosts banned). ✅`
);
process.exit(0);
